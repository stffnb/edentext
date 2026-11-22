import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { AddMarkStep, RemoveMarkStep, ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform';
import { dropCursor } from '@tiptap/pm/dropcursor';
import { closeGroup } from '../undo';
import { IDB_SRC, awaitImage, shownSrc } from '../../storage/imageStore';
import { cmToPx } from '../../storage/pageMargins';
import { changedRanges } from '../changedRanges';
import { readVerticalMargins, placeFrameSoon, placeInColumn, freeDragX, sinkSideFloat, shiftToOffset, liftBand, bandRise } from './pageBreaks';
import { coordsAt } from './overlay';

// Inline, as-character image, or a floating text-wrapped frame (wrap = flow mode);
// width/height are doc px @96dpi, rotation CW degrees. Export → cm + ODF
// draw:transform/style:wrap. A floating image floats at its anchor; drag re-anchors it.

// 'inline' = as-character; 'left'/'right' = square wrap (text on the open side);
// 'topBottom' = no side wrap (text only above/below); 'through' = the text runs over
// or under it (`inFront` picks which), so the frame reserves nothing at all.
export type WrapMode = 'inline' | 'left' | 'right' | 'topBottom' | 'through';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      setImage: (attrs: { src: string; alt?: string; width?: number | null; height?: number | null; rotation?: number; wrap?: WrapMode }) => ReturnType;
      setImageWrap: (wrap: WrapMode, inFront?: boolean) => ReturnType;
      setImageAttrs: (attrs: Record<string, unknown>) => ReturnType;
      restackFrame: (to: 'forward' | 'backward' | 'front' | 'back') => ReturnType;
    };
  }
}

export const MIN_SIZE_PX = 24;

// Corners keep aspect; edges (n/s/e/w) change one dimension only.
// Shared with textBox.ts, whose node view uses the same handle set.
export const HANDLES: { k: string; x: -1 | 0 | 1; y: -1 | 0 | 1; aspect: boolean }[] = [
  { k: 'nw', x: -1, y: -1, aspect: true },
  { k: 'n', x: 0, y: -1, aspect: false },
  { k: 'ne', x: 1, y: -1, aspect: true },
  { k: 'e', x: 1, y: 0, aspect: false },
  { k: 'se', x: 1, y: 1, aspect: true },
  { k: 's', x: 0, y: 1, aspect: false },
  { k: 'sw', x: -1, y: 1, aspect: true },
  { k: 'w', x: -1, y: 0, aspect: false },
];

export function parsePx(value: string | null): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseCm(value: string | null): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

// The share of each side a file cuts off the picture (Word's a:srcRect, ODF's fo:clip):
// the frame shows the rest, scaled to fill it.
export type Crop = { l: number; t: number; r: number; b: number };
export function cropOf(v: unknown): Crop | null {
  const c = v as Crop | null;
  if (!c || typeof c !== 'object') return null;
  const ok = [c.l, c.t, c.r, c.b].every((n) => typeof n === 'number' && n >= 0);
  return ok && c.l + c.r < 0.99 && c.t + c.b < 0.99 && (c.l || c.t || c.r || c.b) ? c : null;
}
const parseCrop = (v: string | null): Crop | null => {
  const [l, t, r, b] = (v ?? '').split(',').map(Number);
  return cropOf({ l, t, r, b });
};

// How the picture's colours are drawn: ODF's draw:color-mode, which is also LibreOffice's
// reading of Word's grayscale, black-and-white and washout effects. null = as stored.
export type ColorMode = 'greyscale' | 'mono' | 'watermark';
export const colorModeOf = (v: unknown): ColorMode | null =>
  v === 'greyscale' || v === 'mono' || v === 'watermark' ? v : null;

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// The page text width, live from the vars the editor maintains (margins/orientation).
const COLUMN_WIDTH_CSS =
  'calc(var(--user-page-width) - var(--user-margin-left) - var(--user-margin-right))';

// An as-character image the file sizes to the column can land under a pixel over it once
// its cm/EMU width is in px: trim the width so the line holds it, keep the height. A truly
// wider one keeps its size and overhangs the margin, as LibreOffice draws it.
export function fitInlineImage(attrs: Record<string, unknown>, maxWidthPx: number): void {
  const w = attrs.width;
  if (typeof w !== 'number' || w <= maxWidthPx || w - maxWidthPx > 1) return;
  attrs.width = framePx(maxWidthPx);
}

// A frame size in doc px, from the cm or EMU the file states. Kept fractional — rounding
// a page-wide picture to whole pixels loses 0.3mm of height — but our own export
// quantizes to 0.001cm (0.04px), so a size that close to a whole pixel *is* one.
export function framePx(px: number): number {
  const whole = Math.round(px);
  return Math.abs(px - whole) < 0.05 ? whole : Math.round(px * 100) / 100;
}

// The gap a floating frame keeps to the text, in cm per side (Word's distT/B/L/R, ODF's
// fo:margin-*). A bare number, as older documents store it, is the gap beside the frame.
export type WrapGap = { top: number; right: number; bottom: number; left: number };
export function wrapGap(v: unknown): WrapGap {
  if (typeof v === 'number') return { top: 0, right: Math.max(0, v), bottom: 0, left: Math.max(0, v) };
  const g = (v && typeof v === 'object' ? v : {}) as Partial<WrapGap>;
  const n = (x: unknown) => (typeof x === 'number' && x > 0 ? Math.round(x * 1000) / 1000 : 0);
  return { top: n(g.top), right: n(g.right), bottom: n(g.bottom), left: n(g.left) };
}
/** The attr value for a gap: null where no side has one. */
export function wrapGapAttr(g: WrapGap): WrapGap | null {
  return g.top || g.right || g.bottom || g.left ? g : null;
}
// A new frame's gap once it wraps: Word's 0.32cm beside a picture (LibreOffice's Graphics
// style has none, so the text touches it), and LibreOffice's Frame style 0.2cm all round.
export const PICTURE_WRAP_GAP: WrapGap = { top: 0, right: 0.32, bottom: 0, left: 0.32 };
export const BOX_WRAP_GAP: WrapGap = { top: 0.2, right: 0.2, bottom: 0.2, left: 0.2 };
export const parseWrapGap = (v: string | null): number | WrapGap | null => {
  const n = (v ?? '').trim().split(/\s+/).map(Number);
  if (n.length === 1) return Number.isFinite(n[0]) && n[0] > 0 ? n[0] : null;
  return n.length === 4 && n.every(Number.isFinite) ? wrapGapAttr(wrapGap({ top: n[0], right: n[1], bottom: n[2], left: n[3] })) : null;
};
export const wrapGapText = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === 'number') return String(v);
  const g = wrapGap(v);
  return `${g.top} ${g.right} ${g.bottom} ${g.left}`;
};
const gapPx = (cm: number) => Math.round(cmToPx(cm));

// A floating frame's margins from its wrapOffset: its left edge in the text column,
// measured against the live column vars an indented anchor cannot skew (a right float
// is placed from the far side). wrapOffsetY becomes a top margin — see the attr's note.
export function frameMargins(wrap: WrapMode, offsetCm: unknown, boxWidthPx: number, offsetYCm?: unknown, distCm?: unknown): string {
  const near = typeof offsetCm === 'number' ? `${Math.round(cmToPx(offsetCm))}px` : null;
  // The gap is the file's own (fo:margin-*, distT/B/L/R) and nothing where it declares
  // none — probed: LibreOffice wraps flush against a frame whose graphic style leaves the
  // margin out. Beside a side float only the text's side counts; the other is its offset.
  // The gap above never moves the frame off its offset (probed); sinkSideFloat keeps text out of it.
  const g = wrapGap(distCm);
  const bottom = `${gapPx(g.bottom)}px`;
  if (wrap === 'topBottom') {
    const y = typeof offsetYCm === 'number' && offsetYCm > 0 ? gapPx(offsetYCm) : 0;
    return `${y}px 0 ${bottom} ${near ?? '0'}`;
  }
  if (wrap === 'left') return `0 ${gapPx(g.right)}px ${bottom} ${near ?? '0'}`;
  const far = near == null ? '0' : `calc(${COLUMN_WIDTH_CSS} - ${near} - ${boxWidthPx}px)`;
  return `0 ${far} ${bottom} ${gapPx(g.left)}px`;
}

