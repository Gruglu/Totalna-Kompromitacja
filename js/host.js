// Panel prowadzącego: trzyma stan gry, rozsyła planszę i widoki na urządzenia graczy.
import * as E from './engine.js';
import { hostRoom, randomCode } from './net.js';
import * as media from './media.js';
import { rulesFor } from './rules.js';
import * as S from './season.js';
import * as avatars from './avatars.js';

const LS = { set: 'pk.set', state: 'pk.state', code: 'pk.code', mediaVer: 'pk.mediaVer' };
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {
      toast('Nie udało się zapisać stanu w przeglądarce');
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let set = null;
let state = null;
let history = [];
let code = store.get(LS.code) || randomCode();
store.set(LS.code, code);
let netStatus = 'connecting';
let room = null;
let setErrors = [];
let editing = null; // { kind: 'name'|'score', id }
let armedNew = false;
let addingPlayer = false;
let pendingLoad = null; // { jsons: [{ path, file }], media: [{ path, file }] } gdy w folderze jest kilka JSON-ów
let mediaMissing = []; // brakujące pliki mediów w wczytanym zestawie
let mediaCount = 0;
let mediaVer = store.get(LS.mediaVer) || newMediaVer();
store.set(LS.mediaVer, mediaVer);
let audioStat = null; // stan odtwarzacza z podglądu albo osobnego okna planszy
const viewers = new Map(); // token -> nazwa urządzenia, które tylko ogląda planszę
const devices = new Map(); // token -> { sig, media: {have,total}, audio: {st,src} } urządzenia graczy i widzów
const thumbs = new Map(); // src -> url dla miniatur w panelu
let season = S.load(); // ranking sezonu, osobno od stanu gry (przetrwa „Nowa gra”)
let shameWho = null; // kogo dotyczy wpis do Hall of Shame
let shameCtx = '';
let shameDraft = '';
let shameManual = false;
let shameOpen = false; // czy pole Hall of Shame jest rozwinięte w trakcie gry // wpisywany tekst, przetrwa przerysowanie panelu
let armedDel = null; // numer odcinka sezonu do usunięcia (drugie kliknięcie)

// podgląd planszy w panelu: rozmiar, dźwięk u prowadzącego, wygląd telefonu
const prefs = { size: 'm', sound: true, phone: false };
try {
  Object.assign(prefs, JSON.parse(store.get('pk.preview') || '{}'));
} catch {}
const $pv = document.getElementById('pv');
function pv() {
  try {
    return $pv?.contentWindow?.__preview || null;
  } catch {
    return null;
  }
}
function applyPrefs() {
  store.set('pk.preview', JSON.stringify(prefs));
  document.body.dataset.pv = prefs.size;
  document.body.classList.toggle('pv-phone', prefs.phone);
  const p = pv();
  p?.setSound(prefs.sound);
  p?.setPhone(prefs.phone);
  if (!prefs.sound) audioStat = null;
  const lab = { s: 'mały', m: 'średni', l: 'duży' };
  const box = document.getElementById('pv-tools');
  if (box)
    box.innerHTML = `<button class="btn small ghost" data-a="previewSize" title="Rozmiar podglądu">Podgląd: ${lab[prefs.size]}</button>
      <button class="btn small ${prefs.sound ? '' : 'ghost'}" data-a="previewSound" title="Muzyka i efekty z pytań grają też u Ciebie">${prefs.sound ? 'Dźwięk u mnie: wł.' : 'Dźwięk u mnie: wył.'}</button>
      <button class="btn small ${prefs.phone ? '' : 'ghost'}" data-a="previewPhone" title="Jak to wygląda na telefonie w pionie">${prefs.phone ? 'Widok: telefon' : 'Widok: komputer'}</button>`;
  if (state) renderMain();
}
$pv?.addEventListener('load', applyPrefs);
// dźwięk w podglądzie wymaga gestu: pierwsze kliknięcie albo klawisz w panelu go odblokowuje
const unlockPreview = () => prefs.sound && pv()?.unlock();
document.addEventListener('pointerdown', unlockPreview, true);
document.addEventListener('keydown', unlockPreview, true);

function newMediaVer() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const base = location.href.replace(/[^/]*$/, '');
const peerParam = new URLSearchParams(location.search).get('peer');
const joinUrl = `${base}play.html?r=${code}${peerParam ? '&peer=' + encodeURIComponent(peerParam) : ''}`;
const chan = new BroadcastChannel('totalna-kompromitacja');

// ---------- start ----------

async function boot() {
  const saved = store.get(LS.set);
  if (saved) {
    try {
      set = JSON.parse(saved);
    } catch {
      set = null;
    }
  }
  if (!set) set = await fetch('pytania/przyklad.json').then((r) => r.json());
  const st = store.get(LS.state);
  if (st) {
    try {
      state = JSON.parse(st);
      state.players.forEach((p) => {
        if (!p.manual) p.connected = false;
      });
    } catch {
      state = null;
    }
  }
  if (!state) state = E.newGame(set);
  if (!state.media) state.media = { n: 0, cmd: null };
  if (!state.shame) state.shame = [];
  if (!state.punish) state.punish = { winner: null, loser: null, nick: '' };
  if (state.screen === undefined) state.screen = null;
  startRoom();
  checkMedia();
  render();
  broadcast();
}

function startRoom() {
  room = hostRoom(code, {
    onStatus(s) {
      netStatus = s;
      renderTop();
    },
    onJoin(token, name, conn, info) {
      devices.set(token, { sig: null, media: null, audio: null });
      if (info?.viewer) {
        viewers.set(token, name || 'ekran');
        sendTo(token);
        renderPlayers();
        return;
      }
      viewers.delete(token);
      const exists = state.players.some((p) => p.id === token);
      dispatch({ type: 'addPlayer', id: token, name: exists ? E.player(state, token).name : name || 'Gracz', connected: true }, false);
      if (!exists && state.phase !== 'lobby') toast(`${name} dołącza w trakcie gry`);
    },
    onLeave(token) {
      devices.delete(token);
      if (viewers.delete(token)) return renderPlayers();
      dispatch({ type: 'setConnected', id: token, connected: false }, false);
    },
    onMessage(token, m) {
      if (m.t === 'media-get') return sendMediaFile(token, m);
      if (m.t === 'media-have' || m.t === 'astat') return deviceInfo(token, m);
      if (!E.player(state, token)) return;
      if (m.t === 'buzz') dispatch({ type: 'buzz', id: token }, true);
      else if (m.t === 'rename' && state.phase === 'lobby') dispatch({ type: 'renamePlayer', id: token, name: String(m.name).slice(0, 24) }, false);
      else if (m.t === 'wager') {
        if (state.phase === 'dd' && state.picker === token) dispatch({ type: 'ddWager', amount: m.amount }, true);
        else if (state.phase === 'final-wager') dispatch({ type: 'finalWager', id: token, amount: m.amount }, false);
      } else if (m.t === 'answer') dispatch({ type: 'finalAnswer', id: token, text: m.text }, false);
    },
  });
}

// ---------- stan ----------

function dispatch(action, undoable = true) {
  const next = E.reduce(state, action);
  if (next === state) return false;
  if (undoable) {
    history.push(state);
    if (history.length > 80) history.shift();
  }
  state = next;
  persist();
  render();
  broadcast();
  return true;
}

function undo() {
  const prev = history.pop();
  if (!prev) return toast('Nie ma czego cofnąć');
  // zachowaj aktualny status połączeń i graczy dodanych w międzyczasie
  const conn = new Map(state.players.map((p) => [p.id, p]));
  prev.players.forEach((p) => {
    if (conn.has(p.id)) p.connected = conn.get(p.id).connected;
  });
  state.players.forEach((p) => {
    if (!prev.players.some((x) => x.id === p.id)) prev.players.push({ ...p, score: 0 });
  });
  // Hall of Shame i kara nie są cofane razem z punktami
  state = { ...prev, fx: { n: state.fx.n + 1, type: null }, media: state.media, shame: state.shame, punish: state.punish };
  persist();
  render();
  broadcast();
  toast('Cofnięto');
}

function persist() {
  store.set(LS.state, JSON.stringify(state));
}

function boardView() {
  const view = E.boardView(state);
  if (view.screen === 'season') view.season = S.view(season);
  return view;
}

function broadcast() {
  if (!state) return;
  const full = boardView();
  chan.postMessage({ t: 'state', view: full, joinUrl, code, mediaVer });
  if (!room) return;
  const board = playersBoard(full);
  for (const p of state.players) if (!p.manual) sendTo(p.id, board);
  for (const t of viewers.keys()) sendTo(t, board);
}

// Gracz dostaje swój widok (buzzer, zakłady) i planszę; widz tylko planszę.
// Przed pierwszym stanem i po zmianie pytań idzie lista plików mediów do pobrania.
function sendTo(token, board = playersBoard(boardView())) {
  if (!room) return;
  const d = devices.get(token);
  const list = mediaList();
  const sig = mediaVer + '|' + list.join('|');
  if (d && d.sig !== sig) {
    d.sig = sig;
    room.sendTo(token, { t: 'media-list', ver: mediaVer, items: list });
    const av = avatars.snapshot();
    if (av) room.sendTo(token, { t: 'avatars', m: av });
  }
  const isPlayer = state.players.some((p) => p.id === token);
  room.sendTo(token, {
    t: 'state',
    view: isPlayer ? E.playerView(state, token) : null,
    board,
    joinUrl,
    code,
    mediaVer,
    now: Date.now(),
  });
}

// Media dla graczy idą pod losowymi nazwami i zaszyfrowane; klucz do pliku jest w widoku
// planszy tylko wtedy, gdy plik jest na planszy (pytanie, obrazek z odpowiedzią przy odsłonięciu).
// Dzięki temu urządzenia pobierają wszystko z góry, a nikt nie podejrzy pytań w narzędziach przeglądarki.
let secrets = null; // { ver, files: { src: { id, k } } }
function secretFor(src) {
  if (!secrets || secrets.ver !== mediaVer) {
    try {
      secrets = JSON.parse(store.get('pk.mediaKeys') || 'null');
    } catch {
      secrets = null;
    }
    if (!secrets || secrets.ver !== mediaVer) secrets = { ver: mediaVer, files: {} };
  }
  let f = secrets.files[src];
  if (!f) {
    const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
    f = {
      id: 'm' + Array.from(rnd(6), (b) => b.toString(16).padStart(2, '0')).join(''),
      k: btoa(String.fromCharCode(...rnd(16))),
    };
    secrets.files[src] = f;
    store.set('pk.mediaKeys', JSON.stringify(secrets));
  }
  return f;
}

function mediaSrcs() {
  return [...new Set(E.mediaRefs(state?.set || set).map((r) => r.src))].filter((s) => !media.isExternal(s));
}
function mediaList() {
  return mediaSrcs().map((s) => secretFor(s).id);
}

// plansza dla urządzeń graczy: ścieżki plików zamienione na losowe id + klucze do tego, co widać
function playersBoard(board) {
  const b = { ...board, mediaKeys: {} };
  const map = (src) => {
    if (!src || media.isExternal(src)) return src;
    const f = secretFor(src);
    b.mediaKeys[f.id] = f.k;
    return f.id;
  };
  if (b.cur) b.cur = { ...b.cur, image: map(b.cur.image) };
  if (b.answerImage) b.answerImage = map(b.answerImage);
  if (b.audio) b.audio = { ...b.audio, src: map(b.audio.src) };
  if (b.final) b.final = { ...b.final, image: map(b.final.image) };
  return b;
}

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function sendMediaFile(token, m) {
  const id = String(m.id || '');
  const src = m.ver === mediaVer ? mediaSrcs().find((s) => secretFor(s).id === id) : null;
  if (!src) return room.sendTo(token, { t: 'media-file', ver: m.ver, id, missing: true });
  const f = await media.source(src);
  if (f?.blob) {
    const sec = secretFor(src);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey('raw', b64(sec.k), 'AES-GCM', false, ['encrypt']);
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await f.blob.arrayBuffer());
    room.sendTo(token, { t: 'media-file', ver: mediaVer, id, iv: btoa(String.fromCharCode(...iv)), type: f.blob.type, data });
  } else room.sendTo(token, { t: 'media-file', ver: mediaVer, id, url: f?.url || null, missing: !f });
}

