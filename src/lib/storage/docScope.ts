import { sweepImages } from './imageStore';
import { embedded } from '../embed/mode';

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
// Which tabs are open comes from a Web Lock each one holds on its document, which the
// browser drops with the tab however it ends. Without Web Locks (an insecure origin) a
// marker is taken as abandoned well past the minute a hidden tab's timers are throttled to.
const LOCK = 'edentext-doc@';
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
 * The document a fresh tab opens: a new one, as a word processor starts on an empty
 * page; the earlier ones are offered, not opened. The empty id is the first document —
 * a browser that has never run this editor has no marker at all.
 */
export function pickSlot(marks: Record<string, number>, now: number): string {
  if (!Object.keys(marks).length) return '';
  let id: string;
  do id = `d${now.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`; while (id in marks);
  return id;
}

function mark(id: string, at: number): void {
  if (volatile) return;
  try {
    localStorage.setItem(LIVE + id, String(at));
  } catch { /* a full localStorage costs the marker, not the document */ }
}

function resolve(): string {
  // An embedded editor keeps nothing, so it claims no slot among the app's own documents.
  if (embedded) return '';
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

// Whether documents stay in this browser (app-wide): absent = kept, `'0'` = those no tab
// holds are dropped at the next start, `'none'` = never written at all. A password-protected
// document is dropped like `'0'`, since its copy here is unencrypted.
const KEEP_KEY = 'edentext-keep-documents';
export type Retention = 'keep' | 'closed' | 'none';

export function loadRetention(): Retention {
  const v = localStorage.getItem(KEEP_KEY);
  return v === 'none' ? 'none' : v === '0' ? 'closed' : 'keep';
}

export function saveRetention(r: Retention): void {
  if (r === 'keep') localStorage.removeItem(KEEP_KEY);
  else localStorage.setItem(KEEP_KEY, r === 'none' ? 'none' : '0');
}

// Read once: the open document already sits in localStorage, so `'none'` takes effect
// at the next start, when the prune drops this tab's own copy too. Embedded, the host
// application holds the document, so none is kept here either.
export const volatile = embedded || (() => { try { return loadRetention() === 'none'; } catch { return false; } })();

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
}

/** Where this tab's document keys live: localStorage, or the page's memory when `volatile`. */
export const docStore: Storage = volatile ? memoryStorage() : localStorage;

export const docId = resolve();

// Every scoped name, gathered as the storage modules resolve their keys at load: the
// first document's keys carry no id, so this is the only way to find them all.
const scopedNames = new Set<string>();

/** The key this tab's document keeps `name` under. */
export function docKey(name: string): string {
  scopedNames.add(name);
  return docId === '' ? name : `${name}@${docId}`;
}

/** Keep this tab's marker fresh, and sign it off when the tab goes away; `mark` writes none when `volatile`. */
export function startTabPresence(): void {
  navigator.locks?.request(LOCK + docId, () => new Promise<never>(() => {})).catch(() => {});
  setInterval(() => mark(docId, Date.now()), BEAT_MS);
  addEventListener('pagehide', () => mark(docId, -Date.now()));
  // A page revived from the back/forward cache is holding its document again.
  addEventListener('pageshow', () => mark(docId, Date.now()));
}

function dropDocument(id: string): void {
  const suffix = id && `@${id}`;
  const keys: string[] = id ? [] : [...scopedNames];
  for (let i = 0; id && i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.endsWith(suffix)) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);
  // Its pictures are swept the next time any document saves — the store is shared.
  if (typeof indexedDB === 'undefined') return;
  indexedDB.deleteDatabase(`edentext-snapshots${suffix}`);
  indexedDB.deleteDatabase(`edentext-fonts${suffix}`);
}

// Whether another tab holds `id`: its lock where the browser has them, else its marker.
async function heldBy(): Promise<(id: string, at: number) => boolean> {
  const now = Date.now();
  if (typeof navigator === 'undefined' || !navigator.locks) return (_, at) => at > 0 && now - at <= STALE_MS;
  const { held = [] } = await navigator.locks.query();
  const ids = new Set(held.map((l) => l.name?.startsWith(LOCK) && l.name.slice(LOCK.length)));
  return (id) => ids.has(id);
}

// The start's prune, which listing waits for so it never offers a document being dropped.
let pruning: Promise<void> = Promise.resolve();

