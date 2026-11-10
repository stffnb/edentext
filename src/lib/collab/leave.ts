import type { Editor } from '@tiptap/core';
import { withoutDefaults } from '../storage/autosave';
import { docStore, keepAsNewDocument } from '../storage/docScope';
import { keepEmbeddedFonts } from '../storage/embeddedFontStore';
import { putImages, stashImages } from '../storage/imageStore';

// Leaving a joined session (docs/architecture/collab.md, Storage). A joiner holds the
// document in memory only, so it either keeps it as a new document of this browser or
// drops it; both reload the tab without the link, which ends its volatile storage.

/** Set right before a reload the reader chose, so the unload warning stays out of it. */
export const unload = { quiet: false };

// Not a document's own: a broken or half-loaded copy, and the file a joiner never had.
const SKIP = new Set(['edentext-doc', 'edentext-doc-loading', 'edentext-doc-broken', 'edentext-doc-file']);

type Json = { type?: unknown; content?: unknown[] } & Record<string, unknown>;

// Pictures out of any stored zone (one zone, or the sections' sets of zones) into the image store.
function stashDeep(value: unknown, blobs: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((v) => stashDeep(v, blobs));
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray((value as Json).content)) {
    const { json, blobs: found } = stashImages(value);
    for (const [k, v] of found) blobs.set(k, v);
    return json;
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stashDeep(v, blobs)]));
}

/** Stores the open document, its stores, pictures and fonts as a new document for this tab. */
export async function keepSessionCopy(editor: Editor): Promise<boolean> {
  const values: [string, string][] = [['edentext-doc', JSON.stringify(withoutDefaults(editor.getJSON(), editor.schema))]];
  for (let i = 0; i < docStore.length; i++) {
    const name = docStore.key(i)!;
    if (!SKIP.has(name)) values.push([name, docStore.getItem(name)!]);
  }
  const blobs = new Map<string, string>();
  const slim = values.map(([name, raw]): [string, string] => {
    if (!raw.includes('data:')) return [name, raw];
    try { return [name, JSON.stringify(stashDeep(JSON.parse(raw), blobs))]; } catch { return [name, raw]; }
  });
  // Pinned, not swept: no stored document names them until the keys below are written.
  const stashed = !blobs.size || await putImages(blobs, false);
  const id = keepAsNewDocument(stashed ? slim : values);
  if (id === null) return false;
  await keepEmbeddedFonts(id);
  return true;
}

/** Reloads this tab without the session link: into the kept copy, or the tab's own document. */
export function reloadAlone(): void {
  unload.quiet = true;
  history.replaceState(null, '', location.pathname + location.search);
  location.reload();
}