function deviceInfo(token, m) {
  const d = devices.get(token);
  if (!d) return;
  if (m.t === 'media-have') d.media = { have: Number(m.have) || 0, total: Number(m.total) || 0, ver: m.ver };
  else d.audio = { st: String(m.st || ''), src: m.src };
  renderPlayers();
  if (m.t === 'astat' && E.currentQuestion(state)?.audio) renderMain();
}

// mówiące awatary: prowadzący łączy się z botem i przekazuje wszystko graczom
avatars.start(
  () => {
    if (state?.phase === 'lobby') renderMain();
  },
  (m) => {
    if (!room) return;
    for (const t of [...state.players.map((p) => p.id), ...viewers.keys()]) room.sendTo(t, { t: 'avatars', m });
  }
);

chan.onmessage = (e) => {
  if (e.data?.t === 'hello') broadcast();
  else if (e.data?.t === 'audio') {
    const prev = audioStat?.st;
    audioStat = { ...e.data, at: Date.now() };
    if (prev !== audioStat.st) renderMain();
  }
};

// telefony dostają odświeżenie co 2 s (np. zegar finału)
setInterval(() => {
  if (state && state.phase === 'final-question') broadcast();
}, 2000);

// ---------- akcje panelu ----------

const actions = {
  openStream() {
    const w = window.open('board.html', 'pk-stream', 'width=1280,height=720');
    if (!w) toast('Przeglądarka zablokowała okno. Otwórz board.html ręcznie.');
  },
  previewSize() {
    const order = ['s', 'm', 'l'];
    prefs.size = order[(order.indexOf(prefs.size) + 1) % order.length];
    applyPrefs();
  },
  previewSound() {
    prefs.sound = !prefs.sound;
    applyPrefs();
  },
  previewPhone() {
    prefs.phone = !prefs.phone;
    applyPrefs();
  },
  loadSet() {
    document.getElementById('file').click();
  },
  loadDir() {
    document.getElementById('dir').click();
  },
  undo,
  newGame() {
    if (!armedNew) {
      armedNew = true;
      renderTop();
      setTimeout(() => {
        armedNew = false;
        renderTop();
      }, 3000);
      return;
    }
    armedNew = false;
    const keep = state.players.map(({ id, name, connected, manual }) => ({ id, name, connected, manual }));
    history = [];
    state = E.newGame(set, keep);
    persist();
    render();
    broadcast();
    toast('Nowa gra, gracze zostają');
  },
  copyLink() {
    navigator.clipboard?.writeText(joinUrl).then(
      () => toast('Link skopiowany'),
      () => toast('Nie udało się skopiować, zaznacz link ręcznie')
    );
  },
  newCode() {
    room?.destroy();
    code = randomCode();
    store.set(LS.code, code);
    location.reload();
  },
};

function playerAction(kind, id, extra) {
  switch (kind) {
    case 'plus':
      return dispatch({ type: 'adjust', id, delta: step() });
    case 'minus':
      return dispatch({ type: 'adjust', id, delta: -step() });
    case 'pick':
      return dispatch({ type: 'setPicker', id });
    case 'buzz':
      return dispatch({ type: 'manualBuzz', id });
    case 'up':
      return dispatch({ type: 'movePlayer', id, dir: -1 }, false);
    case 'down':
      return dispatch({ type: 'movePlayer', id, dir: 1 }, false);
    case 'remove':
      room?.kick(id);
      return dispatch({ type: 'removePlayer', id });
    case 'edit-name':
    case 'edit-score':
      editing = { kind: kind.slice(5), id };
      render();
      setTimeout(() => {
        const el = document.getElementById('edit-' + id);
        el?.focus();
        el?.select();
      });
      return;
  }
}

function step() {
  const r = E.roundOf(state);
  return r ? Math.min(...r.values) : 100;
}

// ---------- rysowanie ----------

const $top = document.getElementById('top');
const $main = document.getElementById('main');
const $players = document.getElementById('players');

function renderTop() {
  if (!state) return;
  const nets = {
    connecting: 'łączenie z serwerem…',
    open: 'pokój otwarty',
    reconnecting: 'łączenie ponowne…',
    'id-taken': 'kod jeszcze zajęty, ponawiam…',
  };
  $top.innerHTML = `
    <div class="logo">${esc(state.title)}<small>panel prowadzącego · tego gracze nie widzą</small></div>
    <div class="room"><span>Pokój</span><b>${code}</b><span class="net">${esc(nets[netStatus] || netStatus)}</span></div>
    <div class="tools">
      <button class="btn" data-a="openStream" title="Opcjonalne: plansza w osobnym oknie, np. na drugi monitor">Osobne okno planszy</button>
      <button class="btn" data-a="loadDir" title="Folder z plikiem JSON i podfolderem media">Wczytaj folder</button>
      <button class="btn" data-a="loadSet" title="Plik JSON, można zaznaczyć razem z plikami mediów">Wczytaj pliki</button>
      <button class="btn" data-a="undo" ${history.length ? '' : 'disabled'}>Cofnij <kbd>Ctrl+Z</kbd></button>
      <button class="btn${armedNew ? ' armed' : ''}" data-a="newGame">${armedNew ? 'Na pewno? Kliknij znowu' : 'Nowa gra'}</button>
    </div>`;
}

