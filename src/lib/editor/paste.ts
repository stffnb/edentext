import { Fragment, Slice } from '@tiptap/pm/model';
import type { MarkType, Node as PMNode, Schema } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { Transform } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';
import { inNote } from './extensions/notes';
import { RECORDING } from './extensions/trackChanges';

const LOCAL_IMAGE_SRC = /^(?:data:|idb:)/i;

// A pasted web image must not get as far as a node view: assigning its URL to img.src
// would disclose the reader's IP before the editor has made a deliberate choice to load it.
export function dropRemoteImages(slice: Slice): Slice {
  let dropped = false;
  const clean = (fragment: Fragment): Fragment => {
    const nodes: PMNode[] = [];
    fragment.forEach(node => {
      if (node.type.name === 'image') {
        const src = node.attrs.src;
        if (typeof src === 'string' && !LOCAL_IMAGE_SRC.test(src)) { dropped = true; return; }
      }
      nodes.push(node.content.size ? node.copy(clean(node.content)) : node);
    });
    return Fragment.fromArray(nodes);
  };
  const content = clean(slice.content);
  return dropped ? Slice.maxOpen(content) : slice;
}

export const PASTE_NOTICE_EVENT = 'odf-paste-notice';

const HOLDS_CONTENT = 'img, br, hr, table, svg, math, video, canvas, input';
const ALIGNED = 'p[align], h1[align], h2[align], h3[align], h4[align], h5[align], h6[align]';
const FETCH_MS = 20_000;
const MAX_PICTURE_BYTES = 32 * 1024 * 1024;

type Size = { width: number; height: number };
/** Where a paste's fetched pictures land: the live view, and the size a picture gets in it. */
export type PasteTarget = { view: () => EditorView | null; fit?: (src: string) => Promise<Size | null> };
// `data`: undefined while the fetch runs, null once it failed.
type Pending = { url: string; width: number | null; height: number | null; data?: string | null; size?: Size | null; told?: boolean };

// A picture being fetched stands in the document as this grey square, which carries only
// an id and the alt text: its address stays on the client that pasted it, so no other client
// or file gets it. The id starts with that client's `pasteOwner`, which a session publishes.
const pending = new Map<string, Pending>();
export const pasteOwner = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
const ownerOf = (id: string) => id.slice(1, 9);
// The owners of the other clients in this client's session, who still fill their own squares.
let present: () => string[] = () => [];
export function pastersWith(fn: (() => string[]) | null): void { present = fn ?? (() => []); }
const PENDING_SRC = 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2224%22%20height=%2224%22%20id=%22';
const pendingSrc = (id: string) => `${PENDING_SRC}${id}%22%3E%3Crect%20width=%2224%22%20height=%2224%22%20fill=%22%23e5e7eb%22/%3E%3C/svg%3E`;
const pendingId = (src: unknown) => (typeof src === 'string' && src.startsWith(PENDING_SRC) ? src.slice(PENDING_SRC.length).split('%22')[0] : null);
const squareId = (node: PMNode) => (node.type.name === 'image' ? pendingId(node.attrs.src) : null);

// A size the HTML states in px; the square's own size is not the picture's.
function statedPx(img: HTMLImageElement, side: 'width' | 'height'): number | null {
  const px = /^(\d+(?:\.\d+)?)(?:px)?$/.exec((img.getAttribute(side) ?? img.style[side]).trim());
  return px && +px[1] > 0 ? +px[1] : null;
}

// The address a clipboard picture names, if it is one on the web: the clipboard carries no
// page address, so a relative one resolves only against the HTML's own <base>.
function webUrl(src: string, base: string | null): string | null {
  try {
    const url = new URL(src.startsWith('//') && !base ? `https:${src}` : src, base ?? undefined);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch { return null; }
}

// One request without cookies or referrer, read up to the size cap; null for anything
// that is no picture, too large, refused (CORS) or too slow.
async function fetchPicture(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(FETCH_MS) });
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!res.ok || !res.body || !type.startsWith('image/')) return null;
    const reader = res.body.getReader();
    const parts: BlobPart[] = [];
    for (let size = 0; ;) {
      const { done, value } = await reader.read();
      if (done) break;
      if ((size += value.length) > MAX_PICTURE_BYTES) { void reader.cancel(); return null; }
      parts.push(value);
    }
    return await new Promise((resolve) => {
      const file = new FileReader();
      file.onload = () => resolve(file.result as string);
      file.onerror = () => resolve(null);
      file.readAsDataURL(new Blob(parts, { type }));
    });
  } catch { return null; }
}