// A side float placed at an x of its own (see shiftToOffset), with the gap it keeps to
// the text. The shift last measured is kept on the element, so a re-applied wrap restores
// it at once instead of a frame late.
export function unstackFloat(el: HTMLElement, side: 'left' | 'right', offsetCm: unknown, distCm?: unknown): void {
  const kept = el.dataset.unstack?.split(':');
  if (typeof offsetCm !== 'number' || kept?.[0] !== `${side}${offsetCm}`) delete el.dataset.unstack;
  else [el.style.marginLeft, el.style.marginRight] = [kept[1], kept[2]];
  if (typeof offsetCm !== 'number') { delete el.dataset.floatX; return; }
  el.dataset.floatX = String(offsetCm);
  const g = wrapGap(distCm);
  el.dataset.floatGap = String(gapPx(side === 'right' ? g.left : g.right));
  // Deferred: a new node view is not in its paragraph yet, so its neighbours are unknown.
  requestAnimationFrame(() => shiftToOffset(el));
}

// What picking a wrap mode by hand drops: the offsets belong to the mode that was set,
// and so do the coordinate systems they were measured in (the page corner, a fixed
// page). `inFront` means something for run-through alone. Shared with textBox.ts.
// Behind and in front of the text are one mode, so a switch between them keeps the place.
export function droppedFrameAttrs(wrap: WrapMode, inFront: boolean, from: unknown): Record<string, unknown> {
  if (wrap === 'through' && from === 'through') return { inFront };
  return {
    wrapOffset: null,
    wrapOffsetY: null,
    wrapFromPage: false,
    wrapFromBody: false,
    anchorPage: null,
    inFront: wrap === 'through' && inFront,
  };
}

// Word's behind-text / in-front-of-text, ODF run-through: the text runs over or under
// the frame, so it reserves nothing. Absolute with no offsets keeps the static position
// it was anchored at; the file's own offsets ride as margins from there.
export function applyRunThrough(el: HTMLElement, offsetCm: unknown, offsetYCm: unknown, inFront: boolean, fromPage = false, fromBody = false, rank: unknown = 0): void {
  const px = (cm: unknown) => (typeof cm === 'number' ? Math.round(cmToPx(cm)) : 0);
  el.style.position = 'absolute';
  el.style.margin = `${px(offsetYCm)}px 0 0 ${px(offsetCm)}px`;
  el.style.zIndex = stackZ(inFront, rank, el.classList.contains('image-node'));
  // Which side of the text it lands on, for the header/footer layer's stacking.
  if (inFront) el.dataset.inFront = ''; else delete el.dataset.inFront;
  clearPagePlace(el);
  // A page-placed frame states its corner instead: placeFromPage turns the pair into
  // the margins that reach it, and pagination re-places it from these same numbers. A
  // header/footer zone places it by CSS from the same pair (HeaderFooterLayer).
  if (fromPage || fromBody) {
    if (fromBody) el.dataset.fromBody = '';
    el.dataset.pageX = String(px(offsetCm));
    el.dataset.pageY = String(px(offsetYCm));
    el.style.setProperty('--page-x', `${px(offsetCm)}px`);
    el.style.setProperty('--page-y', `${px(offsetYCm)}px`);
  } else if (typeof offsetCm === 'number') {
    el.dataset.columnX = String(px(offsetCm));
  }
}

// A header's or footer's text does not wrap around a frame anchored in it (probed in
// LibreOffice: full-width and narrow, paragraph- and margin-relative): it runs through at its
// anchor, and its gap above is kept for the footer's band (HeaderFooterLayer).
export function runInZone(view: EditorView, el: HTMLElement, edge: 'left' | 'right' | 'center', offsetCm: unknown, offsetYCm: unknown, dist: unknown, rank: unknown): void {
  applyRunThrough(el, offsetCm, offsetYCm, true, false, false, rank);
  // Without an x of its own it stands where its wrap would in the body: at that edge of
  // the column or centred in it, whichever way its anchor paragraph is aligned.
  if (typeof offsetCm !== 'number') {
    if (edge === 'left') el.dataset.columnX = '0';
    else el.dataset.columnSide = edge;
  }
  // How far its gap reaches above its paragraph's top.
  el.dataset.zoneGap = String(gapPx(wrapGap(dist).top) - (typeof offsetYCm === 'number' ? gapPx(offsetYCm) : 0));
  if (el.isConnected) placeInColumn(view, el);
  else placeFrameSoon(view, el);
}

// A free frame's layer: in front of the text under the header layer (22), behind it over
// the sheets (-200), where every picture paints over every shape whatever their ranks, as
// LibreOffice paints them (frames.md). Past the caps the document order decides.
export function stackZ(inFront: boolean, rank: unknown, picture: boolean): string {
  const r = typeof rank === 'number' && rank > 0 ? rank : 0;
  return String(inFront ? 1 + Math.min(r, 20) : -150 + Math.min(r, 60) + (picture ? 70 : 0));
}

// A frame's rank among the stacking numbers its file part uses (ODF draw:z-index, DOCX
// relativeHeight, which runs into the billions): one above every lower-numbered frame
// anchored within STACK_REACH paragraphs, so the few frames that can overlap keep their
// order under stackZ's caps however many the part holds. Both importers read it this way.
const STACK_REACH = 3;
const partRanks = new WeakMap<Document, Map<Element, number>>();
export function stackRank(el: Element, ns: string | null, attr: string): number {
  const doc = el.ownerDocument;
  let ranks = partRanks.get(doc);
  if (!ranks) {
    const paras = new Map<Element, number>();
    const frames: { el: Element; v: number; at: number }[] = [];
    for (const e of Array.from(doc.querySelectorAll('*'))) {
      // A paragraph inside a frame's text counts as its anchor's.
      let p: Element | null = e.parentElement;
      while (p && !paras.has(p)) p = p.parentElement;
      if (!p && (e.localName === 'p' || e.localName === 'h')) paras.set(e, paras.size);
      const v = Number(e.getAttributeNS(ns, attr) ?? NaN);
      if (Number.isFinite(v)) frames.push({ el: e, v, at: p ? paras.get(p)! : paras.size });
    }
    frames.sort((a, b) => a.v - b.v);
    ranks = new Map();
    for (const [i, f] of frames.entries()) {
      let r = 0;
      for (let j = 0; j < i; j++) {
        const g = frames[j];
        if (g.v < f.v && Math.abs(g.at - f.at) <= STACK_REACH) r = Math.max(r, ranks.get(g.el)! + 1);
      }
      ranks.set(f.el, r);
    }
    partRanks.set(doc, ranks);
  }
  return ranks.get(el) ?? 0;
}

// Whether a frame is out of the flow, where frames overlap and their order shows.
const isFreeFrame = (n: PMNode): boolean =>
  (n.type.name === 'image' || n.type.name === 'textBox') && (n.attrs.wrap === 'through' || typeof n.attrs.anchorPage === 'number');

