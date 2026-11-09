// Edytor pytań: własny zestaw bez pisania JSON-a ręcznie.
// Wszystko leży w localStorage tej przeglądarki. Eksport daje plik w tym samym formacie,
// który przyjmuje panel prowadzącego („Wczytaj pliki”), a „Zagraj” przekazuje zestaw do panelu od razu.
import { validateSet } from './engine.js';
import * as media from './media.js';

const KEY = 'tk.editor.v1';
const HANDOFF = 'pk.incoming'; // panel prowadzącego odbiera stąd zestaw (host.js)
const MAX_ROUNDS = 4;
const MAX_CATS = 8;
const MAX_ROWS = 10;
const DD_DEFAULT = [1, 2];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = (o) => JSON.parse(JSON.stringify(o));
const filled = (s) => String(s ?? '').trim() !== '';

// ---------- model ----------

const emptyQ = () => ({ q: '', a: '' });
const newCat = (rows) => ({ name: '', questions: Array.from({ length: rows }, emptyQ) });
function newRound(i, prev) {
  const values = prev ? prev.values.map((v) => v * 2) : [100, 200, 300, 400, 500];
  const cols = prev ? prev.categories.length : 5;
  return { name: `Runda ${i + 1}`, values, categories: Array.from({ length: cols }, () => newCat(values.length)) };
}
const blankSet = () => ({ title: 'Totalna Kompromitacja', subtitle: '', rounds: [newRound(0)] });

// zestaw z pliku albo z panelu: uzupełnij braki, żeby siatka była prostokątna
function normalize(src) {
  if (!src || typeof src !== 'object' || !Array.isArray(src.rounds)) return null;
  const s = clone(src);
  delete s.example;
  s.title = String(s.title ?? '');
  s.rounds = s.rounds
    .filter((r) => r && typeof r === 'object')
    .map((r, i) => {
      const cats = (Array.isArray(r.categories) ? r.categories : [])
        .filter((c) => c && typeof c === 'object')
        .map((c) => ({
          ...c,
          name: String(c.name ?? ''),
          questions: (Array.isArray(c.questions) ? c.questions : []).map((q) =>
            q && typeof q === 'object' ? { ...q, q: String(q.q ?? ''), a: String(q.a ?? '') } : emptyQ()
          ),
        }));
      const values = (Array.isArray(r.values) ? r.values : []).map(Number).filter((v) => Number.isFinite(v));
      const rows = Math.max(values.length, ...cats.map((c) => c.questions.length), 1);
      while (values.length < rows) values.push((values[values.length - 1] || 0) + 100);
      cats.forEach((c) => {
        while (c.questions.length < rows) c.questions.push(emptyQ());
      });
      if (!cats.length) cats.push(newCat(rows));
      return { ...r, name: String(r.name ?? `Runda ${i + 1}`), values, categories: cats };
    });
  if (!s.rounds.length) s.rounds.push(newRound(0));
  if (s.final && typeof s.final === 'object')
    s.final = { ...s.final, category: String(s.final.category ?? ''), q: String(s.final.q ?? ''), a: String(s.final.a ?? '') };
  else delete s.final;
  return s;
}

// zestaw do eksportu i do gry: bez pustych pól opcjonalnych
function cleanQ(src) {
  const q = { ...src };
  for (const k of ['q', 'a', 'note', 'image', 'answerImage', 'audio', 'category']) {
    if (typeof q[k] === 'string') q[k] = q[k].trim();
    if (k !== 'q' && k !== 'a' && k !== 'category' && !q[k]) delete q[k];
  }
  if (Array.isArray(q.alt)) {
    q.alt = q.alt.map((x) => String(x).trim()).filter(Boolean);
    if (!q.alt.length) delete q.alt;
  } else delete q.alt;
  for (const k of ['audioStart', 'audioEnd']) {
    if (q[k] === '' || q[k] == null || !Number.isFinite(Number(q[k]))) delete q[k];
    else q[k] = Number(q[k]);
  }
  if (!q.audio) {
    delete q.audioStart;
    delete q.audioEnd;
  }
  return q;
}
function clean(src) {
  const s = clone(src);
  s.title = s.title.trim() || 'Totalna Kompromitacja';
  if (typeof s.subtitle === 'string') s.subtitle = s.subtitle.trim();
  if (!s.subtitle) delete s.subtitle;
  if (s.episode === '' || s.episode == null || !Number.isFinite(Number(s.episode))) delete s.episode;
  else s.episode = Number(s.episode);
  s.rounds = s.rounds.map((r) => {
    const o = { ...r, name: r.name.trim() || 'Runda', categories: r.categories.map((c) => ({ ...c, name: c.name.trim(), questions: c.questions.map(cleanQ) })) };
    if (o.dailyDoubles == null) delete o.dailyDoubles;
    if (o.wheelFields == null) delete o.wheelFields;
    return o;
  });
  if (s.final) s.final = cleanQ(s.final);
  else delete s.final;
  return s;
}

// ---------- zapis w przeglądarce ----------

