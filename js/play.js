// Urządzenie gracza: plansza (to samo, co dawniej szło na streamie) i buzzer.
// Tryby: gracz (plansza + buzzer), widz (sama plansza, ?tryb=ekran),
// buzzer sparowany z komputerem gracza (?tryb=buzzer&t=…, sam przycisk).
import { joinRoom, normalizeCode } from './net.js';
import * as stage from './stage.js';
import * as mc from './mediacache.js';
import * as avatars from './avatars.js';
import * as sound from './sound.js';

const EARLY_LOCK_MS = 1000;
const params = new URLSearchParams(location.search);
const $root = document.getElementById('app');

const ls = {
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
    } catch {}
  },
};
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// telefon sparowany z komputerem gracza dostaje jego token w linku
let token = params.get('t') || ls.get('pk.token');
if (!token) {
  token = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
  ls.set('pk.token', token);
}
const paired = !!params.get('t');

let mode = params.get('tryb') === 'ekran' ? 'view' : params.get('tryb') === 'buzzer' ? 'buzzer' : 'play';
let code = normalizeCode(params.get('r') || ls.get('pk.lastCode') || '');
let name = (params.get('n') || ls.get('pk.name') || '').slice(0, 24);
let link = null;
let net = 'connecting';
let view = null; // widok gracza (buzzer, zakłady)
let board = null; // plansza
let viewAt = 0;
let lockUntil = 0;
let pressedAt = 0;
let sentWager = null;
let draft = '';
let mediaList = null; // { ver, items } od prowadzącego
let showBoard = mode !== 'buzzer' && ls.get('pk.board') !== '0';

// ---------- zegar prowadzącego ----------
// Plansza liczy czas (wpisywanie pytania, zegary) od znaczników prowadzącego, a zegar
// telefonu potrafi się różnić o sekundy. Opóźnienie sieci tylko zaniża różnicę,
// więc bierzemy największą z ostatnich próbek.
const offs = [];
let offset = 0;
function sample(hostNow) {
  if (!hostNow) return;
  offs.push(hostNow - Date.now());
  if (offs.length > 20) offs.shift();
  offset = Math.max(...offs);
}
const clock = () => Date.now() + offset;

// ---------- dźwięk ----------

let soundOn = false;
function unlockSound() {
  if (mode === 'buzzer') return;
  stage.unlock();
  soundOn = sound.unlocked();
  document.querySelector('.sound-gate')?.remove();
}
function soundGate() {
  if (mode === 'buzzer' || !showBoard || soundOn || document.querySelector('.sound-gate')) return;
  const g = document.createElement('button');
  g.className = 'sound-gate';
  g.innerHTML = 'Dotknij, żeby włączyć dźwięk<small>muzyka i efekty z pytań grają u Ciebie</small>';
  g.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    unlockSound();
    sound.play('bonus');
  });
  document.body.appendChild(g);
}
// każde dotknięcie i tak odblokowuje
document.addEventListener('pointerdown', () => !soundOn && link && unlockSound(), true);

// ---------- ekran dołączania ----------

function renderJoin(error = '') {
  document.body.className = 'scanlines';
  $root.innerHTML = `<form class="join" id="joinf" autocomplete="off">
    <h1>Totalna Kompromitacja</h1>
    <label><span class="label">Kod pokoju</span><input class="field code" id="code" value="${esc(code)}" maxlength="4" autocapitalize="characters" spellcheck="false" required></label>
    <label><span class="label">Twój nick</span><input class="field" id="name" value="${esc(name)}" maxlength="24"></label>
    <button class="btn primary" type="submit" data-m="play">Wchodzę</button>
    <button class="btn ghost small" type="submit" data-m="view">Tylko oglądam, bez grania</button>
    <div class="err" role="alert">${esc(error)}</div>
  </form>`;
  const f = document.getElementById('joinf');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const m = e.submitter?.dataset.m || 'play';
    code = normalizeCode(document.getElementById('code').value);
    name = document.getElementById('name').value.trim().slice(0, 24);
    if (code.length !== 4) return renderJoin('Kod ma 4 litery.');
    if (!name && m === 'play') return renderJoin('Wpisz nick.');
    mode = m;
    if (name) ls.set('pk.name', name);
    ls.set('pk.lastCode', code);
    params.set('r', code);
    if (m === 'view') params.set('tryb', 'ekran');
    else params.delete('tryb');
    history.replaceState(null, '', '?' + params.toString());
    unlockSound(); // to kliknięcie jest gestem: dźwięk od razu działa
    start();
  });
  document.getElementById(code ? 'name' : 'code').focus();
}

