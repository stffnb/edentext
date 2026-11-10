import type { EmbeddedFont } from '../fonts/embeddedFonts';
import { openDb, idbRequest } from './idb';
import { docKey, keyOf, volatile } from './docScope';

// The current document's embedded fonts, persisted in IndexedDB (not localStorage, whose
// ~5 MB quota is already tight for images). One record, replaced on each open, so storage
// stays bounded to the open document; on app start it is re-registered via FontFace.
const DB_NAME = docKey('edentext-fonts');
const STORE = 'fonts';
const KEY = 'current';

const db_ = () => openDb(DB_NAME, STORE);
const request = <T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest) =>
  idbRequest<T>(db, STORE, mode, run);

// A volatile tab's fonts, which `keepEmbeddedFonts` stores once its document is kept.
let held: EmbeddedFont[] = [];

export async function saveEmbeddedFonts(fonts: EmbeddedFont[]): Promise<void> {
  if (volatile) held = fonts;
  if (volatile || typeof indexedDB === 'undefined') return;
  try {
    const db = await db_();
    if (fonts.length) await request(db, 'readwrite', (s) => s.put(fonts, KEY));
    else await request(db, 'readwrite', (s) => s.delete(KEY));
    db.close();
  } catch { /* storage disabled/full — fidelity just won't persist across reloads */ }
}

export async function loadEmbeddedFonts(): Promise<EmbeddedFont[]> {
  if (volatile || typeof indexedDB === 'undefined') return [];
  try {
    const db = await db_();
    const fonts = await request<EmbeddedFont[] | undefined>(db, 'readonly', (s) => s.get(KEY));
    db.close();
    return fonts ?? [];
  } catch { return []; }
}

export async function clearEmbeddedFontStore(): Promise<void> {
  if (volatile || typeof indexedDB === 'undefined') return;
  try {
    const db = await db_();
    await request(db, 'readwrite', (s) => s.delete(KEY));
    db.close();
  } catch { /* nothing to clear */ }
}

/** Stores a volatile tab's fonts for document `id` (`docScope.keepAsNewDocument`). */
export async function keepEmbeddedFonts(id: string): Promise<void> {
  if (!held.length || typeof indexedDB === 'undefined') return;
  try {
    const db = await openDb(keyOf(id, 'edentext-fonts'), STORE);
    await request(db, 'readwrite', (s) => s.put(held, KEY));
    db.close();
  } catch { /* the text keeps its fallback face */ }
}
