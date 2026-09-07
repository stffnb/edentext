// Which document this tab edits. Every document-scoped key hangs off the id, so two
// tabs never write over each other; the first document keeps the empty id, and with it
// the bare key names every earlier version wrote.

// Duplicating a tab copies its sessionStorage, so the copy lands on the same document.
// ponytail: telling a duplicate from a reload needs the navigation type — worth
// measuring per browser before anything relies on it.
const TAB_KEY = 'edentext-tab-doc';
// One marker per document: epoch ms while a tab holds it, the same stamp negated once
// the tab lets go. Only ever written by the tab that holds it, so no two tabs race over
// one key, and the stamp doubles as "when was this document last used".
const LIVE = 'edentext-live@';
// A hidden tab's timers are throttled to about a minute, so a marker is only abandoned
// well past that.
const BEAT_MS = 60_000;
const STALE_MS = 10 * 60_000;
const MAX_DOCS = 10;

function markers(): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(LIVE)) continue;
    const at = Number(localStorage.getItem(key));
    if (at) out[key.slice(LIVE.length)] = at;
  }
  return out;
}

/**
 * The document a fresh tab opens: the one used last that no live tab holds, else a new
 * one. The empty id is the first document — a browser that has never run this editor
 * has no marker at all, and so does one that ran every earlier version.
 */
export function pickSlot(marks: Record<string, number>, now: number): string {
  const free = Object.entries(marks)
    .filter(([, at]) => at < 0 || now - at > STALE_MS)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  if (free) return free[0];
  if (!Object.keys(marks).length) return '';
  return `d${now.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

function mark(id: string, at: number): void {
  try {
    localStorage.setItem(LIVE + id, String(at));
  } catch { /* a full localStorage costs the marker, not the document */ }
}

function resolve(): string {
  try {
    // The tab's own slot, unconditionally: after a reload — or a crash — it has to get
    // its document back, and nothing but this tab knows which one that was.
    const mine = sessionStorage.getItem(TAB_KEY);
    const id = mine ?? pickSlot(markers(), Date.now());
    if (mine === null) sessionStorage.setItem(TAB_KEY, id);
    // Claimed here rather than from main.ts: the storage modules read their keys while
    // the import graph is walked, long before the first statement of main.ts runs.
    mark(id, Date.now());
    return id;
  } catch {
    return '';
  }
}

export const docId = resolve();

/** The key this tab's document keeps `name` under. */
export function docKey(name: string): string {
  return docId === '' ? name : `${name}@${docId}`;
}

/** Keep this tab's marker fresh, and sign it off when the tab goes away. */
export function startTabPresence(): void {
  setInterval(() => mark(docId, Date.now()), BEAT_MS);
  addEventListener('pagehide', () => mark(docId, -Date.now()));
  // A page revived from the back/forward cache is holding its document again.
  addEventListener('pageshow', () => mark(docId, Date.now()));
}

function dropDocument(id: string): void {
  const suffix = `@${id}`;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.endsWith(suffix)) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);
  // Its pictures are swept the next time any document saves — the store is shared.
  if (typeof indexedDB === 'undefined') return;
  indexedDB.deleteDatabase(`edentext-snapshots${suffix}`);
  indexedDB.deleteDatabase(`edentext-fonts${suffix}`);
}

/**
 * Keep the newest MAX_DOCS documents. A document a tab still holds is never dropped,
 * however old it is, and neither is the first one: its keys carry no id to sweep by.
 */
export function pruneOldDocuments(): void {
  const now = Date.now();
  const old = Object.entries(markers())
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(MAX_DOCS);
  for (const [id, at] of old) {
    if (id === '' || (at > 0 && now - at <= STALE_MS)) continue;
    dropDocument(id);
    localStorage.removeItem(LIVE + id);
  }
}
