import { openDb, idbRequest } from './idb';

// The files this browser has opened or saved, most recent first. The name and time
// go in localStorage so the menu can be drawn synchronously; the FileSystemFileHandle
// that actually reopens one is structured-cloneable but not JSON, so it lives in
// IndexedDB beside it. A browser without the File System Access API keeps the names
// only — there is nothing to reopen from, and the entry says so.
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
 * Record a file as just used. A handle already in the list keeps its id — the same
 * file opened twice is one entry, moved to the top — and one without a handle is
 * matched on its name, which is all a browser with no picker gives us.
 */
export async function rememberRecentFile(name: string, handle: FileSystemFileHandle | null): Promise<RecentFile[]> {
  const list = loadRecentFiles();
  const existing = handle ? await findByHandle(list, handle) : list.find((f) => f.name === name);
  const id = existing?.id ?? `f${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const next = [{ id, name, at: Date.now() }, ...list.filter((f) => f.id !== id)].slice(0, MAX);
  write(next);
  if (handle) await putHandle(id, handle);
  await sweepHandles(next);
  return next;
}

export function forgetRecentFiles(): void {
  write([]);
  void sweepHandles([]);
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
 * The bytes of a recent file, or null when it can't be reopened — the browser has no
 * handle for it, the file is gone, or the user declined the permission prompt the
 * File System Access API requires after a reload.
 */
export async function readRecentFile(id: string): Promise<{ bytes: Uint8Array; handle: FileSystemFileHandle; name: string } | null> {
  const handle = await getHandle(id);
  if (!handle) return null;
  type Permissioned = FileSystemFileHandle & {
    queryPermission?: (d: { mode: string }) => Promise<PermissionState>;
    requestPermission?: (d: { mode: string }) => Promise<PermissionState>;
  };
  const h = handle as Permissioned;
  let state = (await h.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
  if (state === 'prompt') state = (await h.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
  if (state !== 'granted') return null;
  const file = await handle.getFile();
  return { bytes: new Uint8Array(await file.arrayBuffer()), handle, name: file.name };
}