// ---------- układ ----------

let built = false;
function build() {
  built = true;
  $root.innerHTML = `<div class="play" id="play">
    <div class="screen" id="screen"><div class="fit" id="fit"><div class="frame scanlines"><div class="stage" id="stage"><div class="waiting">Łączenie z prowadzącym…</div></div></div></div></div>
    <div class="pad" id="pad"></div>
  </div>`;
  stage.init(document.getElementById('stage'), {
    sound: true,
    clock,
    resolve: (id) => mc.resolve(id),
    report: reportAudio,
  });
  document.getElementById('stage').addEventListener('click', (e) => {
    const img = e.target.closest('.img img');
    if (img) zoom(img.src);
  });
  layout();
}

// telefon w pionie: plansza 4:3 nad przyciskiem; poziomo i na komputerze: plansza 16:9 z boku panel
function layout() {
  const play = document.getElementById('play');
  if (!play) return;
  const portrait = innerHeight > innerWidth * 1.05;
  play.className = `play mode-${mode}${showBoard && mode !== 'buzzer' ? ' with-board' : ' no-board'}${portrait ? ' portrait' : ' landscape'}`;
  document.body.className = mode === 'view' ? 'is-view' : '';
  const fr = document.querySelector('.frame');
  fr?.classList.toggle('compact', portrait);
  // poziomo na telefonie albo w małym oknie: drobne napisy w górę
  requestAnimationFrame(() => fr?.classList.toggle('small', !portrait && fr.clientWidth < 1000));
}
addEventListener('resize', () => {
  layout();
  stage.refresh();
});

function zoom(src) {
  const z = document.createElement('div');
  z.className = 'zoom';
  z.innerHTML = `<img src="${esc(src)}" alt=""><small>dotknij, żeby zamknąć</small>`;
  z.onclick = () => z.remove();
  document.body.appendChild(z);
}

// ---------- połączenie ----------

let lastAudio = '';
function reportAudio(st) {
  const k = st.st + '|' + st.src;
  if (k === lastAudio) return;
  lastAudio = k;
  link?.send({ t: 'astat', st: st.st, src: st.src });
}

mc.setSender((m) => !!link?.send(m));
mc.onChange((p) => {
  link?.send({ t: 'media-have', ...p });
  renderPad();
});
avatars.relayed(() => stage.refresh());

function start() {
  link?.destroy();
  view = null;
  board = null;
  net = 'connecting';
  if (!built) build();
  layout();
  soundGate();
  link = joinRoom(code, token, name || 'ekran', {
    viewer: mode === 'view',
    onPing: (m) => sample(m.now),
    onStatus(s) {
      net = s;
      if (s === 'kicked') {
        link?.destroy();
        link = null;
        built = false;
        return renderJoin('Prowadzący usunął Cię z gry.');
      }
      if (s === 'no-room' && !board) {
        link?.destroy();
        link = null;
        built = false;
        return renderJoin(`Nie ma pokoju ${code}. Sprawdź kod albo czy prowadzący ma otwarty panel.`);
      }
      if (s === 'open') mc.resume();
      renderPad();
    },
    onMessage(m) {
      if (m.t === 'state') {
        sample(m.now);
        const prev = view;
        view = m.view;
        viewAt = Date.now();
        if (view && prev?.phase !== view.phase) {
          sentWager = null;
          if (view.phase !== 'final-question') draft = '';
        }
        if (view?.buzzed?.me && !prev?.buzzed?.me) navigator.vibrate?.([60, 40, 60]);
        if (m.board) {
          board = m.board;
          mc.setKeys(board.mediaKeys);
          if (showBoard && mode !== 'buzzer') stage.update({ view: board, joinUrl: m.joinUrl, code: m.code, mediaVer: m.mediaVer });
        }
        renderPad();
      } else if (m.t === 'media-list') {
        mediaList = m;
        if (showBoard && mode !== 'buzzer') mc.setList(m.ver, m.items);
      } else if (m.t === 'media-file') {
        mc.receive(m);
      } else if (m.t === 'avatars') {
        avatars.feed(m.m);
      }
    },
  });
  renderPad();
}