// One step past the next free frame in its layer (stackZ), or to that layer's end, as
// both word processors move one; every free frame is then renumbered from 0. Shared
// with text boxes, which it also reaches from a caret in their text. Returns false where
// the frame is already there or not free.
export function restackFrame(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, to: 'forward' | 'backward' | 'front' | 'back'): boolean {
  const sel = state.selection;
  const { $from } = sel;
  let from = sel instanceof NodeSelection ? sel.from : -1;
  for (let d = $from.depth; from < 0 && d > 0; d--) if ($from.node(d).type.name === 'textBox') from = $from.before(d);
  const node = from >= 0 ? state.doc.nodeAt(from) : null;
  if (!node || !isFreeFrame(node)) return false;
  const frames: { pos: number; node: PMNode }[] = [];
  state.doc.descendants((node, pos) => { if (isFreeFrame(node)) frames.push({ pos, node }); });
  const rank = (n: PMNode) => (n.attrs.zIndex as number) || 0;
  frames.sort((a, b) => rank(a.node) - rank(b.node) || a.pos - b.pos);
  const i = frames.findIndex((f) => f.pos === from);
  const layer = (f: { node: PMNode }) => (f.node.attrs.inFront === true ? 'front' : f.node.type.name);
  const peers = frames.map((f, k) => (layer(f) === layer(frames[i]) ? k : -1)).filter((k) => k >= 0);
  const at = peers.indexOf(i);
  const j = to === 'forward' ? peers[at + 1] : to === 'backward' ? peers[at - 1] : to === 'front' ? peers[peers.length - 1] : peers[0];
  if (j == null || j === i) return false;
  if (dispatch) {
    const [moved] = frames.splice(i, 1);
    frames.splice(j, 0, moved);
    const tr = state.tr;
    frames.forEach((f, k) => { if (rank(f.node) !== k) tr.setNodeAttribute(f.pos, 'zIndex', k); });
    dispatch(tr);
  }
  return true;
}

// A frame leaving run-through, or its page, takes no page place along.
export function clearPagePlace(el: HTMLElement): void {
  delete el.dataset.zoneGap;
  delete el.dataset.fromBody;
  delete el.dataset.pageX;
  delete el.dataset.pageY;
  delete el.dataset.columnX;
  delete el.dataset.columnSide;
  el.style.removeProperty('--page-x');
  el.style.removeProperty('--page-y');
}

// Drag a frame that is out of the flow. Its offsets count from a point the drag cannot
// move — the column, the page's corner — so the pointer delta is simply added to them
// (a frame without an x comes with the one it shows, freeDragX). `done(null)` reports a click that never moved.
export function startFreeMove(
  event: MouseEvent,
  dom: HTMLElement,
  attrs: Record<string, unknown>,
  preview: (by: { x: number; y: number } | null) => void,
  done: (offsets: { wrapOffset: number; wrapOffsetY: number } | null) => void,
): void {
  event.preventDefault();
  event.stopPropagation();
  // The wrapper is axis-aligned, so its scaled/unscaled width ratio is the zoom.
  const zoom = dom.getBoundingClientRect().width / dom.offsetWidth || 1;
  const win = dom.ownerDocument.defaultView ?? window;
  const cm = (px: number) => Math.round((px * 2.54 * 1000) / 96) / 1000;
  const base = (v: unknown) => (typeof v === 'number' ? v : 0);
  const sx = event.clientX;
  const sy = event.clientY;
  let by = { x: 0, y: 0 };
  let moved = false;

  const move = (e: MouseEvent): void => {
    if (!e.buttons) { finish(); return; }
    by = { x: cm((e.clientX - sx) / zoom), y: cm((e.clientY - sy) / zoom) };
    moved = true;
    preview(by);
  };
  const finish = (): void => {
    win.removeEventListener('mousemove', move);
    win.removeEventListener('mouseup', finish);
    preview(null);
    done(moved
      ? { wrapOffset: base(attrs.wrapOffset) + by.x, wrapOffsetY: base(attrs.wrapOffsetY) + by.y }
      : null);
  };
  win.addEventListener('mousemove', move);
  win.addEventListener('mouseup', finish);
}

// Where an as-char frame sits against the line (ODF style:vertical-pos/-rel, probed
// against LibreOffice): its bottom on the baseline by default, `text-*` against the
// character area, `offset` its top wrapOffsetY cm below the baseline.
export type InlineVAlign = 'middle' | 'below' | 'text-top' | 'text-middle' | 'text-bottom' | 'offset';

export function inlineVerticalAlign(vAlign: unknown, boxHeightPx: number, offsetYCm: unknown): string {
  if (!boxHeightPx) return '';
  switch (vAlign) {
    case 'middle': return `${-boxHeightPx / 2}px`;
    case 'below': return `${-boxHeightPx}px`;
    case 'text-top': return 'text-top';
    case 'text-bottom': return 'text-bottom';
    // No CSS keyword centres on the character area; 0.36em stands in for half of
    // (ascent − descent), which Liberation Serif/Sans, Times and Arial all share.
    case 'text-middle': return `calc(0.36em - ${boxHeightPx / 2}px)`;
    case 'offset':
      return typeof offsetYCm === 'number' ? `${-(cmToPx(offsetYCm) + boxHeightPx)}px` : '';
    default: return '';
  }
}

// The offset counts from the anchor block's top, its space above included. Behind text or
// an earlier frame (the importers sink frames) that part is covered, so the rest is
// measured; a band leading the block rises by the space above, which editor.css hands down.
export function sinkToOffset(d: HTMLElement, y: unknown): number | null {
  const p = d.parentElement;
  if (!p) return null;
  const down = typeof y === 'number' && y > 0;
  let before = d.previousSibling;
  while (before instanceof Element && before.classList.contains('ProseMirror-separator')) before = before.previousSibling;
  const wrap = d.dataset.wrap === 'topBottom';
  const leads = !before && wrap;
  if (leads) {
    d.dataset.bandY = String(down ? Math.round(cmToPx(y)) : 0);
    liftBand(d);
  } else { delete d.dataset.bandLift; delete d.dataset.bandY; }
  if (leads || !down) return down ? Math.round(cmToPx(y)) : null;
  let gap = Math.round(cmToPx(y));
  if (d.previousSibling) {
    d.style.marginTop = '0px';
    const box = p.getBoundingClientRect();
    const scale = box.width / p.offsetWidth || 1;
    gap = clamp(Math.round(cmToPx(y) - (wrap ? bandRise(p) : 0) - (d.getBoundingClientRect().top - box.top) / scale), 6, pageContentHeightPx());
  }
  d.style.marginTop = `${gap}px`;
  return gap;
}

// The page text height in px, capping how tall an image can be stretched. Read live
// from the :root vars the editor maintains (orientation/margins change them). A frame in
// a header or footer may reach over the whole page.
export function pageContentHeightPx(frame?: Element): number {
  const cs = getComputedStyle(document.documentElement);
  if (frame?.closest('.hf-zone')) return parseFloat(cs.getPropertyValue('--user-page-height')) || 4000;
  const h =
    parseFloat(cs.getPropertyValue('--user-page-height')) -
    parseFloat(cs.getPropertyValue('--user-margin-top')) -
    parseFloat(cs.getPropertyValue('--user-margin-bottom'));
  return h > 0 ? h : 4000;
}

// setNodeMarkup replaces a leaf node outright, so the node selection maps off it and an
// attribute change would deselect the node. Put it back where it stood. Shared with
// textBox.ts and formula.ts; `marks` is the leaf's own, which the replacement drops.
export function atomAttrTr(state: EditorState, pos: number, attrs: Record<string, unknown>, marks?: readonly Mark[]): Transaction {
  const selected = state.selection instanceof NodeSelection && state.selection.from === pos;
  const tr = state.tr.setNodeMarkup(pos, undefined, attrs, marks);
  return selected ? tr.setSelection(NodeSelection.create(tr.doc, pos)) : tr;
}