function loadDb() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.sets)) {
      d.sets = d.sets.filter((x) => x && x.id && x.set).map((x) => ({ ...x, set: normalize(x.set) || blankSet() }));
      return d;
    }
  } catch {}
  return { sets: [], cur: null };
}

let db = loadDb();
let saveState = { ok: true, at: null };
let saveTimer = null;

function writeDb() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const c = cur();
  if (c) c.updated = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    saveState = { ok: true, at: Date.now() };
  } catch {
    saveState = { ok: false, at: Date.now() };
  }
  renderSaved();
  renderSetList();
}
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeDb, 350);
};
window.addEventListener('beforeunload', () => saveTimer && writeDb());

const cur = () => db.sets.find((x) => x.id === db.cur) || null;
const set = () => cur().set;

// name: nazwa zestawu na liście w edytorze i w nazwie pliku; set.title to logo na planszy
function addSet(s, focus = true, name = '') {
  const item = { id: uid(), name, updated: Date.now(), set: s };
  db.sets.unshift(item);
  if (focus) {
    db.cur = item.id;
    sel = { r: 0, c: 0, q: 0 };
  }
  writeDb();
  return item;
}

// ---------- stan widoku ----------

let sel = { r: 0, c: 0, q: 0 }; // r: numer rundy albo 'final'
let armed = null; // klucz przycisku, który czeka na drugie kliknięcie
let armTimer = null;
const thumbs = new Map(); // src -> url | null

function arm(k) {
  if (armed === k) {
    armed = null;
    clearTimeout(armTimer);
    return true;
  }
  armed = k;
  clearTimeout(armTimer);
  armTimer = setTimeout(() => {
    armed = null;
    render();
  }, 3000);
  render();
  return false;
}
const armTxt = (k, txt) => (armed === k ? 'Na pewno? Kliknij znowu' : txt);

function fixSel() {
  const s = set();
  if (sel.r === 'final') {
    if (!s.final) sel = { r: s.rounds.length - 1, c: 0, q: 0 };
    return;
  }
  sel.r = Math.min(Math.max(0, sel.r), s.rounds.length - 1);
  const r = s.rounds[sel.r];
  sel.c = Math.min(Math.max(0, sel.c), r.categories.length - 1);
  sel.q = Math.min(Math.max(0, sel.q), r.values.length - 1);
}

const selQ = () => (sel.r === 'final' ? set().final : set().rounds[sel.r].categories[sel.c].questions[sel.q]);

// ---------- sprawdzanie ----------

function qState(q) {
  const a = filled(q.q);
  const b = filled(q.a);
  if (a && b) return audioBad(q) ? 'bad' : 'ok';
  return a || b || filled(q.image) || filled(q.note) ? 'bad' : 'empty';
}
const audioBad = (q) => q.audioEnd !== '' && q.audioEnd != null && Number(q.audioEnd) <= (Number(q.audioStart) || 0);

function issues() {
  const s = set();
  const out = [];
  let ok = 0;
  let total = 0;
  s.rounds.forEach((r, ri) => {
    r.values.forEach((v, qi) => {
      if (!(Number(v) > 0)) out.push({ txt: `R${ri + 1}: stawka w wierszu ${qi + 1} musi być większa od zera`, at: { r: ri, c: 0, q: qi } });
    });
    r.categories.forEach((c, ci) => {
      if (!filled(c.name)) out.push({ txt: `R${ri + 1}: kategoria ${ci + 1} nie ma nazwy`, at: { r: ri, c: ci, q: 0 } });
      c.questions.forEach((q, qi) => {
        total++;
        const where = `R${ri + 1} · ${c.name.trim() || `kategoria ${ci + 1}`} · ${r.values[qi]}`;
        const at = { r: ri, c: ci, q: qi };
        if (!filled(q.q) && !filled(q.a)) out.push({ txt: `${where}: puste`, at, empty: true });
        else if (!filled(q.q)) out.push({ txt: `${where}: brak treści pytania`, at });
        else if (!filled(q.a)) out.push({ txt: `${where}: brak odpowiedzi`, at });
        else if (audioBad(q)) out.push({ txt: `${where}: koniec fragmentu audio przed początkiem`, at });
        else ok++;
      });
    });
  });
  if (s.final) {
    total++;
    const f = s.final;
    const miss = [!filled(f.category) && 'kategorii', !filled(f.q) && 'pytania', !filled(f.a) && 'odpowiedzi'].filter(Boolean);
    if (miss.length) out.push({ txt: `Finał: brak ${miss.join(', ')}`, at: { r: 'final' } });
    else if (audioBad(f)) out.push({ txt: 'Finał: koniec fragmentu audio przed początkiem', at: { r: 'final' } });
    else ok++;
  }
  return { list: out, ok, total };
}

// ---------- rysowanie ----------

const $top = document.getElementById('top');
const $side = document.getElementById('side');
const $main = document.getElementById('main');
const $form = document.getElementById('form');

