import { openDb, idbRequest } from './idb';
import { fnv1a } from '../utils/hash';

// The document's pictures, out of the autosaved JSON and into IndexedDB. localStorage's
// ~5 MB quota is a handful of photos, and a document that exceeds it stops saving; the
// JSON keeps a short key in each `src` instead, and only that is small enough to fit.
// Where IndexedDB is unavailable the data-URIs stay inline, exactly as they were.
const DB_NAME = 'edentext-images';
const STORE = 'images';
export const IDB_SRC = 'idb:';

// Below this a picture is an icon, and one round trip through IndexedDB costs more
// than the bytes save.
const MIN_STASH_CHARS = 4096;

// Content key: FNV-1a over the head, the tail and the length, not the whole data-URI —
// a photo is megabytes, and this runs on every autosave. Two different pictures
// agreeing on all three is not something a document produces.
export function keyOf(src: string): string {
  const sample = src.length <= 8192 ? src : src.slice(0, 4096) + src.slice(-4096);
  return `${fnv1a(sample).toString(36)}${src.length.toString(36)}`;
}

type Json = { attrs?: Record<string, unknown>; content?: Json[] } & Record<string, unknown>;

// Every node with a `src`, in document order. Images ride paragraphs, cells and text
// boxes alike, so the walk is over the whole tree rather than a known depth.
function srcNodes(node: Json, out: Json[] = []): Json[] {
  if (typeof node?.attrs?.src === 'string') out.push(node);
  for (const child of node?.content ?? []) srcNodes(child, out);
  return out;
}

/**
 * The document with its large pictures replaced by `idb:` keys, plus those pictures.
 * A structural copy: only the nodes on the path to a picture are rebuilt, so the
 * caller's JSON is untouched.
 */
export function stashImages(json: object, stash: (key: string) => boolean = () => true): { json: object; blobs: Map<string, string> } {
  const blobs = new Map<string, string>();
  const walk = (node: Json): Json => {
    const src = node?.attrs?.src;
    const content = node?.content?.map(walk);
    let attrs = node?.attrs;
    if (typeof src === 'string' && src.startsWith('data:') && src.length >= MIN_STASH_CHARS) {
      const key = keyOf(src);
      if (stash(key)) {
        blobs.set(key, src);
        attrs = { ...attrs, src: IDB_SRC + key };
      }
    }
    return content || attrs !== node?.attrs ? { ...node, ...(attrs ? { attrs } : {}), ...(content ? { content } : {}) } : node;
  };
  return { json: walk(json as Json), blobs };
}

// Keys this session has seen the store hold — the ones a JSON may name even when the
// tab dies before the next write lands.
const confirmed = new Set<string>();
export const isStored = (key: string): boolean => confirmed.has(key);

// Whether this session has anything in the store. Without it a document whose last
// picture was just deleted would skip the sweep below and leave its bytes behind.
let inUse = false;

// The store is shared across this browser's documents, so a key may only go when no
// stored document names it any more. A list per document would go stale for every one
// no tab has opened since; ponytail: a regex over localStorage on each debounced save.
function referenced(): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < localStorage.length; i++) {
    const raw = localStorage.getItem(localStorage.key(i)!) ?? '';
    for (const [, key] of raw.matchAll(/idb:([a-z0-9]+)/g)) out.add(key);
  }
  return out;
}

// Keys a header or footer put this session: its JSON names them only once the write
// lands, so a sweep in between would take them. The next session's sweep can.
const pinned = new Set<string>();

/**
 * Write the pictures and, with `sweep`, drop every key no document references any more.
 */
