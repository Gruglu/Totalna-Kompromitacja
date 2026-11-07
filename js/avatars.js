// Mówiące awatary: ekran streamu łączy się z botem Discorda uruchomionym u prowadzącego
// (bot/bot.js, ws://127.0.0.1:7337). Bez bota nic się nie dzieje i plansza wygląda jak zwykle.
// ?bot=PORT zmienia port, ?bot=0 wyłącza.

const param = new URLSearchParams(location.search).get('bot');
const PORT = param == null || param === '' ? 7337 : Number(param);

const byNick = new Map(); // znormalizowany nick -> { key, closed, open }
const speaking = new Set();
let connected = false;
let onChange = () => {};

export const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export function forName(name) {
  return byNick.get(norm(name)) || null;
}
export function isConnected() {
  return connected;
}

// HTML awatara dla gracza o danym nicku (pusty, gdy brak).
export function html(name, cls = 'av') {
  const a = forName(name);
  if (!a) return '';
  return `<div class="${cls}${speaking.has(a.key) ? ' talk' : ''}" data-av="${a.key}"><img class="c" src="${a.closed}" alt=""><img class="o" src="${a.open}" alt=""></div>`;
}

// Mówienie przełącza tylko klasy, bez przerysowywania planszy.
function apply(key) {
  const on = speaking.has(key);
  for (const el of document.querySelectorAll(`[data-av="${key}"]`)) {
    el.classList.toggle('talk', on);
    el.closest('.p, .who, .row')?.classList.toggle('talking', on);
  }
}

// Po każdym przerysowaniu dociąga klasę „talking” na kafelkach.
export function refresh() {
  for (const el of document.querySelectorAll('[data-av]')) {
    const on = speaking.has(el.dataset.av);
    el.classList.toggle('talk', on);
    el.closest('.p, .who, .row')?.classList.toggle('talking', on);
  }
}

// Wiadomość od bota (albo przekazana przez prowadzącego telefonom graczy).
export function feed(m) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'hello') {
    byNick.clear();
    speaking.clear();
    for (const p of m.players || []) for (const n of p.nicks || []) byNick.set(norm(n), { key: p.key, closed: p.closed, open: p.open });
    for (const k of m.speaking || []) speaking.add(k);
    connected = true;
    onChange();
  } else if (m.t === 'speak') {
    if (m.on) speaking.add(m.key);
    else speaking.delete(m.key);
    apply(m.key);
  } else if (m.t === 'bye') {
    // bot padł: awatary zostają (bez ruszania ustami)
    const was = connected;
    connected = false;
    speaking.clear();
    refresh();
    if (was) onChange();
  }
}

// Telefon gracza: awatary przychodzą od prowadzącego, bez łączenia z botem.
export function relayed(cb) {
  onChange = cb || onChange;
}

// Stan do przekazania dalej (np. graczowi, który dołączył później).
export function snapshot() {
  if (!connected) return null;
  const players = new Map();
  for (const [nick, a] of byNick) {
    if (!players.has(a.key)) players.set(a.key, { key: a.key, nicks: [], closed: a.closed, open: a.open });
    players.get(a.key).nicks.push(nick);
  }
  return { t: 'hello', players: [...players.values()], speaking: [...speaking] };
}

// onRaw: dostaje każdą wiadomość od bota (prowadzący przekazuje je graczom)
export function start(cb, onRaw) {
  onChange = cb || onChange;
  if (!PORT) return;
  let ws;
  let wait = 1000;
  const connect = () => {
    try {
      ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    } catch {
      return setTimeout(connect, 5000);
    }
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === 'hello') wait = 1000;
      feed(m);
      if (m.t === 'hello' || m.t === 'speak') onRaw?.(m);
    };
    ws.onclose = () => {
      if (connected) {
        feed({ t: 'bye' });
        onRaw?.({ t: 'bye' });
      }
      // bot pewnie jeszcze nie działa; próbujemy co kilka sekund, po cichu
      setTimeout(connect, wait);
      wait = Math.min(wait * 2, 8000);
    };
  };
  connect();
}