function toggleBoard() {
  showBoard = !showBoard;
  ls.set('pk.board', showBoard ? '1' : '0');
  layout();
  if (showBoard) {
    if (mediaList) mc.setList(mediaList.ver, mediaList.items);
    if (board) stage.update({ view: board });
    soundGate();
  }
  stage.setSound(showBoard);
  renderPad();
}

// ---------- buzzer ----------

function buzz() {
  if (!view || view.phase !== 'question') return;
  const t = Date.now();
  if (t < lockUntil) return;
  if (view.canBuzz) {
    pressedAt = t;
    link?.send({ t: 'buzz' });
    navigator.vibrate?.(30);
    renderPad();
  } else if (!view.buzzed && !view.tried && !view.dd) {
    lockUntil = t + EARLY_LOCK_MS;
    navigator.vibrate?.(200);
    renderPad();
    setTimeout(renderPad, EARLY_LOCK_MS + 20);
  }
}

function buzzerHTML() {
  const v = view;
  const t = Date.now();
  if (t < lockUntil) return `<button class="buzzer early" id="buzz">Za wcześnie<small>blokada na sekundę</small></button>`;
  if (v.buzzed?.me) return `<button class="buzzer mine" id="buzz">Odpowiadasz<small>mów głośno i wyraźnie</small></button>`;
  if (v.buzzed) return `<button class="buzzer locked" id="buzz">${esc(v.buzzed.name)}<small>zgłosił się pierwszy</small></button>`;
  if (v.tried) return `<button class="buzzer locked" id="buzz">Pudło<small>to pytanie już nie dla Ciebie</small></button>`;
  if (v.canBuzz) {
    const waiting = pressedAt && t - pressedAt < 1500;
    return `<button class="buzzer armed" id="buzz">${waiting ? 'Wysłane…' : 'Zgłaszam się'}<small>${waiting ? 'czekaj na decyzję' : 'wciśnij teraz'}</small></button>`;
  }
  return `<button class="buzzer" id="buzz">Czekaj<small>buzzery jeszcze zamknięte</small></button>`;
}

const LOOK = () => (showBoard && mode !== 'buzzer' ? 'patrz na planszę' : 'patrz na ekran');