function renderPlayers() {
  const s = state;
  const cur = s.cur;
  const qOpen = s.phase === 'question' && cur && !cur.dd && !cur.buzzed;
  const html = s.players
    .map((p, i) => {
      let cls = 'pl';
      if (s.picker === p.id && ['board', 'dd', 'round-intro'].includes(s.phase)) cls += ' pick';
      if (cur && cur.buzzed === p.id && s.phase === 'question') cls += ' buzz';
      const conn = p.manual ? 'manual' : p.connected ? '' : 'off';
      const nm =
        editing?.kind === 'name' && editing.id === p.id
          ? `<input class="field" id="edit-${esc(p.id)}" data-edit="name" data-id="${esc(p.id)}" value="${esc(p.name)}" maxlength="24">`
          : `<button class="nm" data-p="edit-name" data-id="${esc(p.id)}" title="Zmień nick"><i class="conn ${conn}"></i>${esc(p.name)}</button>`;
      const sc =
        editing?.kind === 'score' && editing.id === p.id
          ? `<input class="field" id="edit-${esc(p.id)}" data-edit="score" data-id="${esc(p.id)}" value="${p.score}" inputmode="numeric" style="width:90px">`
          : `<button class="sc${p.score < 0 ? ' neg' : ''}" data-p="edit-score" data-id="${esc(p.id)}" title="Ustaw wynik">${p.score}</button>`;
      const tried = cur?.tried.includes(p.id);
      const acts = [];
      acts.push(`<button class="btn small" data-p="minus" data-id="${esc(p.id)}">−${step()}</button>`);
      acts.push(`<button class="btn small" data-p="plus" data-id="${esc(p.id)}">+${step()}</button>`);
      if (s.phase !== 'lobby' && s.picker !== p.id) acts.push(`<button class="btn small ghost" data-p="pick" data-id="${esc(p.id)}">Niech wybiera</button>`);
      if (qOpen && !tried) acts.push(`<button class="btn small danger" data-p="buzz" data-id="${esc(p.id)}">Zgłasza się <kbd>${i + 1}</kbd></button>`);
      if (s.phase === 'lobby') {
        acts.push(`<button class="btn small ghost" data-p="up" data-id="${esc(p.id)}" ${i ? '' : 'disabled'} title="W lewo na planszy">↑</button>`);
        acts.push(`<button class="btn small ghost" data-p="down" data-id="${esc(p.id)}" ${i < s.players.length - 1 ? '' : 'disabled'} title="W prawo na planszy">↓</button>`);
        acts.push(`<button class="btn small danger ghost" data-p="remove" data-id="${esc(p.id)}">Usuń</button>`);
      }
      const tag = p.manual ? 'bez telefonu' : p.connected ? 'online' : 'offline';
      return `<div class="${cls}"><span class="num">${i + 1}</span>${nm}${sc}<div class="acts">${acts.join('')}<span class="tag" style="margin-left:auto;align-self:center">${tag}</span></div>${devTag(p)}</div>`;
    })
    .join('');
  const add = addingPlayer
    ? `<div class="row"><input class="field" id="newplayer" placeholder="Nick gracza bez telefonu" maxlength="24"><button class="btn small primary" data-x="addPlayerOk">Dodaj</button></div>`
    : `<button class="btn small ghost" data-x="addPlayer">+ Gracz bez telefonu</button>`;
  const vw = viewers.size ? `<div class="viewers">Tylko oglądają: ${[...viewers.values()].map(esc).join(', ')}</div>` : '';
  $players.innerHTML = `
    <div>
      <div class="sec-h"><h2>Gracze</h2><span class="label">${s.players.length} / 6</span></div>
      <div class="plist">${html || '<div class="hint">Nikt jeszcze nie dołączył.</div>'}</div>
      <div style="margin-top:8px">${add}</div>
      ${vw}
    </div>`;
}

// stan urządzenia gracza: czy ma już wszystkie media odcinka
function devTag(p) {
  if (p.manual || !p.connected) return '';
  const d = devices.get(p.id);
  const m = d?.media;
  if (!m || m.ver !== mediaVer) return '';
  if (!m.total) return '';
  if (m.have >= m.total) return `<span class="dev ok" style="grid-column:1/-1">media ${m.have}/${m.total}, gotowe</span>`;
  return `<span class="dev" style="grid-column:1/-1">pobiera media ${m.have}/${m.total}</span>`;
}

function mainLobby() {
  const err = setErrors.length ? `<div class="err">Plik z pytaniami ma błędy:\n${setErrors.map(esc).join('\n')}</div>` : '';
  const counts = set.rounds.map((r) => `${r.categories.length}×${r.values.length}`).join(' + ');
  return `
    <div class="sec-h"><h2>Poczekalnia</h2><span class="label">gracze dołączają</span></div>
    <div style="display:grid;gap:16px">
      <div class="panel">
        <span class="label">Kod pokoju</span>
        <div class="bigcode">${code}</div>
        <span class="label">Link dla graczy</span>
        <div class="joinurl">${esc(joinUrl)}</div>
        <div class="row"><button class="btn" data-a="copyLink">Kopiuj link</button><button class="btn ghost small" data-a="newCode">Nowy kod pokoju</button></div>
      </div>
      <div class="panel">
        <span class="label">Pytania</span>
        <div><b style="font-family:var(--f-display);font-size:22px;text-transform:uppercase;color:var(--amber)">${esc(set.title || 'Bez tytułu')}</b></div>
        <div class="hint">${counts} pytań${set.final ? ' + finał' : ''}${set.episode != null ? ` · odcinek ${esc(set.episode)}` : ''}. ${set.example ? '<b>To przykładowy zestaw testowy.</b> Wczytaj swój folder z pytaniami przyciskiem u góry.' : 'Zestaw zapisany w tej przeglądarce, nie leży w internecie.'}</div>
        ${mediaInfo()}
        ${err}
      </div>
      ${chooser()}
      ${seasonPanel()}
      ${avatarInfo()}
      <div class="hint">Gracze wchodzą w link na telefonie albo komputerze i widzą planszę u siebie, razem z obrazkami i muzyką. Streamowanie nie jest potrzebne. Najlepiej: plansza na komputerze, buzzer na telefonie (gracz wchodzi na komputerze, a telefon paruje kodem QR z dołu swojego ekranu), albo wszystko na jednym telefonie. Podgląd obok pokazuje dokładnie to, co widzą. Kolejność graczy na planszy zmieniasz strzałkami.</div>
      <div class="actions">
        <button class="btn primary" data-x="opener">Czołówka <kbd>Enter</kbd></button>
        <button class="btn" data-x="rules">Od razu zasady</button>
        <button class="btn ghost" data-x="start" ${state.players.length ? '' : 'disabled'}>Bez wstępu, pierwsza runda</button>
      </div>
    </div>`;
}

function avatarInfo() {
  if (!avatars.isConnected()) return '';
  const miss = state.players.filter((p) => !avatars.forName(p.name)).map((p) => p.name);
  const txt = miss.length
    ? `Bez awatara: <b>${miss.map(esc).join(', ')}</b>. Nick w grze musi się zgadzać z polem <b>nick</b> w config.json bota.`
    : 'Wszyscy gracze mają awatar.';
  return `<div class="hint">Mówiące awatary: bot Discorda połączony. ${txt}</div>`;
}

function plural(n, one, few, many) {
  if (n === 1) return one;
  const d = n % 10;
  const dd = n % 100;
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
}

function mediaInfo() {
  const refs = E.mediaRefs(set);
  if (!refs.length) return '';
  const img = refs.filter((r) => r.field !== 'audio').length;
  const aud = refs.filter((r) => r.field === 'audio').length;
  const miss = mediaMissing.length
    ? `<div class="err">Brakuje ${mediaMissing.length} ${mediaMissing.length === 1 ? 'pliku' : 'plików'} mediów. Wczytaj cały folder z pytaniami:\n${mediaMissing
        .slice(0, 10)
        .map((m) => `${esc(m.where)}: ${esc(m.src)}`)
        .join('\n')}${mediaMissing.length > 10 ? '\n…' : ''}</div>`
    : `<div class="hint ok">Media: ${img} ${plural(img, 'obrazek', 'obrazki', 'obrazków')}, ${aud} ${plural(aud, 'klip', 'klipy', 'klipów')} audio. Wszystkie pliki są na miejscu.</div>`;
  return miss;
}

function chooser() {
  if (!pendingLoad) return '';
  return `<div class="panel">
    <span class="label">W folderze jest kilka plików z pytaniami. Który gramy?</span>
    <div class="row">${pendingLoad.jsons.map((j, i) => `<button class="btn" data-pick-json="${i}">${esc(j.path)}</button>`).join('')}</div>
    <div class="row"><button class="btn ghost small" data-x="cancelLoad">Anuluj</button></div>
  </div>`;
}

const WELCOME = [
  'Dobry wieczór. Witam w Totalnej Kompromitacji, jedynym teleturnieju, w którym przegrana jest gwarantowana, tylko nie wiadomo jeszcze komu.',
  'Dzisiaj przed nami grupa osób, które z niezrozumiałych powodów uważają, że coś wiedzą. Zaraz to sprawdzimy.',
  'Zanim zaczniemy, zasady. Słuchajcie uważnie, bo potem nie będzie „a ja nie wiedziałem”.',
];

function mainOpener() {
  return `
    <div class="sec-h"><h2>Czołówka</h2><span class="label">leci u graczy, ok. 11 s</span></div>
    <div class="qcard">
      <div class="hint">U graczy: włączenie kineskopu, log startowy, logo${set.episode != null ? `, odcinek ${esc(set.episode)}` : ''} i lista graczy. Muzyka gra na ich urządzeniach. Gdy skończy, powiedz na powitanie:</div>
      <div class="script">${WELCOME.map((t) => `<p>${esc(t)}</p>`).join('')}</div>
      <div class="actions">
        <button class="btn primary" data-x="rules">Zasady <kbd>Enter</kbd></button>
        <button class="btn" data-x="opener">Puść jeszcze raz</button>
        <button class="btn ghost" data-x="start" ${state.players.length ? '' : 'disabled'}>Pomiń zasady</button>
        <button class="btn ghost small" data-x="toLobby">Wróć do poczekalni</button>
      </div>
    </div>`;
}

