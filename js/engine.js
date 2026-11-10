// Silnik gry: czyste funkcje na stanie. Prowadzący (host.html) trzyma stan,
// plansza u graczy i ich buzzery dostają tylko widoki bez odpowiedzi.

export const ANSWER_SECONDS = 5;
export const FINAL_SECONDS = 30;
export const DD_MIN = 5;
export const DD_PER_ROUND = [1, 2];
// koło fortuny: pytania od graczy (każdy wysyła swoje), ukryte pola na planszy jak „wszystko albo nic”
export const WHEEL_PER_PLAYER = 2;
export const SPIN_MS = 6500; // kręcenie kołem
export const DRAW_MS = 3200; // losowanie osoby, gdy ktoś trafi na własne pytanie
export const WHEEL_CAT = 'Koło fortuny';
// kategoria w ciemno: ukryte pole, pytanie z kategorii, której nie ma na planszy, za podwójną stawkę
export const BLIND_CAT = 'Kategoria w ciemno';
export const BLIND_MULT = 2;
// kadr z gry: kolejne zbliżenia obrazka ("zoom" w pytaniu), za późniejsze mniej punktów
export const ZOOM_POINTS = [1, 2 / 3, 1 / 3];

import { rulesFor } from './rules.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const now = () => Date.now();

export function newGame(set, players = [], pool = null) {
  return {
    v: 1,
    title: set.title || 'Totalna Kompromitacja',
    set,
    phase: 'lobby',
    round: 0,
    players: players.map((p) => ({ ...p, score: 0 })),
    picker: null,
    used: {},
    dd: {},
    cur: null,
    final: null,
    fx: { n: 0, type: null },
    media: { n: 0, cmd: null },
    screen: null, // ekran dodatkowy w poczekalni i po odcinku: 'season' | 'shame' | 'punish'
    shame: [], // Hall of Shame: najgłupsze odpowiedzi odcinka
    punish: { winner: null, loser: null, nick: '' },
    wheel: { pool: pool ? pool.map((x) => ({ ...x, used: false })) : poolFromSet(set), cells: {} },
    blind: { cells: {}, used: [] },
  };
}

// ---------- kategoria w ciemno ----------

// pula pytań w ciemno z pliku: "blind": [{ category, q, a, ... }]
export const blindPool = (set) => (Array.isArray(set?.blind) ? set.blind : []);
const blindValid = (x) => !!(x && x.q && x.a && x.category);
function blindLeft(s) {
  const used = new Set(s.blind?.used || []);
  return blindPool(s.set).map((x, i) => i).filter((i) => blindValid(blindPool(s.set)[i]) && !used.has(i));
}

// ile pól w ciemno w rundzie: "blindFields" z rundy, a domyślnie 1, gdy w pliku jest pula
function placeBlind(s, r) {
  const round = s.set.rounds[r];
  const pool = blindPool(s.set).filter(blindValid).length;
  const want = round.blindFields != null && round.blindFields !== '' ? Math.max(0, Math.round(Number(round.blindFields)) || 0) : pool ? 1 : 0;
  const cells = [];
  round.categories.forEach((cat, c) =>
    cat.questions.forEach((_, q) => {
      const k = key(r, c, q);
      // pole w ciemno zabiera pytanie z planszy: nie marnujemy na to kadrów ze zbliżeniami
      if (!s.dd[k] && !s.wheel?.cells?.[k] && !zoomOf(round.categories[c].questions[q])) cells.push(k);
    })
  );
  for (let n = 0; n < want && cells.length; n++) s.blind.cells[cells.splice(Math.floor(Math.random() * cells.length), 1)[0]] = true;
}

// ---------- kadr z gry: zbliżenia ----------

export const zoomOf = (q) => (Array.isArray(q?.zoom) && q.zoom.length ? q.zoom : null);
function zoomPoints(s) {
  const p = roundOf(s)?.zoomPoints;
  return Array.isArray(p) && p.length ? p.map(Number) : ZOOM_POINTS;
}
// stawka pytania teraz: przy zbliżeniach maleje z każdym etapem (zaokrąglona do 50)
export function curValue(s) {
  const c = s.cur;
  if (!c) return 0;
  if (c.dd) return c.wager;
  const z = c.stage != null ? zoomOf(curQuestion(s)) : null;
  if (!z) return c.value;
  const pts = zoomPoints(s);
  const f = pts[Math.min(c.stage, pts.length - 1)] ?? 1;
  return Math.max(50, Math.round((c.value * f) / 50) * 50);
}
function startZoom(s) {
  if (zoomOf(curQuestion(s))) s.cur.stage = 0;
}

// ---------- koło fortuny ----------

const WHEEL_FIELDS = ['q', 'a', 'note', 'image', 'answerImage', 'audio', 'audioStart', 'audioEnd'];
const wid = () => 'w' + Math.random().toString(36).slice(2, 9);
const norm = (t) => String(t ?? '').trim().toLowerCase();

function wheelItem(src, from) {
  const it = { id: src.id || wid(), author: String(src.author ?? '').trim().slice(0, 24), authorId: src.authorId ?? null, from, used: false };
  for (const f of WHEEL_FIELDS) if (src[f] != null && src[f] !== '') it[f] = typeof src[f] === 'string' ? src[f].trim().slice(0, f === 'q' ? 400 : 300) : src[f];
  const alt = Array.isArray(src.alt) ? src.alt : typeof src.alt === 'string' ? src.alt.split(/[;\n]/) : [];
  const clean = alt.map((x) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 8);
  if (clean.length) it.alt = clean;
  return it;
}

// pytania na koło zapisane w pliku zestawu ("wheel": [{ author, q, a, ... }])
export function poolFromSet(set) {
  return (Array.isArray(set?.wheel) ? set.wheel : []).filter((x) => x && x.q && x.a).map((x, i) => wheelItem({ ...x, id: 'f' + i }, 'file'));
}