function body() {
  const v = view;
  const ph = v.phase;
  if (!v.me) return { info: ['Łączenie…', ''], center: '' };
  if (ph === 'lobby') return { info: ['Jesteś w grze', 'czekamy na start'], center: `<button class="buzzer" id="buzz" disabled>Rozgrzewka<small>tu będzie Twój buzzer</small></button>` };
  if (ph === 'opener') return { info: ['Zaraz zaczynamy', LOOK()], center: `<button class="buzzer" id="buzz" disabled>Czołówka<small>jeszcze możesz uciec</small></button>` };
  if (ph === 'rules') return { info: ['Zasady', 'słuchaj, potem nie płacz'], center: `<button class="buzzer" id="buzz" disabled>Zasady<small>buzzer ruszy w pierwszej rundzie</small></button>` };
  if (ph === 'round-intro') return { info: ['Nowa runda', `zaczyna ${v.pickerName}`], center: `<button class="buzzer" id="buzz">Czekaj<small>za chwilę plansza</small></button>` };
  if (ph === 'board')
    return {
      info: v.picker ? ['Ty wybierasz', 'podaj kategorię i stawkę na głos'] : [`Wybiera ${v.pickerName}`, LOOK()],
      center: `<button class="buzzer" id="buzz">Czekaj<small>buzzery jeszcze zamknięte</small></button>`,
    };
  if (ph === 'dd') {
    if (v.picker && v.ddMax) {
      return {
        info: ['Wszystko albo nic', `${v.category} · grasz tylko Ty`],
        center: `<form class="form" id="wagerf"><span class="label">Twoja stawka (5–${v.ddMax})</span>
          <input class="field" id="wager" inputmode="numeric" pattern="[0-9]*" placeholder="np. ${Math.min(500, v.ddMax)}" ${sentWager != null ? 'disabled' : ''}>
          <button class="btn primary" ${sentWager != null ? 'disabled' : ''}>${sentWager != null ? `Wysłano ${sentWager}` : 'Stawiam'}</button>
          <div class="hint">Możesz też powiedzieć stawkę na głos, prowadzący ją wpisze.</div></form>`,
      };
    }
    return { info: ['Wszystko albo nic', `${v.pickerName} gra sam`], center: `<button class="buzzer locked" id="buzz">Patrz<small>to nie Twoja tura</small></button>` };
  }
  if (ph === 'question') {
    if (v.dd) {
      return v.buzzed?.me
        ? { info: [`${v.category} · ${v.value}`, 'wszystko albo nic'], center: `<button class="buzzer mine" id="buzz">Odpowiadasz<small>stawka ${v.value}</small></button>` }
        : { info: [`${v.category} · ${v.value}`, `${v.pickerName} gra o wszystko`], center: `<button class="buzzer locked" id="buzz">Patrz<small>to nie Twoja tura</small></button>` };
    }
    return { info: [`${v.category} · ${v.value}`, showBoard && mode !== 'buzzer' ? 'spacja też działa' : 'pytanie na ekranie'], center: buzzerHTML() };
  }
  if (ph === 'reveal') {
    const r = v.result;
    let html;
    if (r?.mine && r.verdict !== 'wrong') html = `<div class="r">Dobrze</div><div class="d">+${r.delta}</div>`;
    else if (r?.mine) html = `<div class="r red">Pudło</div><div class="d">${r.delta}</div>`;
    else if (v.tried) html = `<div class="r red">Pudło</div><div class="d">było blisko? nie było</div>`;
    else if (!r || r.verdict === 'nobody') html = `<div class="r">Nikt</div><div class="d">nie wiedział</div>`;
    else html = `<div class="r">${esc(r.verdict === 'wrong' ? 'Ktoś pudłuje' : 'Ktoś trafia')}</div><div class="d"></div>`;
    return { info: [`${v.category} · ${v.value}`, 'odpowiedź na planszy'], center: `<div class="result">${html}</div>` };
  }
  if (ph.startsWith('final') && v.final) {
    const f = v.final;
    if (!f.inFinal) return { info: ['Finał', f.category], center: `<div class="result"><div class="r red">Bez finału</div><div class="d">wynik na minusie albo zero. patrz i cierp</div></div>` };
    if (ph === 'final-intro') return { info: ['Finał', f.category], center: `<div class="result"><div class="r">Finał</div><div class="d">zaraz obstawiasz</div></div>` };
    if (ph === 'final-wager') {
      const done = f.wager != null;
      return {
        info: ['Finał · zakład', f.category],
        center: `<form class="form" id="fwagerf"><span class="label">Zakład (0–${v.me.score})</span>
          <input class="field" id="fwager" inputmode="numeric" pattern="[0-9]*" placeholder="0–${v.me.score}">
          <button class="btn primary">${done ? `Przyjęty: ${f.wager}. Zmień` : 'Obstawiam'}</button>
          <div class="hint">Dobra odpowiedź dodaje zakład, zła go zabiera. Możesz zmienić, dopóki prowadzący nie pokaże pytania.</div></form>`,
      };
    }
    if (ph === 'final-question') {
      const left = f.remaining != null ? Math.max(0, f.remaining - (Date.now() - viewAt)) : null;
      const over = left === 0;
      return {
        info: ['Finał · odpowiedź', `zakład ${f.wager ?? 0}`],
        center: `<form class="form" id="fansf"><div class="countdown${left != null && left < 5000 ? ' low' : ''}" id="cd">${left != null ? Math.ceil(left / 1000) : ''}</div>
          <textarea class="field" id="fans" maxlength="140" placeholder="Twoja odpowiedź" ${over ? 'disabled' : ''}></textarea>
          <button class="btn primary" ${over ? 'disabled' : ''}>${f.answer != null ? 'Wyślij poprawkę' : 'Wyślij'}</button>
          <div class="hint">${f.answer != null ? `Wysłano: <b>${esc(f.answer)}</b>` : 'Liczy się ostatnia wysłana wersja.'}</div></form>`,
      };
    }
    if (ph === 'final-reveal') return { info: ['Finał', 'odsłaniamy na planszy'], center: `<div class="result"><div class="r">Odsłaniamy</div><div class="d">${f.answer != null ? esc(f.answer) : '(nic nie wysłano)'}</div></div>` };
  }
  if (ph === 'end') {
    return {
      info: ['Koniec odcinka', 'dzięki za grę'],
      center: `<div class="pad-rank">${(v.ranking || []).map((p, i) => `<div class="${p.me ? 'me' : ''}"><span>${i + 1}. ${esc(p.name)}</span><b>${p.score}</b></div>`).join('')}</div>`,
    };
  }
  return { info: ['…', ''], center: '' };
}

