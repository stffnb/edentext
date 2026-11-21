import { Fragment, Slice } from '@tiptap/pm/model';
import type { MarkType, Node as PMNode, Schema } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { inNote } from './extensions/notes';

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

/**
 * Clipboard HTML with every picture the editor will not load (anything but its own data)
 * replaced by its alt text, and the wrappers that held nothing else removed, so no empty
 * paragraph or heading stands where it was. The count rides `PASTE_NOTICE_EVENT`.
 */
export function localPastedHtml(html: string): string {
  if (!/<img\b|\balign=/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let dropped = 0;
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    if (LOCAL_IMAGE_SRC.test(img.getAttribute('src')?.trim() ?? '')) continue;
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
  if (!dropped && !aligned.length) return html;
  if (dropped) window.dispatchEvent(new CustomEvent(PASTE_NOTICE_EVENT, { detail: { images: dropped } }));
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
