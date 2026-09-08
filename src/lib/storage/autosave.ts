import { t, locale } from '../i18n/i18n.svelte';
import { stashImages, putImages, restoreImages } from './imageStore';
import { keepSnapshot, listSnapshots, readSnapshot } from './snapshots';
import { docKey } from './docScope';

const STORAGE_KEY = docKey('edentext-doc');
// Set while a stored document is being handed to the editor, cleared once the editor
// has actually come up (markDocumentLoaded). Finding it still set at load time means
// the last attempt hung or threw — reloading would only freeze again.
const BOOT_KEY = docKey('edentext-doc-loading');
// Where such a document is parked instead of being loaded, so nothing is lost and
// it can still be pulled out of localStorage.
const BROKEN_KEY = docKey('edentext-doc-broken');
const DEBOUNCE_MS = 1000;

let timeout: ReturnType<typeof setTimeout> | null = null;
// Hands out the document as last handed in, until it is written. A function, so a
// long document is serialized once per write, not once per keystroke.
let pending: (() => object) | null = null;
// Writes queue behind each other: an older write finishing after a newer one would
// store the older document and sweep the pictures the newer one just added.
let chain: Promise<void> = Promise.resolve();
// localStorage has a ~5 MB quota; embedded images (data-URIs) can exceed it. Warn
// the user once so a failed autosave isn't silent, and swallow the throw so the
// debounced timer doesn't surface an unhandled error.
let quotaWarned = false;

export function saveDocument(json: () => object): void {
  pending = json;
  if (timeout) clearTimeout(timeout);
  timeout = setTimeout(() => { chain = chain.then(write); }, DEBOUNCE_MS);
}

async function write(): Promise<void> {
  const take = pending;
  if (!take) return;
  const json = take();
  // Pictures go to IndexedDB and the JSON keeps a key; where that fails they stay
  // inline, which is the only thing localStorage ever held.
  const { json: slim, blobs } = stashImages(json);
  const stashed = await putImages(blobs);
  store(stashed ? slim : json);
  // Every few minutes one version is kept whole, pictures included — the store the
  // localStorage copy is swept against holds only what the open document still uses.
  void keepSnapshot(json);
  // Pending until stored, so a flush during the round trip still has it; a newer
  // document handed in meanwhile stays pending for the write queued behind.
  if (pending === take) pending = null;
}

// The tab is going away: no time for the IndexedDB round trip, so the JSON goes out
// at once and the pictures follow — an earlier save already holds all but the newest.
// Timer and pending stay, so a page revived from the back/forward cache writes again.
export function flushDocument(): void {
  if (!pending) return;
  const { json: slim, blobs } = stashImages(pending());
  void putImages(blobs);
  store(slim);
}

function store(json: object): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
  } catch (err) {
    console.error('[autosave] Could not save the document:', err);
    if (!quotaWarned) {
      quotaWarned = true;
      alert(t().dialogs.autosaveQuota);
    }
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDocument(); });
  addEventListener('pagehide', flushDocument);
}

// A document that cannot be loaded is the one place the kept versions are offered:
// nothing in the UI points at them, so this is where a reader meets them. Newest first,
// one question each — the newest may be the one that broke.
async function offerSnapshot(): Promise<object | null> {
  for (const at of await listSnapshots()) {
    const when = new Date(at).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' });
    if (!confirm(t().dialogs.openSnapshot(when))) continue;
    const doc = await readSnapshot(at);
    if (doc) return doc;
  }
  return null;
}

export async function loadDocument(): Promise<object | null> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (localStorage.getItem(BOOT_KEY)) {
    localStorage.removeItem(BOOT_KEY);
    // The user decides: a reload that cut a slow start short is the usual cause, and
    // another try costs nothing a reload would not fix. Given up, the document is parked
    // and the versions the autosave kept aside are offered in its place.
    if (!raw || !confirm(t().dialogs.documentNotLoaded)) {
      if (raw) {
        localStorage.setItem(BROKEN_KEY, raw);
        localStorage.removeItem(STORAGE_KEY);
      }
      const rescued = await offerSnapshot();
      if (!rescued) return null;
      // Under the same flag as any other document: one that freezes the editor again
      // brings this question back instead of repeating the freeze.
      localStorage.setItem(BOOT_KEY, '1');
      return rescued;
    }
  }
  if (!raw) return null;
  let doc: object;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  localStorage.setItem(BOOT_KEY, '1');
  const missing = await restoreImages(doc);
  if (missing) requestAnimationFrame(() => alert(t().dialogs.picturesNotRestored(missing)));
  return doc;
}

// Called once the editor is up and has laid out the document. Until then the boot
// flag stands, so a document that freezes the editor is skipped on the next load.
export function markDocumentLoaded(): void {
  localStorage.removeItem(BOOT_KEY);
}

export function clearDocument(): void {
  localStorage.removeItem(STORAGE_KEY);
}