export const Image = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      // In a session a large picture's src is its key (`collab/pictures.ts`): the copy, the
      // clipboard and the vector PDF get the picture.
      src: { default: null, renderHTML: (a) => (a.src == null ? {} : { src: shownSrc(a.src) }) },
      alt: { default: '' },
      // px @96dpi and CW degrees; kept off the width/height attrs (rendered via
      // inline style / data-rotation) so one place drives the node view.
      width: {
        default: null,
        parseHTML: el => parsePx(el.getAttribute('width') ?? (el as HTMLElement).style.width),
        renderHTML: () => ({}),
      },
      height: {
        default: null,
        parseHTML: el => parsePx(el.getAttribute('height') ?? (el as HTMLElement).style.height),
        renderHTML: () => ({}),
      },
      rotation: {
        default: 0,
        parseHTML: el => parsePx((el as HTMLElement).getAttribute('data-rotation')) ?? 0,
        renderHTML: () => ({}),
      },
      wrap: {
        default: 'inline',
        parseHTML: el => (el as HTMLElement).getAttribute('data-wrap') ?? 'inline',
        renderHTML: () => ({}),
      },
      // Where a floating frame sits in the text column: cm from the column's left edge
      // to the frame's left edge (Word's posOffset, ODF svg:x). null = flush to its side.
      wrapOffset: {
        default: null,
        parseHTML: el => parseCm((el as HTMLElement).getAttribute('data-wrap-offset')),
        renderHTML: () => ({}),
      },
      // How far below its anchor paragraph the frame sits, in cm (Word's positionV
      // posOffset, ODF svg:y). Drawn as the float's top margin; a side float's lines
      // still run beside that margin (sinkToOffset).
      wrapOffsetY: {
        default: null,
        parseHTML: el => parseCm((el as HTMLElement).getAttribute('data-wrap-offset-y')),
        renderHTML: () => ({}),
      },
      // The gap the file keeps between a floating frame and the text, in cm: a WrapGap,
      // or a number for the sides as older documents store it (see wrapGap). null =
      // none, which is what both render for a frame that declares none.
      wrapDist: {
        default: null,
        parseHTML: el => parseWrapGap((el as HTMLElement).getAttribute('data-wrap-dist')),
        renderHTML: () => ({}),
      },
      // The page a page-anchored frame is placed on (ODF text:anchor-page-number): a
      // cover graphic or a watermark, out of the text flow. wrapOffset/-Y are then the
      // frame's coordinates from that page's top-left corner, not from its column.
      anchorPage: {
        default: null,
        parseHTML: el => parsePx((el as HTMLElement).getAttribute('data-anchor-page')),
        renderHTML: () => ({}),
      },
      // Which end of its band a `topBottom` frame is set against (Word's positionH align,
      // ODF's style:horizontal-pos). Set only where two frames share the band, so they
      // sit side by side; a lone one fills the band, which is what the wrap means.
      wrapAlign: {
        default: null,
        parseHTML: el => (el as HTMLElement).getAttribute('data-wrap-align') || null,
        renderHTML: () => ({}),
      },
      crop: {
        default: null,
        parseHTML: el => parseCrop((el as HTMLElement).getAttribute('data-crop')),
        renderHTML: () => ({}),
      },
      colorMode: {
        default: null,
        parseHTML: el => colorModeOf((el as HTMLElement).getAttribute('data-color-mode')),
        renderHTML: () => ({}),
      },
      // Where an as-char frame sits against the line (see inlineVerticalAlign).
      // null = its bottom on the baseline, which is LibreOffice's and Word's default.
      vAlign: {
        default: null,
        parseHTML: el => (el as HTMLElement).getAttribute('data-v-align') || null,
        renderHTML: () => ({}),
      },
      // Whether wrapOffsetY counts from the top of the page the anchor lands on rather
      // than from the anchor paragraph (Word's positionV relativeFrom="page", ODF's
      // style:vertical-rel="page") — how a cover page's own blocks are placed.
      wrapFromPage: {
        default: false,
        parseHTML: el => (el as HTMLElement).hasAttribute('data-wrap-from-page'),
        renderHTML: () => ({}),
      },
      // Whether wrapOffsetY counts from the top of the page's body text instead (Word's
      // relativeFrom="margin", ODF's "page-content"): how a header reaches into the body.
      wrapFromBody: {
        default: false,
        parseHTML: el => (el as HTMLElement).hasAttribute('data-wrap-from-body'),
        renderHTML: () => ({}),
      },
      // The frame's place among the free frames (restackFrame): 0 up, ties in document
      // order. The files' draw:z-index / relativeHeight, ranked on import.
      zIndex: {
        default: 0,
        parseHTML: el => parsePx((el as HTMLElement).getAttribute('data-z-index')) ?? 0,
        renderHTML: () => ({}),
      },
      // A page-anchored frame's stacking against text (ODF style:run-through): default
      // "background" sits behind; a title page's own cover graphic sets "foreground".
      inFront: {
        default: false,
        parseHTML: el => (el as HTMLElement).hasAttribute('data-in-front'),
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]', getAttrs: el => {
      const src = el.getAttribute('src') ?? '';
      return /^(?:data:|idb:)/i.test(src) ? null : false;
    } }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const w = node.attrs.width as number | null;
    const h = node.attrs.height as number | null;
    const rot = (node.attrs.rotation as number) || 0;
    const wrap = (node.attrs.wrap as WrapMode) || 'inline';
    const offset = node.attrs.wrapOffset as number | null;
    const offsetY = node.attrs.wrapOffsetY as number | null;
    const va = h ? inlineVerticalAlign(node.attrs.vAlign, h, offsetY) : '';
    const crop = cropOf(node.attrs.crop);
    const style = [
      w ? `width:${w}px` : '',
      h ? `height:${h}px` : '',
      rot ? `transform:rotate(${rot}deg)` : '',
      va ? `vertical-align:${va}` : '',
      // ponytail: object-view-box is Chromium's; the node view clips with a box instead.
      crop ? `object-view-box:inset(${crop.t * 100}% ${crop.r * 100}% ${crop.b * 100}% ${crop.l * 100}%)` : '',
    ].filter(Boolean).join(';');
    return ['img', mergeAttributes(HTMLAttributes, {
      ...(style ? { style } : {}),
      ...(rot ? { 'data-rotation': String(rot) } : {}),
      ...(crop ? { 'data-crop': [crop.l, crop.t, crop.r, crop.b].join(',') } : {}),
      ...(colorModeOf(node.attrs.colorMode) ? { 'data-color-mode': node.attrs.colorMode } : {}),
      ...(wrap !== 'inline' ? { 'data-wrap': wrap } : {}),
      ...(offset != null ? { 'data-wrap-offset': String(offset) } : {}),
      ...(offsetY != null ? { 'data-wrap-offset-y': String(offsetY) } : {}),
      ...(node.attrs.wrapDist != null ? { 'data-wrap-dist': wrapGapText(node.attrs.wrapDist) } : {}),
      ...(node.attrs.wrapAlign ? { 'data-wrap-align': String(node.attrs.wrapAlign) } : {}),
      ...(node.attrs.vAlign ? { 'data-v-align': String(node.attrs.vAlign) } : {}),
      ...(node.attrs.anchorPage ? { 'data-anchor-page': String(node.attrs.anchorPage) } : {}),
      ...(node.attrs.inFront ? { 'data-in-front': '' } : {}),
      ...(node.attrs.zIndex ? { 'data-z-index': String(node.attrs.zIndex) } : {}),
      ...(node.attrs.wrapFromPage ? { 'data-wrap-from-page': '' } : {}),
      ...(node.attrs.wrapFromBody ? { 'data-wrap-from-body': '' } : {}),
    })];
  },

  addCommands() {
    return {
      setImage:
        attrs =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),

      // Set attributes on the selected image, keeping it selected.
      setImageAttrs:
        (attrs) =>
        ({ state, dispatch }) => {
          const sel = state.selection;
          if (!(sel instanceof NodeSelection) || sel.node.type.name !== this.name) return false;
          if (dispatch) dispatch(atomAttrTr(state, sel.from, { ...sel.node.attrs, ...attrs }));
          return true;
        },

      // Set the wrap mode on the selected image.
      setImageWrap:
        (wrap: WrapMode, inFront = false) =>
        ({ state, dispatch }) => {
          const sel = state.selection;
          if (!(sel instanceof NodeSelection) || sel.node.type.name !== this.name) return false;
          // Picking a side means "put it there", so the imported offset goes with it.
          // A frame the file never floated has no distance either; give it a new one's.
          const wrapDist = wrap === 'inline' ? sel.node.attrs.wrapDist : sel.node.attrs.wrapDist ?? PICTURE_WRAP_GAP;
          if (dispatch) {
            dispatch(atomAttrTr(state, sel.from,
              { ...sel.node.attrs, wrap, wrapDist, ...droppedFrameAttrs(wrap, inFront, sel.node.attrs.wrap) }));
          }
          return true;
        },

      restackFrame: (to) => ({ state, dispatch }) => restackFrame(state, dispatch, to),
    };
  },

  addNodeView() {
    return ({ node, editor, getPos, view }) => new ImageView(node as PMNode, editor, getPos as () => number, view);
  },

  // The drop cursor paints a caret where a dragged-in image *file* lands; moving an
  // existing image uses the node view's live re-anchor drag, not PM's native node move.
  addProseMirrorPlugins() {
    return [dropCursor({ color: '#3b82f6', width: 2 }), imageLinePlugin(), behindTextPlugin()];
  },
});

