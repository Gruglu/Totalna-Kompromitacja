// Ekran streamu: odbiera widok od panelu prowadzącego (BroadcastChannel) i go rysuje.
import { ANSWER_SECONDS, FINAL_SECONDS } from './engine.js';
import * as sound from './sound.js';

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
    if (!PREVIEW && !first && view.fx && lastFx && view.fx.n > lastFx.n) sound.play(view.fx.type);
    lastFx = view.fx;
    render();
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
  if (ph === 'lobby') round = 'Zaraz zaczynamy <span>dołącz z telefonu</span>';
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

function main() {
  const v = view;
  const ph = v.phase;
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
    const img = c.image ? `<div class="img"><img src="${esc(c.image)}" alt=""></div>` : '';
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
      <div class="body"><div class="text${ph === 'reveal' ? ' dim' : ''}" id="qtext" style="--qsize:${qsize(c.text)}"></div>${img}</div>
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
    const img = f.image ? `<div class="img"><img src="${esc(f.image)}" alt=""></div>` : '';
    return `<div class="q">
      <div class="meta"><b class="red">Finał</b>${esc(f.category)} · odpowiedzi na telefonach</div>
      <div class="body"><div class="text" id="qtext" style="--qsize:${qsize(f.text)}"></div>${img}</div>
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
      </div>
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
  $bar.innerHTML = bar();
  $lower.innerHTML = lower();
  const html = main();
  const phaseKey = view.phase + ':' + (view.cur ? `${view.cur.c}:${view.cur.q}` : '') + ':' + view.round;
  if (html !== lastMainKey) {
    $main.innerHTML = html;
    lastMainKey = html;
    if (phaseKey !== lastPhaseKey && view.phase === 'board') $main.querySelector('.board')?.classList.add('enter');
    if (view.phase === 'lobby') drawQR();
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

(function loop() {
  tick();
  requestAnimationFrame(loop);
})();

window.addEventListener('beforeunload', () => chan.close());