function mainRules() {
  const list = rulesFor(set);
  const i = state.rule;
  const r = list[i];
  const last = i === list.length - 1;
  return `
    <div class="sec-h"><h2>Zasady · ${i + 1} z ${list.length}</h2><span class="label">czytaj na głos, gracze widzą skrót</span></div>
    <div class="qcard">
      <div class="rule-h">${esc(r.title)}</div>
      <div class="script big"><p>${esc(r.host)}</p></div>
      <div class="rule-board"><span class="label">Na planszy</span>${r.board.map((l) => `<div>&gt; ${esc(l)}</div>`).join('')}</div>
      <div class="actions">
        <button class="btn" data-x="rulePrev" ${i ? '' : 'disabled'}>Poprzednia <kbd>←</kbd></button>
        ${
          last
            ? `<button class="btn primary" data-x="start" ${state.players.length ? '' : 'disabled'}>Zaczynamy pierwszą rundę <kbd>Enter</kbd></button>`
            : `<button class="btn primary" data-x="ruleNext">Następna <kbd>Enter</kbd></button>`
        }
        <button class="btn ghost small" data-x="opener">Czołówka</button>
        <button class="btn ghost small" data-x="toLobby">Wróć do poczekalni</button>
      </div>
      <div class="rule-list">${list.map((x, j) => `<button class="${j === i ? 'cur' : j < i ? 'done' : ''}" data-rule="${j}"><span>${String(j + 1).padStart(2, '0')}</span>${esc(x.title)}</button>`).join('')}</div>
      ${state.players.length ? '' : '<div class="hint">Nie ma jeszcze graczy, więc pierwszej rundy nie da się zacząć.</div>'}
    </div>`;
}

function mainIntro() {
  const r = E.roundOf(state);
  return `
    <div class="sec-h"><h2>${esc(r.name || 'Runda ' + (state.round + 1))}</h2><span class="label">intro na planszy</span></div>
    <div class="qcard">
      <div class="hint">Na planszy lecą kategorie tej rundy. Zapowiedz je i przejdź do planszy. Zaczyna <b>${esc(E.nameOf(state, state.picker))}</b>${state.round > 0 ? ' (najniższy wynik)' : ' (losowo)'}.</div>
      <div class="actions"><button class="btn primary" data-x="next">Pokaż planszę <kbd>Enter</kbd></button></div>
    </div>`;
}

function mainBoard() {
  const r = E.roundOf(state);
  const cols = r.categories.length;
  let cells = r.categories.map((c) => `<div class="c">${esc(c.name)}</div>`).join('');
  r.values.forEach((v, q) => {
    r.categories.forEach((_, c) => {
      const k = E.key(state.round, c, q);
      const used = state.used[k];
      cells += `<button data-pickq="${c}:${q}" class="${state.dd[k] ? 'dd' : ''}" ${used ? 'disabled' : ''}>${used ? '' : v}</button>`;
    });
  });
  return `
    <div class="sec-h"><h2>Plansza</h2><span class="label">wybiera ${esc(E.nameOf(state, state.picker))} · kliknij pole, które poda</span></div>
    <div class="mini" style="grid-template-columns:repeat(${cols},1fr)">${cells}</div>
    <div class="hint" style="margin-top:12px">Pola oznaczone <b style="color:var(--tally)">W/N</b> to „wszystko albo nic”. Widzisz je tylko Ty.</div>
    <div class="actions" style="margin-top:12px"><button class="btn ghost small" data-x="endRound">Zakończ rundę wcześniej</button></div>`;
}

function questionData() {
  const r = E.roundOf(state);
  return { cat: r.categories[state.cur.c], q: r.categories[state.cur.c].questions[state.cur.q] };
}

function qBlock(q, reveal = true) {
  const alt = q.alt?.length ? `<div class="alt">Uznaj też: <b>${q.alt.map(esc).join('</b>, <b>')}</b></div>` : '';
  const note = q.note ? `<div class="note"><span class="label">Ciekawostka do komentarza</span>${esc(q.note)}</div>` : '';
  const pics = [];
  if (q.image) pics.push(thumb(q.image, 'Obrazek z pytaniem'));
  if (q.answerImage) pics.push(thumb(q.answerImage, 'Po odpowiedzi'));
  const img = pics.length ? `<div class="qimgs">${pics.join('')}</div>` : '';
  return `<div class="qtext">${esc(q.q)}</div>${img}${q.audio ? audioBlock(q) : ''}
    ${reveal ? `<div class="ans"><div class="k">Odpowiedź</div><div class="a">${esc(q.a)}</div></div>${alt}${note}` : ''}`;
}

function thumb(src, label) {
  let u = thumbs.get(src);
  if (u === undefined) {
    thumbs.set(src, '');
    media.resolve(src).then((x) => {
      thumbs.set(src, x || null);
      renderMain();
    });
    u = '';
  }
  const body = u ? `<img src="${esc(u)}" alt="">` : `<div class="miss">${u === null ? 'brak pliku' : '…'}</div>`;
  return `<figure class="qimg"><figcaption class="label">${esc(label)}</figcaption>${body}</figure>`;
}