// A frame behind the text paints under the page and the paragraphs over it, so the
// browser hit-tests those first and a click never reaches it — where both word
// processors let one be picked. The event goes to the frame's own node view, which
// selects and drags it as a click on any other frame does; text over it still wins,
// as the caret does there.
function behindTextPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          const at = event.target;
          // The primary button only: a right-click keeps whatever the browser's own
          // context-menu handling does with the point.
          if (!view.editable || event.button !== 0) return false;
          if (at instanceof HTMLElement && at.closest('[data-wrap="through"]')) return false;
          const hit = frameBehindPoint(view, event.clientX, event.clientY);
          if (!hit) return false;
          event.preventDefault();
          // A text box tells its outline from its text by the element hit; a picture is its image.
          const frame = hit.closest('[data-wrap="through"]')!;
          (frame.classList.contains('textbox-node') ? hit : frame.querySelector('img') ?? frame).dispatchEvent(new MouseEvent('mousedown', {
            clientX: event.clientX, clientY: event.clientY, button: 0, cancelable: true, bubbles: true,
          }));
          return true;
        },
        // The page over such a frame would show its own cursor; the frame's is the one meant.
        mousemove(view, event) {
          const hit = view.editable && !event.buttons ? frameBehindPoint(view, event.clientX, event.clientY) : null;
          view.dom.style.cursor = hit ? getComputedStyle(hit).cursor : '';
          return false;
        },
      },
    },
  });
}

// The element hit in the topmost behind-text frame under the point, or null where text
// painted over it covers the point — the elements above it are walked in paint order.
// A shape's outline is an SVG path, and only it and the shape's text take the hit.
function frameBehindPoint(view: EditorView, x: number, y: number): Element | null {
  const doc = view.dom.ownerDocument;
  for (const el of doc.elementsFromPoint(x, y)) {
    if (el.closest('[data-wrap="through"]') && view.dom.contains(el)) return el;
    if (el instanceof HTMLElement && textUnder(el, x, y)) return null;
  }
  return null;
}

// Whether one of the element's own text runs covers the point: a hit on its box alone
// is the empty part of a line or a paragraph, which the frame under it may take.
function textUnder(el: HTMLElement, x: number, y: number): boolean {
  const range = el.ownerDocument.createRange();
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== 3 || !node.nodeValue?.trim()) continue;
    range.selectNodeContents(node);
    for (const r of Array.from(range.getClientRects())) {
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
  }
  return false;
}

// A line carrying nothing but an as-character image is as tall as the image or the
// block's line height, whichever is more — no text descent hangs below it (probed
// against LibreOffice). Whitespace beside the image adds none, which CSS cannot ask.
const imageLineKey = new PluginKey('imageLine');

// Hard breaks are the only line boundaries visible in the model, so a frame is taken
// as alone on its line when nothing but whitespace shares its break-delimited run —
// the image-plus-caption idiom. A soft wrap around it can't be seen from here.
function blockImageLines(node: PMNode, pos: number, decos: Decoration[]): void {
  let images: number[] = [];
  let text = false;
  // 'true': a full-width float rides this block, so its successor clears the band;
  // 'anchored': every such float is page-anchored — the successor must not clear.
  let band: 'true' | 'anchored' | null = null;
  const flush = () => {
    if (!text) for (const at of images) decos.push(Decoration.node(at, at + 1, { class: 'image-line' }));
    images = [];
    text = false;
  };
  node.forEach((child, offset) => {
    if (child.type.name === 'hardBreak') flush();
    else if (child.type.name === 'image') {
      const wrap = child.attrs.wrap ?? 'inline';
      if (wrap === 'inline') images.push(pos + 1 + offset);
      if (wrap === 'topBottom' && band !== 'true') band = child.attrs.anchorPage ? 'anchored' : 'true';
    } else if (child.isText ? child.text?.trim() : true) text = true;
  });
  flush();
  // The attribute editor.css keys the clearing on — an attribute, since a `:has()`
  // there makes Chromium restyle the whole document on every insertion.
  if (band) decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-wrap-band': band }));
}

// A textblock holding an as-character box holds that box's paragraphs too.
const holdsBlocks = (block: PMNode): boolean => {
  for (let i = 0; i < block.childCount; i++) if (!block.child(i).isLeaf) return true;
  return false;
};

function imageLineDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    blockImageLines(node, pos, decos);
    return holdsBlocks(node);
  });
  return DecorationSet.create(doc, decos);
}

// Only the textblocks an edit touched are read again, the rest mapped: a keystroke would
// otherwise walk the whole document. A step that moves nothing (an attribute set in place)
// has no range to go by, so it reads them all.
const RANGED = [ReplaceStep, ReplaceAroundStep, AddMarkStep, RemoveMarkStep];
function mapImageLines(tr: Transaction, old: DecorationSet): DecorationSet {
  if (!tr.steps.every((s) => RANGED.some((type) => s instanceof type))) return imageLineDecorations(tr.doc);
  const set = old.map(tr.mapping, tr.doc);
  const [range] = changedRanges(tr);
  if (!range) return set;
  const { doc } = tr, stale: Decoration[] = [], fresh: Decoration[] = [];
  doc.nodesBetween(Math.max(0, range.from - 1), Math.min(doc.content.size, range.to + 1), (node, pos) => {
    if (!node.isTextblock) return true;
    const end = pos + node.nodeSize;
    stale.push(...set.find(pos, end).filter((d) => d.from >= pos && d.to <= end));
    blockImageLines(node, pos, fresh);
    return holdsBlocks(node);
  });
  return set.remove(stale).add(doc, fresh);
}

