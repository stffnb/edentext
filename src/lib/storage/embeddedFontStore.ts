import type { EmbeddedFont } from '../fonts/embeddedFonts';

// The current document's embedded fonts, persisted in IndexedDB (not localStorage, whose
// ~5 MB quota is already tight for images). One record, replaced on each open, so storage
// stays bounded to the open document; on app start it is re-registered via FontFace.
const DB_NAME = 'odf-editor-fonts';
const STORE = 'fonts';
const KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export async function saveEmbeddedFonts(fonts: EmbeddedFont[]): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openDb();
    if (fonts.length) await request(db, 'readwrite', (s) => s.put(fonts, KEY));
    else await request(db, 'readwrite', (s) => s.delete(KEY));
    db.close();
  } catch { /* storage disabled/full — fidelity just won't persist across reloads */ }
}

export async function loadEmbeddedFonts(): Promise<EmbeddedFont[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const db = await openDb();
    const fonts = await request<EmbeddedFont[] | undefined>(db, 'readonly', (s) => s.get(KEY));
    db.close();
    return fonts ?? [];
  } catch { return []; }
}

export async function clearEmbeddedFontStore(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openDb();
    await request(db, 'readwrite', (s) => s.delete(KEY));
    db.close();
  } catch { /* nothing to clear */ }
}