const fmt = (t) => {
  t = Math.max(0, Math.floor(t || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const AUDIO_TXT = {
  ready: 'gotowe, czeka',
  loading: 'pobiera plik',
  playing: 'gra',
  paused: 'pauza',
  ended: 'fragment się skończył',
  missing: 'brak pliku audio, wczytaj folder',
  error: 'błąd odtwarzania',
  locked: 'dźwięk zablokowany',
};

// stan audio: u prowadzącego (podgląd z dźwiękiem albo osobne okno) i u graczy
function localAudio(src) {
  return audioStat && audioStat.src === src && Date.now() - audioStat.at < 60000 ? audioStat : null;
}

function playersAudio(src) {
  const out = [];
  src = media.isExternal(src) ? src : secretFor(src).id; // gracze znają plik tylko po losowym id
  for (const p of state.players) {
    if (p.manual || !p.connected) continue;
    const d = devices.get(p.id);
    out.push({ name: p.name, st: d?.audio?.src === src ? d.audio.st : null });
  }
  return out;
}

function audioPlaying(src) {
  const l = localAudio(src);
  if (l) return l.st === 'playing';
  return playersAudio(src).some((x) => x.st === 'playing');
}

function audioBlock(q) {
  const live = state.phase !== 'dd';
  const st = localAudio(q.audio);
  const txt = !live ? 'muzyka ruszy po ustaleniu stawki' : st ? `u Ciebie: ${AUDIO_TXT[st.st] || st.st}` : prefs.sound ? 'u Ciebie: czeka' : 'u Ciebie: wyciszone (podgląd bez dźwięku)';
  const range = q.audioStart || q.audioEnd ? ` · fragment ${fmt(q.audioStart || 0)}–${q.audioEnd ? fmt(q.audioEnd) : 'koniec'}` : '';
  const playing = audioPlaying(q.audio);
  const ps = playersAudio(q.audio);
  const bad = ps.filter((x) => ['missing', 'error', 'locked', 'loading'].includes(x.st));
  const on = ps.filter((x) => x.st === 'playing').length;
  const who = ps.length
    ? `<div class="hint">U graczy: ${on ? `gra u ${on} z ${ps.length}` : `${ps.filter((x) => x.st && x.st !== 'loading' && x.st !== 'missing').length} z ${ps.length} gotowych`}${
        bad.length ? `. <b style="color:var(--tally)">${bad.map((x) => `${esc(x.name)}: ${esc(AUDIO_TXT[x.st] || x.st)}`).join(', ')}</b>` : ''
      }</div>`
    : '';
  return `<div class="audio${playing ? ' on' : ''}">
    <div class="aline"><span class="label">Audio${range}</span><span class="ast${st && ['missing', 'error', 'locked'].includes(st.st) ? ' bad' : ''}">${esc(txt)}</span><span class="atime" id="atime"></span></div>
    ${
      live
        ? `<div class="row">
      <button class="btn ${playing ? '' : 'primary'}" data-x="aToggle">${playing ? 'Pauza' : 'Graj'} <kbd>M</kbd></button>
      <button class="btn" data-x="aRestart">Od początku <kbd>R</kbd></button>
      <button class="btn ghost small" data-x="aStop">Stop</button>
    </div>`
        : ''
    }
    ${live ? who : ''}
  </div>`;
}

function mainDD() {
  const { cat, q } = questionData();
  const max = E.ddMax(state);
  return `
    <div class="sec-h"><h2 style="color:var(--tally)">Wszystko albo nic</h2><span class="label">${esc(cat.name)} · gra ${esc(E.nameOf(state, state.picker))}</span></div>
    <div class="qcard">
      <div class="hint"><b>${esc(E.nameOf(state, state.picker))}</b> wpisuje stawkę na telefonie albo podaje ją na głos, wtedy wpisz ją tutaj. Zakres <b>${E.DD_MIN}–${max}</b>.</div>
      <div class="row" style="max-width:420px"><input class="field" id="ddw" inputmode="numeric" placeholder="Stawka ${E.DD_MIN}–${max}"><button class="btn primary" data-x="ddWager">Stawka</button><button class="btn ghost small" data-x="ddMax">Max (${max})</button></div>
      <div class="hint">Pytanie pokaże się graczom dopiero po ustaleniu stawki. Podgląd dla Ciebie:</div>
      ${qBlock(q)}
    </div>`;
}

function mainQuestion() {
  const { cat, q } = questionData();
  const c = state.cur;
  let st;
  if (c.buzzed) st = `<span class="st buzz">${c.dd ? 'Odpowiada' : 'Zgłasza się'}: ${esc(E.nameOf(state, c.buzzed))}</span>`;
  else if (c.buzzOpen) st = `<span class="st open">Buzzery otwarte</span>`;
  else st = `<span class="st closed">Buzzery zamknięte</span>`;
  const wrong = c.wrong.length ? `<span class="label">pudło: ${c.wrong.map((id) => esc(E.nameOf(state, id))).join(', ')}</span>` : '';
  const val = c.dd ? c.wager : c.value;
  const canJudge = !!c.buzzed;
  const acts = [];
  if (!c.dd && !c.buzzed) acts.push(`<button class="btn primary" data-x="openBuzz" ${c.buzzOpen ? 'disabled' : ''}>Otwórz buzzery <kbd>Spacja</kbd></button>`);
  if (c.dd && !c.buzzedAt) acts.push(`<button class="btn" data-x="startClock">Start zegara <kbd>Spacja</kbd></button>`);
  acts.push(`<button class="btn ok solid" data-x="right" ${canJudge ? '' : 'disabled'}>Dobrze +${val} <kbd>D</kbd></button>`);
  acts.push(`<button class="btn danger solid" data-x="wrong" ${canJudge ? '' : 'disabled'}>Źle −${val} <kbd>Z</kbd></button>`);
  acts.push(`<button class="btn ok" data-x="half" ${canJudge ? '' : 'disabled'}>Połowa <kbd>P</kbd></button>`);
  acts.push(`<button class="btn ghost" data-x="nobody">Nikt nie wie <kbd>N</kbd></button>`);
  return `
    <div class="sec-h"><h2>${esc(cat.name)}</h2><span class="label">${c.dd ? 'wszystko albo nic' : 'pytanie'}</span></div>
    <div class="qcard">
      <div class="qmeta"><b class="${c.dd ? 'red' : ''}">${val}</b>${wrong}</div>
      ${qBlock(q)}
      <div class="status">${st}<span class="clock" id="clock"></span></div>
      <div class="actions">${acts.join('')}</div>
      ${shameBox()}
    </div>`;
}

function mainReveal() {
  const { cat, q } = questionData();
  const r = state.cur.result;
  let res = 'Nikt nie wiedział.';
  if (r?.verdict === 'right') res = `${esc(E.nameOf(state, r.id))} trafia, +${r.delta}.`;
  if (r?.verdict === 'half') res = `${esc(E.nameOf(state, r.id))} dostaje połowę, +${r.delta}.`;
  if (r?.verdict === 'wrong') res = `${esc(E.nameOf(state, r.id))} pudłuje, ${r.delta}.`;
  return `
    <div class="sec-h"><h2>${esc(cat.name)}</h2><span class="label">odpowiedź na planszy</span></div>
    <div class="qcard">
      <div class="hint" style="font-size:16px"><b>${res}</b> Czas na złośliwy komentarz.</div>
      ${qBlock(q)}
      <div class="actions"><button class="btn primary" data-x="next">Dalej <kbd>Enter</kbd></button></div>
      ${shameBox()}
    </div>`;
}

function mainFinal() {
  const s = state;
  const f = s.set.final;
  const F = s.final;
  const nm = (id) => esc(E.nameOf(s, id));
  if (s.phase === 'final-intro') {
    const out = s.players.filter((p) => !F.ids.includes(p.id));
    return `
      <div class="sec-h"><h2>Finał</h2><span class="label">kategoria na planszy</span></div>
      <div class="qcard">
        <div class="hint">Kategoria: <b>${esc(f.category)}</b>. Grają tylko gracze z dodatnim wynikiem: <b>${F.ids.map(nm).join(', ')}</b>.${out.length ? ` Odpadają: ${out.map((p) => esc(p.name)).join(', ')}.` : ''}</div>
        <div class="actions"><button class="btn primary" data-x="finalWagers">Zbieraj zakłady <kbd>Enter</kbd></button></div>
      </div>`;
  }
  if (s.phase === 'final-wager') {
    const rows = F.ids
      .map((id) => {
        const p = E.player(s, id);
        const w = F.wagers[id];
        return `<tr><td class="nm">${nm(id)}</td><td class="num">${p.score}</td><td class="num">${w ?? '–'}</td><td><div class="row"><input class="field" id="fw-${esc(id)}" inputmode="numeric" placeholder="0–${p.score}"><button class="btn small" data-fw="${esc(id)}">Wpisz</button></div></td></tr>`;
      })
      .join('');
    return `
      <div class="sec-h"><h2>Finał · zakłady</h2><span class="label">${F.ids.filter((id) => F.wagers[id] != null).length}/${F.ids.length} przyjęte</span></div>
      <div class="qcard">
        <table class="ftable"><thead><tr><th>Gracz</th><th>Wynik</th><th>Zakład</th><th>Ręcznie</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="hint">Kto nie obstawi, gra za 0.</div>
        <div class="actions"><button class="btn primary" data-x="finalQuestion">Pokaż pytanie <kbd>Enter</kbd></button></div>
        <div class="note"><span class="label">Pytanie finałowe (tylko dla Ciebie)</span>${esc(f.q)}</div>
      </div>`;
  }
  if (s.phase === 'final-question') {
    const rows = F.ids
      .map((id) => {
        const a = F.answers[id];
        return `<tr><td class="nm">${nm(id)}</td><td class="txt">${a != null ? esc(a) || '(pusto)' : '–'}</td><td><div class="row"><input class="field" id="fa-${esc(id)}" placeholder="wpisz za gracza" style="width:180px"><button class="btn small" data-fa="${esc(id)}">Wpisz</button></div></td></tr>`;
      })
      .join('');
    return `
      <div class="sec-h"><h2>Finał · pytanie</h2><span class="label">${F.ids.filter((id) => F.answers[id] != null).length}/${F.ids.length} odpowiedzi</span></div>
      <div class="qcard">
        ${qBlock(f)}
        <div class="status"><span class="st open">Gracze piszą</span><span class="clock" id="clock"></span></div>
        <table class="ftable"><thead><tr><th>Gracz</th><th>Odpowiedź</th><th>Ręcznie</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="actions"><button class="btn primary" data-x="finalReveal">Odsłaniaj odpowiedzi <kbd>Enter</kbd></button></div>
      </div>`;
  }
  if (s.phase === 'final-reveal') {
    const id = F.order[F.idx];
    const judged = F.judged[id];
    const rows = F.order
      .map((pid, i) => {
        const j = F.judged[pid];
        return `<tr class="${i === F.idx ? 'cur' : ''}"><td class="nm">${nm(pid)}</td><td class="txt">${i <= F.idx ? esc(F.answers[pid] ?? '') || '(pusto)' : '···'}</td><td class="num">${F.wagers[pid]}</td><td class="num">${j ? (j.delta >= 0 ? '+' : '') + j.delta : ''}</td></tr>`;
      })
      .join('');
    return `
      <div class="sec-h"><h2>Finał · odsłanianie</h2><span class="label">od najniższego wyniku</span></div>
      <div class="qcard">
        <div class="ans"><div class="k">Odpowiedź</div><div class="a">${esc(f.a)}</div></div>
        ${f.alt?.length ? `<div class="alt">Uznaj też: <b>${f.alt.map(esc).join('</b>, <b>')}</b></div>` : ''}
        ${f.note ? `<div class="note"><span class="label">Ciekawostka</span>${esc(f.note)}</div>` : ''}
        <table class="ftable"><thead><tr><th>Gracz</th><th>Odpowiedź</th><th>Zakład</th><th>Zmiana</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="actions">
          <button class="btn ok solid" data-x="fRight" ${judged ? 'disabled' : ''}>Dobrze <kbd>D</kbd></button>
          <button class="btn danger solid" data-x="fWrong" ${judged ? 'disabled' : ''}>Źle <kbd>Z</kbd></button>
          <button class="btn" data-x="fShow" ${F.shown ? 'disabled' : ''}>Pokaż poprawną graczom <kbd>S</kbd></button>
          <button class="btn primary" data-x="fNext" ${judged ? '' : 'disabled'}>${F.idx < F.order.length - 1 ? 'Następny gracz' : 'Wyniki końcowe'} <kbd>Enter</kbd></button>
        </div>
        ${shameBox()}
      </div>`;
  }
  return '';
}

// ---------- Hall of Shame (w trakcie gry i po odcinku) ----------

// kontekst: o które pytanie chodzi i kto jest domyślnym kandydatem
function shameContext() {
  const s = state;
  if (s.cur && ['question', 'reveal'].includes(s.phase)) {
    const { cat, q } = questionData();
    const c = s.cur;
    const who = c.buzzed || c.result?.id || c.wrong[c.wrong.length - 1] || null;
    return { key: `${s.round}:${c.c}:${c.q}`, who, q: q.q, a: q.a, cat: cat.name, text: '' };
  }
  if (s.phase === 'final-reveal' && s.final) {
    const id = s.final.order[s.final.idx];
    const f = s.set.final;
    return { key: `final:${id}`, who: id, q: f.q, a: f.a, cat: `Finał · ${f.category}`, text: s.final.answers[id] ?? '' };
  }
  return { key: 'end', who: null, q: null, a: null, cat: null, text: '' };
}

function shameBox() {
  const ctx = shameContext();
  if (ctx.key !== shameCtx) {
    shameCtx = ctx.key;
    shameManual = false;
    shameDraft = ctx.text;
  }
  // dopóki prowadzący nie kliknie kogoś ręcznie, kandydatem jest ten, kto właśnie odpowiadał
  if (!shameManual) shameWho = ctx.who;
  const n = (state.shame || []).length;
  const chips = state.players
    .map((p) => `<button class="chip${shameWho === p.id ? ' on' : ''}" data-shame-who="${esc(p.id)}">${esc(p.name)}</button>`)
    .join('');
  return `<details class="shame-box"${ctx.key === 'end' || shameOpen ? ' open' : ''}>
    <summary><span class="label">Hall of Shame</span><span class="hint">${n ? `${n} ${plural(n, 'wpis', 'wpisy', 'wpisów')}` : 'pusto'} · zapisz głupią odpowiedź, pokażesz ją po odcinku</span></summary>
    <div class="row">${chips}</div>
    <div class="row"><input class="field" id="shame-text" value="${esc(shameDraft)}" placeholder="Co powiedział(a), dosłownie" maxlength="200"><button class="btn small danger" data-x="shameSave">Do Hall of Shame</button></div>
  </details>`;
}

function shameList() {
  const list = state.shame || [];
  if (!list.length) return '<div class="hint">Nic nie zapisano w trakcie gry. Możesz dopisać tutaj.</div>';
  return `<div class="shame-list">${list
    .map(
      (x) => `<div class="sh${x.star ? ' star' : ''}">
        <button class="btn small ${x.star ? 'primary' : 'ghost'}" data-shame-star="${x.n}" title="Ta idzie na slajd">${x.star ? 'Na slajdzie' : 'Wybierz'}</button>
        <div class="sh-body"><b>${esc(x.name)}</b>: „${esc(x.text)}”${x.cat ? `<div class="label">${esc(x.cat)}${x.a ? ` · poprawnie: ${esc(x.a)}` : ''}</div>` : ''}</div>
        <button class="btn small danger ghost" data-shame-del="${x.n}">Usuń</button>
      </div>`
    )
    .join('')}</div>`;
}

// ---------- ranking sezonu ----------

function seasonTable(limit = 99) {
  const rows = S.table(season).slice(0, limit);
  if (!rows.length) return '<div class="hint">Sezon jest pusty. Wyniki dopisujesz po odcinku przyciskiem „Zapisz odcinek do sezonu”.</div>';
  return `<table class="ftable"><thead><tr><th>#</th><th>Gracz</th><th>Odc.</th><th>Wygrane</th><th>Ostatnie</th><th>Suma</th></tr></thead><tbody>${rows
    .map(
      (r, i) =>
        `<tr class="${i < S.FINALE_SPOTS ? 'fin' : ''}"><td class="num">${i + 1}.</td><td class="nm">${esc(r.name)}</td><td class="num">${r.played}</td><td class="num">${r.wins}</td><td class="num">${r.lasts}</td><td class="num">${r.total}</td></tr>`
    )
    .join('')}</tbody></table>`;
}

function seasonPanel() {
  const eps = season.episodes;
  const onAir = state.screen === 'season';
  const saved = S.isSaved(season, state) || !!state.seasonSaved;
  const atEnd = state.phase === 'end';
  const epList = eps.length
    ? `<div class="ep-list">${eps
        .map((e, i) => {
          const armed = armedDel === i;
          const top = e.results[0];
          return `<div><span class="label">${e.ep != null ? `odc. ${esc(e.ep)}` : 'odc. ?'} · ${esc(e.date)}</span><span>wygrywa ${esc(top?.name || '?')}${e.shame?.length ? ` · shame ${e.shame.length}` : ''}</span><button class="btn small danger ${armed ? 'solid' : 'ghost'}" data-season-del="${i}">${armed ? 'Na pewno?' : 'Usuń'}</button></div>`;
        })
        .join('')}</div>`
    : '';
  const saveRow = atEnd
    ? `<div class="row"><button class="btn ${saved ? '' : 'primary'}" data-x="seasonSave">${saved ? 'Zapisz ponownie (nadpisze odcinek)' : 'Zapisz odcinek do sezonu'}</button>${
        saved ? '<span class="hint ok">Odcinek jest w sezonie.</span>' : state.set.episode == null ? '<span class="hint">Zestaw nie ma numeru odcinka, zapis doda nowy wpis.</span>' : ''
      }</div>`
    : '';
  return `<div class="panel">
    <div class="row" style="justify-content:space-between"><span class="label">Ranking sezonu · ${eps.length} ${plural(eps.length, 'odcinek', 'odcinki', 'odcinków')} · top ${S.FINALE_SPOTS} gra w finale sezonu</span>
      <button class="btn small ${onAir ? 'primary' : ''}" data-x="${onAir ? 'screenOff' : 'screenSeason'}">${onAir ? 'Zdejmij z planszy' : 'Pokaż na planszy'}</button></div>
    ${saveRow}
    ${seasonTable()}
    ${epList}
    ${aliasBlock()}
    <div class="row">
      <input class="field" id="season-name" value="${esc(season.name)}" maxlength="40" style="max-width:220px" title="Nazwa sezonu">
      <button class="btn small ghost" data-x="seasonRename">Zmień nazwę</button>
      <button class="btn small" data-x="seasonExport" ${eps.length ? '' : 'disabled'}>Eksport JSON</button>
      <button class="btn small" data-x="seasonImport">Import JSON</button>
    </div>
    <div class="hint">Sezon trzyma się w tej przeglądarce i nie znika przy „Nowa gra”. Po każdym odcinku zrób eksport i trzymaj plik obok pytań, na wypadek innego komputera. Gracze łączą się po nicku. Nick z kary łączy się sam przy zapisie odcinka, inne zmiany nicków połączysz polem wyżej.</div>
  </div>`;
}

function aliasBlock() {
  const al = Object.entries(season.aliases || {});
  const list = al.length
    ? `<div class="ep-list">${al
        .map(([k, v]) => `<div><span class="label">alias</span><span>„${esc(k)}” liczy się jako <b>${esc(v)}</b></span><button class="btn small danger ghost" data-alias-del="${esc(k)}">Usuń</button></div>`)
        .join('')}</div>`
    : '';
  return `${list}<div class="row">
      <input class="field" id="alias-from" placeholder="Nick (np. z kary)" maxlength="24">
      <span class="label">to ten sam gracz co</span>
      <input class="field" id="alias-to" placeholder="Główny nick" maxlength="24">
      <button class="btn small" data-x="aliasAdd">Połącz</button>
    </div>`;
}

function mainEnd() {
  const pun = E.punishment(state);
  const rows = E.standings(state)
    .map((p, i) => `<tr><td class="num">${i + 1}.</td><td class="nm">${esc(p.name)}</td><td class="num">${p.score}</td></tr>`)
    .join('');
  const scr = state.screen;
  const tabs = [
    [null, 'Wyniki odcinka'],
    ['shame', `Hall of Shame${state.shame?.length ? ` (${state.shame.length})` : ''}`],
    ['punish', 'Kara'],
    ['season', 'Ranking sezonu'],
  ]
    .map(([k, t]) => `<button class="btn ${scr === k ? 'primary' : ''}" data-screen="${k || ''}">${esc(t)}</button>`)
    .join('');
  const chips = (field, cur) =>
    state.players.map((p) => `<button class="chip${cur === p.id ? ` on${field === 'w' ? ' amber' : ''}` : ''}" data-pun-${field}="${esc(p.id)}">${esc(p.name)}</button>`).join('');
  const SCRN = { shame: 'Hall of Shame', punish: 'kara', season: 'ranking sezonu' };
  return `
    <div class="sec-h"><h2>Koniec odcinka</h2><span class="label">na planszy: ${esc(SCRN[scr] || 'wyniki odcinka')}</span></div>
    <div class="qcard">
      <div class="actions end-tabs">${tabs}</div>
      <div class="hint">Proponowana kolejność: wyniki, Hall of Shame, kara, ranking sezonu. Przełączasz, co widzą widzowie; nic się tu nie liczy od nowa.</div>
      <div class="panel"><span class="label">Wyniki odcinka</span><table class="ftable"><tbody>${rows}</tbody></table></div>
      <div class="panel">
        <span class="label">Hall of Shame · na slajd idzie jedna, reszta jako nominacje</span>
        ${shameList()}
        ${shameBox()}
      </div>
      <div class="panel">
        <span class="label">Kara dla przegranego</span>
        <div class="script"><p>${pun.loserName && pun.winnerName ? `${esc(pun.winnerName)}, gratuluję. W nagrodę dostajesz władzę nad ostatnim miejscem, a ostatnie miejsce to dzisiaj ${esc(pun.loserName)}. Wybierasz nowy nick i nowy avatar na Discordzie. Obowiązuje ${pun.days} dni, do ${esc(pun.until)}. Bez zmieniania z powrotem, bez negocjacji, a apelacje przyjmuję w tym samym okienku co zawsze.` : 'Potrzeba co najmniej dwóch graczy.'}</p></div>
        <div class="row"><span class="label" style="min-width:90px">Wybiera</span>${chips('w', pun.winner)}</div>
        <div class="row"><span class="label" style="min-width:90px">Cierpi</span>${chips('l', pun.loser)}</div>
        <div class="row"><input class="field" id="pun-nick" value="${esc(pun.nick)}" placeholder="Nowy nick (wpisz, gdy zwycięzca wybierze)" maxlength="32"><button class="btn small" data-x="punNick">Pokaż nick</button></div>
        <div class="hint">Domyślnie pierwsze i ostatnie miejsce. Przy remisie kliknij właściwą osobę. Avatar zwycięzca wysyła przegranemu na Discordzie, ekran pokazuje tylko nick.</div>
      </div>
      ${seasonPanel()}
      <div class="hint">„Nowa gra” u góry zaczyna od zera z tymi samymi graczami. Ranking sezonu zostaje.</div>
    </div>`;
}

function renderMain() {
  const ph = state.phase;
  let html;
  if (ph === 'lobby') html = mainLobby();
  else if (ph === 'opener') html = mainOpener();
  else if (ph === 'rules') html = mainRules();
  else if (ph === 'round-intro') html = mainIntro();
  else if (ph === 'board') html = mainBoard();
  else if (ph === 'dd') html = mainDD();
  else if (ph === 'question') html = mainQuestion();
  else if (ph === 'reveal') html = mainReveal();
  else if (ph.startsWith('final')) html = mainFinal();
  else html = mainEnd();
  html += `<div class="keys">
    <span><kbd>Spacja</kbd> otwórz buzzery</span><span><kbd>D</kbd> dobrze</span><span><kbd>Z</kbd> źle</span><span><kbd>P</kbd> połowa</span>
    <span><kbd>N</kbd> nikt</span><span><kbd>Enter</kbd> dalej</span><span><kbd>M</kbd> muzyka graj/pauza</span><span><kbd>R</kbd> od początku</span><span><kbd>1–6</kbd> zgłoszenie ręczne</span><span><kbd>H</kbd> Hall of Shame</span><span><kbd>Ctrl+Z</kbd> cofnij</span></div>`;
  $main.innerHTML = html;
}

function render() {
  // zachowaj wpisywany tekst i fokus przy przerysowaniu
  const a = document.activeElement;
  const keep = a && a.id && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') ? { id: a.id, v: a.value, s: a.selectionStart, e: a.selectionEnd } : null;
  const vals = {};
  document.querySelectorAll('input.field[id]').forEach((el) => (vals[el.id] = el.value));
  renderTop();
  renderMain();
  renderPlayers();
  for (const [id, v] of Object.entries(vals)) {
    const el = document.getElementById(id);
    if (el && !el.dataset.edit && id !== 'shame-text') el.value = v;
  }
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      if (keep.id !== 'shame-text') el.value = keep.v;
      el.focus();
      try {
        el.setSelectionRange(keep.s, keep.e);
      } catch {}
    }
  }
}

// ---------- zdarzenia ----------

function isPlaying() {
  const q = E.currentQuestion(state);
  return !!(q?.audio && audioPlaying(q.audio));
}

const x = {
  start: () => dispatch({ type: 'start' }),
  opener: () => dispatch({ type: 'opener' }, false),
  rules: () => dispatch({ type: 'rules', idx: 0 }, false),
  ruleNext: () => dispatch({ type: 'ruleStep', dir: 1 }, false),
  rulePrev: () => dispatch({ type: 'ruleStep', dir: -1 }, false),
  toLobby: () => dispatch({ type: 'lobby' }, false),
  aToggle: () => dispatch({ type: 'media', cmd: isPlaying() ? 'pause' : 'play' }, false),
  aRestart: () => dispatch({ type: 'media', cmd: 'restart' }, false),
  aStop: () => dispatch({ type: 'media', cmd: 'stop' }, false),
  cancelLoad() {
    pendingLoad = null;
    render();
  },
  next: () => dispatch({ type: 'next' }),
  endRound: () => dispatch({ type: 'endRound' }),
  openBuzz: () => dispatch({ type: 'openBuzz' }),
  startClock: () => dispatch({ type: 'startClock' }),
  right: () => dispatch({ type: 'judge', verdict: 'right' }),
  wrong: () => dispatch({ type: 'judge', verdict: 'wrong' }),
  half: () => dispatch({ type: 'judge', verdict: 'half' }),
  nobody: () => dispatch({ type: 'nobody' }),
  ddWager() {
    const v = document.getElementById('ddw')?.value;
    if (!dispatch({ type: 'ddWager', amount: v })) toast(`Stawka musi być od ${E.DD_MIN} do ${E.ddMax(state)}`);
  },
  ddMax: () => dispatch({ type: 'ddWager', amount: E.ddMax(state) }),
  finalWagers: () => dispatch({ type: 'finalWagers' }),
  finalQuestion: () => dispatch({ type: 'finalQuestion' }),
  finalReveal: () => dispatch({ type: 'finalReveal' }),
  fRight: () => dispatch({ type: 'finalJudge', verdict: 'right' }),
  fWrong: () => dispatch({ type: 'finalJudge', verdict: 'wrong' }),
  fShow: () => dispatch({ type: 'finalShow' }, false),
  fNext: () => dispatch({ type: 'finalNext' }),
  screenSeason: () => dispatch({ type: 'screen', screen: 'season' }, false),
  screenOff: () => dispatch({ type: 'screen', screen: null }, false),
  shameSave() {
    const el = document.getElementById('shame-text');
    const text = el?.value.trim();
    if (!text) return toast('Wpisz, co padło');
    const ctx = shameContext();
    if (!shameWho) return toast('Kliknij, kto to powiedział');
    dispatch({ type: 'shameAdd', id: shameWho, text, q: ctx.q, a: ctx.a, cat: ctx.cat }, false);
    shameDraft = '';
    const f = document.getElementById('shame-text');
    if (f) {
      f.value = '';
      f.blur(); // skróty klawiszowe znowu działają
    }
    toast(`Zapisane w Hall of Shame (${state.shame.length})`);
  },
  punNick() {
    const v = document.getElementById('pun-nick')?.value ?? '';
    dispatch({ type: 'punish', nick: v }, false) || render();
    if (state.screen !== 'punish') dispatch({ type: 'screen', screen: 'punish' }, false);
  },
  seasonSave() {
    const ep = S.episodeFrom(state, E.punishment(state));
    if (!ep.results.length) return toast('Nie ma graczy');
    let { replaced, ...next } = S.upsert(season, ep);
    // nick z kary: w następnym odcinku ta osoba może grać pod nowym nickiem, punkty mają się łączyć
    if (ep.punish?.nick && ep.punish.loser) next = S.addAlias(next, ep.punish.nick, ep.punish.loser);
    state = { ...state, seasonSaved: true }; // bez numeru odcinka: nie dopisuj drugi raz przez przypadek
    persist();
    setSeason(next);
    toast(replaced ? 'Odcinek nadpisany w sezonie' : 'Odcinek zapisany w sezonie');
  },
  seasonRename() {
    const v = document.getElementById('season-name')?.value.trim();
    if (!v) return;
    setSeason({ ...season, name: v.slice(0, 40) });
    toast('Nazwa sezonu zmieniona');
  },
  aliasAdd() {
    const a = document.getElementById('alias-from')?.value.trim();
    const b = document.getElementById('alias-to')?.value.trim();
    if (!a || !b) return toast('Wpisz oba nicki');
    for (const id of ['alias-from', 'alias-to']) {
      const el = document.getElementById(id);
      if (el) el.value = '';
    }
    setSeason(S.addAlias(season, a, b));
    toast(`${a} liczy się teraz jako ${b}`);
  },
  seasonExport() {
    S.download(season);
  },
  seasonImport() {
    document.getElementById('seasonFile').click();
  },
  addPlayer() {
    addingPlayer = true;
    render();
    document.getElementById('newplayer')?.focus();
  },
  addPlayerOk() {
    const el = document.getElementById('newplayer');
    const name = el?.value.trim();
    addingPlayer = false;
    if (name) dispatch({ type: 'addPlayer', id: 'm-' + Math.random().toString(36).slice(2, 8), name, manual: true, connected: true }, false);
    else render();
  },
};

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t || t.disabled) return;
  if (t.dataset.a) actions[t.dataset.a]?.();
  else if (t.dataset.x) x[t.dataset.x]?.();
  else if (t.dataset.p) playerAction(t.dataset.p, t.dataset.id);
  else if (t.dataset.rule) dispatch({ type: 'rules', idx: Number(t.dataset.rule) }, false);
  else if (t.dataset.screen !== undefined) dispatch({ type: 'screen', screen: t.dataset.screen || null }, false);
  else if (t.dataset.shameWho) {
    shameWho = t.dataset.shameWho;
    shameManual = true;
    render();
  } else if (t.dataset.shameStar) dispatch({ type: 'shameStar', n: Number(t.dataset.shameStar) }, false);
  else if (t.dataset.shameDel) dispatch({ type: 'shameDel', n: Number(t.dataset.shameDel) }, false);
  else if (t.dataset.punW) dispatch({ type: 'punish', winner: t.dataset.punW }, false);
  else if (t.dataset.punL) dispatch({ type: 'punish', loser: t.dataset.punL }, false);
  else if (t.dataset.aliasDel) setSeason(S.removeAlias(season, t.dataset.aliasDel));
  else if (t.dataset.seasonDel) {
    const i = Number(t.dataset.seasonDel);
    if (armedDel !== i) {
      armedDel = i;
      render();
      setTimeout(() => {
        if (armedDel === i) {
          armedDel = null;
          render();
        }
      }, 3000);
      return;
    }
    armedDel = null;
    setSeason({ ...season, episodes: season.episodes.filter((_, j) => j !== i) });
    toast('Odcinek usunięty z sezonu');
  }
  else if (t.dataset.pickJson) {
    const pl = pendingLoad;
    pendingLoad = null;
    if (pl) useLoad(pl.jsons[Number(t.dataset.pickJson)], pl.media);
  } else if (t.dataset.pickq) {
    const [c, q] = t.dataset.pickq.split(':').map(Number);
    dispatch({ type: 'pick', c, q });
  } else if (t.dataset.fw) {
    const id = t.dataset.fw;
    const v = document.getElementById('fw-' + id)?.value;
    if (!dispatch({ type: 'finalWager', id, amount: v }, false)) toast('Zakład od 0 do wyniku gracza');
  } else if (t.dataset.fa) {
    const id = t.dataset.fa;
    const v = document.getElementById('fa-' + id)?.value ?? '';
    dispatch({ type: 'finalAnswer', id, text: v, force: true }, false);
  }
});

