// Plansza: wspólne rysowanie dla okna streamu (board.html), podglądu w panelu
// i ekranu gracza (play.html). Strona, która jej używa, dostarcza widok, źródło mediów
// i zegar prowadzącego; plansza rysuje, gra efekty i (gdy ma dźwięk) audio z pytań.
import { ANSWER_SECONDS, FINAL_SECONDS } from './engine.js';
import * as sound from './sound.js';
import * as avatars from './avatars.js';

const TYPE_CPS = 38; // znaki na sekundę przy wpisywaniu pytania

let $stage = null;
let opts = {
  sound: false, // czy ta plansza gra efekty i audio z pytań
  resolve: async () => null, // src -> adres do <img>/<audio> albo null
  report: null, // stan odtwarzacza audio (tylko gdy sound)
  clock: () => Date.now(), // czas prowadzącego (telefony mają inny zegar)
};
let view = null;
let joinUrl = '';
let code = '';
let lastFx = null;
let lastMainKey = '';
let lastPhaseKey = '';
let prevScores = new Map();
let lastSecond = null;
let mediaVer = null;

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nameOf = (id) => view?.players.find((p) => p.id === id)?.name ?? '?';
const now = () => opts.clock();

export function init(root, o = {}) {
  $stage = root;
  opts = { ...opts, ...o };
  loop();
}

export function getView() {
  return view;
}

// m: { view, joinUrl, code, mediaVer }
export function update(m) {
  if (!m?.view) return;
  const first = !view;
  view = m.view;
  joinUrl = m.joinUrl || joinUrl;
  code = m.code || code;
  if (m.mediaVer !== undefined && m.mediaVer !== mediaVer) {
    if (mediaVer != null) {
      urls.clear();
      opts.onMediaReset?.();
    }
    mediaVer = m.mediaVer;
  }
  if (opts.sound && !first && view.fx && lastFx && view.fx.n > lastFx.n) sound.play(view.fx.type);
  lastFx = view.fx;
  render();
  syncAudio();
}

// przerysuj wszystko (np. przyszły awatary albo plik z mediami)
export function refresh() {
  lastMainKey = '';
  if (view) render();
  syncAudio();
}

// włącz/wyłącz dźwięk tej planszy (podgląd w panelu)
export function setSound(on) {
  if (opts.sound === !!on) return;
  opts.sound = !!on;
  if (!on) {
    stopAudio();
    aSrc = null;
    aUrl = null;
  } else {
    lastMediaN = view?.media?.n ?? null; // nie odpalaj od nowa muzyki, która już grała
  }
  syncAudio();
}

// stan odtwarzacza z innego okna (gdy ta plansza sama nie gra)
export function setAudioStat(st) {
  if (!opts.sound) audioStat = st;
}

// odblokowanie dźwięku: musi być wywołane z kliknięcia/dotknięcia
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
let blessed = false;
export function unlock() {
  const ok = sound.unlock();
  if (!blessed) {
    blessed = true;
    // iOS pozwala później grać tylko elementom, które raz ruszyły w geście użytkownika
    for (const el of [player, extPlayer]) {
      if (el.src) continue;
      el.src = SILENT;
      el.play().then(
        () => el.pause(),
        () => {}
      );
    }
  }
  setTimeout(syncAudio, 50);
  return ok;
}

// ---------- rysowanie ----------

function bar() {
  const v = view;
  let round = '';
  const ph = v.phase;
  if (ph === 'opener') return '';
  const SCR = { season: 'Ranking sezonu <span>suma punktów ze wszystkich odcinków</span>', shame: 'Hall of Shame <span>to zostanie w archiwum</span>', punish: 'Kara <span>ważna 7 dni</span>' };
  if (v.screen && SCR[v.screen]) round = SCR[v.screen];
  else if (ph === 'lobby') round = 'Zaraz zaczynamy <span>dołącz z telefonu albo komputera</span>';
  else if (ph === 'rules') round = `Zasady gry <span>${v.rules.idx + 1} / ${v.rules.count}</span>`;
  else if (ph === 'board' || ph === 'round-intro')
    round = `${esc(v.roundName)} <span>stawki ${v.values[0]}–${v.values[v.values.length - 1]} · ${v.qDone}/${v.qTotal}</span>`;
  else if (ph === 'dd') round = `Wszystko albo nic <span>${esc(v.cur.category)}</span>`;
  else if (ph === 'question' || ph === 'reveal')
    round = `${esc(v.cur.category)} <span>${v.cur.dd ? 'stawka ' + v.cur.wager : 'za ' + v.cur.value}</span>`;
  else if (ph.startsWith('final')) round = `Finał <span>${esc(v.final?.category || '')}</span>`;
  else if (ph === 'end') round = 'Wyniki <span>koniec odcinka</span>';
  const alarm = ph === 'dd' ? ' alarm' : '';
  return `<div class="bar${alarm}"><div class="logo">${esc(v.title)}</div><div class="round">${round}</div><div class="air"><i class="dot"></i>NA ŻYWO</div></div>`;
}