function imageLinePlugin(): Plugin {
  return new Plugin({
    key: imageLineKey,
    state: {
      init: (_, state) => imageLineDecorations(state.doc),
      apply: (tr, old) => (tr.docChanged ? mapImageLines(tr, old) : old),
    },
    props: { decorations(state) { return imageLineKey.getState(state); } },
  });
}

const WAITING_SRC = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="none"><rect width="1" height="1" fill="#e5e7eb"/></svg>')}`;

// Node view: a bounding-box wrapper (reserves the rotated footprint for text flow)
// holds a centered, rotated "rotor" with the <img>, eight resize handles (corners
// aspect-locked, edges single-axis) and a rotate grip — all rotating with the image.
class ImageView {
  dom: HTMLElement;
  private rotor: HTMLElement;
  private img: HTMLImageElement;
  private badge: HTMLElement;
  private node: PMNode;
  private editor: Editor;
  // Handed in with the node: editor.view is not there yet while a saved document builds.
  private view: EditorView;
  private getPos: () => number;
  // Live offsets while a free drag runs (cm), added to the node's own by offX/offY.
  private dragBy: { x: number; y: number } | null = null;
  private dragX = 0;
  private unwait: (() => void) | null = null;

  constructor(node: PMNode, editor: Editor, getPos: () => number, view: EditorView) {
    this.node = node;
    this.editor = editor;
    this.view = view;
    this.getPos = getPos;

    this.dom = document.createElement('span');
    this.dom.className = 'image-node';

    this.rotor = document.createElement('span');
    this.rotor.className = 'image-rotor';

    this.img = document.createElement('img');
    this.showSrc();
    this.img.alt = (node.attrs.alt as string) ?? '';
    // Pasted/HTML images may arrive without dimensions; adopt their natural size
    // (capped to the text column) so every image is explicitly sized.
    this.img.onload = () => this.adoptNaturalSize();
    // Dragging an image live re-anchors it to the text position under the cursor so the
    // surrounding text reflows in real time — inline and floating alike.
    this.img.addEventListener('mousedown', e => this.startReposition(e as MouseEvent));
    const clip = document.createElement('span');
    clip.className = 'image-crop';
    clip.appendChild(this.img);
    this.rotor.appendChild(clip);
    this.applyCrop();
    this.applyColorMode();

    for (const cfg of HANDLES) {
      const h = document.createElement('span');
      h.className = `image-resize-handle image-resize-${cfg.k}`;
      h.addEventListener('mousedown', e => this.startResize(e as MouseEvent, cfg));
      this.rotor.appendChild(h);
    }
    const rot = document.createElement('span');
    rot.className = 'image-rotate-handle';
    rot.addEventListener('mousedown', e => this.startRotate(e as MouseEvent));
    this.rotor.appendChild(rot);

    this.dom.appendChild(this.rotor);

    // Live "Width … × Height …" readout shown while resizing (on the axis-aligned
    // wrapper so it stays upright even when the image is rotated).
    this.badge = document.createElement('span');
    this.badge.className = 'image-size-badge';
    this.dom.appendChild(this.badge);

    this.applyLayout(this.attrW(), this.attrH(), this.attrRot());
    this.applyWrap();
    // The frame is not in the document yet, so a sunk one has nothing to measure against.
    requestAnimationFrame(() => this.sinkToOffset());
  }

  private showBadge(w: number, h: number): void {
    const cm = (px: number) => ((px * 2.54) / 96).toFixed(2);
    this.badge.textContent = `Width ${cm(w)} cm × Height ${cm(h)} cm`;
    this.badge.style.display = 'block';
  }

  private attrW(): number | null { const w = this.node.attrs.width; return typeof w === 'number' ? w : null; }
  private attrH(): number | null { const h = this.node.attrs.height; return typeof h === 'number' ? h : null; }
  private attrRot(): number { return (this.node.attrs.rotation as number) || 0; }
  private attrWrap(): WrapMode { const w = this.node.attrs.wrap; return w === 'left' || w === 'right' || w === 'topBottom' || w === 'through' ? w : 'inline'; }
  // The wrapper's reserved (rotated) width, which applyLayout has just written.
  private boxWidth(): number { return parseFloat(this.dom.style.width) || this.attrW() || 0; }
  // The frame's offsets, carrying a running drag. Without one the attr passes through
  // as it stands: null means "no offset stated", which places the frame flush.
  private offX(): unknown { return this.dragBy ? this.dragX + this.dragBy.x : this.node.attrs.wrapOffset; }
  private offY(): unknown { const v = this.node.attrs.wrapOffsetY; return this.dragBy ? (typeof v === 'number' ? v : 0) + this.dragBy.y : v; }
  // A frame out of the flow is placed by those offsets alone, so it is dragged by them.
  private isFree(): boolean { return this.attrWrap() === 'through' || typeof this.node.attrs.anchorPage === 'number' || this.inZone(); }
  // Any frame of a zone's own that is not in its line is out of the zone's text flow.
  private inZone(): boolean {
    return this.attrWrap() !== 'inline' && !!(this.view.dom as HTMLElement).closest('.hf-zone');
  }
  // A zone's frame set against the page or its body text is out of the zone's flow: the
  // layer places it there and moves the body clear of it (HeaderFooterLayer).
  private pastZone(): boolean {
    const a = this.node.attrs;
    return this.attrWrap() !== 'inline' && (a.wrapFromBody === true || a.wrapFromPage === true)
      && !!(this.view.dom as HTMLElement).closest('.hf-zone');
  }

  // Size the rotor to w×h, rotate it about its centre, and grow the axis-aligned
  // wrapper to the rotated bounding box so the line reserves the right space.
  private applyLayout(w: number | null, h: number | null, deg: number): void {
    if (w && h) {
      this.rotor.style.width = `${w}px`;
      this.rotor.style.height = `${h}px`;
      // Out of the flow the offsets place the unrotated box, as both formats do.
      const rad = this.isFree() ? 0 : (deg * Math.PI) / 180;
      const bw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
      const bh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
      this.dom.style.width = `${bw}px`;
      this.dom.style.height = `${bh}px`;
      this.dom.style.verticalAlign =
        inlineVerticalAlign(this.node.attrs.vAlign, bh, this.node.attrs.wrapOffsetY);
      // A frame alone on its line is the whole line, so where it sits against a baseline
      // no longer means anything — except an offset, which still lengthens the line.
      this.dom.dataset.vAlign = String(this.node.attrs.vAlign ?? '');
    } else {
      this.rotor.style.width = '';
      this.rotor.style.height = '';
      this.dom.style.width = '';
      this.dom.style.height = '';
      this.dom.style.verticalAlign = '';
    }
    this.rotor.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
  }

