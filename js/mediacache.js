// Media na urządzeniu gracza. Prowadzący ma pliki u siebie (IndexedDB), więc urządzenie
// gracza pobiera je od niego przez to samo połączenie P2P, po jednym, zaraz po wejściu.
// Pliki przychodzą zaszyfrowane i pod losowymi nazwami: klucz do obrazka czy klipu
// prowadzący wysyła dopiero razem z pytaniem, więc nie da się ich podejrzeć wcześniej
// (ani obrazka z odpowiedzią przed odsłonięciem). Zaszyfrowane pliki zostają w IndexedDB
// urządzenia, więc po odświeżeniu nie lecą drugi raz.

const DB = 'tk-media-gracz';
const STORE = 'files';
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }).catch(() => null); // prywatne okno itp.: działamy tylko w pamięci
  }
  return dbp;
}

async function idb(mode, fn) {
  const d = await db();
  if (!d) return null;
  return new Promise((res) => {
    try {
      const t = d.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
      t.onerror = t.onabort = () => res(null);
    } catch {
      res(null);
    }
  });
}

const isExternal = (src) => /^(https?:|data:|blob:)/i.test(String(src || ''));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let ver = null;
let list = []; // id plików odcinka
const files = new Map(); // id -> { iv, data, type } | { url } | null (brak u prowadzącego)
const fileWait = new Map(); // id -> [resolve]
const keys = new Map(); // id -> klucz (base64), dochodzi z pytaniem
const keyWait = new Map(); // id -> [resolve]
const plain = new Map(); // id -> Promise<url|null>
const wanted = []; // kolejka do pobrania, pilne na początku
let inflight = null;
let inflightAt = 0;
let send = () => false;
let onProgress = () => {};

export function setSender(fn) {
  send = fn;
}
export function onChange(fn) {
  onProgress = fn;
}

export function progress() {
  return { have: list.filter((id) => files.has(id)).length, total: list.length, ver };
}

function wake(map, id, val) {
  for (const r of map.get(id) || []) r(val);
  map.delete(id);
}
function waitFor(map, id) {
  return new Promise((r) => {
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(r);
  });
}

function reset() {
  for (const p of plain.values()) p.then((u) => u?.startsWith('blob:') && URL.revokeObjectURL(u));
  plain.clear();
  files.clear();
  keys.clear();
  wanted.length = 0;
  inflight = null;
}

// lista plików od prowadzącego; nowa wersja kasuje stare pliki
export async function setList(v, ids) {
  if (v !== ver) {
    reset();
    ver = v;
    const stored = await idb('readonly', (st) => st.get('ver'));
    if (v !== ver) return;
    if (stored !== v) {
      await idb('readwrite', (st) => {
        st.clear();
        st.put(v, 'ver');
      });
    }
  }
  list = [...new Set(ids)];
  for (const id of list) {
    if (files.has(id)) continue;
    const rec = await idb('readonly', (st) => st.get('f:' + id));
    if (v !== ver) return;
    if (rec && !files.has(id)) {
      files.set(id, rec);
      wake(fileWait, id, rec);
    } else if (!rec && !wanted.includes(id) && inflight !== id) wanted.push(id);
  }
  onProgress(progress());
  pump();
}

// klucze do mediów, które właśnie są na planszy
export function setKeys(obj) {
  for (const [id, k] of Object.entries(obj || {})) {
    if (keys.get(id) === k) continue;
    keys.set(id, k);
    wake(keyWait, id, k);
  }
}

function pump() {
  if (ver == null) return;
  if (inflight && Date.now() - inflightAt < 20000) return;
  if (inflight) wanted.push(inflight); // nie doszło, spróbujemy jeszcze raz na końcu
  inflight = null;
  while (wanted.length && files.has(wanted[0])) wanted.shift();
  const next = wanted.shift();
  if (!next) return;
  if (!send({ t: 'media-get', ver, id: next })) {
    wanted.unshift(next);
    return;
  }
  inflight = next;
  inflightAt = Date.now();
}

// odpowiedź prowadzącego: { id, ver, iv, data, type } | { url } | { missing }
export async function receive(m) {
  if (m.ver !== ver) return;
  const id = m.id;
  if (inflight === id) inflight = null;
  let rec = null;
  if (m.data) {
    let data = m.data;
    if (data instanceof Blob) data = await data.arrayBuffer();
    else if (ArrayBuffer.isView(data)) data = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    rec = { iv: m.iv, data, type: m.type || '' };
  }
  else if (m.url) rec = { url: m.url };
  if (rec) idb('readwrite', (st) => st.put(rec, 'f:' + id));
  files.set(id, rec);
  wake(fileWait, id, rec);
  onProgress(progress());
  pump();
}

// po ponownym połączeniu: dokończ pobieranie
export function resume() {
  if (inflight) {
    wanted.unshift(inflight);
    inflight = null;
  }
  pump();
}

async function open(id) {
  let rec = files.has(id) ? files.get(id) : undefined;
  if (rec === undefined) {
    // pilne: na początek kolejki
    const i = wanted.indexOf(id);
    if (i > 0) wanted.splice(i, 1);
    if (i !== 0 && inflight !== id) wanted.unshift(id);
    pump();
    rec = await waitFor(fileWait, id);
  }
  if (!rec) return null;
  if (rec.url) return rec.url;
  const k = keys.get(id) ?? (await waitFor(keyWait, id));
  try {
    const key = await crypto.subtle.importKey('raw', b64(k), 'AES-GCM', false, ['decrypt']);
    const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(rec.iv) }, key, rec.data);
    return URL.createObjectURL(new Blob([buf], { type: rec.type }));
  } catch (e) {
    // uszkodzony albo stary plik: wyrzuć i pobierz od nowa
    console.warn('media', id, e);
    files.delete(id);
    idb('readwrite', (st) => st.delete('f:' + id));
    return null;
  }
}

// adres do <img>/<audio>; czeka na plik i klucz
export function resolve(id) {
  if (!id) return Promise.resolve(null);
  if (isExternal(id)) return Promise.resolve(id);
  if (!plain.has(id)) {
    const p = open(id);
    plain.set(id, p);
    p.then((u) => !u && plain.get(id) === p && plain.delete(id));
  }
  return plain.get(id);
}

setInterval(pump, 3000);
