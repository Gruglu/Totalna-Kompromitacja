// Ekran streamu: odbiera widok od panelu prowadzącego (BroadcastChannel) i go rysuje.
import { ANSWER_SECONDS, FINAL_SECONDS } from './engine.js';
import * as sound from './sound.js';
import * as media from './media.js';

const params = new URLSearchParams(location.search);
const PREVIEW = params.has('preview');
const TYPE_CPS = 38; // znaki na sekundę przy wpisywaniu pytania

const $stage = document.getElementById('stage');
const chan = new BroadcastChannel('totalna-kompromitacja');
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

chan.onmessage = (e) => {
  const m = e.data;
  if (m?.t === 'state') {
    const first = !view;
    view = m.view;
    joinUrl = m.joinUrl || joinUrl;
    code = m.code || code;
    if (m.mediaVer !== mediaVer) {
      if (mediaVer != null) {
        media.resetCache();
        urls.clear();
      }
      mediaVer = m.mediaVer;
    }
    if (!PREVIEW && !first && view.fx && lastFx && view.fx.n > lastFx.n) sound.play(view.fx.type);
    lastFx = view.fx;
    render();
    syncAudio();
  } else if (m?.t === 'audio' && PREVIEW) {
    audioStat = m;
  }
};
chan.postMessage({ t: 'hello' });
setInterval(() => !view && chan.postMessage({ t: 'hello' }), 1000);

// dźwięk wymaga jednego kliknięcia w oknie streamu
if (!PREVIEW) {
  const ov = document.createElement('div');
  ov.className = 'unlock';
  ov.innerHTML = '<div>Kliknij, żeby włączyć dźwięk<small>raz, przed startem streamu</small></div>';
  ov.onclick = () => {
    sound.unlock();
    sound.play('bonus');
    ov.remove();
  };
  document.body.appendChild(ov);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') {
      document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    }
  });
}

// ---------- rysowanie ----------

function bar() {
  const v = view;
  let round = '';
  const ph = v.phase;
  if (ph === 'opener') return '';
  if (ph === 'lobby') round = 'Zaraz zaczynamy <span>dołącz z telefonu</span>';
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
  return `<div class="${cls}">${delta}<div class="n">${esc(p.name)}</div><div class="s${p.score < 0 ? ' neg' : ''}">${p.score}</div><div class="t">${esc(tag)}</div></div>`;
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
  media.resolve(src).then((u) => {
    urls.set(src, u || null);
    lastMainKey = '';
    render();
    syncAudio();
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
        `<div class="who" style="--d:${OPENER.cast + 0.5 + i * OPENER.castStep}s"><span class="no">${String(i + 1).padStart(2, '0')}</span><span class="nm">${esc(p.name)}</span><span class="sn">${esc(pool[i % pool.length])}</span></div>`
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

function main() {
  const v = view;
  const ph = v.phase;
  if (ph === 'opener') return openerHTML();
  if (ph === 'rules') return rulesHTML();
  if (ph === 'lobby') {
    return `<div class="lobby"><div style="display:grid;gap:1.6cqw">
      <div class="sub">Kod pokoju</div>
      <div class="code">${esc(code || '····')}</div>
      <div class="sub">Wejdź z telefonu albo drugiej karty</div>
      <div class="url">${esc(joinUrl.replace(/^https?:\/\//, ''))}</div>
    </div><div><div class="qr" id="qr"></div><div class="qrcap">zeskanuj ze streamu</div></div></div>`;
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
            `<div class="row${i === 0 ? ' first' : ''}${i === sorted.length - 1 && sorted.length > 1 ? ' last' : ''}" style="--i:${sorted.length - 1 - i}"><span class="pos">${i + 1}.</span><span class="nm">${esc(p.name)}</span><span class="sc${p.score < 0 ? ' neg' : ''}">${p.score}</span></div>`
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
  if (!view) return;
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
      if (el) el.style.setProperty('--t0', `${-Math.max(0, (Date.now() - view.opener.at) / 1000)}s`);
    }
  }
  lastPhaseKey = phaseKey;
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
  const t = Date.now();
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
        if (!PREVIEW && s !== lastSecond && low && s > 0) sound.play('tick');
        if (!PREVIEW && s === 0 && lastSecond > 0) sound.play('timeout');
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
// Gra tylko prawdziwe okno streamu. Podgląd w panelu dostaje stan od niego przez kanał.

const player = new Audio();
player.preload = 'auto';
const extPlayer = new Audio(); // zewnętrzne adresy bez CORS nie mogą iść przez Web Audio
extPlayer.preload = 'auto';
let aSrc = null; // ścieżka z pytania
let aEl = player;
let aUrl = null;
let lastMediaN = null;
let analyser = null;
let audioStat = null; // w podglądzie: stan z okna streamu
let ended = false;

function aInfo() {
  return view?.audio || null;
}

function report(st) {
  if (PREVIEW) return;
  const a = aInfo();
  const pos = a ? Math.max(0, aEl.currentTime - a.start) : 0;
  const total = a ? (a.end || aEl.duration || 0) - a.start : 0;
  audioStat = { t: 'audio', st, pos, dur: Number.isFinite(total) ? total : 0, src: aSrc };
  chan.postMessage(audioStat);
}

function stopAudio() {
  for (const el of [player, extPlayer]) {
    el.pause();
  }
  ended = false;
}

async function syncAudio() {
  if (PREVIEW || !view) return;
  const a = aInfo();
  if (!a) {
    if (aSrc) {
      stopAudio();
      aSrc = null;
      aUrl = null;
      report('none');
    }
    lastMediaN = view.media?.n ?? null;
    return;
  }
  if (a.src !== aSrc) {
    stopAudio();
    aSrc = a.src;
    aUrl = null;
    const u = await media.resolve(a.src);
    if (aSrc !== a.src) return;
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
  const m = view.media;
  if (!m || m.n === lastMediaN) return;
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
  if (m.cmd === 'restart' || ended || aEl.currentTime < a.start || (a.end && aEl.currentTime >= a.end - 0.05)) {
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
    if (el !== aEl) return;
    ended = true;
    report('ended');
  });
  el.addEventListener('error', () => el === aEl && aSrc && report('error'));
  el.addEventListener('loadedmetadata', () => el === aEl && report(el.paused ? 'ready' : 'playing'));
}

const fmt = (t) => {
  t = Math.max(0, Math.floor(t || 0));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
const STAT_TXT = { ready: 'czeka na prowadzącego', playing: 'odtwarzanie', paused: 'pauza', ended: 'koniec fragmentu', missing: 'brak pliku audio', error: 'błąd odtwarzania', locked: 'kliknij w okno streamu', none: '' };
let vizBins = null;
let lastReport = 0;

function audioTick() {
  const a = aInfo();
  if (!PREVIEW && a && aUrl && !aEl.paused) {
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
  if (playing && analyser && aEl === player && !PREVIEW) {
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

(function loop() {
  tick();
  audioTick();
  requestAnimationFrame(loop);
})();

window.addEventListener('beforeunload', () => chan.close());