function renderTop() {
  $top.innerHTML = `
    <div class="logo">Totalna Kompromitacja<small>edytor pytań · zapisuje się w tej przeglądarce</small></div>
    <div class="room"><span>Edytor</span><span class="net" id="saved"></span></div>
    <div class="tools">
      <button class="btn" data-a="newSet">Nowy zestaw</button>
      <button class="btn" data-a="import" title="Plik JSON w formacie odcinka">Importuj JSON</button>
      <button class="btn" data-a="export" title="Pobierz plik, który wczytasz w panelu albo komuś wyślesz">Eksportuj JSON</button>
      <button class="btn" data-a="fromHost" title="Kopia zestawu, który jest teraz wczytany w panelu prowadzącego">Weź z panelu</button>
      <button class="btn play" data-a="play" title="Sprawdza zestaw i wczytuje go do panelu prowadzącego">Zagraj tym zestawem</button>
    </div>`;
  renderSaved();
  fitTop();
}

// formularz przykleja się pod paskiem u góry, który na węższych ekranach ma dwie linie
function fitTop() {
  document.querySelector('.ed')?.style.setProperty('--toph', `${$top.offsetHeight}px`);
}
window.addEventListener('resize', fitTop);

function renderSaved() {
  const el = document.getElementById('saved');
  if (!el) return;
  if (!saveState.ok) {
    el.textContent = 'nie udało się zapisać, brak miejsca w przeglądarce';
    el.classList.add('bad');
    return;
  }
  el.classList.remove('bad');
  el.textContent = saveState.at
    ? `zapisano ${new Date(saveState.at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
    : 'zapis automatyczny';
}

function countQ(s) {
  let ok = 0;
  let total = 0;
  s.rounds.forEach((r) => r.categories.forEach((c) => c.questions.forEach((q) => (total++, qState(q) === 'ok' && ok++))));
  return { ok, total };
}

function setListHtml() {
  return db.sets
    .map((it) => {
      const n = countQ(it.set);
      const when = new Date(it.updated).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `<button class="set-it${it.id === db.cur ? ' on' : ''}" data-set="${esc(it.id)}">
        <b>${esc(itemName(it))}</b>
        <span>${n.ok}/${n.total} pytań · ${esc(when)}</span>
      </button>`;
    })
    .join('');
}
const itemName = (it) => String(it.name ?? '').trim() || 'Bez nazwy';

function renderSetList() {
  const el = document.getElementById('setlist');
  if (el) el.innerHTML = setListHtml();
}

function renderSide() {
  const s = set();
  $side.innerHTML = `
    <div>
      <div class="sec-h"><h2>Moje zestawy</h2><span class="label">${db.sets.length}</span></div>
      <div class="set-list" id="setlist">${setListHtml()}</div>
      <div class="row" style="margin-top:8px">
        <button class="btn small ghost" data-a="dupSet">Duplikuj</button>
        <button class="btn small danger ghost" data-a="delSet">${armTxt('delSet', 'Usuń zestaw')}</button>
      </div>
    </div>
    <div>
      <div class="sec-h"><h2>Zestaw</h2></div>
      <div class="fgrid">
        <label><span class="label">Nazwa zestawu</span><input class="field" data-m="name" value="${esc(cur().name ?? '')}" placeholder="np. Wieczór z Wiedźminem" maxlength="60"></label>
        <label><span class="label">Logo na planszy</span><input class="field" data-m="title" value="${esc(s.title)}" placeholder="Totalna Kompromitacja" maxlength="40"></label>
        <label><span class="label">Podpis pod logo w czołówce</span><input class="field" data-m="subtitle" value="${esc(s.subtitle ?? '')}" placeholder="opcjonalnie" maxlength="80"></label>
        <label><span class="label">Numer odcinka</span><input class="field" data-m="episode" type="number" min="1" step="1" value="${esc(s.episode ?? '')}" placeholder="opcjonalnie" style="width:120px"></label>
      </div>
    </div>
    <div id="status"></div>
    <div class="hint">Zestaw zapisuje się sam, w tej przeglądarce. Żeby przenieść go na inny komputer albo dać znajomym, użyj <b>Eksportuj JSON</b>. Odpowiedzi widzi tylko prowadzący, gracze dostają pytanie dopiero, gdy padnie na planszy.</div>`;
  renderStatus();
}

function renderStatus() {
  const el = document.getElementById('status');
  if (!el) return;
  const { list, ok, total } = issues();
  const hard = list.filter((x) => !x.empty);
  const empty = list.length - hard.length;
  const shown = [...hard, ...list.filter((x) => x.empty)].slice(0, 8);
  el.innerHTML = `
    <div class="sec-h"><h2>Gotowość</h2><span class="label">${ok}/${total}</span></div>
    <div class="meter"><i style="width:${total ? Math.round((ok / total) * 100) : 0}%"></i></div>
    ${
      list.length
        ? `<div class="issues">${shown
            .map((x, i) => `<button class="iss${x.empty ? ' empty' : ''}" data-iss="${i}">${esc(x.txt)}</button>`)
            .join('')}${list.length > shown.length ? `<div class="hint">i jeszcze ${list.length - shown.length}</div>` : ''}</div>
          <div class="hint">${empty ? `Puste pola: ${empty}. ` : ''}Kliknij, żeby przejść do pola.</div>`
        : '<div class="hint ok">Wszystko wypełnione. Można grać.</div>'
    }`;
  el._issues = shown;
}

function tabsHtml() {
  const s = set();
  const tabs = s.rounds.map((r, i) => {
    const n = { ok: 0, total: 0 };
    r.categories.forEach((c) => c.questions.forEach((q) => (n.total++, qState(q) === 'ok' && n.ok++)));
    return `<button class="tab${sel.r === i ? ' on' : ''}" data-round="${i}">${esc(r.name.trim() || `Runda ${i + 1}`)}<span>${n.ok}/${n.total}</span></button>`;
  });
  if (s.rounds.length < MAX_ROUNDS) tabs.push(`<button class="tab add" data-a="addRound">+ Runda</button>`);
  tabs.push(
    s.final
      ? `<button class="tab${sel.r === 'final' ? ' on' : ''}" data-round="final">Finał<span>${qState(s.final) === 'ok' && filled(s.final.category) ? 'gotowy' : 'braki'}</span></button>`
      : `<button class="tab add" data-a="addFinal">+ Finał</button>`
  );
  return `<div class="tabs">${tabs.join('')}</div>`;
}

function cellHtml(r, c, q) {
  const qq = set().rounds[r].categories[c].questions[q];
  const st = qState(qq);
  const tags = [qq.image && 'obrazek', qq.answerImage && 'obr. odp.', qq.audio && 'audio'].filter(Boolean);
  const on = sel.r === r && sel.c === c && sel.q === q;
  const v = set().rounds[r].values[q];
  return `<button class="cell ${st}${on ? ' on' : ''}" data-cell="${c}:${q}" id="cell-${c}-${q}">
    <span class="v">${esc(v)}</span>
    <span class="t">${esc(qq.q.trim() || (st === 'empty' ? 'puste' : 'brak treści'))}</span>
    ${tags.length ? `<span class="tg">${tags.join(' · ')}</span>` : ''}
  </button>`;
}

function renderMain() {
  fixSel();
  const s = set();
  if (sel.r === 'final') {
    $main.innerHTML = `${tabsHtml()}
      <div class="panel">
        <span class="label">Finał</span>
        <div class="hint">Jedno pytanie na koniec. Grają w nim tylko gracze z wynikiem powyżej zera: każdy obstawia część punktów, potem wpisuje odpowiedź na swoim urządzeniu. Treść wpisujesz po prawej.</div>
        <div class="row"><button class="btn small danger ghost" data-a="delFinal">${armTxt('delFinal', 'Usuń finał')}</button></div>
      </div>`;
    return;
  }
  const r = s.rounds[sel.r];
  const cols = r.categories.length;
  const head = r.categories
    .map(
      (c, ci) => `<div class="chead">
        <input class="field cname" data-cn="${ci}" value="${esc(c.name)}" placeholder="Kategoria ${ci + 1}" maxlength="40">
        <div class="cbtn">
          <button class="btn small ghost" data-cmove="${ci}:-1" ${ci ? '' : 'disabled'} title="W lewo">←</button>
          <button class="btn small ghost" data-cmove="${ci}:1" ${ci < cols - 1 ? '' : 'disabled'} title="W prawo">→</button>
          <button class="btn small danger ghost" data-cdel="${ci}" ${cols > 1 ? '' : 'disabled'} title="Usuń kategorię">${armed === 'cdel' + ci ? 'Na pewno?' : '×'}</button>
        </div>
      </div>`
    )
    .join('');
  const rows = r.values
    .map(
      (v, qi) => `<div class="rlab">
        <input class="field val" type="number" min="1" step="1" data-rv="${qi}" value="${esc(v)}" title="Stawka">
        <button class="btn small danger ghost" data-rdel="${qi}" ${r.values.length > 1 ? '' : 'disabled'} title="Usuń wiersz">${armed === 'rdel' + qi ? '?' : '×'}</button>
      </div>${r.categories.map((_, ci) => cellHtml(sel.r, ci, qi)).join('')}`
    )
    .join('');
  const ddAuto = DD_DEFAULT[sel.r] ?? 1;
  const ddOpts = [0, 1, 2, 3]
    .map((n) => `<option value="${n}" ${r.dailyDoubles === n ? 'selected' : ''}>${n}</option>`)
    .join('');
  $main.innerHTML = `${tabsHtml()}
    <div class="rset">
      <label><span class="label">Nazwa rundy</span><input class="field" data-rn value="${esc(r.name)}" maxlength="30" style="width:200px"></label>
      <label><span class="label">Pola „wszystko albo nic”</span>
        <select class="field" data-dd style="width:auto"><option value="" ${r.dailyDoubles == null ? 'selected' : ''}>domyślnie (${ddAuto})</option>${ddOpts}</select></label>
      <label title="Koło fortuny: ukryte pola, na których wybierający kręci kołem z pytaniami od graczy (gracze wpisują je na telefonach w poczekalni)"><span class="label">Pola z kołem</span>
        <select class="field" data-wheel style="width:auto"><option value="" ${r.wheelFields == null ? 'selected' : ''}>auto (pytania graczy po równo)</option>${[0, 1, 2, 3, 4, 5, 6]
          .map((n) => `<option value="${n}" ${r.wheelFields === n ? 'selected' : ''}>${n}</option>`)
          .join('')}</select></label>
      <div class="row" style="margin-left:auto">
        <button class="btn small ghost" data-a="doubleValues" title="Wszystkie stawki razy dwa">Stawki ×2</button>
        <button class="btn small danger ghost" data-a="delRound" ${s.rounds.length > 1 ? '' : 'disabled'}>${armTxt('delRound', 'Usuń rundę')}</button>
      </div>
    </div>
    <div class="egrid-wrap">
      <div class="egrid" style="grid-template-columns:76px repeat(${cols}, minmax(120px, 1fr))">
        <div class="corner label">stawka</div>${head}${rows}
      </div>
    </div>
    <div class="row">
      <button class="btn small" data-a="addRow" ${r.values.length < MAX_ROWS ? '' : 'disabled'}>+ Wiersz</button>
      <button class="btn small" data-a="addCat" ${cols < MAX_CATS ? '' : 'disabled'}>+ Kategoria</button>
      <span class="hint">${cols} ${cols === 1 ? 'kategoria' : cols < 5 ? 'kategorie' : 'kategorii'} × ${r.values.length} = ${cols * r.values.length} pytań. Na telefonach najlepiej czyta się do 6 kategorii.</span>
    </div>`;
}

function mediaField(f, label, ph) {
  const q = selQ();
  return `<label><span class="label">${label}</span><input class="field" data-f="${f}" value="${esc(q[f] ?? '')}" placeholder="${ph}"></label>
    <div class="mprev" id="mp-${f}">${mediaPrev(f, q[f])}</div>`;
}

function mediaPrev(f, src) {
  src = String(src ?? '').trim();
  if (!src) return '';
  let u = thumbs.get(src);
  if (u === undefined) {
    thumbs.set(src, '');
    media.resolve(src).then((x) => {
      thumbs.set(src, x || null);
      const el = document.getElementById('mp-' + f);
      if (el && String(selQ()?.[f] ?? '').trim() === src) el.innerHTML = mediaPrev(f, src);
    });
    u = '';
  }
  if (u === '') return '<span class="hint">sprawdzam…</span>';
  if (u === null)
    return `<span class="hint warn">Nie widzę tego pliku. Link musi zaczynać się od https://, a ścieżkę typu media/plik.jpg wczytujesz w panelu razem z folderem.</span>`;
  if (f === 'audio') return `<audio controls preload="none" src="${esc(u)}"></audio>`;
  return `<img src="${esc(u)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'hint warn',textContent:'Obrazek się nie wczytał. Sprawdź, czy to bezpośredni link do pliku.'}))">`;
}