  // Float the wrapper per wrap mode so text flows beside it at its anchor paragraph
  // (left/right) or only above/below it (topBottom). The live re-anchor drag keeps it
  // where the text is.
  private applyWrap(): void {
    const d = this.dom;
    const wrap = this.attrWrap();
    // Mirrors renderHTML's data-wrap, so one selector reaches a floating frame in the
    // live view and in generated static HTML alike.
    if (wrap === 'inline') delete d.dataset.wrap; else d.dataset.wrap = wrap;
    d.style.float = '';
    d.style.display = '';
    d.style.clear = '';
    d.style.margin = '';
    d.style.shapeOutside = '';
    delete d.dataset.sinkGap;
    delete d.dataset.gapTop;
    d.style.position = '';
    d.style.zIndex = '';
    d.style.top = '';
    d.style.left = '';
    this.rotor.style.top = '';
    clearPagePlace(d);
    const a = this.node.attrs;
    if (typeof a.anchorPage === 'number' && a.anchorPage > 0) {
      this.applyPageAnchor(a.anchorPage);
      return;
    }
    delete d.dataset.anchorPage;
    if (wrap !== 'through' && this.pastZone()) {
      applyRunThrough(d, this.offX(), this.offY(), true, a.wrapFromPage === true, a.wrapFromBody === true, a.zIndex);
      return;
    }
    if (wrap !== 'through' && this.inZone()) {
      const edge = wrap === 'topBottom' ? (a.wrapAlign === 'left' || a.wrapAlign === 'right' ? a.wrapAlign : 'center') : wrap;
      runInZone(this.view, d, edge, this.offX(), this.offY(), a.wrapDist, a.zIndex);
      return;
    }
    if (wrap === 'through') {
      applyRunThrough(d, this.offX(), this.offY(), a.inFront === true, a.wrapFromPage === true, a.wrapFromBody === true, a.zIndex);
      // Deferred like sinkToOffset: the frame has to be laid out before its own page
      // can be read off the grid. Its column only needs it in the document, so a frame
      // already there (a drag, an edit) lands at once instead of a frame late.
      if (!a.wrapFromPage && !a.wrapFromBody && d.isConnected) placeInColumn(this.view, d);
      else placeFrameSoon(this.view, d);
      return;
    }
    if (wrap === 'left' || wrap === 'right') {
      d.style.float = wrap;
      d.style.margin = frameMargins(wrap, a.wrapOffset, this.boxWidth(), null, a.wrapDist);
      unstackFloat(d, wrap, a.wrapOffset, a.wrapDist);
      this.sinkToOffset();
    } else if (wrap === 'topBottom' && (a.wrapAlign === 'left' || a.wrapAlign === 'right')) {
      // Sharing its band with the frame set against the other end (the importers only
      // keep wrapAlign for such a pair): each floats to its own side, so both fit.
      d.style.float = a.wrapAlign;
      d.style.clear = a.wrapAlign;
      d.style.margin = frameMargins(wrap, null, 0, a.wrapOffsetY, a.wrapDist);
      this.sinkToOffset();
    } else if (wrap === 'topBottom') {
      // A full-width float (not display:block — which on an inline atom node view
      // disrupts ProseMirror's view + page-break spacer widgets): text can only flow
      // above/below it. applyLayout reset the width to the box; widen to the column here.
      d.style.float = 'left';
      d.style.clear = 'both';
      d.style.width = '100%';
      d.style.margin = frameMargins(wrap, null, 0, a.wrapOffsetY, a.wrapDist);
      this.sinkToOffset();
    }
    // The wrapper spans the column, so the picture's own x is the rotor's place in it
    // (the rotor is centred by CSS); every other mode positions the wrapper itself.
    const x = wrap === 'topBottom' && !a.wrapAlign ? a.wrapOffset : null;
    this.rotor.style.left = typeof x === 'number'
      ? `${Math.round(cmToPx(x)) + (parseFloat(this.rotor.style.width) || 0) / 2}px` : '';
  }

  // Placed from its page's top-left corner, behind the text like the header layer's page
  // background — unless the file's own run-through says otherwise (inFront). Its paragraph
  // collapses to nothing (editor.css), so it takes no flow space either way. Both corners
  // come from the grid: a section on its own paper makes the pages differ in height, and
  // a page narrower than the sheet is centred in it rather than starting at its edge.
  private applyPageAnchor(page: number): void {
    const d = this.dom;
    d.dataset.anchorPage = String(page);
    const px = (cm: unknown) => Math.round(cmToPx(typeof cm === 'number' ? cm : 0));
    d.style.position = 'absolute';
    d.style.zIndex = stackZ(this.node.attrs.inFront === true, this.node.attrs.zIndex, true);
    const grid = readVerticalMargins(this.view.dom as HTMLElement).grid;
    d.style.left = `${grid.leftOf(page) + px(this.offX())}px`;
    d.style.top = `${grid.topOf(page) + px(this.offY())}px`;
  }

  // A side float's lines run beside the offset as Word keeps them (sinkSideFloat).
  private sinkToOffset(): void {
    const top = gapPx(wrapGap(this.node.attrs.wrapDist).top);
    const gap = sinkToOffset(this.dom, this.node.attrs.wrapOffsetY);
    const wrap = this.attrWrap();
    if (gap === null || (wrap !== 'left' && wrap !== 'right')) return;
    this.dom.dataset.sinkGap = String(gap);
    this.dom.dataset.gapTop = String(top);
    sinkSideFloat(this.dom);
  }

  // Drag an image to re-anchor it live to the text position under the cursor (text
  // reflows in real time, throttled): a float re-anchors on a line change, an inline
  // image to the exact character. Every move is recorded, grouped into one undo step: a
  // move left out of the history was rebased under the first, and undo kept both copies.
  // The press selects the image, as it does a shape, so its frame shows while it moves.
  private startReposition(event: MouseEvent): void {
    if (!this.editor.isEditable) return;
    const pos = this.getPos();
    if (typeof pos === 'number') this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
    if (this.isFree()) { this.startFreeDrag(event); return; }
    event.preventDefault();
    event.stopPropagation();
    const view = this.view;
    const origPos = this.getPos();
    if (typeof origPos !== 'number') return;
    const win = this.dom.ownerDocument.defaultView ?? window;

    let curPos = origPos;
    let firstMove = true;
    const group = {}; // history merges transactions sharing a composition value
    let raf = 0;
    let lastX = event.clientX;
    let lastY = event.clientY;

    const lineTop = (pos: number): number | null => {
      try { return coordsAt(view, pos).top; } catch { return null; }
    };

    // Re-anchor the image at the exact text position under the cursor (so it follows
    // line by line, not paragraph by paragraph), but only when the cursor's line differs
    // from the image's current line — a float won't move within a line, so skip churn.
    const step = (): void => {
      raf = 0;
      const found = view.posAtCoords({ left: lastX, top: lastY });
      if (!found) return;
      const target = found.pos;
      if (target === curPos || target === curPos + 1) return;
      const $t = view.state.doc.resolve(target);
      if (!$t.parent.isTextblock) return;
      // A float can't move within a line — skip re-anchoring until the cursor's line
      // changes; an inline image follows the cursor to the exact position.
      if (this.attrWrap() !== 'inline') {
        const curY = lineTop(curPos);
        const tgtY = lineTop(target);
        if (curY != null && tgtY != null && Math.abs(curY - tgtY) < 6) return;
      }
      const node = view.state.doc.nodeAt(curPos);
      if (!node || node.type.name !== 'image') return;
      try {
        const tr = view.state.tr;
        tr.delete(curPos, curPos + node.nodeSize);
        const ip = tr.mapping.map(target);
        tr.insert(ip, node);
        tr.setSelection(NodeSelection.create(tr.doc, ip));
        tr.setMeta('composition', group);
        if (firstMove) closeGroup(tr);
        view.dispatch(tr);
        curPos = ip;
        firstMove = false;
      } catch { /* target can't hold an inline image — ignore */ }
    };

    const move = (e: MouseEvent): void => {
      if (!e.buttons) { finish(); return; }
      lastX = e.clientX;
      lastY = e.clientY;
      if (!raf) raf = win.requestAnimationFrame(step);
    };
    // A release before the pending frame still drops the image where the pointer was last.
    const finish = (): void => {
      if (raf) { win.cancelAnimationFrame(raf); step(); }
      win.removeEventListener('mousemove', move);
      win.removeEventListener('mouseup', finish);
    };
    win.addEventListener('mousemove', move);
    win.addEventListener('mouseup', finish);
  }

