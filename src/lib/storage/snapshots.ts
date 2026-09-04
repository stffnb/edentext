import { openDb, idbRequest } from './idb';

// Earlier versions of the autosaved document, in IndexedDB. The browser copy is one
// document deep: a bad edit, a failed load or a swept picture would otherwise take it
// with no way back. A snapshot holds the document's text — margins, styles and the
// header/footer belong to the open document and are left where they are.
const DB_NAME = 'edentext-snapshots';
const STORE = 'snapshots';
// Three is what a session is worth; each holds the pictures inline, unlike the
// localStorage copy, so the store pays for them.
const KEEP = 3;
const EVERY_MS = 5 * 60_000;

let lastAt = 0;

async function withDb<T>(run: (db: IDBDatabase) => Promise<T>): Promise<T | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openDb(DB_NAME, STORE);
    const out = await run(db);
    db.close();
    return out;
  } catch {
    return null;
  }
}

function keys(db: IDBDatabase): Promise<IDBValidKey[]> {
  return idbRequest<IDBValidKey[]>(db, STORE, 'readonly', (s) => s.getAllKeys());
}

/** Take one, at most every EVERY_MS, and drop everything past the newest KEEP. */
export async function keepSnapshot(json: object): Promise<void> {
  const at = Date.now();
  if (at - lastAt < EVERY_MS) return;
  lastAt = at;
  await withDb(async (db) => {
    await idbRequest(db, STORE, 'readwrite', (s) => s.put(json, at));
    const all = (await keys(db)).map(Number).sort((a, b) => b - a);
    for (const old of all.slice(KEEP)) await idbRequest(db, STORE, 'readwrite', (s) => s.delete(old));
  });
}

/** When each kept version was taken, newest first. */
export async function listSnapshots(): Promise<number[]> {
  return (await withDb(async (db) => (await keys(db)).map(Number).sort((a, b) => b - a))) ?? [];
}

export async function readSnapshot(at: number): Promise<object | null> {
  return withDb((db) => idbRequest<object | undefined>(db, STORE, 'readonly', (s) => s.get(at)))
    .then((doc) => doc ?? null);
}