function commitEdit(el) {
  const id = el.dataset.id;
  const kind = el.dataset.edit;
  editing = null;
  if (kind === 'name') {
    const n = el.value.trim();
    if (n) dispatch({ type: 'renamePlayer', id, name: n.slice(0, 24) }, false);
    else render();
  } else {
    const v = Math.round(Number(el.value));
    if (Number.isFinite(v)) dispatch({ type: 'setScore', id, score: v });
    else render();
  }
}

document.addEventListener('keydown', (e) => {
  const el = e.target;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    if (el.dataset.edit) {
      if (e.key === 'Enter') commitEdit(el);
      if (e.key === 'Escape') {
        editing = null;
        render();
      }
    } else if (e.key === 'Escape') el.blur();
    else if (e.key === 'Enter') {
      if (el.id === 'ddw') x.ddWager();
      else if (el.id === 'newplayer') x.addPlayerOk();
      else if (el.id === 'shame-text') x.shameSave();
      else if (el.id === 'pun-nick') x.punNick();
      else if (el.id === 'season-name') x.seasonRename();
      else if (el.id === 'alias-from' || el.id === 'alias-to') x.aliasAdd();
      else if (el.id.startsWith('fw-')) document.querySelector(`[data-fw="${CSS.escape(el.id.slice(3))}"]`)?.click();
      else if (el.id.startsWith('fa-')) document.querySelector(`[data-fa="${CSS.escape(el.id.slice(3))}"]`)?.click();
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    return undo();
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const ph = state.phase;
  const k = e.key.toLowerCase();
  if (k === ' ') {
    e.preventDefault();
    if (ph === 'question') state.cur.dd ? x.startClock() : x.openBuzz();
    return;
  }
  if (k === 'enter') {
    e.preventDefault();
    if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
    if (ph === 'lobby') x.opener();
    else if (ph === 'opener') x.rules();
    else if (ph === 'rules') state.rule < rulesFor(set).length - 1 ? x.ruleNext() : x.start();
    else if (ph === 'round-intro' || ph === 'reveal') x.next();
    else if (ph === 'final-intro') x.finalWagers();
    else if (ph === 'final-wager') x.finalQuestion();
    else if (ph === 'final-question') x.finalReveal();
    else if (ph === 'final-reveal') x.fNext();
    return;
  }
  if (k === 'h' && document.querySelector('.shame-box')) {
    e.preventDefault();
    shameOpen = true;
    renderMain();
    document.getElementById('shame-text')?.focus();
    return;
  }
  if (ph === 'rules') {
    if (e.key === 'ArrowRight') x.ruleNext();
    else if (e.key === 'ArrowLeft') x.rulePrev();
  }
  if (E.currentQuestion(state)?.audio && ph !== 'dd') {
    if (k === 'm') return x.aToggle();
    if (k === 'r') return x.aRestart();
  }
  if (ph === 'question') {
    if (k === 'd') x.right();
    else if (k === 'z') x.wrong();
    else if (k === 'p') x.half();
    else if (k === 'n') x.nobody();
    else if (/^[1-9]$/.test(k)) {
      const p = state.players[Number(k) - 1];
      if (p) dispatch({ type: 'manualBuzz', id: p.id });
    }
  } else if (ph === 'final-reveal') {
    if (k === 'd') x.fRight();
    else if (k === 'z') x.fWrong();
    else if (k === 's') x.fShow();
  }
});

document.addEventListener(
  'toggle',
  (e) => {
    if (e.target.classList?.contains('shame-box') && state.phase !== 'end') shameOpen = e.target.open;
  },
  true
);

document.addEventListener('input', (e) => {
  if (e.target.id === 'shame-text') shameDraft = e.target.value;
});

document.addEventListener(
  'blur',
  (e) => {
    const el = e.target;
    if (el?.dataset?.edit && editing) commitEdit(el);
  },
  true
);

// ---------- wczytywanie pytań i mediów ----------
// "Wczytaj folder": cały folder pytań (JSON + media/). "Wczytaj pliki": JSON, opcjonalnie razem z mediami.
// Ścieżki mediów w JSON są względne do pliku JSON, np. "media/sw-senat.jpg".

async function onFiles(list) {
  const files = [...list].map((file) => ({ file, path: (file.webkitRelativePath || file.name).replace(/\\/g, '/') }));
  if (!files.length) return;
  const jsons = files.filter((f) => /\.json$/i.test(f.path) && !/(^|\/)ranking-[^/]*\.json$/i.test(f.path));
  const med = files.filter((f) => media.isMediaFile(f.path));
  if (!jsons.length) {
    if (med.length) {
      await storeMedia(med, '');
      toast(`Wczytano ${med.length} plików mediów`);
    } else toast('Nie ma tu pliku JSON ani mediów');
    return;
  }
  if (jsons.length > 1) {
    jsons.sort((a, b) => a.path.localeCompare(b.path, 'pl', { numeric: true }));
    pendingLoad = { jsons, media: med };
    if (state.phase !== 'lobby') toast('Kilka plików JSON, wybierz w poczekalni');
    return render();
  }
  useLoad(jsons[0], med);
}

async function storeMedia(med, dir) {
  const items = med.map(({ file, path }) => ({ file, path: dir && path.startsWith(dir) ? path.slice(dir.length) : path.split('/').slice(1).join('/') || path }));
  try {
    await media.replaceAll(items);
  } catch (e) {
    toast('Nie udało się zapisać mediów w przeglądarce');
    console.warn(e);
    return;
  }
  mediaCount = items.length;
  mediaVer = newMediaVer();
  store.set(LS.mediaVer, mediaVer);
  thumbs.clear();
  media.resetCache();
}

async function useLoad(j, med) {
  let parsed;
  try {
    parsed = JSON.parse(await j.file.text());
  } catch (err) {
    setErrors = [`To nie jest poprawny JSON: ${err.message}`];
    return render();
  }
  const errs = E.validateSet(parsed);
  if (errs.length) {
    setErrors = errs.slice(0, 12);
    if (state.phase !== 'lobby') toast('Plik ma błędy, szczegóły w poczekalni');
    return render();
  }
  setErrors = [];
  if (parsed.episode == null) {
    const m = j.path.match(/odcinek[-_ ]?(\d+)/i);
    if (m) parsed.episode = Number(m[1]);
  }
  // media tylko gdy przyszły razem z JSON-em; sam JSON zostawia poprzednio wczytane
  if (med.length) {
    const dir = j.path.includes('/') ? j.path.slice(0, j.path.lastIndexOf('/') + 1) : '';
    await storeMedia(med, dir);
  }
  set = parsed;
  store.set(LS.set, JSON.stringify(set));
  await checkMedia();
  const name = set.title || j.path;
  if (state.phase === 'lobby') {
    state = { ...state, set, title: set.title || state.title };
    persist();
    render();
    broadcast();
    toast(`Wczytano: ${name}${med.length ? ` + ${med.length} mediów` : ''}`);
  } else {
    render();
    broadcast();
    toast('Wczytano. Nowy zestaw zadziała po „Nowa gra”.');
  }
}

async function checkMedia() {
  const refs = E.mediaRefs(set);
  const out = [];
  for (const r of refs) if (!(await media.has(r.src))) out.push(r);
  mediaMissing = out;
  if (state) renderMain();
}

function setSeason(next) {
  season = next;
  if (!S.save(season)) toast('Nie udało się zapisać sezonu w przeglądarce');
  render();
  broadcast();
}

document.getElementById('seasonFile').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  let d;
  try {
    d = S.normalize(JSON.parse(await f.text()));
  } catch {
    d = null;
  }
  if (!d) return toast('To nie jest plik rankingu sezonu');
  setSeason(d);
  toast(`Wczytano sezon: ${d.episodes.length} ${plural(d.episodes.length, 'odcinek', 'odcinki', 'odcinków')}`);
});

