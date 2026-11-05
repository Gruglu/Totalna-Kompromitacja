// Panel prowadzącego: trzyma stan gry, rozsyła widoki do streamu i telefonów.
import * as E from './engine.js';
import { hostRoom, randomCode } from './net.js';
import * as media from './media.js';
import { rulesFor } from './rules.js';

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
let mediaVer = Number(store.get(LS.mediaVer)) || 1;
let audioStat = null; // stan odtwarzacza z okna streamu
const thumbs = new Map(); // src -> url dla miniatur w panelu

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
    onJoin(token, name) {
      const exists = state.players.some((p) => p.id === token);
      dispatch({ type: 'addPlayer', id: token, name: exists ? E.player(state, token).name : name || 'Gracz', connected: true }, false);
      if (!exists && state.phase !== 'lobby') toast(`${name} dołącza w trakcie gry`);
    },
    onLeave(token) {
      dispatch({ type: 'setConnected', id: token, connected: false }, false);
    },
    onMessage(token, m) {
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
  state = { ...prev, fx: { n: state.fx.n + 1, type: null }, media: state.media };
  persist();
  render();
  broadcast();
  toast('Cofnięto');
}

function persist() {
  store.set(LS.state, JSON.stringify(state));
}

function broadcast() {
  if (!state) return;
  chan.postMessage({ t: 'state', view: E.boardView(state), joinUrl, code, mediaVer });
  if (!room) return;
  for (const p of state.players) if (!p.manual) room.sendTo(p.id, { t: 'state', view: E.playerView(state, p.id) });
}

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
    <div class="logo">${esc(state.title)}<small>panel prowadzącego · tego nie streamuj</small></div>
    <div class="room"><span>Pokój</span><b>${code}</b><span class="net">${esc(nets[netStatus] || netStatus)}</span></div>
    <div class="tools">
      <button class="btn" data-a="openStream">Ekran streamu</button>
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
        acts.push(`<button class="btn small ghost" data-p="up" data-id="${esc(p.id)}" ${i ? '' : 'disabled'} title="W lewo na streamie">↑</button>`);
        acts.push(`<button class="btn small ghost" data-p="down" data-id="${esc(p.id)}" ${i < s.players.length - 1 ? '' : 'disabled'} title="W prawo na streamie">↓</button>`);
        acts.push(`<button class="btn small danger ghost" data-p="remove" data-id="${esc(p.id)}">Usuń</button>`);
      }
      const tag = p.manual ? 'bez telefonu' : p.connected ? 'online' : 'offline';
      return `<div class="${cls}"><span class="num">${i + 1}</span>${nm}${sc}<div class="acts">${acts.join('')}<span class="tag" style="margin-left:auto;align-self:center">${tag}</span></div></div>`;
    })
    .join('');
  const add = addingPlayer
    ? `<div class="row"><input class="field" id="newplayer" placeholder="Nick gracza bez telefonu" maxlength="24"><button class="btn small primary" data-x="addPlayerOk">Dodaj</button></div>`
    : `<button class="btn small ghost" data-x="addPlayer">+ Gracz bez telefonu</button>`;
  $players.innerHTML = `
    <div>
      <div class="sec-h"><h2>Gracze</h2><span class="label">${s.players.length} / 6</span></div>
      <div class="plist">${html || '<div class="hint">Nikt jeszcze nie dołączył.</div>'}</div>
      <div style="margin-top:8px">${add}</div>
    </div>`;
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
      <div class="hint">Otwórz <b>Ekran streamu</b> i udostępnij to okno na Discordzie (kliknij w nie raz, żeby włączyć dźwięk, <b>F</b> = pełny ekran). Gracze skanują kod ze streamu albo wchodzą w link. Kolejność graczy na streamie zmieniasz strzałkami.</div>
      <div class="actions">
        <button class="btn primary" data-x="opener">Czołówka <kbd>Enter</kbd></button>
        <button class="btn" data-x="rules">Od razu zasady</button>
        <button class="btn ghost" data-x="start" ${state.players.length ? '' : 'disabled'}>Bez wstępu, pierwsza runda</button>
      </div>
    </div>`;
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
    <div class="sec-h"><h2>Czołówka</h2><span class="label">leci na streamie, ok. 11 s</span></div>
    <div class="qcard">
      <div class="hint">Na streamie: włączenie kineskopu, log startowy, logo${set.episode != null ? `, odcinek ${esc(set.episode)}` : ''} i lista graczy. Muzyka gra z okna streamu. Gdy skończy, powiedz na powitanie:</div>
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
    <div class="sec-h"><h2>Zasady · ${i + 1} z ${list.length}</h2><span class="label">czytaj na głos, na streamie skrót</span></div>
    <div class="qcard">
      <div class="rule-h">${esc(r.title)}</div>
      <div class="script big"><p>${esc(r.host)}</p></div>
      <div class="rule-board"><span class="label">Na streamie</span>${r.board.map((l) => `<div>&gt; ${esc(l)}</div>`).join('')}</div>
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
    <div class="sec-h"><h2>${esc(r.name || 'Runda ' + (state.round + 1))}</h2><span class="label">intro na streamie</span></div>
    <div class="qcard">
      <div class="hint">Na streamie lecą kategorie tej rundy. Zapowiedz je i przejdź do planszy. Zaczyna <b>${esc(E.nameOf(state, state.picker))}</b>${state.round > 0 ? ' (najniższy wynik)' : ' (losowo)'}.</div>
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
  playing: 'gra na streamie',
  paused: 'pauza',
  ended: 'fragment się skończył',
  missing: 'brak pliku audio, wczytaj folder',
  error: 'błąd odtwarzania',
  locked: 'kliknij raz w okno streamu (dźwięk)',
};

function audioBlock(q) {
  const live = state.phase !== 'dd';
  const st = audioStat && audioStat.src === q.audio && Date.now() - audioStat.at < 60000 ? audioStat : null;
  const txt = !live ? 'muzyka ruszy po ustaleniu stawki' : st ? AUDIO_TXT[st.st] || st.st : 'brak odpowiedzi z okna streamu, czy jest otwarte?';
  const range = q.audioStart || q.audioEnd ? ` · fragment ${fmt(q.audioStart || 0)}–${q.audioEnd ? fmt(q.audioEnd) : 'koniec'}` : '';
  const playing = st?.st === 'playing';
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
      <div class="hint">Pytanie pokaże się na streamie dopiero po ustaleniu stawki. Podgląd dla Ciebie:</div>
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
    <div class="sec-h"><h2>${esc(cat.name)}</h2><span class="label">odpowiedź na streamie</span></div>
    <div class="qcard">
      <div class="hint" style="font-size:16px"><b>${res}</b> Czas na złośliwy komentarz.</div>
      ${qBlock(q)}
      <div class="actions"><button class="btn primary" data-x="next">Dalej <kbd>Enter</kbd></button></div>
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
      <div class="sec-h"><h2>Finał</h2><span class="label">kategoria na streamie</span></div>
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
          <button class="btn" data-x="fShow" ${F.shown ? 'disabled' : ''}>Pokaż poprawną na streamie <kbd>S</kbd></button>
          <button class="btn primary" data-x="fNext" ${judged ? '' : 'disabled'}>${F.idx < F.order.length - 1 ? 'Następny gracz' : 'Wyniki końcowe'} <kbd>Enter</kbd></button>
        </div>
      </div>`;
  }
  return '';
}