function playerTag(p) {
  const v = view;
  const cur = v.cur;
  let cls = 'p';
  let tag = '';
  if (!p.connected) tag = 'offline';
  if (v.phase === 'lobby') tag = p.connected ? 'gotowy' : 'czeka';
  if (['board', 'round-intro', 'dd'].includes(v.phase) && v.picker === p.id) {
    cls += ' pick';
    tag = v.phase === 'dd' ? 'gra o wszystko' : 'wybiera';
  }
  if (cur && (v.phase === 'question' || v.phase === 'reveal')) {
    if (cur.buzzed === p.id) {
      cls += ' buzz';
      tag = 'odpowiada';
    } else if (cur.wrong.includes(p.id)) {
      cls += ' locked';
      tag = 'pudło';
    } else if (cur.dd || cur.buzzed) {
      cls += ' locked';
      tag = cur.dd ? '' : 'blokada';
    }
    if (v.phase === 'reveal' && cur.result?.id === p.id && cur.result.verdict !== 'wrong') {
      cls = 'p buzz';
      tag = cur.result.verdict === 'half' ? 'połowa' : 'trafia';
    }
  }
  if (v.final && v.phase.startsWith('final')) {
    if (!v.final.ids.includes(p.id)) {
      cls += ' locked';
      tag = 'poza finałem';
    } else if (v.phase === 'final-reveal' && v.final.currentId === p.id) {
      cls += ' buzz';
      tag = 'na celowniku';
    }
  }
  if (!p.connected && v.phase !== 'lobby') cls += ' off';
  const prev = prevScores.get(p.id);
  let delta = '';
  if (prev != null && prev !== p.score) {
    const d = p.score - prev;
    delta = `<div class="delta${d < 0 ? ' neg' : ''}">${d > 0 ? '+' : ''}${d}</div>`;
  }
  const av = avatars.html(p.name);
  if (av) cls += ' has-av';
  return `<div class="${cls}">${delta}${av}<div class="n">${esc(p.name)}</div><div class="s${p.score < 0 ? ' neg' : ''}">${p.score}</div><div class="t">${esc(tag)}</div></div>`;
}

function lower() {
  if (view.phase === 'opener') return '';
  const ps = view.players;
  if (!ps.length) return `<div class="lower empty">Czekamy na graczy</div>`;
  const html = `<div class="lower" style="--n:${ps.length}">${ps.map(playerTag).join('')}</div>`;
  prevScores = new Map(ps.map((p) => [p.id, p.score]));
  return html;
}

function qsize(text) {
  const n = (text || '').length;
  if (n > 220) return '3.3cqw';
  if (n > 160) return '3.8cqw';
  if (n > 110) return '4.4cqw';
  return '5.2cqw';
}

// adresy mediów: znane od razu albo dociągane z IndexedDB (wtedy ponowne rysowanie)
const urls = new Map();
function mediaUrl(src) {
  if (!src) return '';
  if (urls.has(src)) return urls.get(src) || '';
  urls.set(src, undefined); // ładowanie
  Promise.resolve(opts.resolve(src)).then((u) => {
    if (!urls.has(src)) return; // w międzyczasie zmieniły się media
    urls.set(src, u || null);
    lastMainKey = '';
    render();
  });
  return '';
}

function imgBlock(src, cls = '') {
  const u = mediaUrl(src);
  if (!u && urls.get(src) === null) return ''; // brak pliku: widzowie nic nie widzą, prowadzący ma ostrzeżenie w panelu
  const inner = u ? `<img src="${esc(u)}" alt="">` : `<div class="missing">${urls.get(src) === undefined ? 'ładowanie…' : 'brak pliku'}<small>${esc(src)}</small></div>`;
  return `<div class="img ${cls}"><div class="tag">materiał</div>${inner}</div>`;
}

function deckBlock() {
  return `<div class="deck" id="deck"><div class="tag">odsłuch</div><canvas id="viz" width="640" height="220"></canvas>
    <div class="dfoot"><span class="dst" id="dst">czeka na prowadzącego</span><span class="dtime" id="dtime">00:00</span></div></div>`;
}