/**
 * Drop every document no tab holds that is not to be kept, and every empty one — each
 * fresh tab mints one — then keep the newest MAX_DOCS. A held document is never
 * dropped, however old; neither is the first one for its age.
 */
export function pruneOldDocuments(): Promise<void> {
  return (pruning = prune());
}

async function prune(): Promise<void> {
  const isHeld = await heldBy();
  let docs = Object.entries(markers()).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const drop = (id: string) => { dropDocument(id); localStorage.removeItem(LIVE + id); };
  // A reload keeps its own document, since the tab's id survives in sessionStorage —
  // unless nothing is to be stored, where the copy from before the switch goes too.
  if (volatile && !docs.some(([id]) => id === docId)) docs.push([docId, 0]);
  const keep = loadRetention() === 'keep';
  const forget = docs.filter(([id, at]) => (id === docId ? volatile : !isHeld(id, at)
    && (!keep || localStorage.getItem(keyOf(id, 'edentext-doc-protected')) === '1')));
  for (const [id] of forget) drop(id);
  // Their pictures go now, not at the next save that happens to have pictures of its own.
  if (forget.length) await sweepImages();
  docs = Object.entries(markers()).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  for (const [id, at] of docs) if (id !== docId && !isHeld(id, at) && isEmpty(id)) drop(id);
  docs = Object.entries(markers()).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  for (const [id, at] of docs.slice(MAX_DOCS)) if (id !== '' && id !== docId && !isHeld(id, at)) drop(id);
}

export interface BrowserDocument {
  id: string;
  /** Last used, epoch ms. */
  at: number;
  /** Open in this tab. */
  mine: boolean;
  /** Held by another live tab. */
  held: boolean;
  /** The name the user gave it, else the start of its text; empty for an empty one. */
  label: string;
}

function firstText(node: { text?: string; marks?: { type?: string }[]; content?: unknown[] }): string {
  if (node.text?.trim() && !node.marks?.some((m) => m.type === 'deletion')) return node.text.trim();
  for (const child of node.content ?? []) {
    const text = firstText(child as typeof node);
    if (text) return text;
  }
  return '';
}

const keyOf = (id: string, name: string) => (id === '' ? name : `${name}@${id}`);

type Json = { type?: string; content?: Json[] };

function storedDoc(id: string): Json | null {
  try {
    return JSON.parse(localStorage.getItem(keyOf(id, 'edentext-doc')) ?? 'null');
  } catch {
    return null;
  }
}

// `saveHfDoc` removes an empty zone's key, so any zone key left is content.
const ZONE_KEYS = ['header', 'header-first', 'header-even', 'footer', 'footer-first', 'footer-even', 'hf-sections']
  .map((z) => `edentext-${z}`);

// Nothing in the body but the lone empty paragraph a new document is, and no zone.
function isEmpty(id: string): boolean {
  const c = storedDoc(id)?.content ?? [];
  const bodyEmpty = c.length === 0 || (c.length === 1 && c[0].type === 'paragraph' && !c[0].content?.length);
  return bodyEmpty && ZONE_KEYS.every((k) => localStorage.getItem(keyOf(id, k)) === null);
}

function labelOf(id: string): string {
  const name = localStorage.getItem(keyOf(id, 'edentext-doc-name'))?.trim();
  return name || firstText(storedDoc(id) ?? {}).slice(0, 80);
}

/** Whether this browser keeps a document besides this tab's. */
export function otherDocumentsStored(): boolean {
  return Object.keys(markers()).some((id) => id !== docId && storedDoc(id) !== null);
}

/** Every document this browser keeps, most recently used first; an empty one only while open. */
export async function listDocuments(): Promise<BrowserDocument[]> {
  await pruning;
  const isHeld = await heldBy();
  return Object.entries(markers())
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([id, at]) => ({
      id,
      at: Math.abs(at),
      mine: id === docId,
      held: id !== docId && isHeld(id, at),
      label: labelOf(id),
    }))
    .filter((d) => d.mine || d.held || !isEmpty(d.id));
}

/** Switch this tab to another document; the reload's pagehide saves and releases this one. */
export function openDocument(id: string): void {
  sessionStorage.setItem(TAB_KEY, id);
  location.reload();
}

/** Delete a document no tab holds, the first one included. */
export async function deleteDocument(id: string): Promise<void> {
  const doc = (await listDocuments()).find((d) => d.id === id);
  if (!doc || doc.mine || doc.held) return;
  dropDocument(id);
  localStorage.removeItem(LIVE + id);
}
