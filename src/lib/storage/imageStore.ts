import { openDb, idbRequest } from './idb';

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
function keyOf(src: string): string {
  const sample = src.length <= 8192 ? src : src.slice(0, 4096) + src.slice(-4096);
  let h = 0x811c9dc5;
  for (let i = 0; i < sample.length; i++) {
    h ^= sample.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}${src.length.toString(36)}`;
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
export function stashImages(json: object): { json: object; blobs: Map<string, string> } {
  const blobs = new Map<string, string>();
  const walk = (node: Json): Json => {
    const src = node?.attrs?.src;
    const content = node?.content?.map(walk);
    let attrs = node?.attrs;
    if (typeof src === 'string' && src.startsWith('data:') && src.length >= MIN_STASH_CHARS) {
      const key = keyOf(src);
      blobs.set(key, src);
      attrs = { ...attrs, src: IDB_SRC + key };
    }
    return content || attrs !== node?.attrs ? { ...node, ...(attrs ? { attrs } : {}), ...(content ? { content } : {}) } : node;
  };
  return { json: walk(json as Json), blobs };
}

// Whether this session has anything in the store. Without it a document whose last
// picture was just deleted would skip the sweep below and leave its bytes behind.
let inUse = false;

/** Write the pictures and drop every key the document no longer references. */
export async function putImages(blobs: Map<string, string>): Promise<boolean> {
  if (!blobs.size && !inUse) return true;
  if (typeof indexedDB === 'undefined') return false;
  inUse = blobs.size > 0;
  try {
    const db = await openDb(DB_NAME, STORE);
    const known = await idbRequest<IDBValidKey[]>(db, STORE, 'readonly', (s) => s.getAllKeys());
    for (const [key, src] of blobs) {
      if (!known.includes(key)) await idbRequest(db, STORE, 'readwrite', (s) => s.put(src, key));
    }
    for (const key of known) {
      if (!blobs.has(String(key))) await idbRequest(db, STORE, 'readwrite', (s) => s.delete(key));
    }
    db.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Put the pictures back. Returns how many keys the store no longer had — their nodes
 * keep the key as their `src`, which renders as a broken picture rather than quietly
 * dropping the reader's content.
 */
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
      if (src) node.attrs!.src = src;
      else missing++;
    }
    db.close();
  } catch {
    return nodes.length;
  }
  return missing;
}