function mainEnd() {
  const rows = E.standings(state)
    .map((p, i) => `<tr><td class="num">${i + 1}.</td><td class="nm">${esc(p.name)}</td><td class="num">${p.score}</td></tr>`)
    .join('');
  return `
    <div class="sec-h"><h2>Koniec odcinka</h2><span class="label">ranking na streamie</span></div>
    <div class="qcard">
      <table class="ftable"><tbody>${rows}</tbody></table>
      <div class="hint">„Nowa gra” u góry zaczyna od zera z tymi samymi graczami.</div>
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
    <span><kbd>N</kbd> nikt</span><span><kbd>Enter</kbd> dalej</span><span><kbd>M</kbd> muzyka graj/pauza</span><span><kbd>R</kbd> od początku</span><span><kbd>1–6</kbd> zgłoszenie ręczne</span><span><kbd>Ctrl+Z</kbd> cofnij</span></div>`;
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
    if (el && !el.dataset.edit) el.value = v;
  }
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      el.value = keep.v;
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
  return !!(q?.audio && audioStat?.src === q.audio && audioStat.st === 'playing');
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
    } else if (e.key === 'Enter') {
      if (el.id === 'ddw') x.ddWager();
      else if (el.id === 'newplayer') x.addPlayerOk();
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
  const jsons = files.filter((f) => /\.json$/i.test(f.path));
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
  mediaVer++;
  store.set(LS.mediaVer, String(mediaVer));
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
