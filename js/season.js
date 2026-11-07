// Ranking sezonu: wyniki odcinków zapisane w przeglądarce prowadzącego (localStorage),
// z eksportem i importem pliku JSON. Gracze łączą się między odcinkami po nicku
// (wielkość liter i spacje na brzegach nie mają znaczenia).

export const FINALE_SPOTS = 3;
const KEY = 'pk.season';

export function emptySeason() {
  return { v: 1, name: 'Sezon 1', episodes: [] };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw)) || emptySeason();
  } catch {}
  return emptySeason();
}

export function save(season) {
  try {
    localStorage.setItem(KEY, JSON.stringify(season));
    return true;
  } catch {
    return false;
  }
}

const nkey = (name) => String(name ?? '').trim().toLocaleLowerCase('pl');

// sprawdza i porządkuje wczytany plik; null gdy to nie jest sezon
export function normalize(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.episodes)) return null;
  const episodes = d.episodes
    .filter((e) => e && Array.isArray(e.results))
    .map((e) => ({
      ep: e.ep ?? null,
      title: String(e.title || ''),
      date: String(e.date || ''),
      results: e.results
        .filter((r) => r && String(r.name ?? '').trim())
        .map((r) => ({ name: String(r.name).trim().slice(0, 24), score: Math.round(Number(r.score)) || 0 })),
      shame: Array.isArray(e.shame) ? e.shame.filter((x) => x && x.text) : [],
      punish: e.punish && typeof e.punish === 'object' ? e.punish : null,
    }))
    .filter((e) => e.results.length);
  return { v: 1, name: String(d.name || 'Sezon 1').slice(0, 40), episodes };
}

// wpis odcinka z bieżącego stanu gry
export function episodeFrom(state, punish) {
  const results = [...state.players].sort((a, b) => b.score - a.score).map((p) => ({ name: p.name, score: p.score }));
  return {
    ep: state.set.episode ?? null,
    title: state.set.subtitle || state.set.title || '',
    date: new Date().toISOString().slice(0, 10),
    results,
    shame: (state.shame || []).map(({ name, text, q, a, cat, star }) => ({ name, text, q, a, cat, star: !!star })),
    punish: punish ? { winner: punish.winnerName, loser: punish.loserName, nick: punish.nick || '', until: punish.until } : null,
  };
}

// odcinek o tym samym numerze zastępuje poprzedni zapis
export function upsert(season, ep) {
  const episodes = [...season.episodes];
  const i = ep.ep != null ? episodes.findIndex((e) => e.ep === ep.ep) : -1;
  if (i >= 0) episodes[i] = ep;
  else episodes.push(ep);
  episodes.sort((a, b) => (a.ep ?? 1e9) - (b.ep ?? 1e9) || a.date.localeCompare(b.date));
  return { ...season, episodes, replaced: i >= 0 };
}

export function isSaved(season, state) {
  const ep = state.set.episode;
  if (ep == null) return false;
  return season.episodes.some((e) => e.ep === ep);
}

// tabela sezonu: suma punktów ze wszystkich odcinków
export function table(season) {
  const m = new Map();
  season.episodes.forEach((e, ei) => {
    const top = Math.max(...e.results.map((r) => r.score));
    const sorted = [...e.results].sort((a, b) => a.score - b.score);
    const bottom = sorted.length > 1 ? sorted[0].score : null;
    e.results.forEach((r) => {
      const k = nkey(r.name);
      const row = m.get(k) || { name: r.name, total: 0, played: 0, wins: 0, lasts: 0, last: null };
      row.name = r.name; // najnowsza pisownia nicku
      row.total += r.score;
      row.played++;
      if (r.score === top) row.wins++;
      if (bottom != null && r.score === bottom) row.lasts++;
      if (ei === season.episodes.length - 1) row.last = r.score;
      m.set(k, row);
    });
  });
  return [...m.values()].sort((a, b) => b.total - a.total || b.wins - a.wins || a.lasts - b.lasts || a.name.localeCompare(b.name, 'pl'));
}

// widok dla ekranu streamu
export function view(season) {
  const rows = table(season);
  return {
    name: season.name,
    count: season.episodes.length,
    lastEp: season.episodes.length ? season.episodes[season.episodes.length - 1].ep : null,
    spots: FINALE_SPOTS,
    rows: rows.map((r, i) => ({ ...r, pos: i + 1 })),
  };
}

export function download(season) {
  const blob = new Blob([JSON.stringify(season, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const slug = season.name.toLocaleLowerCase('pl').replace(/[^a-z0-9ąćęłńóśźż]+/g, '-').replace(/^-|-$/g, '') || 'sezon';
  a.href = URL.createObjectURL(blob);
  a.download = `ranking-${slug}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