  // A frame out of the flow moves by its own offsets instead of re-anchoring: nothing
  // wraps around it, so there is no text position to follow.
  private startFreeDrag(event: MouseEvent): void {
    this.dragX = freeDragX(this.view, this.dom, this.node.attrs.wrapOffset);
    startFreeMove(event, this.dom, { ...this.node.attrs, wrapOffset: this.dragX }, by => { this.dragBy = by; this.applyWrap(); },
      offsets => { if (offsets) this.commit(offsets); });
  }

  // A session key whose picture has not arrived shows a grey box of the picture's size,
  // so nothing reflows, until it comes.
  private showSrc(): void {
    this.unwait?.();
    this.unwait = null;
    const shown = shownSrc(this.node.attrs.src);
    const waiting = shown.startsWith(IDB_SRC);
    this.dom.classList.toggle('image-waiting', waiting);
    const url = waiting ? WAITING_SRC : shown;
    if (this.img.getAttribute('src') !== url) this.img.src = url;
    if (waiting) this.unwait = awaitImage(shown.slice(IDB_SRC.length), () => { this.unwait = null; this.showSrc(); }, this.dom);
  }

  destroy(): void {
    this.unwait?.();
  }

  private adoptNaturalSize(): void {
    if (this.attrW() != null && this.attrH() != null || this.dom.classList.contains('image-waiting')) return;
    const nw = this.img.naturalWidth;
    const nh = this.img.naturalHeight;
    if (!nw || !nh) return;
    const maxW = this.boxMaxWidth();
    let w = nw;
    let h = nh;
    if (w > maxW) { h = Math.round((h * maxW) / w); w = maxW; }
    this.commit({ width: Math.round(w), height: Math.round(h) });
  }

  // Largest width an image may take: the containing cell, else the page text column.
  private boxMaxWidth(): number {
    const box = (this.dom.closest('td,th') ?? this.dom.closest('.tiptap')) as HTMLElement | null;
    if (!box) return 10000;
    const cs = getComputedStyle(box);
    const w = box.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
    return Math.max(MIN_SIZE_PX, w || 10000);
  }

  private commit(attrs: Record<string, unknown>): void {
    const pos = this.getPos();
    if (typeof pos !== 'number') return;
    this.view.dispatch(atomAttrTr(this.editor.state, pos, { ...this.node.attrs, ...attrs }));
  }

  private startResize(event: MouseEvent, cfg: typeof HANDLES[number]): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.editor.isEditable) return;

    const startW = this.rotor.offsetWidth;
    const startH = this.rotor.offsetHeight;
    if (!startW || !startH) return;
    const aspect = startW / startH;
    const deg = this.attrRot();
    const th = (deg * Math.PI) / 180;
    const cosT = Math.cos(th);
    const sinT = Math.sin(th);
    // The wrapper is axis-aligned, so its scaled/unscaled width ratio is the zoom.
    const zoom = this.dom.getBoundingClientRect().width / this.dom.offsetWidth || 1;
    const maxW = this.boxMaxWidth();
    const maxH = pageContentHeightPx(this.dom);
    const sx = event.clientX;
    const sy = event.clientY;
    const win = this.dom.ownerDocument.defaultView ?? window;
    let lastW = startW;
    let lastH = startH;
    let moved = false;

    const move = (e: MouseEvent): void => {
      if (!e.buttons) { finish(); return; }
      // Un-rotate the screen delta onto the image's own axes so handles track the
      // pointer at any rotation.
      const dx = (e.clientX - sx) / zoom;
      const dy = (e.clientY - sy) / zoom;
      const lx = dx * cosT + dy * sinT;
      const ly = -dx * sinT + dy * cosT;
      if (cfg.aspect) {
        let w = clamp(startW + cfg.x * lx, MIN_SIZE_PX, maxW);
        let h = w / aspect;
        if (h > maxH) { h = maxH; w = h * aspect; }
        lastW = Math.round(w);
        lastH = Math.round(h);
      } else {
        if (cfg.x) lastW = Math.round(clamp(startW + cfg.x * lx, MIN_SIZE_PX, maxW));
        if (cfg.y) lastH = Math.round(clamp(startH + cfg.y * ly, MIN_SIZE_PX, maxH));
      }
      moved = true;
      this.applyLayout(lastW, lastH, deg);
      this.applyWrap();
      this.showBadge(lastW, lastH);
    };
    const finish = (): void => {
      win.removeEventListener('mousemove', move);
      win.removeEventListener('mouseup', finish);
      this.badge.style.display = 'none';
      if (moved) this.commit({ width: lastW, height: lastH });
    };
    win.addEventListener('mousemove', move);
    win.addEventListener('mouseup', finish);
  }

  private startRotate(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.editor.isEditable) return;

    const w = this.rotor.offsetWidth;
    const h = this.rotor.offsetHeight;
    const rect = this.dom.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const win = this.dom.ownerDocument.defaultView ?? window;
    let lastDeg = this.attrRot();
    let moved = false;

    const move = (e: MouseEvent): void => {
      if (!e.buttons) { finish(); return; }
      // Handle sits above centre, so 0° is straight up; Shift snaps to 15°.
      let ang = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
      if (e.shiftKey) ang = Math.round(ang / 15) * 15;
      lastDeg = ((Math.round(ang) % 360) + 360) % 360;
      moved = true;
      this.applyLayout(w, h, lastDeg);
      this.applyWrap();
    };
    const finish = (): void => {
      win.removeEventListener('mousemove', move);
      win.removeEventListener('mouseup', finish);
      if (moved) this.commit({ rotation: lastDeg });
    };
    win.addEventListener('mousemove', move);
    win.addEventListener('mouseup', finish);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    // The picture is drawn from the attrs alone: an unchanged attrs object is the
    // picture already on the page, and rewriting it costs a layout per picture.
    const drawn = node.attrs === this.node.attrs;
    this.node = node;
    if (drawn) return true;
    this.showSrc();
    this.img.alt = (node.attrs.alt as string) ?? '';
    this.applyLayout(this.attrW(), this.attrH(), this.attrRot());
    this.applyCrop();
    this.applyColorMode();
    this.applyWrap();
    return true;
  }

  // The kept part fills the frame: the picture is drawn that much larger and shifted,
  // and the crop box cuts off the rest (a box, not object-view-box: every engine and
  // the raster PDF's html2canvas clip an overflow).
  private applyCrop(): void {
    const c = cropOf(this.node.attrs.crop);
    const s = this.img.style;
    const w = c ? 1 - c.l - c.r : 1, h = c ? 1 - c.t - c.b : 1;
    s.position = c ? 'relative' : '';
    s.width = c ? `${100 / w}%` : '';
    s.height = c ? `${100 / h}%` : '';
    s.left = c ? `${(-100 * c.l) / w}%` : '';
    s.top = c ? `${(-100 * c.t) / h}%` : '';
  }

  // editor.css draws the mode from the attribute, which the static HTML carries too.
  private applyColorMode(): void {
    const mode = colorModeOf(this.node.attrs.colorMode);
    if (mode) this.img.dataset.colorMode = mode;
    else delete this.img.dataset.colorMode;
  }

  selectNode(): void {
    this.dom.classList.add('image-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('image-selected');
  }

  ignoreMutation(): boolean {
    return true;
  }

  // Keep ProseMirror out of all mouse handling on the image: startReposition owns the
  // drag (live re-anchor) for inline and floating images alike, and the resize/rotate
  // handles own theirs. Non-mouse events (keyboard, etc.) pass through to PM.
  stopEvent(event: Event): boolean {
    return event.type.startsWith('mouse');
  }
}