// nowy zestaw w poczekalni: pytania z pliku podmienione, pytania od graczy i prowadzącego zostają
export function withSet(s, set) {
  const pool = (s.wheel?.pool || []).filter((x) => x.from !== 'file');
  return { ...s, set, title: set.title || s.title, wheel: { pool: [...poolFromSet(set), ...pool], cells: {} } };
}

export const wheelPool = (s) => s.wheel?.pool || [];
export const wheelLeft = (s) => wheelPool(s).filter((x) => !x.used);
export function authorName(s, it) {
  const p = it?.authorId ? player(s, it.authorId) : s.players.find((x) => it?.author && norm(x.name) === norm(it.author));
  return p ? p.name : it?.author || '?';
}
// zasady z uwzględnieniem pytań na koło, które są w stanie gry, a nie w pliku
export const rulesOf = (s) => rulesFor(s.set, wheelPool(s).length);
export function isAuthor(s, it, id) {
  if (!it || !id) return false;
  if (it.authorId) return it.authorId === id;
  return !!it.author && norm(it.author) === norm(nameOf(s, id));
}
export function wheelMine(s, id) {
  return wheelPool(s).filter((x) => isAuthor(s, x, id));
}

// ile pól z kołem w każdej rundzie: "wheelFields" z rundy albo pula rozłożona równo (więcej w późniejszych)
export function wheelPlan(set, poolSize) {
  const rounds = set?.rounds || [];
  const fixed = rounds.map((r) => (Number.isFinite(Number(r.wheelFields)) && r.wheelFields !== null && r.wheelFields !== '' ? Math.max(0, Math.round(Number(r.wheelFields))) : null));
  const auto = fixed.map((f, i) => (f == null ? i : -1)).filter((i) => i >= 0);
  let rest = Math.max(0, poolSize - fixed.reduce((n, f) => n + (f || 0), 0));
  const out = fixed.map((f) => f || 0);
  if (auto.length) {
    const each = Math.floor(rest / auto.length);
    let extra = rest - each * auto.length;
    for (let j = auto.length - 1; j >= 0; j--) {
      out[auto[j]] = each + (extra > 0 ? 1 : 0);
      if (extra > 0) extra--;
    }
  }
  return out;
}

function placeWheel(s, r, count) {
  const round = s.set.rounds[r];
  const cells = [];
  round.categories.forEach((cat, c) =>
    cat.questions.forEach((_, q) => {
      if ((q > 0 || round.values.length === 1) && !s.dd[key(r, c, q)]) cells.push([c, q]);
    })
  );
  // najwyżej co trzecie pole, żeby plansza została planszą
  const total = round.categories.reduce((n, cat) => n + cat.questions.length, 0);
  count = Math.min(count, cells.length, Math.max(1, Math.floor(total / 3)));
  const perCat = new Map();
  let placed = 0;
  while (placed < count && cells.length) {
    const i = Math.floor(Math.random() * cells.length);
    const [c, q] = cells.splice(i, 1)[0];
    const n = perCat.get(c) || 0;
    // rozrzuć po kategoriach: do kategorii z polem wraca dopiero, gdy wszystkie mają już tyle samo
    const min = Math.min(...round.categories.map((_, cc) => perCat.get(cc) || 0));
    if (n > min && cells.some(([cc]) => (perCat.get(cc) || 0) === min)) continue;
    perCat.set(c, n + 1);
    s.wheel.cells[key(r, c, q)] = true;
    placed++;
  }
}