export async function putImages(blobs: Map<string, string>, sweep = true): Promise<boolean> {
  if (!blobs.size && !inUse) return true;
  if (typeof indexedDB === 'undefined') return false;
  inUse = blobs.size > 0;
  try {
    const db = await openDb(DB_NAME, STORE);
    const known = await idbRequest<IDBValidKey[]>(db, STORE, 'readonly', (s) => s.getAllKeys());
    for (const [key, src] of blobs) {
      if (!known.includes(key)) await idbRequest(db, STORE, 'readwrite', (s) => s.put(src, key));
      confirmed.add(key);
      if (!sweep) pinned.add(key);
    }
    if (!sweep) { db.close(); return true; }
    // Not from the stored copy yet, so the sweeper's own pictures come from `blobs`.
    const live = referenced();
    for (const key of known) {
      if (blobs.has(String(key)) || live.has(String(key)) || pinned.has(String(key))) continue;
      confirmed.delete(String(key));
      await idbRequest(db, STORE, 'readwrite', (s) => s.delete(key));
    }
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** Drop every key no document references, as after deleting documents. */
export function sweepImages(): Promise<boolean> {
  inUse = true;
  return putImages(new Map());
}

/**
 * Put the pictures back. Returns how many keys the store no longer had — their nodes
 * keep the key as their `src`, which renders as a broken picture rather than quietly
 * dropping the reader's content.
 */
// Pictures a shared session holds (`collab/pictures.ts`): there the document names each
// large one by its key, `idb:<key>`, and the bytes travel beside it, once per client.
const held = new Map<string, string>();
const waiting = new Map<string, Set<() => void>>();
let wanted: ((key: string) => void) | null = null;
// Where each awaited picture shows, so a session asks for those nearest the viewport first.
const places = new Map<string, Set<Element>>();
let waits = 0;
let told: ((waiting: boolean) => void) | null = null;

/** The key a session holds this data-URI under, or null when it is small enough to stay inline. */
export const imageKey = (src: unknown): string | null =>
  typeof src === 'string' && src.startsWith('data:') && src.length >= MIN_STASH_CHARS ? keyOf(src) : null;

/**
 * `value` with each `src` swapped by `fn`, copied only along what changed. Walks arrays and
 * plain objects (a store's value, a document's JSON), never bytes or class instances.
 */
export function mapSrcs(value: unknown, fn: (src: string) => string): unknown {
  if (Array.isArray(value)) {
    const out = value.map((v) => mapSrcs(v, fn));
    return out.some((v, i) => v !== value[i]) ? out : value;
  }
  // Node attributes have no prototype at all.
  const proto = value && typeof value === 'object' ? Object.getPrototypeOf(value) : undefined;
  if (proto !== Object.prototype && proto !== null) return value;
  let out: Record<string, unknown> | null = null;
  for (const [k, v] of Object.entries(value as object)) {
    const next = k === 'src' && typeof v === 'string' ? fn(v) : mapSrcs(v, fn);
    if (next !== v) (out ??= { ...value as Record<string, unknown> })[k] = next;
  }
  return out ?? value;
}

/** Holds a picture; true when it is new here. Whoever waits for it is told. */
export function holdImage(key: string, src: string): boolean {
  if (held.has(key)) return false;
  held.set(key, src);
  places.delete(key);
  for (const fn of waiting.get(key) ?? []) fn();
  waiting.delete(key);
  return true;
}
export const heldImage = (key: string): string | undefined => held.get(key);

/** What a `src` shows: the held picture for a session key, anything else as it is. */
export function shownSrc(src: unknown): string {
  const s = typeof src === 'string' ? src : '';
  return (s.startsWith(IDB_SRC) && held.get(s.slice(IDB_SRC.length))) || s;
}

/** Calls `fn` once a key's picture arrives and asks the session for it; `at` shows it meanwhile. Returns the unsubscribe. */
export function awaitImage(key: string, fn: () => void, at?: Element): () => void {
  const set = waiting.get(key) ?? new Set();
  waiting.set(key, set.add(fn));
  if (at) places.set(key, (places.get(key) ?? new Set()).add(at));
  wanted?.(key);
  return () => { set.delete(fn); if (at) places.get(key)?.delete(at); };
}

/** How far in px the nearest place showing a key's awaited picture is from the viewport; Infinity when none shows. */
export function distanceOf(key: string): number {
  let best = Infinity;
  for (const el of places.get(key) ?? []) {
    const r = el.getBoundingClientRect();
    if (!el.isConnected || (!r.width && !r.height)) continue;
    best = Math.min(best, r.bottom < 0 ? -r.bottom : r.top > innerHeight ? r.top - innerHeight : 0);
  }
  return best;
}

/** The session keys in `value` no one here holds yet, each asked for. */
export function lackedKeys(value: unknown): string[] {
  const keys = new Set<string>();
  if (wanted) mapSrcs(value, (src) => {
    const key = src.startsWith(IDB_SRC) ? src.slice(IDB_SRC.length) : '';
    if (key && !held.has(key)) keys.add(key);
    return src;
  });
  for (const key of keys) wanted?.(key);
  return [...keys];
}

/** Who shows that something waits for pictures (`untilHeld`). */
export function showWaitingWith(fn: ((waiting: boolean) => void) | null): void { told = fn; }

/** Resolves true once every key is held, false when `lost` says one cannot come or the session ends. */
export async function untilHeld(keys: string[], lost: () => boolean): Promise<boolean> {
  if (keys.every((k) => held.has(k))) return true;
  if (!waits++) told?.(true);
  try {
    while (keys.some((k) => !held.has(k))) {
      if (!wanted || lost()) return false;
      await new Promise((ok) => setTimeout(ok, 200));
    }
    return true;
  } finally {
    if (!--waits) told?.(false);
  }
}

/** The session that fetches missing pictures, or null; null also lets go of every held one. */
export function fetchImagesWith(fn: ((key: string) => void) | null): void {
  wanted = fn;
  if (!fn) held.clear();
}

/**
 * The document with every held session key back as its picture, for whatever leaves the
 * editor (a file, autosave). `missing` counts the keys no one here holds.
 */
export function withHeldImages<T extends object>(json: T): { json: T; missing: number } {
  let missing = 0;
  if (!held.size && !wanted) return { json, missing };
  const walk = (node: Json): Json => {
    const src = node?.attrs?.src;
    const content = node?.content?.map(walk);
    let attrs = node?.attrs;
    if (typeof src === 'string' && src.startsWith(IDB_SRC)) {
      const data = held.get(src.slice(IDB_SRC.length));
      if (data) attrs = { ...attrs, src: data };
      else missing++;
    }
    return content || attrs !== node?.attrs ? { ...node, ...(attrs ? { attrs } : {}), ...(content ? { content } : {}) } : node;
  };
  return { json: walk(json as unknown as Json) as unknown as T, missing };
}

export async function restoreImages(json: object): Promise<number> {
  const nodes = srcNodes(json as Json).filter((n) => String(n.attrs!.src).startsWith(IDB_SRC));
  if (!nodes.length) return 0;
  inUse = true;
  if (typeof indexedDB === 'undefined') return nodes.length;
  let missing = 0;
  try {
    const db = await openDb(DB_NAME, STORE);
    for (const node of nodes) {
      const key = String(node.attrs!.src).slice(IDB_SRC.length);
      const src = await idbRequest<string | undefined>(db, STORE, 'readonly', (s) => s.get(key));
      if (src) {
        node.attrs!.src = src;
        confirmed.add(key);
      } else missing++;
    }
    db.close();
  } catch {
    return nodes.length;
  }
  return missing;
}