// The picture's own size, held within the view's text width; null where it does not decode.
function naturalSize(src: string, view: EditorView | null): Promise<Size | null> {
  return new Promise((resolve) => {
    const probe = document.createElement('img');
    probe.onload = () => {
      const style = view && !view.isDestroyed ? getComputedStyle(view.dom) : null;
      const room = style ? view!.dom.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) : 0;
      const [w, h] = [probe.naturalWidth || 1, probe.naturalHeight || 1];
      const scale = room > 0 && w > room ? room / w : 1;
      resolve({ width: Math.round(w * scale), height: Math.round(h * scale) });
    };
    probe.onerror = () => resolve(null);
    probe.src = src;
  });
}

const notify = (images: number) => { if (images) window.dispatchEvent(new CustomEvent(PASTE_NOTICE_EVENT, { detail: { images } })); };

// What goes with a picture that left nothing behind: every wrapper it alone filled, up to
// the first one its parent can spare; a table cell and the document stay.
function emptiedRange(doc: PMNode, pos: number): { from: number; to: number } {
  const $pos = doc.resolve(pos);
  let range = { from: pos, to: pos + 1 };
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.content.size !== 1 + 2 * ($pos.depth - d) || /^table(?:Cell|Header)$/.test(node.type.name)) break;
    const index = $pos.index(d - 1);
    if ($pos.node(d - 1).canReplace(index, index + 1)) range = { from: $pos.before(d), to: $pos.after(d) };
  }
  return range;
}

/**
 * Puts every picture whose fetch has ended where its grey square stands: the picture as the
 * editor's own data, or after a failure its alt text, else nothing. Off the undo stack, so
 * undoing the paste takes the pictures with it. Failures, with `more`, go into one notice.
 */
export function fillPastedPictures(view: EditorView | null, more = 0): void {
  if (!view || view.isDestroyed || !pending.size) return notify(more);
  const tr = view.state.tr;
  const failed = settleSquares(tr, (id) => pending.get(id)?.data !== undefined);
  if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false).setMeta(RECORDING, true));
  notify(more + failed);
}

// Each square `due` names takes its fetched picture, or as a failed fetch its alt text, else
// goes with the wrappers it alone filled. Returns how many failed anew. An entry stays, so a redo
// that brings a square back fills it again.
function settleSquares(tr: Transform, due: (id: string) => boolean): number {
  const hits: { pos: number; node: PMNode; got?: Pending }[] = [];
  tr.doc.descendants((node, pos) => {
    const id = squareId(node);
    if (id && due(id)) hits.push({ pos, node, got: pending.get(id) });
  });
  let failed = 0;
  // Last first, so an earlier position still holds after a removal.
  for (const { pos, node, got } of hits.reverse()) {
    const alt = String(node.attrs.alt ?? '').trim();
    if (got?.data && got.size) {
      const { width, height } = got;
      const ratio = got.size.height / got.size.width;
      const size = width && height ? { width, height }
        : width ? { width, height: Math.round(width * ratio) }
        : height ? { width: Math.round(height / ratio), height } : got.size;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...size, src: got.data });
      continue;
    }
    // A fetch still running counts nowhere: only a file is settled before it ends.
    if (!got || (got.data === null && !got.told)) failed++;
    if (got?.data === null) got.told = true;
    if (alt) tr.replaceWith(pos, pos + 1, node.type.schema.text(alt, node.marks));
    else { const { from, to } = emptiedRange(tr.doc, pos); tr.delete(from, to); }
  }
  return failed;
}

// A square no client present will fill: none here fetches it, and its owner is not in the session.
const orphaned = (gone?: Set<string>) => (id: string) => !pending.has(id)
  && (gone ? gone.has(ownerOf(id)) : !present().includes(ownerOf(id)));

/**
 * Settles the squares whose picture nobody will bring, as a failed fetch: on loading a
 * document, or for the owners `gone` from a session. Off the undo stack, unrecorded.
 */
export function dropOrphanPictures(view: EditorView | null, gone?: Iterable<string>): void {
  if (!view || view.isDestroyed) return;
  const tr = view.state.tr;
  const failed = settleSquares(tr, orphaned(gone && new Set(gone)));
  if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false).setMeta(RECORDING, true));
  if (!gone) notify(failed);
}

/**
 * `value` with the squares settled in every document it holds (`type: 'doc'`): all of them
 * for a file, which never shows one; with `orphans`, those no client present will fill.
 */