// kolejność na kole: pytania tego samego autora nie stoją obok siebie
function wheelOrder(s) {
  const groups = new Map();
  for (const x of [...wheelLeft(s)].sort(() => Math.random() - 0.5)) {
    const k = norm(authorName(s, x));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  const out = [];
  let last = null;
  while (out.length < wheelLeft(s).length) {
    const opts = [...groups.entries()].filter(([, g]) => g.length).sort((a, b) => b[1].length - a[1].length);
    const pick = opts.find(([k]) => k !== last) || opts[0];
    out.push(pick[1].shift());
    last = pick[0];
  }
  return out;
}

function enterWheel(s, c, q, value) {
  const segs = wheelOrder(s).map((x) => ({ id: x.id }));
  s.cur = {
    c,
    q,
    value,
    dd: false,
    wager: null,
    buzzOpen: false,
    openedAt: null,
    buzzed: null,
    buzzedAt: null,
    tried: [],
    wrong: [],
    result: null,
    shownAt: null,
    wheel: { segs, pick: null, idx: null, spinAt: null, seed: 0, own: false, target: null, passed: null, drawAt: null, cands: [] },
  };
  s.phase = 'wheel';
  fx(s, 'wheel');
}

// pytanie i kategoria aktualnego pola (zwykłe albo z koła)
export function curQuestion(s) {
  const c = s.cur;
  if (!c) return null;
  if (c.wheel) return c.wheel.pick ? wheelPool(s).find((x) => x.id === c.wheel.pick) || null : null;
  if (c.blind != null) return blindPool(s.set)[c.blind] || null;
  return roundOf(s).categories[c.c].questions[c.q];
}
export function curCategory(s) {
  const c = s.cur;
  if (!c) return '';
  if (c.wheel) return WHEEL_CAT;
  if (c.blind != null) return s.phase === 'blind' ? BLIND_CAT : blindPool(s.set)[c.blind]?.category || BLIND_CAT;
  return roundOf(s).categories[c.c].name;
}
export const half = (v) => Math.round(v / 2 / 50) * 50 || Math.round(v / 2);
// autor wylosowanego pytania jako gracz (premia), null gdy autora nie ma w grze
export function authorPlayer(s) {
  const it = s.cur?.wheel ? curQuestion(s) : null;
  if (!it) return null;
  return s.players.find((p) => isAuthor(s, it, p.id))?.id ?? null;
}
export const solo = (cur) => !!(cur && (cur.dd || cur.wheel));

// ---------- pomocnicze ----------

export const key = (r, c, q) => `${r}:${c}:${q}`;
export const roundOf = (s) => s.set.rounds[s.round];
export const player = (s, id) => s.players.find((p) => p.id === id);
export const nameOf = (s, id) => player(s, id)?.name ?? '?';

export function roundDone(s) {
  const r = roundOf(s);
  return r.categories.every((cat, c) => cat.questions.every((_, q) => s.used[key(s.round, c, q)]));
}

export function ddMax(s) {
  const p = player(s, s.picker);
  const top = Math.max(...roundOf(s).values);
  return Math.max(p ? p.score : 0, top);
}

export function finalists(s) {
  return s.players.filter((p) => p.score > 0).map((p) => p.id);
}

function fx(s, type) {
  s.fx = { n: s.fx.n + 1, type };
}

// polecenie dla odtwarzacza audio u graczy (graj / pauza / od nowa / stop)
function mediaCmd(s, cmd) {
  const m = s.media || { n: 0 };
  s.media = { n: m.n + 1, cmd, at: now() };
}

// pytanie, które jest teraz na ekranie (zwykłe albo finałowe)
export function currentQuestion(s) {
  if (s.cur && ['dd', 'question', 'reveal'].includes(s.phase)) return curQuestion(s);
  if (s.final && ['final-question', 'final-reveal'].includes(s.phase)) return s.set.final;
  return null;
}

// wszystkie ścieżki mediów użyte w zestawie (do sprawdzenia, czy pliki są wczytane)
export function mediaRefs(set) {
  const out = [];
  const add = (q, where) => {
    for (const f of ['image', 'answerImage', 'audio']) if (q?.[f]) out.push({ src: q[f], field: f, where });
    (zoomOf(q) || []).forEach((src, i) => src && out.push({ src, field: 'zoom', where: `${where} · zbliżenie ${i + 1}` }));
  };
  (set?.rounds || []).forEach((r, ri) =>
    (r.categories || []).forEach((c, ci) => (c.questions || []).forEach((q, qi) => add(q, `R${ri + 1} · ${c.name} · ${r.values?.[qi] ?? qi + 1}`)))
  );
  if (set?.final) add(set.final, 'Finał');
  (Array.isArray(set?.wheel) ? set.wheel : []).forEach((q, i) => add(q, `Koło · ${q?.author || 'pytanie ' + (i + 1)}`));
  blindPool(set).forEach((q, i) => add(q, `W ciemno · ${q?.category || 'pytanie ' + (i + 1)}`));
  return out;
}

function lowestScorer(s) {
  if (!s.players.length) return null;
  const min = Math.min(...s.players.map((p) => p.score));
  const pool = s.players.filter((p) => p.score === min);
  return pool[Math.floor(Math.random() * pool.length)].id;
}

function placeDailyDoubles(s, r) {
  const round = s.set.rounds[r];
  const count = round.dailyDoubles ?? DD_PER_ROUND[r] ?? 1;
  const cells = [];
  round.categories.forEach((cat, c) =>
    cat.questions.forEach((_, q) => {
      if (q > 0) cells.push([c, q]); // nigdy w najtańszym rzędzie
    })
  );
  const usedCats = new Set();
  let placed = 0;
  while (placed < count && cells.length) {
    const i = Math.floor(Math.random() * cells.length);
    const [c, q] = cells.splice(i, 1)[0];
    if (usedCats.has(c) && cells.some(([cc]) => !usedCats.has(cc))) continue;
    usedCats.add(c);
    s.dd[key(r, c, q)] = true;
    placed++;
  }
}

function rebuzzPossible(s) {
  const active = s.players.filter((p) => !s.cur.tried.includes(p.id));
  return active.length > 0;
}

// ---------- akcje ----------

export function reduce(state, a) {
  const s = clone(state);
  const cur = s.cur;
  switch (a.type) {
    case 'addPlayer': {
      if (s.players.some((p) => p.id === a.id)) {
        const p = player(s, a.id);
        p.name = a.name || p.name;
        p.connected = a.connected ?? p.connected;
      } else {
        s.players.push({ id: a.id, name: a.name, score: 0, connected: !!a.connected, manual: !!a.manual });
      }
      return s;
    }
    case 'removePlayer':
      s.players = s.players.filter((p) => p.id !== a.id);
      if (s.picker === a.id) s.picker = s.players[0]?.id ?? null;
      return s;
    case 'renamePlayer': {
      const p = player(s, a.id);
      if (p) p.name = a.name;
      return s;
    }
    case 'movePlayer': {
      const i = s.players.findIndex((p) => p.id === a.id);
      const j = i + a.dir;
      if (i < 0 || j < 0 || j >= s.players.length) return state;
      [s.players[i], s.players[j]] = [s.players[j], s.players[i]];
      return s;
    }
    case 'setConnected': {
      const p = player(s, a.id);
      if (p) p.connected = a.connected;
      return s;
    }
    case 'adjust': {
      const p = player(s, a.id);
      if (p) p.score += a.delta;
      fx(s, a.delta >= 0 ? 'bonus' : 'penalty');
      return s;
    }
    case 'setScore': {
      const p = player(s, a.id);
      if (p) p.score = a.score;
      return s;
    }
    case 'setPicker':
      s.picker = a.id;
      return s;

    case 'opener':
      if (!['lobby', 'opener', 'rules'].includes(s.phase)) return state;
      s.phase = 'opener';
      s.screen = null;
      s.openerAt = now();
      fx(s, 'opener');
      return s;
    case 'rules': {
      if (!['lobby', 'opener', 'rules'].includes(s.phase)) return state;
      s.phase = 'rules';
      s.screen = null;
      s.rule = Math.max(0, Math.min(a.idx ?? 0, rulesOf(s).length - 1));
      s.ruleAt = now();
      fx(s, 'rule');
      return s;
    }
    case 'ruleStep': {
      if (s.phase !== 'rules') return state;
      const n = rulesOf(s).length;
      const i = s.rule + a.dir;
      if (i < 0 || i >= n) return state;
      s.rule = i;
      s.ruleAt = now();
      fx(s, 'rule');
      return s;
    }
    case 'lobby':
      if (!['opener', 'rules'].includes(s.phase)) return state;
      s.phase = 'lobby';
      return s;

    case 'start':
      if (!s.players.length || !['lobby', 'opener', 'rules'].includes(s.phase)) return state;
      s.round = 0;
      s.screen = null;
      s.used = {};
      s.dd = {};
      s.set.rounds.forEach((_, r) => placeDailyDoubles(s, r));
      s.wheel = { pool: wheelPool(s).map((x) => ({ ...x, used: false })), cells: {} };
      wheelPlan(s.set, wheelLeft(s).length).forEach((n, r) => n && placeWheel(s, r, n));
      s.blind = { cells: {}, used: [] };
      s.set.rounds.forEach((_, r) => placeBlind(s, r));
      s.picker = s.players[Math.floor(Math.random() * s.players.length)].id;
      s.phase = 'round-intro';
      s.introAt = now();
      fx(s, 'intro');
      return s;

    case 'media':
      if (!currentQuestion(s)?.audio) return state;
      mediaCmd(s, a.cmd);
      return s;

    case 'showBoard':
      s.phase = 'board';
      s.cur = null;
      return s;

    case 'pick': {
      const k = key(s.round, a.c, a.q);
      if (s.phase !== 'board' || s.used[k]) return state;
      const isDD = !!s.dd[k];
      s.used[k] = true;
      if (s.wheel?.cells?.[k] && !isDD && wheelLeft(s).length) {
        mediaCmd(s, 'stop');
        enterWheel(s, a.c, a.q, roundOf(s).values[a.q]);
        return s;
      }
      const blindLeftNow = s.blind?.cells?.[k] && !isDD ? blindLeft(s) : [];
      s.cur = {
        c: a.c,
        q: a.q,
        value: roundOf(s).values[a.q],
        dd: isDD,
        wager: null,
        buzzOpen: false,
        openedAt: null,
        buzzed: null,
        buzzedAt: null,
        tried: [],
        wrong: [],
        result: null,
        shownAt: null,
      };
      mediaCmd(s, 'stop');
      if (blindLeftNow.length) {
        const idx = blindLeftNow[Math.floor(Math.random() * blindLeftNow.length)];
        s.blind.used.push(idx);
        s.cur.blind = idx;
        s.cur.base = s.cur.value;
        s.cur.value = s.cur.value * BLIND_MULT;
        s.phase = 'blind';
        fx(s, 'dd');
        return s;
      }
      startZoom(s);
      if (isDD) {
        s.phase = 'dd';
        fx(s, 'dd');
      } else {
        s.phase = 'question';
        s.cur.shownAt = now();
        fx(s, 'reveal');
      }
      return s;
    }
    case 'blindGo':
      if (s.phase !== 'blind') return state;
      s.phase = 'question';
      cur.shownAt = now();
      startZoom(s);
      fx(s, 'reveal');
      return s;
    case 'zoomNext': {
      if (s.phase !== 'question' || cur.stage == null || cur.buzzed) return state;
      const z = zoomOf(curQuestion(s));
      if (!z || cur.stage >= z.length - 1) return state;
      cur.stage++;
      fx(s, 'rule');
      return s;
    }
    case 'ddWager': {
      if (s.phase !== 'dd') return state;
      const w = Math.round(Number(a.amount));
      if (!Number.isFinite(w) || w < DD_MIN || w > ddMax(s)) return state;
      cur.wager = w;
      s.phase = 'question';
      cur.shownAt = now();
      cur.buzzed = s.picker;
      cur.buzzedAt = null; // zegar rusza po przeczytaniu
      fx(s, 'reveal');
      return s;
    }
    case 'openBuzz':
      if (s.phase !== 'question' || solo(cur) || cur.buzzed) return state;
      cur.buzzOpen = true;
      cur.openedAt = now();
      fx(s, 'open');
      return s;
    case 'startClock':
      if (s.phase !== 'question' || !solo(cur)) return state;
      cur.buzzedAt = now();
      return s;
    case 'buzz': {
      if (s.phase !== 'question' || !cur.buzzOpen || cur.buzzed || solo(cur)) return state;
      if (cur.tried.includes(a.id) || !player(s, a.id)) return state;
      cur.buzzOpen = false;
      cur.buzzed = a.id;
      cur.buzzedAt = now();
      fx(s, 'buzz');
      return s;
    }
    case 'judge': {
      if (s.phase !== 'question' || !cur.buzzed) return state;
      const id = cur.buzzed;
      const p = player(s, id);
      const value = curValue(s);
      if (a.verdict === 'right' || a.verdict === 'half') {
        const gain = a.verdict === 'half' ? Math.round(value / 2 / 50) * 50 || Math.round(value / 2) : value;
        p.score += gain;
        s.picker = id;
        cur.result = { id, verdict: a.verdict, delta: gain };
        s.phase = 'reveal';
        fx(s, 'right');
        return s;
      }
      // pudło
      p.score -= value;
      cur.tried.push(id);
      cur.wrong.push(id);
      cur.buzzed = null;
      cur.buzzedAt = null;
      if (solo(cur) || !rebuzzPossible(s)) {
        cur.result = { id, verdict: 'wrong', delta: -value };
        s.phase = 'reveal';
      } else {
        cur.buzzOpen = true;
        cur.openedAt = now();
      }
      fx(s, 'wrong');
      return s;
    }
    case 'manualBuzz': {
      if (s.phase !== 'question' || solo(cur) || cur.buzzed) return state;
      if (cur.tried.includes(a.id)) return state;
      cur.buzzOpen = false;
      cur.buzzed = a.id;
      cur.buzzedAt = now();
      fx(s, 'buzz');
      return s;
    }
    // ---------- koło fortuny ----------
    case 'wheelExtra': {
      // dodatkowy obrót spoza planszy, np. gdy zostały pytania graczy
      if (s.phase !== 'board' || !wheelLeft(s).length) return state;
      const v = Math.round(Number(a.value));
      if (!Number.isFinite(v) || v <= 0) return state;
      mediaCmd(s, 'stop');
      enterWheel(s, null, null, v);
      return s;
    }
    case 'wheelSpin': {
      const w = cur?.wheel;
      if (s.phase !== 'wheel' || !w || w.pick) return state;
      const left = new Set(wheelLeft(s).map((x) => x.id));
      w.segs = w.segs.filter((x) => left.has(x.id));
      if (!w.segs.length) return state;
      w.idx = Math.floor(Math.random() * w.segs.length);
      w.pick = w.segs[w.idx].id;
      w.seed = Math.floor(Math.random() * 1e6);
      w.spinAt = now();
      const it = wheelPool(s).find((x) => x.id === w.pick);
      it.used = true;
      w.own = isAuthor(s, it, s.picker);
      w.target = w.own ? null : s.picker;
      // nikt inny nie gra: własne pytanie i tak trzeba wziąć
      if (w.own && !s.players.some((p) => p.id !== s.picker)) w.target = s.picker;
      fx(s, 'spin');
      return s;
    }
    case 'wheelPass': {
      const w = cur?.wheel;
      if (s.phase !== 'wheel' || !w?.pick || !w.own || w.drawAt) return state;
      if (!player(s, a.id) || a.id === s.picker) return state;
      w.target = a.id;
      w.passed = 'chosen';
      fx(s, 'pass');
      return s;
    }
    case 'wheelDraw': {
      const w = cur?.wheel;
      if (s.phase !== 'wheel' || !w?.pick || !w.own || w.drawAt) return state;
      const cands = s.players.filter((p) => p.id !== s.picker).map((p) => p.id);
      if (!cands.length) return state;
      w.cands = cands;
      w.target = cands[Math.floor(Math.random() * cands.length)];
      w.passed = 'draw';
      w.drawAt = now();
      fx(s, 'draw');
      return s;
    }
    case 'wheelGo': {
      const w = cur?.wheel;
      if (s.phase !== 'wheel' || !w?.pick || !w.target) return state;
      s.phase = 'question';
      cur.shownAt = now();
      cur.buzzed = w.target;
      cur.buzzedAt = null; // zegar rusza po przeczytaniu, jak przy „wszystko albo nic”
      fx(s, 'reveal');
      return s;
    }
    case 'wheelCancel': {
      // awaryjnie przed zakręceniem: pole z kołem gra jako zwykłe pytanie albo wraca na planszę
      if (s.phase !== 'wheel' || cur?.wheel?.pick) return state;
      if (cur.c == null) {
        s.cur = null;
        s.phase = 'board';
        return s;
      }
      delete cur.wheel;
      s.phase = 'question';
      cur.shownAt = now();
      fx(s, 'reveal');
      return s;
    }
    case 'wheelBonus': {
      // autor zagiął odpowiadającego: połowa stawki, jeśli prowadzący uzna pytanie za uczciwe
      const w = cur?.wheel;
      if (s.phase !== 'reveal' || !w || w.bonus) return state;
      const r = cur.result;
      if (!r || !['wrong', 'nobody'].includes(r.verdict)) return state;
      const id = authorPlayer(s);
      if (!id || id === w.target) return state;
      const gain = half(cur.value);
      player(s, id).score += gain;
      w.bonus = { id, delta: gain };
      fx(s, 'bonus');
      return s;
    }
    case 'wheelAdd': {
      const q = String(a.q ?? '').trim();
      const ans = String(a.a ?? '').trim();
      if (!q || !ans) return state;
      s.wheel = s.wheel || { pool: [], cells: {} };
      if (a.from === 'player') {
        if (!player(s, a.authorId) || wheelMine(s, a.authorId).length >= WHEEL_PER_PLAYER) return state;
      }
      const author = a.authorId ? nameOf(s, a.authorId) : String(a.author ?? '').trim();
      s.wheel.pool.push(wheelItem({ q, a: ans, alt: a.alt, note: a.note, author, authorId: a.authorId ?? null }, a.from === 'player' ? 'player' : 'host'));
      return s;
    }
    case 'wheelEdit': {
      const it = wheelPool(s).find((x) => x.id === a.id);
      if (!it) return state;
      if (a.byPlayer && (it.used || !isAuthor(s, it, a.byPlayer))) return state;
      const next = wheelItem({ ...it, ...a.fields, id: it.id, authorId: 'authorId' in a.fields ? a.fields.authorId : it.authorId }, it.from);
      if (!next.q || !next.a) return state;
      next.used = it.used;
      Object.keys(it).forEach((k) => delete it[k]);
      Object.assign(it, next);
      return s;
    }
    case 'wheelDel': {
      const it = wheelPool(s).find((x) => x.id === a.id);
      if (!it) return state;
      if (a.byPlayer && (it.used || !isAuthor(s, it, a.byPlayer))) return state;
      if (s.cur?.wheel?.pick === it.id) return state;
      s.wheel.pool = wheelPool(s).filter((x) => x.id !== a.id);
      return s;
    }
    case 'wheelClear':
      if (s.phase === 'wheel') return state;
      s.wheel = { pool: [], cells: s.wheel?.cells || {} };
      return s;

    case 'nobody':
      if (s.phase !== 'question') return state;
      cur.buzzOpen = false;
      cur.buzzed = null;
      cur.result = { id: null, verdict: 'nobody', delta: 0 };
      s.phase = 'reveal';
      fx(s, 'timeout');
      return s;
    case 'next': {
      if (s.phase === 'round-intro') {
        s.phase = 'board';
        return s;
      }
      if (s.phase !== 'reveal') return state;
      s.cur = null;
      mediaCmd(s, 'stop');
      if (!roundDone(s)) {
        s.phase = 'board';
      } else if (s.round < s.set.rounds.length - 1) {
        s.round++;
        s.picker = lowestScorer(s);
        s.phase = 'round-intro';
        s.introAt = now();
        fx(s, 'intro');
      } else {
        toFinal(s);
      }
      return s;
    }
    case 'endRound': // awaryjnie: pomiń resztę rundy
      s.cur = null;
      mediaCmd(s, 'stop');
      if (s.round < s.set.rounds.length - 1) {
        s.round++;
        s.picker = lowestScorer(s);
        s.phase = 'round-intro';
        s.introAt = now();
        fx(s, 'intro');
      } else toFinal(s);
      return s;

    // ---------- finał ----------
    case 'finalWagers':
      if (s.phase !== 'final-intro') return state;
      s.phase = 'final-wager';
      return s;
    case 'finalWager': {
      if (s.phase !== 'final-wager' || !s.final.ids.includes(a.id)) return state;
      const p = player(s, a.id);
      const w = Math.round(Number(a.amount));
      if (!Number.isFinite(w) || w < 0 || w > p.score) return state;
      s.final.wagers[a.id] = w;
      return s;
    }
    case 'finalQuestion':
      if (s.phase !== 'final-wager') return state;
      mediaCmd(s, 'stop');
      s.final.ids.forEach((id) => {
        if (s.final.wagers[id] == null) s.final.wagers[id] = 0;
      });
      s.phase = 'final-question';
      s.final.qAt = now();
      fx(s, 'reveal');
      return s;
    case 'finalAnswer':
      if (s.phase !== 'final-question' || !s.final.ids.includes(a.id)) return state;
      if (s.final.qAt && now() > s.final.qAt + (FINAL_SECONDS + 2) * 1000 && !a.force) return state;
      s.final.answers[a.id] = String(a.text ?? '').slice(0, 140);
      return s;
    case 'finalReveal': {
      if (s.phase !== 'final-question') return state;
      s.phase = 'final-reveal';
      // od najniższego wyniku
      s.final.order = [...s.final.ids].sort((x, y) => player(s, x).score - player(s, y).score);
      s.final.idx = 0;
      s.final.showAnswer = false;
      return s;
    }
    case 'finalShow':
      if (s.phase !== 'final-reveal') return state;
      s.final.shown = true;
      return s;
    case 'finalJudge': {
      if (s.phase !== 'final-reveal') return state;
      const id = s.final.order[s.final.idx];
      if (!id || s.final.judged[id]) return state;
      const w = s.final.wagers[id] || 0;
      const delta = a.verdict === 'right' ? w : -w;
      player(s, id).score += delta;
      s.final.judged[id] = { verdict: a.verdict, delta };
      fx(s, a.verdict === 'right' ? 'right' : 'wrong');
      return s;
    }
    case 'finalNext': {
      if (s.phase !== 'final-reveal') return state;
      const id = s.final.order[s.final.idx];
      if (id && !s.final.judged[id]) return state;
      if (s.final.idx < s.final.order.length - 1) {
        s.final.idx++;
        s.final.shown = false;
      } else {
        s.phase = 'end';
        mediaCmd(s, 'stop');
        fx(s, 'end');
      }
      return s;
    }
    case 'toEnd':
      s.phase = 'end';
      fx(s, 'end');
      return s;

    // ---------- po odcinku: Hall of Shame, kara, ranking sezonu ----------
    case 'screen':
      if (!['lobby', 'end'].includes(s.phase)) return state;
      if (a.screen && !['season', 'shame', 'punish'].includes(a.screen)) return state;
      s.screen = a.screen || null;
      fx(s, s.screen ? 'rule' : null);
      return s;
    case 'shameAdd': {
      const text = String(a.text ?? '').trim().slice(0, 200);
      if (!text) return state;
      s.shame = s.shame || [];
      s.shame.push({
        n: (s.shame.reduce((m, x) => Math.max(m, x.n || 0), 0) || 0) + 1,
        id: a.id ?? null,
        name: a.id ? nameOf(s, a.id) : String(a.name || '').slice(0, 24) || '?',
        text,
        q: a.q ? String(a.q).slice(0, 400) : null,
        a: a.a ? String(a.a).slice(0, 200) : null,
        cat: a.cat ? String(a.cat).slice(0, 80) : null,
        star: !s.shame.some((x) => x.star),
      });
      return s;
    }
    case 'shameDel': {
      const list = s.shame || [];
      const gone = list.find((x) => x.n === a.n);
      s.shame = list.filter((x) => x.n !== a.n);
      if (gone?.star && s.shame.length) s.shame[0].star = true;
      return s;
    }
    case 'shameStar':
      (s.shame || []).forEach((x) => (x.star = x.n === a.n));
      return s;
    case 'punish': {
      const p = { ...(s.punish || { winner: null, loser: null, nick: '' }) };
      if ('winner' in a) p.winner = a.winner;
      if ('loser' in a) p.loser = a.loser;
      if ('nick' in a) p.nick = String(a.nick ?? '').trim().slice(0, 32);
      s.punish = p;
      return s;
    }
    default:
      return state;
  }
}

function toFinal(s) {
  const f = s.set.final;
  if (!f) {
    s.phase = 'end';
    fx(s, 'end');
    return;
  }
  s.final = { ids: finalists(s), wagers: {}, answers: {}, judged: {}, order: [], idx: 0, shown: false, qAt: null };
  s.phase = s.final.ids.length ? 'final-intro' : 'end';
  fx(s, s.final.ids.length ? 'intro' : 'end');
}

// ---------- widoki (bez spoilerów) ----------

export function standings(s) {
  return [...s.players].sort((a, b) => b.score - a.score);
}

// kara dla przegranego: zwycięzca nadaje przegranemu nick i avatar na Discordzie na tydzień
export const PUNISH_DAYS = 7;
export function punishment(s, today = new Date()) {
  const st = standings(s);
  const p = s.punish || {};
  const has = (id) => id && s.players.some((x) => x.id === id);
  const winner = has(p.winner) ? p.winner : st[0]?.id ?? null;
  let loser = has(p.loser) ? p.loser : st[st.length - 1]?.id ?? null;
  if (loser === winner && !has(p.loser)) loser = null;
  const until = new Date(today.getTime() + PUNISH_DAYS * 864e5);
  return {
    winner,
    loser,
    winnerName: winner ? nameOf(s, winner) : null,
    loserName: loser ? nameOf(s, loser) : null,
    nick: p.nick || '',
    until: `${until.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })} (${until.toLocaleDateString('pl-PL', { weekday: 'long' })})`,
    days: PUNISH_DAYS,
  };
}

export function boardView(s) {
  const r = roundOf(s);
  const v = {
    title: s.title,
    phase: s.phase,
    round: s.round,
    roundCount: s.set.rounds.length,
    roundName: r?.name || `Runda ${s.round + 1}`,
    values: r?.values || [],
    categories: (r?.categories || []).map((c) => c.name),
    used: s.used,
    picker: s.picker,
    players: s.players.map(({ id, name, score, connected }) => ({ id, name, score, connected })),
    fx: s.fx,
    introAt: s.introAt,
    qTotal: r ? r.categories.reduce((n, c) => n + c.questions.length, 0) : 0,
    qDone: Object.keys(s.used).filter((k) => k.startsWith(s.round + ':')).length,
    media: s.media || { n: 0, cmd: null },
    screen: ['lobby', 'end'].includes(s.phase) ? s.screen || null : null,
    episode: s.set.episode ?? null,
  };
  if (s.phase === 'end') {
    v.shame = (s.shame || []).map(({ n, name, text, q, a, cat, star }) => ({ n, name, text, q, a, cat, star }));
    v.punish = punishment(s);
  }
  if (s.phase === 'opener') {
    v.opener = { at: s.openerAt, episode: s.set.episode ?? null, subtitle: s.set.subtitle || null };
  }
  if (s.phase === 'rules') {
    const list = rulesOf(s);
    const r0 = list[s.rule] || list[0];
    v.rules = { idx: s.rule, count: list.length, title: r0.title, lines: r0.board, at: s.ruleAt };
  }
  const mq = currentQuestion(s);
  const showMedia = mq && s.phase !== 'dd';
  if (showMedia && mq.audio) v.audio = { src: mq.audio, start: Number(mq.audioStart) || 0, end: Number(mq.audioEnd) || null };
  if (showMedia && mq.answerImage) {
    if (s.phase === 'reveal' || (s.phase === 'final-reveal' && s.final?.shown)) v.answerImage = mq.answerImage;
  }
  if (s.cur) {
    const q = curQuestion(s) || {};
    const showQ = s.phase !== 'dd' && s.phase !== 'wheel' && s.phase !== 'blind';
    const z = zoomOf(q);
    let image = showQ ? q.image || null : null;
    if (showQ && z) image = s.phase === 'reveal' ? (v.answerImage ? null : z[z.length - 1]) : z[Math.min(s.cur.stage ?? 0, z.length - 1)];
    v.cur = {
      c: s.cur.c,
      q: s.cur.q,
      category: curCategory(s),
      solo: solo(s.cur),
      value: curValue(s),
      dd: s.cur.dd,
      blind: s.cur.blind != null,
      base: s.cur.base ?? null,
      stage: z && showQ ? s.cur.stage ?? 0 : null,
      stages: z && showQ ? z.length : null,
      wager: s.cur.wager,
      text: showQ ? q.q : null,
      image,
      hasAudio: showQ && !!q.audio,
      buzzOpen: s.cur.buzzOpen,
      openedAt: s.cur.openedAt,
      buzzed: s.cur.buzzed,
      buzzedAt: s.cur.buzzedAt,
      tried: s.cur.tried,
      wrong: s.cur.wrong,
      shownAt: s.cur.shownAt,
      result: s.cur.result,
      answer: s.phase === 'reveal' ? q.a : null,
    };
    const w = s.cur.wheel;
    if (w) {
      const it = curQuestion(s);
      const byId = new Map(wheelPool(s).map((x) => [x.id, x]));
      v.cur.wheel = {
        segs: w.segs.map((x) => ({ id: x.id, name: authorName(s, byId.get(x.id)) })),
        idx: w.idx,
        spinAt: w.spinAt,
        seed: w.seed,
        author: it ? authorName(s, it) : null,
        own: w.own,
        target: w.target,
        passed: w.passed,
        drawAt: w.drawAt,
        cands: w.cands,
        bonus: w.bonus ? { name: nameOf(s, w.bonus.id), delta: w.bonus.delta } : null,
      };
    }
  }
  v.wheelLeft = wheelLeft(s).length;
  if (s.final) {
    const f = s.set.final;
    const fv = {
      ids: s.final.ids,
      category: f.category,
      text: ['final-question', 'final-reveal', 'end'].includes(s.phase) ? f.q : null,
      image: ['final-question', 'final-reveal'].includes(s.phase) ? f.image || null : null,
      hasAudio: ['final-question', 'final-reveal'].includes(s.phase) && !!f.audio,
      qAt: s.final.qAt,
      wagered: s.final.ids.filter((id) => s.final.wagers[id] != null),
      answered: s.final.ids.filter((id) => s.final.answers[id] != null),
      judged: s.final.judged,
    };
    if (s.phase === 'final-reveal' || s.phase === 'end') {
      fv.order = s.final.order;
      fv.idx = s.final.idx;
      const id = s.final.order[s.final.idx];
      fv.currentId = id;
      fv.currentAnswer = id != null ? s.final.answers[id] ?? '' : null;
      fv.currentWager = id != null && s.final.judged[id] ? s.final.wagers[id] : null;
      fv.answer = s.final.shown || s.phase === 'end' ? f.a : null;
    }
    v.final = fv;
  }
  return v;
}

export function playerView(s, id) {
  const p = player(s, id);
  const v = {
    title: s.title,
    phase: s.phase,
    me: p ? { id: p.id, name: p.name, score: p.score } : null,
    picker: s.picker === id,
    pickerName: nameOf(s, s.picker),
    canBuzz: false,
    buzzed: null,
    tried: false,
    category: null,
    value: null,
  };
  if (s.cur) {
    v.category = curCategory(s);
    v.value = curValue(s);
    v.dd = s.cur.dd;
    v.blind = s.cur.blind != null;
    v.solo = solo(s.cur);
    const w = s.cur.wheel;
    if (w) {
      const it = curQuestion(s);
      v.wheel = {
        spun: !!w.pick,
        landIn: w.spinAt ? Math.max(0, w.spinAt + SPIN_MS - now()) : null,
        author: it ? authorName(s, it) : null,
        own: w.own,
        mineOwn: w.own && s.picker === id,
        target: w.target ? { id: w.target, name: nameOf(s, w.target), me: w.target === id } : null,
        passed: w.passed,
        drawIn: w.drawAt ? Math.max(0, w.drawAt + DRAW_MS - now()) : null,
        others: w.own && s.picker === id && !w.target ? s.players.filter((p) => p.id !== id).map((p) => ({ id: p.id, name: p.name })) : [],
      };
    }
    v.buzzed = s.cur.buzzed ? { id: s.cur.buzzed, name: nameOf(s, s.cur.buzzed), me: s.cur.buzzed === id } : null;
    v.tried = s.cur.tried.includes(id);
    v.canBuzz = s.phase === 'question' && s.cur.buzzOpen && !s.cur.buzzed && !v.tried;
    if (s.phase === 'dd' && s.picker === id) v.ddMax = ddMax(s);
    if (s.cur.result) v.result = { ...s.cur.result, mine: s.cur.result.id === id };
  }
  if (s.final) {
    v.final = {
      inFinal: s.final.ids.includes(id),
      category: s.set.final.category,
      wager: s.final.wagers[id] ?? null,
      answer: s.final.answers[id] ?? null,
      remaining: s.final.qAt ? Math.max(0, s.final.qAt + FINAL_SECONDS * 1000 - now()) : null,
    };
  }
  // własne pytania na koło: gracz widzi tylko swoje
  v.wheelMine = wheelMine(s, id).map((x) => ({ id: x.id, q: x.q, a: x.a, alt: (x.alt || []).join('; '), used: !!x.used }));
  v.wheelMax = WHEEL_PER_PLAYER;
  v.wheelOpen = !!p && !['end'].includes(s.phase);
  if (s.phase === 'end') v.ranking = standings(s).map((x) => ({ name: x.name, score: x.score, me: x.id === id }));
  return v;
}

// ---------- walidacja pliku z pytaniami ----------

export function validateSet(set) {
  const err = [];
  if (!set || typeof set !== 'object') return ['Plik nie jest obiektem JSON.'];
  if (!Array.isArray(set.rounds) || !set.rounds.length) err.push('Brak listy "rounds".');
  (set.rounds || []).forEach((r, ri) => {
    const where = `Runda ${ri + 1}`;
    if (!Array.isArray(r.values) || !r.values.length) err.push(`${where}: brak "values".`);
    if (!Array.isArray(r.categories) || !r.categories.length) err.push(`${where}: brak "categories".`);
    (r.categories || []).forEach((c, ci) => {
      const cw = `${where}, kategoria ${ci + 1}${c?.name ? ` (${c.name})` : ''}`;
      if (!c.name) err.push(`${cw}: brak nazwy.`);
      if (!Array.isArray(c.questions)) return err.push(`${cw}: brak "questions".`);
      if (r.values && c.questions.length !== r.values.length)
        err.push(`${cw}: ${c.questions.length} pytań, a stawek jest ${r.values.length}.`);
      c.questions.forEach((q, qi) => {
        if (!q || !q.q) err.push(`${cw}, pytanie ${qi + 1}: brak treści "q".`);
        if (!q || !q.a) err.push(`${cw}, pytanie ${qi + 1}: brak odpowiedzi "a".`);
        if (q?.audioEnd != null && Number(q.audioEnd) <= (Number(q.audioStart) || 0))
          err.push(`${cw}, pytanie ${qi + 1}: "audioEnd" musi być większe niż "audioStart".`);
        if (q?.zoom != null && (!Array.isArray(q.zoom) || !q.zoom.length || q.zoom.some((x) => typeof x !== 'string' || !x)))
          err.push(`${cw}, pytanie ${qi + 1}: "zoom" musi być listą ścieżek do obrazków (od najbliższego zbliżenia).`);
      });
    });
  });
  if (set.final && (!set.final.q || !set.final.a || !set.final.category))
    err.push('Finał: potrzebne "category", "q" i "a".');
  if (set.wheel != null) {
    if (!Array.isArray(set.wheel)) err.push('"wheel" musi być listą pytań na koło.');
    else
      set.wheel.forEach((q, i) => {
        if (!q?.q || !q?.a) err.push(`Koło, pytanie ${i + 1}: potrzebne "q" i "a".`);
      });
  }
  if (set.blind != null) {
    if (!Array.isArray(set.blind)) err.push('"blind" musi być listą pytań w ciemno.');
    else
      set.blind.forEach((q, i) => {
        if (!q?.q || !q?.a || !q?.category) err.push(`W ciemno, pytanie ${i + 1}: potrzebne "category", "q" i "a".`);
      });
  }
  (set.rounds || []).forEach((r, ri) => {
    if (r?.blindFields != null && !(Number(r.blindFields) >= 0)) err.push(`Runda ${ri + 1}: "blindFields" musi być liczbą od 0.`);
    if (r?.wheelFields != null && !(Number(r.wheelFields) >= 0)) err.push(`Runda ${ri + 1}: "wheelFields" musi być liczbą od 0.`);
  });
  if (set.rules != null) {
    if (!Array.isArray(set.rules) || !set.rules.length) err.push('"rules" musi być niepustą listą.');
    else
      set.rules.forEach((r, i) => {
        if (!r?.title || !Array.isArray(r.board) || !r.host) err.push(`Zasada ${i + 1}: potrzebne "title", "board" (lista) i "host".`);
      });
  }
  return err;
}