// ---------- czołówka ----------
// Oś czasu w sekundach, zgrana z sound.opener(). Opóźnienia animacji liczone od --t0,
// więc odświeżone okno streamu wskakuje w odpowiednie miejsce.
const OPENER = { log: 0.6, logStep: 0.36, glitch: 3.55, logo1: 3.75, logo2: 4.05, ep: 5.0, sub: 5.45, cast: 6.4, castStep: 0.42 };
const SNARK = [
  'przyszedł po minusy',
  'przygotowanie: brak',
  'zna tylko memy',
  'pewność siebie bez pokrycia',
  'faworyt do ostatniego miejsca',
  'wie wszystko poza odpowiedziami',
  'wiedza: pobieranie 3%',
  'ostatnio widziany przy zerze',
  'gra na czuja',
  'czyta tylko nagłówki',
];
function seeded(seed) {
  let x = seed >>> 0 || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function openerHTML() {
  const v = view;
  const o = v.opener;
  const n = v.players.length;
  const rnd = seeded(o.at % 100000);
  const pool = [...SNARK].sort(() => rnd() - 0.5);
  const pad = (k, val) => k + ' ' + '.'.repeat(Math.max(2, 30 - k.length)) + ' ';
  const log = [
    ['TK-BIOS v2.6 · totalna kompromitacja', ''],
    ['test pamięci', '640K OK'],
    ['wykrywanie graczy', String(n)],
    ['ładowanie wiedzy ogólnej', 'BŁĄD', 'red'],
    ['ładowanie wstydu', '100%'],
    ['kalibracja buzzerów', 'OK'],
    ['litość prowadzącego', '0%', 'red'],
    ['sygnał', 'NA ŻYWO', 'red'],
  ];
  const lines = log
    .map(([k, val, c], i) => `<div style="--d:${OPENER.log + i * OPENER.logStep}s">${i ? esc(pad(k)) : esc(k)}<b class="${c || ''}">${esc(val)}</b></div>`)
    .join('');
  const ep = o.episode != null && o.episode !== '' ? `<div class="ep" style="--d:${OPENER.ep}s">Odcinek <b>${esc(String(o.episode).padStart(2, '0'))}</b></div>` : '';
  const sub = `<div class="osub" style="--d:${OPENER.sub}s">${esc(o.subtitle || 'teleturniej, z którego nikt nie wychodzi z twarzą')}</div>`;
  const cast = v.players
    .map(
      (p, i) =>
        `<div class="who${avatars.forName(p.name) ? ' has-av' : ''}" style="--d:${OPENER.cast + 0.5 + i * OPENER.castStep}s">${avatars.html(p.name)}<span class="no">${String(i + 1).padStart(2, '0')}</span><span class="nm">${esc(p.name)}</span><span class="sn">${esc(pool[i % pool.length])}</span></div>`
    )
    .join('');
  const castEnd = OPENER.cast + 0.5 + n * OPENER.castStep + 0.4;
  return `<div class="opener" id="opener">
    <div class="o-on"></div>
    <div class="o-log" style="--d:${OPENER.glitch}s">${lines}</div>
    <div class="o-glitch" style="--d:${OPENER.glitch}s"></div>
    <div class="o-main">
      <div class="o-logo"><div class="l1" style="--d:${OPENER.logo1}s"><span>Totalna</span></div><div class="l2" style="--d:${OPENER.logo2}s"><span>Kompromitacja</span></div></div>
      <div class="o-meta">${ep}${sub}</div>
    </div>
    <div class="o-cast"><div class="o-castlab" style="--d:${OPENER.cast}s">Dzisiaj kompromitują się</div><div class="o-who" style="--n:${Math.max(n, 1)}">${cast}</div></div>
    <div class="o-tick" style="--d:${castEnd}s"><i class="dot"></i>NA ŻYWO<span>za chwilę zasady</span></div>
  </div>`;
}

function rulesHTML() {
  const r = view.rules;
  const pips = Array.from({ length: r.count }, (_, i) => `<i class="${i < r.idx ? 'done' : i === r.idx ? 'cur' : ''}"></i>`).join('');
  return `<div class="rules">
    <div class="rnum">${String(r.idx + 1).padStart(2, '0')}</div>
    <div class="rhead"><span class="sub">Zasady gry · ${r.idx + 1} z ${r.count}</span><div class="pips">${pips}</div></div>
    <div class="rtitle">${esc(r.title)}</div>
    <div class="rlines">${r.lines.map((l, i) => `<div style="--i:${i}">${esc(l)}</div>`).join('')}</div>
  </div>`;
}

function msize(text) {
  const n = (text || '').length;
  if (n > 160) return '2.6cqw';
  if (n > 90) return '3.1cqw';
  return '3.8cqw';
}

// ---------- po odcinku: ranking sezonu, Hall of Shame, kara ----------

function seasonHTML() {
  const se = view.season;
  if (!se || !se.rows.length) {
    return `<div class="center"><div class="sub">${esc(se?.name || 'Sezon')}</div><div class="huge" style="font-size:8cqw">Ranking sezonu</div><div class="crtline">Na razie pusto. Ktoś musi się pierwszy skompromitować.</div></div>`;
  }
  const rows = se.rows.slice(0, 8);
  const n = rows.length;
  const html = rows
    .map((r, i) => {
      const fin = i < se.spots;
      const cut = i === se.spots - 1 && n > se.spots ? '<div class="cutline" style="--i:' + (n - i) + '"><span>granica finału sezonu</span></div>' : '';
      const meta = `${r.played} ${r.played === 1 ? 'odcinek' : r.played < 5 ? 'odcinki' : 'odcinków'}${r.wins ? ` · wygrane ${r.wins}` : ''}${r.lasts ? ` · ostatnie miejsce ${r.lasts}` : ''}`;
      return `<div class="srow${fin ? ' fin' : ''}${i === 0 ? ' first' : ''}" style="--i:${n - 1 - i}"><span class="pos">${r.pos}.</span><span class="nm">${esc(r.name)}<small>${esc(meta)}</small></span>${fin ? '<span class="ftag">finał</span>' : '<span></span>'}<span class="sc${r.total < 0 ? ' neg' : ''}">${r.total}</span></div>${cut}`;
    })
    .join('');
  return `<div class="season">
    <div class="shead"><div class="sub">${esc(se.name)} · po ${se.count} ${se.count === 1 ? 'odcinku' : 'odcinkach'}</div><div class="stitle">Ranking sezonu</div><div class="sub">top <b>${se.spots}</b> gra w finale sezonu</div></div>
    <div class="srows">${html}</div>
  </div>`;
}

function shameHTML() {
  const list = view.shame || [];
  const star = list.find((x) => x.star) || list[0];
  if (!star) {
    return `<div class="center"><div class="sub">Hall of Shame</div><div class="huge" style="font-size:8cqw">Czysto</div><div class="crtline">Dzisiaj nikt nie powiedział nic wystarczająco głupiego. Podejrzane.</div></div>`;
  }
  const rest = list.filter((x) => x !== star);
  const len = star.text.length;
  const size = len > 120 ? '3.6cqw' : len > 70 ? '4.6cqw' : len > 35 ? '6cqw' : '7.6cqw';
  const noms = rest.length
    ? `<div class="noms"><span class="lab">nominacje</span>${rest
        .slice(0, 4)
        .map((x) => `<div><b>${esc(x.name)}</b> „${esc(x.text)}”</div>`)
        .join('')}</div>`
    : '';
  return `<div class="shame">
    <div class="sh-top"><span class="sh-band">Hall of Shame</span><span class="sub">najgłupsza odpowiedź ${view.episode != null ? `odcinka ${esc(String(view.episode).padStart(2, '0'))}` : 'wieczoru'}</span></div>
    ${star.q ? `<div class="sh-q"><span>${esc(star.cat || 'pytanie')}</span>${esc(star.q)}</div>` : ''}
    <div class="sh-who">${esc(star.name)} odpowiada:</div>
    <div class="sh-quote" style="--s:${size}">„${esc(star.text)}”</div>
    ${star.a ? `<div class="answer sh-ans"><div class="k">A miało być</div><div class="a">${esc(star.a)}</div></div>` : ''}
    <div class="sh-stamp">zapisane w archiwum</div>
    ${noms}
  </div>`;
}

function punishHTML() {
  const p = view.punish;
  if (!p?.loserName || !p?.winnerName) {
    return `<div class="center"><div class="huge" style="font-size:8cqw">Kara</div><div class="crtline">Za mało graczy, żeby kogoś ukarać.</div></div>`;
  }
  return `<div class="center punish">
    <div class="dd-band">Kara</div>
    <div class="pl-lines">
      <div style="--i:0"><b class="red">${esc(p.loserName)}</b> przegrywa odcinek</div>
      <div style="--i:1"><b>${esc(p.winnerName)}</b> wybiera nowy nick i avatar na Discordzie</div>
      <div style="--i:2">obowiązuje ${p.days} dni, do <b>${esc(p.until)}</b></div>
      <div style="--i:3">bez zmieniania z powrotem, bez negocjacji</div>
    </div>
    ${p.nick ? `<div class="newnick enter-pop"><span>nowy nick</span><b>${esc(p.nick)}</b></div>` : '<div class="sub">nowy nick: <b>zwycięzca myśli…</b></div>'}
  </div>`;
}

function main() {
  const v = view;
  const ph = v.phase;
  if (ph === 'opener') return openerHTML();
  if (v.screen === 'season') return seasonHTML();
  if (v.screen === 'shame' && ph === 'end') return shameHTML();
  if (v.screen === 'punish' && ph === 'end') return punishHTML();
  if (ph === 'rules') return rulesHTML();
  if (ph === 'lobby') {
    return `<div class="lobby"><div style="display:grid;gap:1.6cqw">
      <div class="sub">Kod pokoju</div>
      <div class="code">${esc(code || '····')}</div>
      <div class="sub">Wejdź z telefonu albo komputera</div>
      <div class="url">${esc(joinUrl.replace(/^https?:\/\//, ''))}</div>
    </div><div><div class="qr" id="qr"></div><div class="qrcap">zeskanuj telefonem</div></div></div>`;
  }
  if (ph === 'round-intro') {
    return `<div class="center">
      <div class="sub">${v.round === 0 ? 'Zaczynamy' : 'Stawki w górę'}</div>
      <div class="huge">${esc(v.roundName)}</div>
      <div class="sub">stawki <b>${v.values.join(' · ')}</b></div>
      <div class="intro-cats">${v.categories.map((c, i) => `<div style="--i:${i}">${esc(c)}</div>`).join('')}</div>
    </div>`;
  }
  if (ph === 'board') {
    const cols = v.categories.length;
    let cells = v.categories.map((c) => `<div class="cat">${esc(c)}</div>`).join('');
    let i = 0;
    v.values.forEach((val, q) => {
      v.categories.forEach((_, c) => {
        const used = v.used[`${v.round}:${c}:${q}`];
        cells += `<div class="v${used ? ' used' : ''}" style="--i:${i++}">${used ? '' : val}</div>`;
      });
    });
    return `<div class="board" style="grid-template-columns:repeat(${cols},1fr);--rows:${v.values.length}">${cells}</div>`;
  }
  if (ph === 'dd') {
    return `<div class="center">
      <div class="dd-band">Wszystko albo nic</div>
      <div class="sub">kategoria <b>${esc(v.cur.category)}</b> · gra tylko <b>${esc(nameOf(v.picker))}</b></div>
      <div class="crtline">Stawka: ${v.cur.wager == null ? 'ustalana…' : v.cur.wager}</div>
    </div>`;
  }
  if (ph === 'question' || ph === 'reveal') {
    const c = v.cur;
    const shownImg = ph === 'reveal' && v.answerImage ? v.answerImage : c.image;
    const img = (shownImg ? imgBlock(shownImg, shownImg === v.answerImage ? 'answer enter-pop' : '') : '') + (c.hasAudio ? deckBlock() : '');
    const hasMedia = !!img;
    let foot = '';
    if (ph === 'question') {
      let st;
      if (c.buzzed) st = `<div class="state buzz">${c.dd ? 'Odpowiada' : 'Zgłasza się'}: ${esc(nameOf(c.buzzed))}</div>`;
      else if (c.buzzOpen) st = `<div class="state open">Buzzery otwarte</div>`;
      else st = `<div class="state closed">Buzzery zamknięte</div>`;
      const showTimer = (c.buzzed && c.buzzedAt) || c.buzzOpen;
      foot = `${st}${showTimer ? '<div class="timer" id="timer"><i></i></div><span class="secs" id="secs"></span>' : ''}`;
    } else {
      const r = c.result;
      let verdict;
      if (!r || r.verdict === 'nobody') verdict = `<div class="verdict none">Nikt nie wiedział</div>`;
      else if (r.verdict === 'wrong') verdict = `<div class="verdict wrong">${esc(nameOf(r.id))} ${r.delta}</div>`;
      else verdict = `<div class="verdict right">${esc(nameOf(r.id))} +${r.delta}</div>`;
      foot = `<div class="answer enter-pop" style="flex:1"><div class="k">Odpowiedź</div><div class="a">${esc(c.answer)}</div></div>${verdict}`;
    }
    const pos = `${v.qDone} z ${v.qTotal}`;
    return `<div class="q">
      <div class="meta"><b class="${c.dd ? 'red' : ''}">${c.dd ? c.wager : c.value}</b>${c.dd ? 'wszystko albo nic · ' : ''}pytanie ${pos}</div>
      <div class="body${hasMedia ? ' media' : ''}"><div class="text${ph === 'reveal' ? ' dim' : ''}" id="qtext" style="--qsize:${hasMedia ? msize(c.text) : qsize(c.text)}"></div>${img}</div>
      <div class="foot">${foot}</div>
    </div>`;
  }
  if (ph === 'final-intro') {
    const f = v.final;
    return `<div class="center">
      <div class="sub">Ostatnie pytanie</div>
      <div class="huge">Finał</div>
      <div class="sub">kategoria</div>
      <div class="crtline" style="font-size:5cqw;color:var(--amber)">${esc(f.category)}</div>
      <div class="sub">grają: <b>${f.ids.map((id) => esc(nameOf(id))).join(', ')}</b></div>
    </div>`;
  }
  if (ph === 'final-wager') {
    const f = v.final;
    return `<div class="center">
      <div class="sub">Finał · ${esc(f.category)}</div>
      <div class="huge" style="font-size:7cqw">Obstawiajcie</div>
      <div class="sub">wpiszcie zakład na telefonie, od zera do całego wyniku</div>
      <div class="fin-list" style="--n:${f.ids.length}">${f.ids
        .map((id) => {
          const ok = f.wagered.includes(id);
          return `<div class="${ok ? 'done' : ''}"><span class="nm">${esc(nameOf(id))}</span><span class="st">${ok ? 'zakład przyjęty' : 'myśli…'}</span></div>`;
        })
        .join('')}</div>
    </div>`;
  }
  if (ph === 'final-question') {
    const f = v.final;
    const img = (f.image ? imgBlock(f.image) : '') + (f.hasAudio ? deckBlock() : '');
    const hasMedia = !!img;
    return `<div class="q">
      <div class="meta"><b class="red">Finał</b>${esc(f.category)} · odpowiedzi na telefonach</div>
      <div class="body${hasMedia ? ' media' : ''}"><div class="text" id="qtext" style="--qsize:${hasMedia ? msize(f.text) : qsize(f.text)}"></div>${img}</div>
      <div class="foot"><div class="state closed">Odpowiedzi: ${f.answered.length}/${f.ids.length}</div><div class="timer" id="timer"><i></i></div><span class="secs" id="secs"></span></div>
    </div>`;
  }
  if (ph === 'final-reveal') {
    const f = v.final;
    const id = f.currentId;
    const j = f.judged[id];
    const ans = f.currentAnswer?.trim() ? esc(f.currentAnswer) : '<span style="color:var(--amber-dim)">(pusto)</span>';
    let verdict = '';
    if (j) verdict = `<div class="verdict ${j.verdict === 'right' ? 'right' : 'wrong'} enter-pop">${j.verdict === 'right' ? 'Dobrze' : 'Źle'} · zakład ${f.currentWager} · ${j.delta >= 0 ? '+' : ''}${j.delta}</div>`;
    return `<div class="q">
      <div class="meta"><b class="red">Finał</b>${esc(f.category)} · gracz ${f.idx + 1} z ${f.order.length}</div>
      <div class="body" style="display:grid;gap:1.6cqw;align-content:center">
        <div class="text dim" style="--qsize:2.6cqw">${esc(f.text)}</div>
        <div class="sub"><b>${esc(nameOf(id))}</b> odpowiada</div>
        <div class="crtline" style="font-size:5.6cqw">${ans}</div>
      </div>${v.answerImage ? `<div class="fin-img">${imgBlock(v.answerImage, 'answer enter-pop')}</div>` : ''}
      <div class="foot">${f.answer ? `<div class="answer enter-pop" style="flex:1"><div class="k">Odpowiedź</div><div class="a">${esc(f.answer)}</div></div>` : '<div style="flex:1"></div>'}${verdict}</div>
    </div>`;
  }
  if (ph === 'end') {
    const sorted = [...v.players].sort((a, b) => b.score - a.score);
    return `<div class="center" style="justify-items:stretch">
      <div class="sub">Koniec odcinka</div>
      <div class="rank">${sorted
        .map(
          (p, i) =>
            `<div class="row${i === 0 ? ' first' : ''}${i === sorted.length - 1 && sorted.length > 1 ? ' last' : ''}" style="--i:${sorted.length - 1 - i}"><span class="pos">${i + 1}.</span>${avatars.html(p.name)}<span class="nm">${esc(p.name)}</span><span class="sc${p.score < 0 ? ' neg' : ''}">${p.score}</span></div>`
        )
        .join('')}</div>
    </div>`;
  }
  return `<div class="waiting">…</div>`;
}

let $main = null;
let $lower = null;
let $bar = null;

function render() {
  if (!view || !$stage) return;
  if (!$main) {
    $stage.innerHTML = '<div id="bar"></div><div class="main" id="main"></div><div id="lower"></div>';
    $bar = document.getElementById('bar');
    $main = document.getElementById('main');
    $lower = document.getElementById('lower');
  }
  $stage.classList.toggle('full', view.phase === 'opener');
  $bar.innerHTML = bar();
  $lower.innerHTML = lower();
  const html = main();
  const phaseKey = view.phase + ':' + (view.cur ? `${view.cur.c}:${view.cur.q}` : '') + ':' + view.round;
  if (html !== lastMainKey) {
    $main.innerHTML = html;
    lastMainKey = html;
    if (phaseKey !== lastPhaseKey && view.phase === 'board') $main.querySelector('.board')?.classList.add('enter');
    if (view.phase === 'lobby') drawQR();
    if (view.phase === 'opener') {
      const el = document.getElementById('opener');
      if (el) el.style.setProperty('--t0', `${-Math.max(0, (now() - view.opener.at) / 1000)}s`);
    }
  }
  lastPhaseKey = phaseKey;
  avatars.refresh();
  tick();
}

function drawQR() {
  const el = document.getElementById('qr');
  if (!el || !window.qrcode || !joinUrl) return;
  const qr = window.qrcode(0, 'M');
  qr.addData(joinUrl);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  el.innerHTML = `<svg viewBox="0 0 ${n} ${n}" width="100%" height="100%" shape-rendering="crispEdges"><path d="${d}" fill="#120d07"/></svg>`;
}

// ---------- czas: wpisywanie pytania i zegary ----------

function tick() {
  if (!view) return;
  const t = now();
  const qt = document.getElementById('qtext');
  if (qt) {
    let text = null;
    let start = null;
    if (view.cur && (view.phase === 'question' || view.phase === 'reveal')) {
      text = view.cur.text;
      start = view.phase === 'reveal' ? 0 : view.cur.shownAt;
    } else if (view.final && view.phase === 'final-question') {
      text = view.final.text;
      start = view.final.qAt;
    }
    if (text != null) {
      const n = Math.min(text.length, Math.floor(((t - start) / 1000) * TYPE_CPS));
      const done = n >= text.length;
      const want = text.slice(0, n);
      if (qt.dataset.n !== String(n)) {
        qt.textContent = want;
        const cur = document.createElement('i');
        cur.className = 'cursor';
        if (!(done && view.phase === 'reveal')) qt.appendChild(cur);
        qt.dataset.n = n;
      }
    }
  }
  const timer = document.getElementById('timer');
  const secs = document.getElementById('secs');
  if (timer && secs) {
    let total = null;
    let from = null;
    if (view.phase === 'question' && view.cur.buzzed && view.cur.buzzedAt) {
      total = ANSWER_SECONDS;
      from = view.cur.buzzedAt;
    } else if (view.phase === 'question' && view.cur.buzzOpen) {
      total = null; // czas na zgłoszenie: tylko licznik w górę
      from = view.cur.openedAt;
    } else if (view.phase === 'final-question') {
      total = FINAL_SECONDS;
      from = view.final.qAt;
    }
    if (from) {
      const el = (t - from) / 1000;
      if (total) {
        const left = Math.max(0, total - el);
        timer.querySelector('i').style.width = `${(left / total) * 100}%`;
        const s = Math.ceil(left);
        secs.textContent = String(s).padStart(2, '0');
        const low = left <= Math.min(3, total * 0.2);
        timer.classList.toggle('low', low);
        secs.classList.toggle('low', low);
        if (opts.sound && s !== lastSecond && low && s > 0) sound.play('tick');
        if (opts.sound && s === 0 && lastSecond > 0) sound.play('timeout');
        lastSecond = s;
      } else {
        timer.querySelector('i').style.width = '100%';
        secs.textContent = String(Math.floor(el)).padStart(2, '0');
        lastSecond = null;
      }
    }
  }
}

// ---------- audio z pytań ----------
// Gra plansza z włączonym dźwiękiem (telefon gracza, podgląd w panelu, okno streamu).
// Plansza bez dźwięku pokazuje stan dostarczony z zewnątrz (setAudioStat).

const player = new Audio();
player.preload = 'auto';
const extPlayer = new Audio(); // zewnętrzne adresy bez CORS nie mogą iść przez Web Audio
extPlayer.preload = 'auto';
let aSrc = null; // ścieżka z pytania
let aEl = player;
let aUrl = null;
let aLoading = false;
let lastMediaN = null;
let analyser = null;
let audioStat = null;
let ended = false;

function aInfo() {
  return view?.audio || null;
}

function report(st) {
  if (!opts.sound) return;
  const a = aInfo();
  const pos = a && aUrl ? Math.max(0, aEl.currentTime - a.start) : 0;
  const total = a && aUrl ? (a.end || aEl.duration || 0) - a.start : 0;
  audioStat = { t: 'audio', st, pos, dur: Number.isFinite(total) ? total : 0, src: aSrc };
  opts.report?.(audioStat);
}

function stopAudio() {
  for (const el of [player, extPlayer]) el.pause();
  ended = false;
}

async function syncAudio() {
  if (!view) return;
  if (!opts.sound) {
    if (aSrc) {
      stopAudio();
      aSrc = null;
      aUrl = null;
    }
    return;
  }
  const a = aInfo();
  if (!a) {
    if (aSrc) {
      stopAudio();
      aSrc = null;
      aUrl = null;
      aLoading = false;
      report('none');
    }
    lastMediaN = view.media?.n ?? null;
    return;
  }
  if (a.src !== aSrc) {
    stopAudio();
    aSrc = a.src;
    aUrl = null;
    aLoading = true;
    report('loading');
    const u = await opts.resolve(a.src);
    if (aSrc !== a.src) return;
    aLoading = false;
    if (!u) {
      report('missing');
      lastMediaN = view.media?.n ?? null;
      return;
    }
    aUrl = u;
    aEl = /^https?:/i.test(u) ? extPlayer : player;
    aEl.src = u;
    try {
      aEl.currentTime = a.start;
    } catch {}
    report('ready');
  }
  if (aLoading) return; // komenda poczeka, aż plik dojdzie
  const m = view.media;
  if (!m || m.n === lastMediaN) return;
  const firstSeen = lastMediaN == null;
  lastMediaN = m.n;
  if (!aUrl) return report('missing');
  if (m.cmd === 'stop') {
    aEl.pause();
    try {
      aEl.currentTime = a.start;
    } catch {}
    ended = false;
    return report('ready');
  }
  if (m.cmd === 'pause') {
    aEl.pause();
    return report('paused');
  }
  if (m.cmd !== 'play' && m.cmd !== 'restart') return;
  // komenda sprzed chwili (plik dochodził albo gracz dołączył w trakcie): dogoń resztę
  const late = m.at ? (now() - m.at) / 1000 : 0;
  if (late > 2.5) {
    const target = a.start + late;
    if ((a.end && target >= a.end - 0.3) || (aEl.duration && target >= aEl.duration - 0.3) || (firstSeen && late > 60)) {
      ended = true;
      return report('ended');
    }
    try {
      aEl.currentTime = target;
    } catch {}
  } else if (m.cmd === 'restart' || ended || aEl.currentTime < a.start || (a.end && aEl.currentTime >= a.end - 0.05)) {
    try {
      aEl.currentTime = a.start;
    } catch {}
  }
  ended = false;
  if (aEl === player && !analyser) analyser = sound.connectMedia(player);
  try {
    await aEl.play();
    report('playing');
  } catch (e) {
    report(sound.unlocked() ? 'error' : 'locked');
  }
}

for (const el of [player, extPlayer]) {
  el.addEventListener('ended', () => {
    if (el !== aEl || !aSrc) return;
    ended = true;
    report('ended');
  });
  el.addEventListener('error', () => el === aEl && aSrc && aUrl && report('error'));
  el.addEventListener('loadedmetadata', () => el === aEl && aSrc && report(el.paused ? 'ready' : 'playing'));
}

const fmt = (t) => {
  t = Math.max(0, Math.floor(t || 0));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
const STAT_TXT = { loading: 'pobieranie pliku…', ready: 'czeka na prowadzącego', playing: 'odtwarzanie', paused: 'pauza', ended: 'koniec fragmentu', missing: 'brak pliku audio', error: 'błąd odtwarzania', locked: 'dotknij ekranu, żeby włączyć dźwięk', none: '' };
let vizBins = null;
let lastReport = 0;

function audioTick() {
  const a = aInfo();
  if (opts.sound && a && aUrl && !aEl.paused) {
    if (a.end && aEl.currentTime >= a.end) {
      aEl.pause();
      ended = true;
      report('ended');
    } else if (Date.now() - lastReport > 250) {
      lastReport = Date.now();
      report('playing');
    }
  }
  const deck = document.getElementById('deck');
  if (!deck) return;
  const st = audioStat?.src === a?.src ? audioStat : null;
  const state = st?.st || 'ready';
  deck.dataset.st = state;
  const dst = document.getElementById('dst');
  if (dst && dst.textContent !== STAT_TXT[state]) dst.textContent = STAT_TXT[state] ?? state;
  const dt = document.getElementById('dtime');
  if (dt) {
    const txt = st?.dur ? `${fmt(st.pos)} / ${fmt(st.dur)}` : fmt(st?.pos || 0);
    if (dt.textContent !== txt) dt.textContent = txt;
  }
  drawViz(state === 'playing');
}

function drawViz(playing) {
  const cv = document.getElementById('viz');
  if (!cv) return;
  const g = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  const N = 32;
  if (!vizBins) vizBins = new Float32Array(N);
  let data = null;
  if (playing && opts.sound && analyser && aEl === player) {
    data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
  }
  const t = Date.now() / 1000;
  for (let i = 0; i < N; i++) {
    let target;
    if (data) target = data[Math.floor((i / N) ** 1.4 * data.length * 0.8)] / 255;
    else if (playing) target = 0.25 + 0.55 * Math.abs(Math.sin(t * (2.1 + i * 0.37) + i)) * (1 - i / (N * 1.3));
    else target = 0.04;
    vizBins[i] += (target - vizBins[i]) * 0.35;
  }
  g.clearRect(0, 0, W, H);
  const bw = W / N;
  const seg = 10;
  for (let i = 0; i < N; i++) {
    const h = Math.max(1, Math.round(vizBins[i] * (H / seg))) * seg;
    for (let y = 0; y < h; y += seg) {
      const top = y > H * 0.72;
      g.fillStyle = top ? '#ff4130' : '#ffb22e';
      g.globalAlpha = playing ? 1 : 0.35;
      g.fillRect(i * bw + 2, H - y - seg + 2, bw - 4, seg - 3);
    }
  }
  g.globalAlpha = 1;
}

let looping = false;
function loop() {
  if (looping) return;
  looping = true;
  const frame = () => {
    tick();
    audioTick();
    requestAnimationFrame(frame);
  };
  frame();
  // requestAnimationFrame stoi, gdy karta jest ukryta: wtedy liczymy dalej na zegarze,
  // żeby po powrocie (albo w nagrywanej karcie) stan był od razu aktualny
  setInterval(() => {
    if (document.hidden) {
      tick();
      audioTick();
    }
  }, 250);
}
