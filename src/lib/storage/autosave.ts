import { t } from '../i18n/i18n.svelte';
import { formatMoment } from './dateFormat.svelte';
import { stashImages, putImages, restoreImages, isStored, withHeldImages } from './imageStore';
import { keepSnapshot, listSnapshots, readSnapshot } from './snapshots';
import { docKey, docStore, volatile, otherDocumentsStored } from './docScope';
import type { Schema } from '@tiptap/pm/model';

const STORAGE_KEY = docKey('edentext-doc');
// Set while a stored document is being handed to the editor, cleared once the editor
// has actually come up (markDocumentLoaded). Finding it still set at load time means
// the last attempt hung or threw — reloading would only freeze again.
const BOOT_KEY = docKey('edentext-doc-loading');
// Where such a document is parked instead of being loaded, so nothing is lost and
// it can still be pulled out of docStore.
const BROKEN_KEY = docKey('edentext-doc-broken');
const DEBOUNCE_MS = 1000;

let timeout: ReturnType<typeof setTimeout> | null = null;
// Hands out the document as last handed in, until it is written. A function, so a
// long document is serialized once per write, not once per keystroke.
let pending: (() => object) | null = null;
// Writes queue behind each other: an older write finishing after a newer one would
// store the older document and sweep the pictures the newer one just added.
let chain: Promise<void> = Promise.resolve();
// localStorage has a ~5 MB quota, which a long enough text alone exceeds. Warn
// the user once so a failed autosave isn't silent, and swallow the throw so the
// debounced timer doesn't surface an unhandled error.
let quotaWarned = false;

type DocJson = { type?: string; attrs?: Record<string, unknown>; marks?: DocJson[]; content?: DocJson[] } & Record<string, unknown>;

/**
 * The document without the attributes that hold their schema default: a paragraph
 * spells out some thirty, mostly null, and loading fills each one back in.
 */
export function withoutDefaults(json: DocJson, schema: Schema): DocJson {
  const trim = (n: DocJson, spec: Record<string, { default?: unknown }> | undefined): DocJson => {
    const out: DocJson = { ...n };
    if (n.attrs && spec) {
      const attrs = Object.fromEntries(Object.entries(n.attrs).filter(([k, v]) => !(k in spec && spec[k].default === v)));
      if (Object.keys(attrs).length) out.attrs = attrs;
      else delete out.attrs;
    }
    if (n.marks) out.marks = n.marks.map((m) => trim(m, schema.marks[m.type!]?.spec.attrs));
    if (n.content) out.content = n.content.map((c) => trim(c, schema.nodes[c.type!]?.spec.attrs));
    return out;
  };
  return trim(json, schema.nodes[json.type!]?.spec.attrs);
}

// With nothing to be stored, there is nothing to write: no copy, no pictures, no versions.
export function saveDocument(json: () => object): void {
  if (volatile) return;
  pending = json;
  if (timeout) clearTimeout(timeout);
  timeout = setTimeout(() => { chain = chain.then(write); }, DEBOUNCE_MS);
}

async function write(): Promise<void> {
  const take = pending;
  if (!take) return;
  // A session's keys go back to their pictures, which no other tab could look up.
  const json = withHeldImages(take()).json;
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
  const json = withHeldImages(pending()).json;
  const { json: slim, blobs } = stashImages(json);
  void putImages(blobs);
  // A picture the store has not confirmed may never land before the tab dies (one just
  // imported), so it stays inline — unless that overflows the quota.
  if (!store(stashImages(json, isStored).json, false)) store(slim);
}

function store(json: object, warn = true): boolean {
  try {
    docStore.setItem(STORAGE_KEY, JSON.stringify(json));
    return true;
  } catch (err) {
    if (!warn) return false;
    warnStorageFull(STORAGE_KEY, err);
    return false;
  }
}

/**
 * One warning for every part of the document that did not fit. Where other documents
 * share the storage, deleting them is the way out, so the warning says where they are.
 */
export function warnStorageFull(key: string, err: unknown): void {
  console.error('[autosave] Could not save', key, err);
  if (quotaWarned) return;
  quotaWarned = true;
  alert(otherDocumentsStored() ? t().dialogs.autosaveQuotaOthers : t().dialogs.autosaveQuota);
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
    const when = formatMoment(at);
    if (!confirm(t().dialogs.openSnapshot(when))) continue;
    const doc = await readSnapshot(at);
    if (doc) return doc;
  }
  return null;
}

// `onLost`: the stored document was given up or unreadable, so the app starts empty and
// must drop that document's page setup, headers and styles along with it.
export async function loadDocument(onLost?: () => void): Promise<object | null> {
  const raw = docStore.getItem(STORAGE_KEY);
  if (docStore.getItem(BOOT_KEY)) {
    docStore.removeItem(BOOT_KEY);
    // The user decides: a reload that cut a slow start short is the usual cause, and
    // another try costs nothing a reload would not fix. Given up, the document is parked
    // and the versions the autosave kept aside are offered in its place.
    if (!raw || !confirm(t().dialogs.documentNotLoaded)) {
      if (raw) {
        docStore.setItem(BROKEN_KEY, raw);
        docStore.removeItem(STORAGE_KEY);
      }
      const rescued = await offerSnapshot();
      if (!rescued) {
        onLost?.();
        return null;
      }
      // Under the same flag as any other document: one that freezes the editor again
      // brings this question back instead of repeating the freeze.
      docStore.setItem(BOOT_KEY, '1');
      return rescued;
    }
  }
  if (!raw) return null;
  let doc: object;
  try {
    doc = JSON.parse(raw);
  } catch {
    onLost?.();
    return null;
  }
  docStore.setItem(BOOT_KEY, '1');
  const missing = await restoreImages(doc);
  if (missing) requestAnimationFrame(() => alert(t().dialogs.picturesNotRestored(missing)));
  return doc;
}

// Called once the editor is up and has laid out the document. Until then the boot
// flag stands, so a document that freezes the editor is skipped on the next load.
export function markDocumentLoaded(): void {
  docStore.removeItem(BOOT_KEY);
}

export function clearDocument(): void {
  docStore.removeItem(STORAGE_KEY);
}