export function withoutPictureSquares<T>(value: T, schema: Schema, orphans = false): T {
  // Only arrays and plain objects are walked: a font's bytes are no document.
  const plain = (v: unknown): v is object => !!v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const holds = (v: unknown): boolean => (Array.isArray(v) ? v.some(holds) : plain(v)
    && (pendingId((v as { attrs?: { src?: unknown } }).attrs?.src) !== null || Object.values(v).some(holds)));
  if (!holds(value)) return value;
  const walk = (v: unknown): unknown => {
    if (!holds(v)) return v;
    if (Array.isArray(v)) return v.map(walk);
    if ((v as { type?: unknown }).type !== 'doc') return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, walk(x)]));
    const tr = new Transform(schema.nodeFromJSON(v));
    settleSquares(tr, orphans ? orphaned() : () => true);
    return tr.doc.toJSON();
  };
  return walk(value) as T;
}

/** A copy leaves the editor without grey squares: each is its alt text, else nothing. */
export function copiedWithoutSquares(slice: Slice): Slice {
  let found = false;
  const clean = (fragment: Fragment): Fragment => {
    const nodes: PMNode[] = [];
    fragment.forEach((node) => {
      if (squareId(node)) {
        found = true;
        const alt = String(node.attrs.alt ?? '').trim();
        if (alt) nodes.push(node.type.schema.text(alt, node.marks));
        return;
      }
      nodes.push(node.content.size ? node.copy(clean(node.content)) : node);
    });
    return Fragment.fromArray(nodes);
  };
  const content = clean(slice.content);
  return found ? new Slice(content, slice.openStart, slice.openEnd) : slice;
}

/** Whether `doc` still holds a square whose picture is on its way. */
export const holdsPictureSquare = (doc: PMNode): boolean => {
  let found = false;
  doc.descendants((node) => { found ||= squareId(node) !== null; return !found; });
  return found;
};

/**
 * Clipboard HTML ready for the schema. A web picture becomes a grey square while `target`'s
 * client fetches it once; with no target, or no address to fetch, its alt text stands in
 * and the wrappers it alone filled go. Failures ride `PASTE_NOTICE_EVENT`, once per paste.
 */
