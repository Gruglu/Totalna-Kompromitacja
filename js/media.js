// Media do pytań (obrazki, audio). Pliki wczytuje prowadzący razem z JSON-em,
// lądują w IndexedDB tej przeglądarki, a ekran streamu (to samo źródło) czyta je stamtąd.
// Nic nie idzie do repo ani do internetu. Pełne adresy https/data: przechodzą bez zmian.

const DB = 'tk-media';
const STORE = 'files';
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const st = t.objectStore(STORE);
    const out = fn(st);
    t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export const isExternal = (src) => /^(https?:|data:|blob:)/i.test(String(src || ''));

// "./media/Foo.JPG" -> "media/foo.jpg"
export function norm(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
    .toLowerCase();
}
const base = (p) => norm(p).split('/').pop();

// files: [{ path: 'media/x.jpg', file: File }]; poprzednie media są kasowane
export async function replaceAll(files) {
  await tx('readwrite', (st) => {
    st.clear();
    for (const { path, file } of files) {
      st.put(file, 'p:' + norm(path));
      st.put(file, 'n:' + base(path)); // zapas: dopasowanie po samej nazwie pliku
    }
  });
  cache.clear();
}

async function getBlob(src) {
  const r1 = await tx('readonly', (st) => st.get('p:' + norm(src)));
  if (r1) return r1;
  return tx('readonly', (st) => st.get('n:' + base(src)));
}

// zapas: plik leżący obok strony (np. media przykładowego zestawu w repo)
async function onSite(src) {
  try {
    const r = await fetch(src, { method: 'HEAD', cache: 'no-store' });
    return r.ok && !/text\/html/.test(r.headers.get('content-type') || '');
  } catch {
    return false;
  }
}

export async function has(src) {
  if (isExternal(src)) return true;
  try {
    if (await getBlob(src)) return true;
  } catch {}
  return onSite(src);
}

const cache = new Map(); // src -> Promise<url|null>

// zwraca adres do użycia w <img>/<audio> albo null, gdy pliku nie ma
export function resolve(src) {
  if (!src) return Promise.resolve(null);
  if (isExternal(src)) return Promise.resolve(src);
  if (!cache.has(src)) {
    cache.set(
      src,
      getBlob(src)
        .catch(() => null)
        .then(async (b) => (b ? URL.createObjectURL(b) : (await onSite(src)) ? src : null))
    );
  }
  return cache.get(src);
}

export function resetCache() {
  for (const p of cache.values()) p.then((u) => u && u.startsWith('blob:') && URL.revokeObjectURL(u));
  cache.clear();
}

const MEDIA_EXT = /\.(jpe?g|png|webp|gif|avif|svg|mp3|ogg|oga|opus|m4a|aac|wav|flac|webm)$/i;
export const isMediaFile = (name) => MEDIA_EXT.test(name);