for (const id of ['file', 'dir']) {
  document.getElementById(id).addEventListener('change', (e) => {
    const list = e.target.files;
    onFiles(list).finally(() => (e.target.value = ''));
  });
}

// ---------- zegar w panelu ----------

(function loop() {
  const el = document.getElementById('clock');
  if (el && state) {
    const t = Date.now();
    let txt = '';
    let low = false;
    const c = state.cur;
    if (state.phase === 'question' && c?.buzzed && c.buzzedAt) {
      const left = Math.max(0, E.ANSWER_SECONDS - (t - c.buzzedAt) / 1000);
      txt = left.toFixed(1) + ' s';
      low = left < 2;
    } else if (state.phase === 'question' && c?.buzzOpen) {
      txt = ((t - c.openedAt) / 1000).toFixed(0) + ' s od otwarcia';
    } else if (state.phase === 'final-question' && state.final.qAt) {
      const left = Math.max(0, E.FINAL_SECONDS - (t - state.final.qAt) / 1000);
      txt = left.toFixed(0) + ' s';
      low = left < 5;
    }
    el.textContent = txt;
    el.classList.toggle('low', low);
  }
  const at = document.getElementById('atime');
  if (at) {
    const st = audioStat;
    const q = state && E.currentQuestion(state);
    const txt = st && q?.audio === st.src && st.dur ? `${fmt(st.pos)} / ${fmt(st.dur)}` : '';
    if (at.textContent !== txt) at.textContent = txt;
  }
  requestAnimationFrame(loop);
})();

let toastTimer = null;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}

window.addEventListener('beforeunload', () => room?.destroy());
boot();
