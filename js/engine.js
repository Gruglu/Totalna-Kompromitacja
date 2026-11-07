// Silnik gry: czyste funkcje na stanie. Prowadzący (host.html) trzyma stan,
// ekran streamu i telefony dostają tylko widoki bez odpowiedzi.

export const ANSWER_SECONDS = 5;
export const FINAL_SECONDS = 30;
export const DD_MIN = 5;
export const DD_PER_ROUND = [1, 2];

import { rulesFor } from './rules.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const now = () => Date.now();

export function newGame(set, players = []) {
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
  };
}

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

// polecenie dla odtwarzacza audio na streamie (graj / pauza / od nowa / stop)
function mediaCmd(s, cmd) {
  const m = s.media || { n: 0 };
  s.media = { n: m.n + 1, cmd, at: now() };
}

// pytanie, które jest teraz na ekranie (zwykłe albo finałowe)
export function currentQuestion(s) {
  if (s.cur && ['dd', 'question', 'reveal'].includes(s.phase)) return roundOf(s).categories[s.cur.c].questions[s.cur.q];
  if (s.final && ['final-question', 'final-reveal'].includes(s.phase)) return s.set.final;
  return null;
}

// wszystkie ścieżki mediów użyte w zestawie (do sprawdzenia, czy pliki są wczytane)
export function mediaRefs(set) {
  const out = [];
  const add = (q, where) => {
    for (const f of ['image', 'answerImage', 'audio']) if (q?.[f]) out.push({ src: q[f], field: f, where });
  };
  (set?.rounds || []).forEach((r, ri) =>
    (r.categories || []).forEach((c, ci) => (c.questions || []).forEach((q, qi) => add(q, `R${ri + 1} · ${c.name} · ${r.values?.[qi] ?? qi + 1}`)))
  );
  if (set?.final) add(set.final, 'Finał');
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
      s.rule = Math.max(0, Math.min(a.idx ?? 0, rulesFor(s.set).length - 1));
      s.ruleAt = now();
      fx(s, 'rule');
      return s;
    }
    case 'ruleStep': {
      if (s.phase !== 'rules') return state;
      const n = rulesFor(s.set).length;
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
      if (s.phase !== 'question' || cur.dd || cur.buzzed) return state;
      cur.buzzOpen = true;
      cur.openedAt = now();
      fx(s, 'open');
      return s;
    case 'startClock':
      if (s.phase !== 'question' || !cur.dd) return state;
      cur.buzzedAt = now();
      return s;
    case 'buzz': {
      if (s.phase !== 'question' || !cur.buzzOpen || cur.buzzed || cur.dd) return state;
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
      const value = cur.dd ? cur.wager : cur.value;
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
      if (cur.dd || !rebuzzPossible(s)) {
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
      if (s.phase !== 'question' || cur.dd || cur.buzzed) return state;
      if (cur.tried.includes(a.id)) return state;
      cur.buzzOpen = false;
      cur.buzzed = a.id;
      cur.buzzedAt = now();
      fx(s, 'buzz');
      return s;
    }
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
    const list = rulesFor(s.set);
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
    const q = r.categories[s.cur.c].questions[s.cur.q];
    const showQ = s.phase !== 'dd';
    v.cur = {
      c: s.cur.c,
      q: s.cur.q,
      category: r.categories[s.cur.c].name,
      value: s.cur.value,
      dd: s.cur.dd,
      wager: s.cur.wager,
      text: showQ ? q.q : null,
      image: showQ ? q.image || null : null,
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
  }
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
    const r = roundOf(s);
    v.category = r.categories[s.cur.c].name;
    v.value = s.cur.dd ? s.cur.wager : s.cur.value;
    v.dd = s.cur.dd;
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
      });
    });
  });
  if (set.final && (!set.final.q || !set.final.a || !set.final.category))
    err.push('Finał: potrzebne "category", "q" i "a".');
  if (set.rules != null) {
    if (!Array.isArray(set.rules) || !set.rules.length) err.push('"rules" musi być niepustą listą.');
    else
      set.rules.forEach((r, i) => {
        if (!r?.title || !Array.isArray(r.board) || !r.host) err.push(`Zasada ${i + 1}: potrzebne "title", "board" (lista) i "host".`);
      });
  }
  return err;
}