const NETS = { connecting: 'łączenie…', open: 'połączono', lost: 'zerwane, łączę…', error: 'błąd, ponawiam…', 'no-room': 'brak pokoju, ponawiam…' };

function footHTML() {
  const netTxt = NETS[net] || net;
  const p = mc.progress();
  const med = showBoard && mode !== 'buzzer' && p.total && p.have < p.total ? `<span>media ${p.have}/${p.total}</span>` : '';
  const btns = [];
  if (mode === 'play' && matchMedia('(pointer: fine)').matches) btns.push(`<button class="btn small ghost" id="pair">Telefon jako buzzer</button>`);
  if (mode !== 'view' && !paired) btns.push(`<button class="btn small ghost" id="tboard">${showBoard && mode !== 'buzzer' ? 'Ukryj planszę' : 'Pokaż planszę'}</button>`);
  btns.push(`<button class="btn small ghost" id="leave">${mode === 'view' ? 'Wyjdź' : 'Zmień'}</button>`);
  return `<div class="foot"><span class="net${net === 'open' ? '' : ' bad'}">${esc(netTxt)}</span>${med}<span class="fbtns">${btns.join('')}</span></div>`;
}

function renderPad() {
  if (!link || !built) return;
  const $pad = document.getElementById('pad');
  if (!$pad) return;
  if (mode === 'view') {
    $pad.innerHTML = net === 'open' ? footHTML() : `<div class="info"><div class="small">${esc(NETS[net] || net)}</div></div>${footHTML()}`;
    return bind();
  }
  if (!view) {
    $pad.innerHTML = `<div class="strip"><div class="logo">TK</div><div class="me"><span class="nm">${esc(name)}</span></div></div>
      <div class="info"><div class="big">Pokój ${esc(code)}</div><div class="small">${esc(NETS[net] || net)}</div></div>
      <div class="pad-center"><button class="buzzer" disabled>Łączenie<small>chwila</small></button></div>${footHTML()}`;
    return bind();
  }
  // nie przerywaj pisania w polu tekstowym
  const a = document.activeElement;
  const typing = a && (a.id === 'fans' || a.id === 'wager' || a.id === 'fwager') ? { id: a.id, v: a.value } : null;
  if (a?.id === 'fans') draft = a.value;
  const b = body();
  const me = view.me;
  $pad.innerHTML = `<div class="strip"><div class="logo">TK</div><div class="me"><span class="nm">${esc(me?.name || name)}</span><span class="sc${me && me.score < 0 ? ' neg' : ''}">${me ? me.score : ''}</span></div></div>
    <div class="info"><div class="big">${esc(b.info[0])}</div><div class="small">${esc(b.info[1])}</div></div>
    <div class="pad-center">${b.center}</div>
    ${footHTML()}`;
  const fans = document.getElementById('fans');
  if (fans && draft) fans.value = draft;
  if (typing) {
    const el = document.getElementById(typing.id);
    if (el && !el.disabled) {
      el.value = typing.v;
      el.focus();
    }
  }
  bind();
}

