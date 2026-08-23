import { openDb, idbRequest } from './idb';

// The files this browser can reopen, most recent first. Name and time go in
// localStorage so the menu draws synchronously; the FileSystemFileHandle that reopens
// one is structured-cloneable but not JSON, so it lives in IndexedDB beside it.
const KEY = 'edentext-recent-files';
const DB_NAME = 'edentext-recent';
const STORE = 'handles';
const MAX = 8;

export type RecentFile = {
  /** Stable within this browser: the id of its handle record. */
  id: string;
  name: string;
  /** Epoch ms of the last open or save. */
  at: number;
};

export function loadRecentFiles(): RecentFile[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((f) => f && typeof f.name === 'string') : [];
  } catch {
    return [];
  }
}

function write(list: RecentFile[]): void {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
  } catch { /* a full or blocked localStorage costs the list, not the save */ }
}

/**
 * Record a file as just used. Without a handle nothing can ever reopen the entry
 * (no File System Access API, or a template), so none is recorded. A handle already
 * in the list keeps its id — the same file opened twice is one entry, moved to the top.
 */
export async function rememberRecentFile(name: string, handle: FileSystemFileHandle | null): Promise<RecentFile[]> {
  const list = loadRecentFiles();
  if (!handle) return list;
  const existing = (await findByHandle(list, handle)) ?? list.find((f) => f.name === name);
  const id = existing?.id ?? `f${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const next = [{ id, name, at: Date.now() }, ...list.filter((f) => f.id !== id)].slice(0, MAX);
  write(next);
  await putHandle(id, handle);
  await sweepHandles(next);
  return next;
}

/** Drop one entry (a dead one, on a failed reopen) and its stored handle. */
export function forgetRecentFile(id: string): RecentFile[] {
  const next = loadRecentFiles().filter((f) => f.id !== id);
  write(next);
  void sweepHandles(next);
  return next;
}

export function forgetRecentFiles(): void {
  write([]);
  void sweepHandles([]);
}

/** Drop every entry with no stored handle — nothing can reopen those. Run at startup. */
export async function pruneRecentFiles(): Promise<RecentFile[]> {
  const list = loadRecentFiles();
  const kept: RecentFile[] = [];
  for (const f of list) if (await getHandle(f.id)) kept.push(f);
  if (kept.length !== list.length) write(kept);
  return kept;
}

// isSameEntry is the only way to compare two handles; it is async, so this walks.
async function findByHandle(list: RecentFile[], handle: FileSystemFileHandle): Promise<RecentFile | undefined> {
  for (const f of list) {
    const known = await getHandle(f.id);
    if (known && (await known.isSameEntry(handle))) return f;
  }
  return undefined;
}

async function putHandle(id: string, handle: FileSystemFileHandle): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openDb(DB_NAME, STORE);
    await idbRequest(db, STORE, 'readwrite', (s) => s.put(handle, id));
    db.close();
  } catch { /* no handle stored: the entry is then a name only */ }
}

export async function getHandle(id: string): Promise<FileSystemFileHandle | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openDb(DB_NAME, STORE);
    const handle = await idbRequest<FileSystemFileHandle | undefined>(db, STORE, 'readonly', (s) => s.get(id));
    db.close();
    return handle ?? null;
  } catch {
    return null;
  }
}

async function sweepHandles(list: RecentFile[]): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openDb(DB_NAME, STORE);
    const keys = await idbRequest<IDBValidKey[]>(db, STORE, 'readonly', (s) => s.getAllKeys());
    for (const key of keys) {
      if (!list.some((f) => f.id === String(key))) await idbRequest(db, STORE, 'readwrite', (s) => s.delete(key));
    }
    db.close();
  } catch { /* nothing to sweep */ }
}

/**
 * The bytes of a recent file. 'gone' = no handle, or the file no longer exists — the
 * entry is dead; 'denied' = read permission (re-asked after a reload) was not granted
 * this time — the entry stays. Opening needs only 'read'; Save re-prompts on its own.
 */
export async function readRecentFile(id: string): Promise<{ bytes: Uint8Array; handle: FileSystemFileHandle; name: string } | 'gone' | 'denied'> {
  const handle = await getHandle(id);
  if (!handle) return 'gone';
  type Permissioned = FileSystemFileHandle & {
    queryPermission?: (d: { mode: string }) => Promise<PermissionState>;
    requestPermission?: (d: { mode: string }) => Promise<PermissionState>;
  };
  const h = handle as Permissioned;
  let state = (await h.queryPermission?.({ mode: 'read' })) ?? 'granted';
  if (state === 'prompt') state = (await h.requestPermission?.({ mode: 'read' })) ?? 'denied';
  if (state !== 'granted') return 'denied';
  try {
    const file = await handle.getFile();
    return { bytes: new Uint8Array(await file.arrayBuffer()), handle, name: file.name };
  } catch (err) {
    if ((err as DOMException)?.name === 'NotFoundError') return 'gone';
    throw err;
  }
}
