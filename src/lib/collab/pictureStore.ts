import { idbRequest, openDb } from '../storage/idb';

// A joiner's or reader's session pictures in IndexedDB, under the room and their content key,
// so a reload takes them from here instead of the wire (docs/architecture/collab-pictures.md).
// Leaving drops the room's; any older than KEEP_MS go on app start, the oldest past MAX_CHARS.
const DB = 'edentext-session-pictures';
const STORE = 'pictures';
const KEEP_MS = 3 * 24 * 3600_000;
const MAX_CHARS = 300 * 2 ** 20;
const WAIT_MS = 3000;

// Each entry's id says all the sweeps need, so they read the ids alone, never the pictures.
type Entry = { id: string; room: string; key: string; at: number; size: number };
const idOf = (room: string, key: string, at: number, size: number) => `${room} ${key} ${at.toString(36)} ${size.toString(36)}`;
function parse(id: IDBValidKey): Entry | null {
  const [room, key, at, size] = String(id).split(' ');
  return size ? { id: String(id), room, key, at: parseInt(at, 36), size: parseInt(size, 36) } : null;
}
const usable = () => typeof indexedDB !== 'undefined';
const entries = async (db: IDBDatabase) => (await idbRequest<IDBValidKey[]>(db, STORE, 'readonly', (s) => s.getAllKeys())).map(parse).filter((e): e is Entry => !!e);

/** Drops the pictures of sessions no tab left properly, KEEP_MS after they were stored. */
export async function sweepSessionPictures(now = Date.now()): Promise<void> {
  if (!usable()) return;
  try {
    const db = await openDb(DB, STORE);
    for (const e of await entries(db)) if (now - e.at > KEEP_MS) await idbRequest(db, STORE, 'readwrite', (s) => s.delete(e.id));
    db.close();
  } catch { /* no storage: nothing kept */ }
}

export type PictureStore = {
  /** The data-URI stored under the key, unchecked; undefined when none is. */
  get(key: string): Promise<string | undefined>;
  put(key: string, src: string): void;
  /** Drops the room's pictures; resolves once they are gone. */
  clear(): Promise<void>;
};

/** The room's store, a no-op without IndexedDB. */
export function pictureStore(room: string): PictureStore {
  // One connection and a queue, so a clear follows every put before it.
  let chain: Promise<unknown> = Promise.resolve();
  const db = usable() ? openDb(DB, STORE).catch(() => null) : Promise.resolve(null);
  const all: Promise<Entry[]> = db.then(async (d) => (d ? entries(d) : [])).catch(() => []);
  const mine = all.then((list) => new Map(list.filter((e) => e.room === room).map((e) => [e.key, e.id])));
  const run = (fn: (d: IDBDatabase) => Promise<unknown>) => (chain = chain.then(async () => {
    const d = await db;
    if (d) await fn(d);
  }).catch(() => {}));
  return {
    // A storage that does not answer within WAIT_MS sends the asker to the wire.
    get(key) {
      const read = (async () => {
        const d = await db, id = (await mine).get(key);
        return d && id ? await idbRequest<string | undefined>(d, STORE, 'readonly', (s) => s.get(id)) : undefined;
      })().catch(() => undefined);
      return Promise.race([read, new Promise<undefined>((ok) => setTimeout(ok, WAIT_MS))]);
    },
    put(key, src) {
      if (src.length > MAX_CHARS) return;
      void run(async (d) => {
        const [list, ids] = await Promise.all([all, mine]);
        if (ids.has(key)) return;
        const e = { id: idOf(room, key, Date.now(), src.length), room, key, at: Date.now(), size: src.length };
        let total = list.reduce((n, x) => n + x.size, e.size);
        list.sort((x, y) => x.at - y.at);
        while (total > MAX_CHARS && list.length) {
          const old = list.shift()!;
          total -= old.size;
          if (old.room === room) ids.delete(old.key);
          await idbRequest(d, STORE, 'readwrite', (s) => s.delete(old.id));
        }
        await idbRequest(d, STORE, 'readwrite', (s) => s.put(src, e.id));
        list.push(e);
        ids.set(key, e.id);
      });
    },
    async clear() {
      await run(async (d) => {
        await idbRequest(d, STORE, 'readwrite', (s) => s.delete(IDBKeyRange.bound(`${room} `, `${room} ￿`)));
        (await mine).clear();
        const list = await all;
        list.splice(0, list.length, ...list.filter((e) => e.room !== room));
      });
      (await db)?.close();
    },
  };
}