export function localPastedHtml(html: string, target?: PasteTarget): string {
  if (!/<img\b|\balign=/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.querySelector('base[href]')?.getAttribute('href') ?? null;
  let dropped = 0;
  const ids: string[] = [];
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = img.getAttribute('src')?.trim() ?? '';
    if (LOCAL_IMAGE_SRC.test(src)) continue;
    const url = target ? webUrl(src, base) : null;
    if (url) {
      const id = `p${pasteOwner}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      pending.set(id, { url, width: statedPx(img, 'width'), height: statedPx(img, 'height') });
      ids.push(id);
      const got = pending.get(id)!;
      img.setAttribute('src', pendingSrc(id));
      // Both sides stated, so the node view has no size of the square's to write back.
      img.setAttribute('width', String(got.width ?? got.height ?? 24));
      img.setAttribute('height', String(got.height ?? got.width ?? 24));
      for (const name of ['srcset', 'sizes', 'loading']) img.removeAttribute(name);
      continue;
    }
    dropped++;
    const alt = img.getAttribute('alt')?.trim();
    if (alt) { img.replaceWith(doc.createTextNode(alt)); continue; }
    let parent = img.parentElement;
    img.remove();
    // A cell stays: the table's grid counts on it.
    while (parent && parent !== doc.body && !/^(?:TD|TH)$/.test(parent.tagName)
      && !parent.textContent?.trim() && !parent.querySelector(HOLDS_CONTENT)) {
      const up: HTMLElement | null = parent.parentElement;
      parent.remove();
      parent = up;
    }
  }
  // The alignment attribute a web page still writes is the block's alignment.
  const aligned = Array.from(doc.querySelectorAll<HTMLElement>(ALIGNED)).filter((el) => !el.style.textAlign
    && /^(?:left|center|right|justify)$/i.test(el.getAttribute('align') ?? ''));
  for (const el of aligned) el.style.textAlign = el.getAttribute('align')!.toLowerCase();
  if (!dropped && !aligned.length && !ids.length) return html;
  if (!ids.length) notify(dropped);
  else void Promise.all(ids.map(async (id) => {
    const data = await fetchPicture(pending.get(id)!.url);
    const size = data ? await (target!.fit ?? ((src) => naturalSize(src, target!.view())))(data) : null;
    return { id, size, data: size ? data : null };
  })).then((all) => {
    // Set together: one step fills the whole paste.
    for (const { id, size, data } of all) Object.assign(pending.get(id)!, { size, data });
    fillPastedPictures(target!.view(), dropped);
  });
  return doc.body.innerHTML;
}

// Fitting foreign HTML into this schema. ProseMirror's own fitting reaches for a text box
// wherever blocks don't fit — it is the one inline node that holds them — and drops what
// it cannot place at all; both are wrong for a paste from a web page.

/**
 * Spill the blocks of the boxes the paste invented (one per block that didn't fit the
 * caret's line). Every real box carries a size — the insert command and both importers
 * set one — so a bare one is that wrapper. Left in, a paste into a box would be dropped
 * whole: a box inside a box never enters the document.
 */
export function unwrapPastedBoxes(slice: Slice): Slice {
  const out: PMNode[] = [];
  let wrapped = false;
  slice.content.forEach(node => {
    const bare = node.type.name === 'textBox' && node.attrs.width === null && node.attrs.height === null;
    wrapped ||= bare;
    if (bare) node.content.forEach(child => out.push(child));
    else out.push(node);
  });
  return wrapped ? Slice.maxOpen(Fragment.fromArray(out)) : slice;
}

/**
 * Everything the slice says, as inline content with a line break per block — for the
 * targets that hold no blocks at all: a header/footer zone and a note body. Pasted blocks
 * would otherwise be wrapped in a box neither file keeps, or be dropped from the second
 * block on. Both importers write a zone's paragraphs as the same breaks.
 */
export function flattenToInline(slice: Slice, schema: Schema): Slice {
  const br = schema.nodes.hardBreak;
  const out: PMNode[] = [];
  const walk = (frag: Fragment) => frag.forEach(node => {
    // A box holds blocks itself, so it is walked into rather than kept.
    if (node.isInline && node.type.name !== 'textBox') return void out.push(node);
    // One break per text block, empty ones included — the blank line they are; a list, a
    // table or a box only holds those blocks and adds no break of its own.
    if (node.isTextblock && out.length && br) out.push(br.create());
    walk(node.content);
  });
  walk(slice.content);
  return new Slice(Fragment.fromArray(out), 0, 0);
}

/**
 * A web editor's copy can join every word with a no-break space; a block with no ordinary
 * space left could only break inside a word. Such a block gets plain spaces back, while a
 * block with ordinary spaces keeps its no-break ones as meant ("10 ms").
 */
export function plainPastedSpaces(slice: Slice): Slice {
  let changed = false;
  const clean = (fragment: Fragment): Fragment => {
    const nodes: PMNode[] = [];
    fragment.forEach(node => {
      const text = node.isTextblock ? node.textContent : '';
      if (text.includes(' ') && !text.includes(' ')) {
        changed = true;
        const inline: PMNode[] = [];
        node.content.forEach(n => inline.push(n.isText ? n.type.schema.text(n.text!.replace(/ /g, ' '), n.marks) : n));
        nodes.push(node.copy(Fragment.fromArray(inline)));
      } else nodes.push(node.content.size && !node.isTextblock ? node.copy(clean(node.content)) : node);
    });
    return Fragment.fromArray(nodes);
  };
  const content = clean(slice.content);
  return changed ? new Slice(content, slice.openStart, slice.openEnd) : slice;
}

/** Every fitting fix a slice from outside gets before it lands at `state`'s selection. */
export function fitPastedSlice(raw: Slice, state: EditorState): Slice {
  const pasted = plainPastedSpaces(raw);
  const slice = inNote(state) ? flattenToInline(pasted, state.schema) : unwrapPastedBoxes(pasted);
  const localImages = dropRemoteImages(slice);
  const textStyleType = state.schema.marks.textStyle;
  if (!textStyleType) return localImages;
  const cursorMarks = state.storedMarks ?? state.selection.$head.marks();
  // Only an explicit font at the caret is carried over, each half of the pair on
  // its own: with none, the pasted text inherits the paragraph's style, as it does
  // in both word processors.
  const attrs = cursorMarks.find(m => m.type === textStyleType)?.attrs ?? {};
  const fonts = Object.fromEntries(['fontFamily', 'fontFamilyAsian'].filter((k) => attrs[k]).map((k) => [k, attrs[k] as string]));
  if (!Object.keys(fonts).length) return localImages;
  return new Slice(applyFontToFragment(localImages.content, textStyleType, fonts), localImages.openStart, localImages.openEnd);
}

function applyFontToFragment(frag: Fragment, textStyleType: MarkType, fonts: Record<string, string>): Fragment {
  const nodes: PMNode[] = [];
  frag.forEach((node: PMNode) => {
    if (node.isText) {
      const existingTS = node.marks.find(m => m.type === textStyleType);
      const missing = Object.entries(fonts).filter(([k]) => !existingTS?.attrs[k]);
      if (!missing.length) {
        nodes.push(node);
      } else {
        const newAttrs = { ...(existingTS?.attrs ?? {}), ...Object.fromEntries(missing) };
        const otherMarks = node.marks.filter(m => m.type !== textStyleType);
        nodes.push(node.mark([...otherMarks, textStyleType.create(newAttrs)]));
      }
    } else {
      nodes.push(node.copy(applyFontToFragment(node.content, textStyleType, fonts)));
    }
  });
  return Fragment.fromArray(nodes);
}