function renderForm() {
  fixSel();
  const s = set();
  const q = selQ();
  const fin = sel.r === 'final';
  const r = fin ? null : s.rounds[sel.r];
  const head = fin
    ? `<b>Finał</b>`
    : `<b>${esc(r.categories[sel.c].name.trim() || `Kategoria ${sel.c + 1}`)}</b><b class="v">${esc(r.values[sel.q])}</b><span class="label">${esc(r.name)}</span>`;
  const alt = Array.isArray(q.alt) ? q.alt.join('; ') : '';
  $form.innerHTML = `
    <div class="sec-h"><h2>Pytanie</h2>${fin ? '' : `<div class="row"><button class="btn small ghost" data-a="prevQ" title="Ctrl+↑">← Poprzednie</button><button class="btn small ghost" data-a="nextQ" title="Ctrl+Enter">Następne →</button></div>`}</div>
    <div class="qhead">${head}</div>
    <div class="fgrid">
      ${fin ? `<label><span class="label">Kategoria finału (gracze widzą ją przed obstawianiem)</span><input class="field" data-f="category" value="${esc(q.category)}" maxlength="40"></label>` : ''}
      <label><span class="label">Treść pytania</span><textarea class="field" data-f="q" rows="4" placeholder="Co prowadzący czyta i co widać na planszy">${esc(q.q)}</textarea></label>
      <label><span class="label">Odpowiedź</span><input class="field" data-f="a" value="${esc(q.a)}" placeholder="Widzi ją tylko prowadzący"></label>
      <label><span class="label">Inne dobre odpowiedzi (oddziel średnikiem)</span><input class="field" data-f="alt" value="${esc(alt)}" placeholder="np. Geralt; Biały Wilk"></label>
      <label><span class="label">Ciekawostka dla prowadzącego</span><textarea class="field" data-f="note" rows="2" placeholder="opcjonalnie, do skomentowania po odpowiedzi">${esc(q.note ?? '')}</textarea></label>
    </div>
    <details class="mbox" ${q.image || q.answerImage || q.audio ? 'open' : ''}>
      <summary><span class="label">Obrazki i muzyka (opcjonalnie)</span></summary>
      <div class="fgrid">
        ${mediaField('image', 'Obrazek z pytaniem', 'https://… albo media/kadr.jpg')}
        ${mediaField('answerImage', 'Obrazek po odpowiedzi', 'https://… albo media/kadr-odp.jpg')}
        ${mediaField('audio', 'Klip audio (prowadzący puszcza go z panelu)', 'https://… albo media/utwor.mp3')}
        <div class="row">
          <label><span class="label">Od sekundy</span><input class="field" type="number" min="0" step="0.5" data-f="audioStart" value="${esc(q.audioStart ?? '')}" style="width:110px"></label>
          <label><span class="label">Do sekundy</span><input class="field" type="number" min="0" step="0.5" data-f="audioEnd" value="${esc(q.audioEnd ?? '')}" style="width:110px"></label>
        </div>
        <div class="hint">Wklej bezpośredni link do pliku (jpg, png, webp, mp3, ogg). Pliki z dysku: wpisz tu ścieżkę względem pliku JSON (np. <b>media/kadr.jpg</b>), potem w panelu użyj „Wczytaj folder” z JSON-em i podfolderem media. Gracze dostają media dopiero razem z pytaniem.</div>
      </div>
    </details>
    ${
      fin
        ? ''
        : `<div class="row">
      <button class="btn small ghost" data-qmove="-1" ${sel.q ? '' : 'disabled'} title="Zamień z pytaniem o stawkę niżej">Zamień z wyższym ↑</button>
      <button class="btn small ghost" data-qmove="1" ${sel.q < r.values.length - 1 ? '' : 'disabled'} title="Zamień z pytaniem o stawkę wyżej">Zamień z niższym ↓</button>
      <button class="btn small danger ghost" data-a="clearQ" style="margin-left:auto">${armTxt('clearQ', 'Wyczyść')}</button>
    </div>`
    }`;
}