function bind() {
  const btn = document.getElementById('buzz');
  if (btn) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      buzz();
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') buzz();
    });
  }
  document.getElementById('leave')?.addEventListener('click', leave);
  document.getElementById('tboard')?.addEventListener('click', toggleBoard);
  document.getElementById('pair')?.addEventListener('click', pair);
  const wf = document.getElementById('wagerf');
  if (wf)
    wf.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = Math.round(Number(document.getElementById('wager').value));
      if (!Number.isFinite(v) || v < 5 || v > view.ddMax) return flash('wager');
      sentWager = v;
      link.send({ t: 'wager', amount: v });
      renderPad();
    });
  const fw = document.getElementById('fwagerf');
  if (fw)
    fw.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = Math.round(Number(document.getElementById('fwager').value));
      if (!Number.isFinite(v) || v < 0 || v > view.me.score) return flash('fwager');
      link.send({ t: 'wager', amount: v });
      document.getElementById('fwager').value = '';
      document.activeElement?.blur();
    });
  const fa = document.getElementById('fansf');
  if (fa)
    fa.addEventListener('submit', (e) => {
      e.preventDefault();
      const el = document.getElementById('fans');
      draft = el.value;
      link.send({ t: 'answer', text: el.value.trim() });
      el.blur();
    });
}

function flash(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.borderColor = 'var(--tally)';
  el.focus();
  setTimeout(() => (el.style.borderColor = ''), 900);
}

// kod QR dla telefonu: ten sam gracz (token), sam przycisk bez planszy
function pair() {
  const base = location.href.replace(/[?#].*$/, '');
  const q = new URLSearchParams({ r: code, t: token, n: view?.me?.name || name, tryb: 'buzzer' });
  if (params.get('peer')) q.set('peer', params.get('peer'));
  const url = `${base}?${q}`;
  const z = document.createElement('div');
  z.className = 'zoom pair';
  let svg = '';
  if (window.qrcode) {
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    svg = `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#ffb22e"/><path d="${d}" fill="#120d07"/></svg>`;
  }
  z.innerHTML = `<div class="pair-box"><h2>Telefon jako buzzer</h2><div class="pair-qr">${svg}</div>
    <p>Zeskanuj telefonem. Telefon będzie Twoim buzzerem (ten sam gracz), plansza zostaje tutaj. Spacja na komputerze też działa.</p>
    <button class="btn primary">Zamknij</button></div>`;
  z.onclick = (e) => (e.target === z || e.target.closest('button')) && z.remove();
  document.body.appendChild(z);
}

function leave() {
  link?.destroy();
  link = null;
  view = null;
  board = null;
  built = false;
  document.querySelector('.sound-gate')?.remove();
  if (paired) {
    // sparowany telefon wraca do zwykłego dołączania
    params.delete('t');
    params.delete('n');
    params.delete('tryb');
    history.replaceState(null, '', '?' + params.toString());
    location.reload();
    return;
  }
  renderJoin();
}

document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
  if (e.key === ' ' && !e.repeat) {
    e.preventDefault();
    if (mode !== 'view') buzz();
  } else if ((e.key === 'f' || e.key === 'F') && link) {
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  } else if (e.key === 'Escape') document.querySelector('.zoom')?.remove();
});

// odliczanie w finale i powrót z „Wysłane…”
setInterval(() => {
  if (!view) return;
  if (view.phase === 'final-question') {
    const cd = document.getElementById('cd');
    const f = view.final;
    if (cd && f?.remaining != null) {
      const left = Math.max(0, f.remaining - (Date.now() - viewAt));
      cd.textContent = Math.ceil(left / 1000);
      cd.classList.toggle('low', left < 5000);
    }
  }
  if (pressedAt && Date.now() - pressedAt > 1500 && Date.now() - pressedAt < 2000 && view.canBuzz) renderPad();
}, 250);

if (code && (name || mode === 'view') && params.get('r')) start();
else renderJoin();