function render() {
  const a = document.activeElement;
  const keep = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && a.closest('#form, #side') ? { sel: fieldSel(a), s: a.selectionStart, e: a.selectionEnd } : null;
  renderTop();
  renderSide();
  renderMain();
  renderForm();
  if (keep?.sel) {
    const el = document.querySelector(keep.sel);
    if (el) {
      el.focus();
      try {
        el.setSelectionRange(keep.s, keep.e);
      } catch {}
    }
  }
}
function fieldSel(el) {
  for (const k of ['f', 'm']) if (el.dataset[k]) return `[data-${k}="${el.dataset[k]}"]`;
  return null;
}

// odświeżenie po wpisaniu tekstu, bez przerysowania pól
function refreshLight() {
  if (sel.r !== 'final') {
    const el = document.getElementById(`cell-${sel.c}-${sel.q}`);
    if (el) el.outerHTML = cellHtml(sel.r, sel.c, sel.q);
  }
  const tabs = document.querySelector('.tabs');
  if (tabs) tabs.outerHTML = tabsHtml();
  renderStatus();
}

// ---------- edycja ----------

document.addEventListener('input', (e) => {
  const el = e.target;
  const d = el.dataset;
  if (d.f) {
    const q = selQ();
    if (d.f === 'alt') q.alt = el.value.split(';').map((x) => x.trim());
    else if (d.f === 'audioStart' || d.f === 'audioEnd') q[d.f] = el.value === '' ? '' : Number(el.value);
    else q[d.f] = el.value;
    if (['image', 'answerImage', 'audio'].includes(d.f)) {
      const box = document.getElementById('mp-' + d.f);
      clearTimeout(el._t);
      el._t = setTimeout(() => box && (box.innerHTML = mediaPrev(d.f, el.value)), 500);
    }
    refreshLight();
    return save();
  }
  if (d.m) {
    const s = set();
    if (d.m === 'episode') s.episode = el.value === '' ? '' : Number(el.value);
    else if (d.m === 'name') cur().name = el.value;
    else s[d.m] = el.value;
    renderStatus();
    return save();
  }
  if (d.cn != null) {
    set().rounds[sel.r].categories[Number(d.cn)].name = el.value;
    const h = document.querySelector('.qhead b');
    if (h && Number(d.cn) === sel.c) h.textContent = el.value.trim() || `Kategoria ${sel.c + 1}`;
    renderStatus();
    return save();
  }
  if (d.rn != null) {
    set().rounds[sel.r].name = el.value;
    const tabs = document.querySelector('.tabs');
    if (tabs) tabs.outerHTML = tabsHtml();
    return save();
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  const d = el.dataset;
  if (d.rv != null) {
    const v = Math.round(Number(el.value));
    set().rounds[sel.r].values[Number(d.rv)] = Number.isFinite(v) ? v : 0;
    save();
    return render();
  }
  if (d.dd != null) {
    const r = set().rounds[sel.r];
    if (el.value === '') delete r.dailyDoubles;
    else r.dailyDoubles = Number(el.value);
    return save();
  }
  if (d.wheel != null) {
    const r = set().rounds[sel.r];
    if (el.value === '') delete r.wheelFields;
    else r.wheelFields = Number(el.value);
    return save();
  }
});

const actions = {
  newSet() {
    addSet(blankSet());
    render();
    document.querySelector('[data-m="name"]')?.focus();
  },
  dupSet() {
    addSet(clone(set()), true, `${itemName(cur())} (kopia)`);
    render();
    toast('Zrobiona kopia');
  },
  delSet() {
    if (!arm('delSet')) return;
    db.sets = db.sets.filter((x) => x.id !== db.cur);
    if (!db.sets.length) addSet(blankSet(), false);
    db.cur = db.sets[0].id;
    sel = { r: 0, c: 0, q: 0 };
    writeDb();
    render();
    toast('Zestaw usunięty');
  },
  import() {
    document.getElementById('imp').click();
  },
  export() {
    writeDb();
    const s = clean(set());
    const blob = new Blob([JSON.stringify(s, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slug(cur().name || s.title)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    const n = issues().list.length;
    toast(n ? `Pobrano. Uwaga: ${n} ${n === 1 ? 'brak' : 'braków'} do uzupełnienia` : 'Pobrano plik JSON');
  },
  fromHost() {
    let s = null;
    try {
      s = normalize(JSON.parse(localStorage.getItem('pk.set')));
    } catch {}
    if (!s) return toast('W panelu nie ma wczytanego zestawu');
    addSet(s, true, `Z panelu${s.episode != null ? `, odcinek ${s.episode}` : ''}`);
    render();
    toast('Skopiowane z panelu. Zmiany tutaj nie ruszają oryginału.');
  },
  play,
  addRound() {
    const s = set();
    if (s.rounds.length >= MAX_ROUNDS) return;
    s.rounds.push(newRound(s.rounds.length, s.rounds[s.rounds.length - 1]));
    sel = { r: s.rounds.length - 1, c: 0, q: 0 };
    save();
    render();
  },
  delRound() {
    const s = set();
    if (s.rounds.length < 2) return;
    const r = s.rounds[sel.r];
    const has = r.categories.some((c) => filled(c.name) || c.questions.some((q) => qState(q) !== 'empty'));
    if (has && !arm('delRound')) return;
    s.rounds.splice(sel.r, 1);
    sel = { r: Math.max(0, sel.r - 1), c: 0, q: 0 };
    save();
    render();
  },
  doubleValues() {
    const r = set().rounds[sel.r];
    r.values = r.values.map((v) => v * 2);
    save();
    render();
  },
  addFinal() {
    set().final = { category: '', q: '', a: '' };
    sel = { r: 'final' };
    save();
    render();
  },
  delFinal() {
    const f = set().final;
    if ((filled(f.q) || filled(f.a) || filled(f.category)) && !arm('delFinal')) return;
    delete set().final;
    sel = { r: set().rounds.length - 1, c: 0, q: 0 };
    save();
    render();
  },
  addRow() {
    const r = set().rounds[sel.r];
    if (r.values.length >= MAX_ROWS) return;
    const last = r.values[r.values.length - 1] || 0;
    const stepV = r.values.length > 1 ? last - r.values[r.values.length - 2] : last || 100;
    r.values.push(last + (stepV > 0 ? stepV : 100));
    r.categories.forEach((c) => c.questions.push(emptyQ()));
    sel = { r: sel.r, c: sel.c, q: r.values.length - 1 };
    save();
    render();
  },
  addCat() {
    const r = set().rounds[sel.r];
    if (r.categories.length >= MAX_CATS) return;
    r.categories.push(newCat(r.values.length));
    sel = { r: sel.r, c: r.categories.length - 1, q: 0 };
    save();
    render();
    document.querySelector(`[data-cn="${sel.c}"]`)?.focus();
  },
  prevQ: () => moveSel(-1),
  nextQ: () => moveSel(1),
  clearQ() {
    if (qState(selQ()) !== 'empty' && !arm('clearQ')) return;
    set().rounds[sel.r].categories[sel.c].questions[sel.q] = emptyQ();
    save();
    render();
  },
};

// po kolei: w dół kategorii, potem następna kategoria
function moveSel(dir) {
  if (sel.r === 'final') return;
  const r = set().rounds[sel.r];
  const rows = r.values.length;
  let i = sel.c * rows + sel.q + dir;
  const n = rows * r.categories.length;
  i = (i + n) % n;
  sel = { r: sel.r, c: Math.floor(i / rows), q: i % rows };
  renderMain();
  renderForm();
  document.querySelector('[data-f="q"]')?.focus();
}

function select(at) {
  sel = at.r === 'final' ? { r: 'final' } : { ...at };
  renderMain();
  renderForm();
  document.getElementById(`cell-${sel.c}-${sel.q}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t || t.disabled) return;
  const d = t.dataset;
  if (d.a) return actions[d.a]?.();
  if (d.set) {
    if (d.set === db.cur) return;
    writeDb();
    db.cur = d.set;
    sel = { r: 0, c: 0, q: 0 };
    writeDb();
    return render();
  }
  if (d.round != null) {
    sel = d.round === 'final' ? { r: 'final' } : { r: Number(d.round), c: 0, q: 0 };
    renderMain();
    return renderForm();
  }
  if (d.cell) {
    const [c, q] = d.cell.split(':').map(Number);
    sel = { r: sel.r, c, q };
    renderMain();
    renderForm();
    return document.querySelector('[data-f="q"]')?.focus();
  }
  if (d.iss != null) {
    const it = document.getElementById('status')?._issues?.[Number(d.iss)];
    if (it) {
      select(it.at);
      document.querySelector(it.txt.includes('nazwy') ? `[data-cn="${it.at.c}"]` : '[data-f="q"]')?.focus();
    }
    return;
  }
  const r = sel.r === 'final' ? null : set().rounds[sel.r];
  if (d.cmove && r) {
    const [c, dir] = d.cmove.split(':').map(Number);
    const to = c + dir;
    if (to < 0 || to >= r.categories.length) return;
    [r.categories[c], r.categories[to]] = [r.categories[to], r.categories[c]];
    if (sel.c === c) sel.c = to;
    else if (sel.c === to) sel.c = c;
    save();
    return render();
  }
  if (d.cdel != null && r) {
    const c = Number(d.cdel);
    const cat = r.categories[c];
    const has = filled(cat.name) || cat.questions.some((q) => qState(q) !== 'empty');
    if (has && !arm('cdel' + c)) return;
    r.categories.splice(c, 1);
    save();
    return render();
  }
  if (d.rdel != null && r) {
    const qi = Number(d.rdel);
    const has = r.categories.some((c) => qState(c.questions[qi]) !== 'empty');
    if (has && !arm('rdel' + qi)) return;
    r.values.splice(qi, 1);
    r.categories.forEach((c) => c.questions.splice(qi, 1));
    save();
    return render();
  }
  if (d.qmove && r) {
    const to = sel.q + Number(d.qmove);
    if (to < 0 || to >= r.values.length) return;
    const qs = r.categories[sel.c].questions;
    [qs[sel.q], qs[to]] = [qs[to], qs[sel.q]];
    sel.q = to;
    save();
    return render();
  }
});

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'Enter') {
    e.preventDefault();
    return moveSel(e.shiftKey ? -1 : 1);
  }
  if (mod && e.key === 'ArrowUp' && e.target.closest?.('#form')) {
    e.preventDefault();
    return moveSel(-1);
  }
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    writeDb();
    return toast(saveState.ok ? 'Zapisane w przeglądarce' : 'Brak miejsca w przeglądarce');
  }
  if (e.key === 'Escape' && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) e.target.blur();
});

document.getElementById('imp').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  let s = null;
  try {
    s = normalize(JSON.parse(await f.text()));
  } catch {}
  if (!s) return toast('To nie jest plik z pytaniami (brak listy "rounds")');
  addSet(s, true, f.name.replace(/\.json$/i, ''));
  render();
  const n = issues().list.length;
  toast(n ? `Zaimportowano. Do uzupełnienia: ${n}` : 'Zaimportowano');
});

// ---------- gra ----------

function play() {
  writeDb();
  const { list } = issues();
  if (list.length) {
    select(list.find((x) => !x.empty)?.at || list[0].at);
    document.querySelector('[data-f="q"]')?.focus();
    return toast(`Zestaw ma braki (${list.length}), lista po lewej`);
  }
  const s = clean(set());
  const errs = validateSet(s);
  if (errs.length) return toast(errs[0]);
  try {
    localStorage.setItem(HANDOFF, JSON.stringify({ set: s, at: Date.now() }));
  } catch {
    return toast('Brak miejsca w przeglądarce. Wyeksportuj JSON i wczytaj go w panelu.');
  }
  toast('Wysyłam do panelu…');
  // otwarty panel w innej karcie odbiera zestaw od razu; jeśli żadnego nie ma, przechodzimy do panelu
  setTimeout(() => {
    let left = null;
    try {
      left = localStorage.getItem(HANDOFF);
    } catch {}
    if (left) location.href = 'host.html';
    else toast('Zestaw jest już w otwartym panelu prowadzącego');
  }, 700);
}

function slug(t) {
  const map = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
  return (
    String(t || '')
      .toLowerCase()
      .replace(/[ąćęłńóśźż]/g, (c) => map[c])
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'pytania'
  );
}

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
  toastTimer = setTimeout(() => el.remove(), 2800);
}

// inna karta edytora zmieniła zestawy
window.addEventListener('storage', (e) => {
  if (e.key !== KEY || !e.newValue) return;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return; // nie przerywaj pisania
  const keepCur = db.cur;
  db = loadDb();
  if (db.sets.some((x) => x.id === keepCur)) db.cur = keepCur;
  else if (db.sets.length) db.cur = db.sets[0].id;
  else addSet(blankSet(), true);
  render();
});

if (!db.sets.length) addSet(blankSet());
if (!cur()) db.cur = db.sets[0].id;
render();
