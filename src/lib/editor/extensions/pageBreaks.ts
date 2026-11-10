import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { COLUMNS_FIT_MARGIN_PX, headFitPx } from './columns';
import { isLeftPage, printedPageNumber } from '../../storage/pageNumbering';
import { RESYNC_NOTES, setNoteAnchorPages } from './notes';

export type PageBreakDebugSnapshot = {
  timestamp: string;
  layout: {
    PAGE_HEIGHT: number;
    PAGE_GAP: number;
    PAGE_MARGIN_TOP: number;
    PAGE_MARGIN_BOTTOM: number;
    CONTENT_HEIGHT: number;
    CYCLE: number;
  };
  numPages: number;
  leaves: Array<{
    index: number;
    tag: string;
    kind: 'atomic' | 'splittable';
    // inTableCell = leaf lives in a cell of a too-tall row (content split). tableRow
    // = leaf is a whole table row (columns = colspan to bridge; isFirstRow breaks
    // before the wrapper rather than mid-table).
    inTableCell: boolean;
    tableRow: { columns: number; isFirstRow: boolean } | null;
    naturalTop: number;
    naturalHeight: number;
    textPreview: string;
    intraSpacerHeights: number[];
    effectiveTop: number;
    effectiveBottom: number;
    pageOfTop: number;
    pageOfBottom: number;
    contentStart: number;
    contentEnd: number;
    overflowsPageEnd: boolean;
  }>;
  placements: Array<{
    leafIndex: number;
    docPos: number | null;
    height: number;
    reason: string;
    // How the gap was bridged: 'table-row' = borderless <tr> spacer inside the
    // table (columns = its colspan), 'block' = normal <div> block spacer,
    // 'none' = no spacer emitted (e.g. an over-tall leaf that couldn't be pushed).
    spacerKind: 'block' | 'table-row' | 'none';
    columns: number | null;
  }>;
  renderedSpacers: Array<{
    height: number;
    offsetTopInDoc: number;
    viewportTop: number;
  }>;
  // In-cell table page breaks (where a too-tall cell's content flows across a page).
  // Unscaled document px relative to .tiptap's top — same values handed to
  // Editor.svelte via pm-pagecount to render the mask + gap overlay.
  tableBreakBands: TableBreakBand[];
  // Live snapshot of the rendered table-break overlay + table geometry, to check the
  // band-layer actually masks the table borders bleeding through each gap. Rects are
  // unscaled doc px relative to .tiptap (same space as leaves/bands). null before mount.
  overlay: OverlayDebug | null;
};

export type OverlayDebug = {
  scale: number;          // measured .paper transform scale (1 at 100% zoom)
  paperFound: boolean;
  bandLayerFound: boolean;
  // .band-layer's top/left in doc px relative to .tiptap. Should be ~(0,0): a non-zero
  // value means the overlay's coordinate origin is offset from the page, so every band
  // is painted off its intended gap (a prime suspect for "mask present but not covering").
  bandLayerOrigin: { top: number; left: number } | null;
  // Resolved page colours, to confirm the mask is opaque and the right colour.
  cssVars: { pageBg: string; pageBorder: string; bg: string };
  // Rendered .table-break-band mask rects (one per band) + their paint-relevant styles.
  bands: Array<{
    top: number; left: number; right: number; bottom: number;
    width: number; height: number; background: string; zIndex: string; position: string;
  }>;
  // Rendered .page-gap-stripe rects.
  stripes: Array<{ top: number; left: number; right: number; bottom: number; height: number }>;
  // Every <table> in the doc: its rendered box + the x of each vertical cell border
  // (the lines that bleed). A table taller than CONTENT_HEIGHT spans page gaps, so its
  // verticalEdges are exactly the lines a band must cover in each gap.
  tables: Array<{
    top: number; left: number; right: number; bottom: number;
    borderColor: string;
    verticalEdges: number[];
  }>;
};

// One page boundary crossed by a single continuous table box. All values are unscaled
// document px relative to .tiptap's top; Editor.svelte renders the mask + gap overlay
// from them inside the zoomed .paper. Carried on the pm-pagecount event detail.
export type TableBreakBand = {
  // Rounded openY (page-content-top where the table resumes) — the dedup id, so two
  // columns breaking at the same boundary collapse to one band.
  key: number;
  closeY: number;     // content-end of the closing page (band/mask top)
  height: number;     // bandSpan = marginBottom + gap + marginTop
  // True when the break falls between whole table rows: the spacer row draws the table's
  // own close/open lines there, so only the gap stripe is painted (a mask would double
  // them). False for in-cell splits.
  rowBreak: boolean;
  // Whether the table draws borders: only then does the mask close and reopen it.
  lines: boolean;
  left: number;       // the table's box left (mask left)
  width: number;      // the table's box width (mask width)
  marginBottom: number;
  gap: number;
};

const debugAccessors = new WeakMap<EditorView, () => PageBreakDebugSnapshot | null>();
const paginating = new WeakMap<EditorView, () => boolean>();

// True while a pass is running or one is queued: work that redraws the view waits for
// a false, or it pays for the redraw of the pass behind it.
export function isPaginating(view: EditorView): boolean {
  return paginating.get(view)?.() ?? false;
}

const layingOut = new WeakMap<EditorView, () => boolean>();
// True while a pass runs or is due next frame; one merely queued behind typing is not.
export function isLayingOut(view: EditorView): boolean {
  return layingOut.get(view)?.() ?? false;
}

export function getPageBreakDebug(view: EditorView): PageBreakDebugSnapshot | null {
  return debugAccessors.get(view)?.() ?? null;
}

// A4 page layout constants (px @96dpi). Page height (orientation-dependent) and
// margins (user-adjustable) are read per pass from live CSS vars; the values below
// are only portrait fallbacks.
const PAGE_HEIGHT = 1123;
export const PAGE_GAP = 20;
const DEFAULT_MARGIN_TOP = 96;
const DEFAULT_MARGIN_BOTTOM = 96;

// How far a section's header and footer reach into a page, as
// [topFirst, topRest, bottomFirst, bottomRest] px: what its body text has to clear on
// its own first page and on every later one. Editor.svelte measures them per section.
export type Band = [number, number, number, number];
const DEFAULT_BAND: Band = [DEFAULT_MARGIN_TOP, DEFAULT_MARGIN_TOP, DEFAULT_MARGIN_BOTTOM, DEFAULT_MARGIN_BOTTOM];
// Word/LibreOffice widow-orphan control: a page break never leaves fewer than this
// many lines of a paragraph behind, nor carries fewer than this many over. On by
// default in both (OOXML `w:widowControl`), so it is not configurable here.
const MIN_KEPT_LINES = 2;

export type VMargins = {
  top: number;
  bottom: number;
  contentHeight: number;
  pageHeight: number;
  cycle: number;
  // The page grid of the last pagination pass (Editor.svelte publishes its runs), so
  // every consumer resolves a page number against the same one.
  grid: PageGrid;
};

// Reads vertical page margins + page height (px) from the --user-* props the Layout
// panel writes (document-px, pairing directly with offsetTop below); side margins
// are ignored (they affect line wrapping, not pagination). Shared with columnsFlow.ts.
export function readVerticalMargins(dom: HTMLElement): VMargins {
  const cs = getComputedStyle(dom);
  // Header/footer-aware effective margins (Editor.svelte): equal the raw page margins
  // unless a header/footer grows past them, in which case the content area shrinks so
  // body text starts below the header / ends above the footer.
  const topEff = parseFloat(cs.getPropertyValue('--pb-content-top-rest'));
  const top = Number.isFinite(topEff) ? topEff : parseFloat(cs.getPropertyValue('--user-margin-top'));
  const bottomEff = parseFloat(cs.getPropertyValue('--pb-content-bottom-rest'));
  const bottom = Number.isFinite(bottomEff) ? bottomEff : parseFloat(cs.getPropertyValue('--user-margin-bottom'));
  const ph = parseFloat(cs.getPropertyValue('--user-page-height'));
  const mt = Number.isFinite(top) ? top : DEFAULT_MARGIN_TOP;
  const mb = Number.isFinite(bottom) ? bottom : DEFAULT_MARGIN_BOTTOM;
  const pageHeight = Number.isFinite(ph) ? ph : PAGE_HEIGHT;
  // Page 1's own zones may reach further than the others', and both pairs here are
  // section 1's — every later section carries its own in the grid's runs.
  const topFirst = parseFloat(cs.getPropertyValue('--pb-content-top-first'));
  const bottomFirst = parseFloat(cs.getPropertyValue('--pb-content-bottom-first'));
  const base: Band = [Number.isFinite(topFirst) ? topFirst : mt, mt,
    Number.isFinite(bottomFirst) ? bottomFirst : mb, mb];
  return {
    top: mt,
    bottom: mb,
    contentHeight: pageHeight - mt - mb,
    pageHeight,
    cycle: pageHeight + PAGE_GAP,
    grid: gridFromRuns(cs.getPropertyValue('--pb-page-runs'), pageHeight, base),
  };
}

// The content band of the page a document-px y falls on: where its body text may begin,
// where it must end, and what is left between the two. Everything that places itself
// against a page reads it here, so no consumer assumes a uniform page.
export function bandAt(vm: VMargins, y: number): { start: number; end: number; height: number } {
  const page = vm.grid.pageAt(y);
  const start = vm.grid.contentTopOf(page);
  const end = vm.grid.contentBottomOf(page);
  return { start, end, height: end - start };
}

// Rows a cell spans move as one: that cell is a single box, so a break between them
// would stretch it across the gap instead of splitting it. Returns each row's group
// leader; a group too tall for a page cannot be kept whole and leads itself. The
// `headerRows` a table repeats go with the row after them, as LibreOffice never leaves
// them alone at a page foot — their copy would open the next page above the same row.
export function rowSpanGroups(
  rows: { spans: number[]; top: number; height: number }[], contentHeight: number, headerRows = 0,
): number[] {
  const leader = rows.map((_, i) => i);
  for (let i = 0; i < rows.length; ) {
    let end = i === 0 ? Math.min(rows.length - 1, headerRows) : i;
    for (let j = i; j <= end; j++) {
      for (const span of rows[j].spans) {
        if (span > 1) end = Math.min(rows.length - 1, Math.max(end, j + span - 1));
      }
    }
    if (end > i && rows[end].top + rows[end].height - rows[i].top <= contentHeight) {
      for (let j = i; j <= end; j++) leader[j] = i;
    }
    i = end + 1;
  }
  return leader;
}

// "fromPage|height|left|topFirst|topRest|bottomFirst|bottomRest,…" — the runs the last
// pass reported (Editor.svelte publishes them). `left` is where the page sits in the
// sheet .paper reserves, which is the widest section's: a narrower page is centred in
// it, so anything placed from a page corner has to start there rather than at the sheet
// edge. The four reaches are the section's own; a run without them takes `base`.
export function gridFromRuns(raw: string, pageHeight: number, base: Band = DEFAULT_BAND): PageGrid {
  const grid = new PageGrid(pageHeight, 0, base);
  for (const part of raw.split(',')) {
    const [from, height, left, ...reach] = part.split('|').map(Number);
    if (Number.isFinite(from) && Number.isFinite(height) && from >= 1 && height > 0) {
      const band = reach.length === 4 && reach.every(Number.isFinite) ? (reach as Band) : base;
      grid.setFrom(from, height, Number.isFinite(left) ? left : 0, band);
    }
  }
  return grid;
}

// The rendered page grid. A page's top is the sum of the pages above it, so a section
// on its own paper (a landscape page amid portrait ones) shifts every page below it —
// the uniform document is just the one-run case. Heights are stored as runs, "every
// page from here on is this tall", so both lookups cost one pass over the sections.
// Whether the table a leaf sits in draws any cell border — a borderless one has no
// edges for a page-break band to close and reopen.
function tableDrawsBorders(el: HTMLElement): boolean {
  const cell = el.closest('table')?.querySelector('td, th');
  if (!cell) return false;
  const cs = getComputedStyle(cell);
  return (['Top', 'Right', 'Bottom', 'Left'] as const).some((side) =>
    cs.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none' && parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0);
}

export class PageGrid {
  private runs: { from: number; height: number; left: number; band: Band }[];

  constructor(baseHeight: number, baseLeft = 0, baseBand: Band = DEFAULT_BAND) {
    this.runs = [{ from: 1, height: baseHeight, left: baseLeft, band: baseBand }];
  }

  /** Every page from `page` on is `height` tall, until a later section says otherwise. */
  setFrom(page: number, height: number, left = 0, band: Band = this.runs[0].band): void {
    while (this.runs.length > 1 && this.runs[this.runs.length - 1].from >= page) this.runs.pop();
    const last = this.runs[this.runs.length - 1];
    if (last.from === page) { last.height = height; last.left = left; last.band = band; }
    else if (last.height !== height || last.left !== left || last.band.some((v, i) => v !== band[i])) {
      this.runs.push({ from: Math.max(1, page), height, left, band });
    }
  }

  /** The run governing `page` — its section's paper and reaches. */
  private runAt(page: number) {
    let run = this.runs[0];
    for (const r of this.runs) if (r.from <= page) run = r;
    return run;
  }

  heightOf(page: number): number {
    return this.runAt(page).height;
  }

  /** Where the page's own left edge sits in the sheet — 0 where it fills it. */
  leftOf(page: number): number {
    return this.runAt(page).left;
  }

  /** Where body text may start on `page`: a run's first page keeps its section's "first"
   *  reach, every later one the "rest" reach — so a taller header shortens its own pages. */
  contentTopOf(page: number): number {
    const run = this.runAt(page);
    return this.topOf(page) + run.band[page === run.from ? 0 : 1];
  }

  /** Where it must end, above the footer's own reach. */
  contentBottomOf(page: number): number {
    const run = this.runAt(page);
    return this.topOf(page) + run.height - run.band[page === run.from ? 2 : 3];
  }

  /** Top of `page` in document px — the pages above it plus a gap each. */
  topOf(page: number): number {
    let top = 0;
    for (let i = 0; i < this.runs.length; i++) {
      const from = this.runs[i].from;
      if (from >= page) break;
      const until = Math.min(this.runs[i + 1]?.from ?? page, page);
      top += (until - from) * (this.runs[i].height + PAGE_GAP);
    }
    return top;
  }

  bottomOf(page: number): number {
    return this.topOf(page) + this.heightOf(page);
  }

  /** The page a document-px y falls on (its gap counts to the page above it). */
  pageAt(y: number): number {
    let page = 1;
    let top = 0;
    for (let i = 0; i < this.runs.length; i++) {
      const step = this.runs[i].height + PAGE_GAP;
      const pages = this.runs[i + 1] ? this.runs[i + 1].from - this.runs[i].from : Infinity;
      const spanned = Math.floor((y - top) / step);
      if (spanned < pages) return Math.max(1, page + Math.max(0, spanned));
      page += pages;
      top += pages * step;
    }
    return page;
  }

  /** One box per page, for the layers that paint them. */
  boxes(count: number): { top: number; height: number }[] {
    const out: { top: number; height: number }[] = [];
    let top = 0;
    for (let p = 1; p <= count; p++) {
      const height = this.heightOf(p);
      out.push({ top, height });
      top += height + PAGE_GAP;
    }
    return out;
  }
}

// Rendered page of an element: its offsetTop within the editor DOM (summed up the
// offsetParent chain, spacers included) resolved against the page grid. The TOC and
// every cross-reference resolve their page numbers with it.
export function pageOfElement(view: EditorView, el: HTMLElement, grid: PageGrid): number {
  return grid.pageAt(topInEditor(view, el));
}

// An element's top in document px from the editor's own top — spacers included, since
// they sit in the flow above it.
export function topInEditor(view: EditorView, el: HTMLElement): number {
  const tiptap = view.dom as HTMLElement;
  let top = 0;
  for (let n: HTMLElement | null = el; n && n !== tiptap; n = n.offsetParent as HTMLElement | null) {
    top += n.offsetTop;
  }
  return top;
}

// Its left, likewise — the same chain, so a frame reads both in one pass.
export function leftInEditor(view: EditorView, el: HTMLElement): number {
  const tiptap = view.dom as HTMLElement;
  let left = 0;
  for (let n: HTMLElement | null = el; n && n !== tiptap; n = n.offsetParent as HTMLElement | null) {
    left += n.offsetLeft;
  }
  return left;
}

// A run-through frame the file places against the page, not against its anchor (Word's
// positionH/V relativeFrom="page"): x counts from the text column, y from the top of the
// page the anchor lands on. Both are written as margins off the frame's static position,
// which is where the anchor character sits — so each is measured, not assumed.
export function placeFromPage(view: EditorView, el: HTMLElement, grid?: PageGrid): void {
  pagePlace(view, el, grid)?.();
}

// Measures first and returns the write. A run-through frame is out of the flow, so its
// static position is where it shows less its own margins, and no write moves another's.
function pagePlace(view: EditorView, el: HTMLElement, grid?: PageGrid): (() => void) | void {
  // A header/footer zone has no page grid of its own: its layer places the frame by CSS.
  if ((view.dom as HTMLElement).closest('.hf-zone')) return;
  const g = grid ?? readVerticalMargins(view.dom as HTMLElement).grid;
  const top = topInEditor(view, el) - (parseFloat(el.style.marginTop) || 0);
  const left = leftInEditor(view, el) - (parseFloat(el.style.marginLeft) || 0);
  const column = columnLeft(view, el);
  // One set against the body text counts from where that page's body begins.
  const page = g.pageAt(top);
  const from = el.dataset.fromBody != null ? g.contentTopOf(page) : g.topOf(page);
  const marginTop = `${Math.round(from + (Number(el.dataset.pageY) || 0) - top)}px`;
  const marginLeft = `${Math.round(column + (Number(el.dataset.pageX) || 0) - left)}px`;
  return () => {
    el.style.marginTop = marginTop;
    el.style.marginLeft = marginLeft;
  };
}

// Any other run-through frame keeps its y below the anchor, but its x counts from the
// column too (a table cell's, a text box's): the static position it starts from carries
// the anchor paragraph's indent and whatever text precedes the anchor in its line.
export function placeInColumn(view: EditorView, el: HTMLElement): void {
  if (together) together.push([view, el]);
  else columnPlace(view, el)?.();
}

// Inside `run` a frame placed in its column only queues, and all of them are placed as
// `run` ends — a resize observer refitting a page of boxes at once lays it out once.
let together: [EditorView, HTMLElement][] | null = null;
export function placeTogether(run: () => void): void {
  if (together) return run();
  together = [];
  try {
    run();
  } finally {
    const frames = together;
    together = null;
    placeFrames(frames);
  }
}

function columnPlace(view: EditorView, el: HTMLElement): (() => void) | void {
  if (!el.isConnected || el.dataset.columnX == null) return;
  const left = leftInEditor(view, el) - (parseFloat(el.style.marginLeft) || 0);
  const marginLeft = `${Math.round(frameColumn(view, el) + (Number(el.dataset.columnX) || 0) - left)}px`;
  return () => { el.style.marginLeft = marginLeft; };
}

// The x in cm a drag moves a run-through frame on from: its own, or for one placed in its
// column without an x, the static place it shows — any x the drag sets counts from the
// column instead, and starting from 0 would make the frame jump.
export function freeDragX(view: EditorView, el: HTMLElement, x: unknown): number {
  if (typeof x === 'number') return x;
  if (el.dataset.wrap !== 'through' || el.dataset.pageX != null || el.dataset.anchorPage != null) return 0;
  return Math.round(((leftInEditor(view, el) - frameColumn(view, el)) * 2.54 * 1000) / 96) / 1000;
}

function frameColumn(view: EditorView, el: HTMLElement): number {
  const box = el.parentElement?.closest<HTMLElement>('td, th, .textbox-content');
  return box ? leftInEditor(view, box) + (parseFloat(getComputedStyle(box).paddingLeft) || 0) : columnLeft(view, el);
}

// The body column's left edge: the page margin, and in a section with margins of its own
// the inset its top-level block carries (descendants clear it, editor.css).
function columnLeft(view: EditorView, el: HTMLElement): number {
  let block = el;
  while (block.parentElement && block.parentElement !== view.dom) block = block.parentElement;
  return (parseFloat(getComputedStyle(view.dom as HTMLElement).paddingLeft) || 0)
    + (parseFloat(getComputedStyle(block).getPropertyValue('--sec-inset-left')) || 0);
}

// A side float sunk below its anchor (image.ts) stops short of the next float on its
// side: floats cannot overlap as LibreOffice lets them, and one pushed aside squeezes its
// text. The room is known once the lines around both are laid out: every pass re-measures.
export function sinkSideFloat(view: EditorView, el: HTMLElement): void {
  const want = Number(el.dataset.sinkGap);
  if (!el.isConnected || !(want > 0)) return;
  const top = (e: HTMLElement) => {
    let y = -(parseFloat(e.style.marginTop) || 0);
    for (let n: HTMLElement | null = e; n && n !== view.dom; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
    return y;
  };
  const floats = Array.from((view.dom as HTMLElement).querySelectorAll<HTMLElement>(`[data-wrap="${el.dataset.wrap}"]`));
  const next = floats[floats.indexOf(el) + 1];
  const gap = next ? Math.min(want, Math.max(0, Math.floor(top(next) - top(el) - el.offsetHeight))) : want;
  // Text runs beside the offset down to the frame's own gap above it.
  el.style.marginTop = `${gap}px`;
  el.style.shapeOutside = `inset(${Math.max(0, gap - (Number(el.dataset.gapTop) || 0))}px 0 0 0) margin-box`;
}

// Pagination moves the page grid under those frames, so every pass re-places them.
export function placePageFrames(view: EditorView, grid: PageGrid): void {
  for (const el of Array.from((view.dom as HTMLElement).querySelectorAll<HTMLElement>('[data-sink-gap]'))) {
    sinkSideFloat(view, el);
  }
  placeFrames(Array.from((view.dom as HTMLElement).querySelectorAll<HTMLElement>(PLACED), (el) => [view, el]), grid);
}

const PLACED = '[data-page-y], [data-column-x]';

// A pane lays out exactly as the view it mirrors, so its frames take that view's
// margins instead of each measuring them again; one whose frames differ is measured.
function copyPageFrames(from: EditorView, to: EditorView, grid: PageGrid): void {
  const sel = `[data-sink-gap], ${PLACED}`;
  const src = (from.dom as HTMLElement).querySelectorAll<HTMLElement>(sel);
  const dst = (to.dom as HTMLElement).querySelectorAll<HTMLElement>(sel);
  if (src.length !== dst.length) return placePageFrames(to, grid);
  src.forEach((el, i) => {
    const twin = dst[i].style;
    if (twin.marginTop !== el.style.marginTop) twin.marginTop = el.style.marginTop;
    if (twin.marginLeft !== el.style.marginLeft) twin.marginLeft = el.style.marginLeft;
    if (twin.shapeOutside !== el.style.shapeOutside) twin.shapeOutside = el.style.shapeOutside;
  });
}

// Every frame is read before any is written: a write between two reads lays the
// document out again, in every pane at once. One inside another frame moves with it,
// so it is read once the outer ones have landed.
function placeFrames(frames: [EditorView, HTMLElement][], grid?: PageGrid): void {
  const grids = new Map<EditorView, PageGrid>();
  const gridOf = (view: EditorView) =>
    grid ?? grids.get(view) ?? grids.set(view, readVerticalMargins(view.dom as HTMLElement).grid).get(view)!;
  const inner = ([, el]: [EditorView, HTMLElement]) => !!el.parentElement?.closest(PLACED);
  for (const group of [frames.filter((f) => !inner(f)), frames.filter(inner)]) {
    const writes = group.map(([view, el]) => (!el.isConnected ? undefined
      : el.dataset.pageY != null ? pagePlace(view, el, gridOf(view)) : columnPlace(view, el)));
    for (const write of writes) write?.();
  }
}

// A frame a node view just laid out, placed on the next frame together with every other
// one built meanwhile: a document's worth of them costs one layout, not one each.
const placeQueue = new Map<HTMLElement, EditorView>();
export function placeFrameSoon(view: EditorView, el: HTMLElement): void {
  if (!placeQueue.size) {
    requestAnimationFrame(() => {
      const frames = Array.from(placeQueue, ([el, view]): [EditorView, HTMLElement] => [view, el]);
      placeQueue.clear();
      placeFrames(frames);
    });
  }
  placeQueue.set(el, view);
}

function pageContentStart(page: number, marginTop: number, grid: PageGrid): number {
  return grid.topOf(page) + marginTop;
}

// `recalc` counts forced recomputes, `edit` the document edits. Layout-only writes
// (addToHistory:false) bump neither, so the convergence brake in `update` can tell an
// answer to the last pass from a fresh change.
// textBlock: the textblock a text-only transaction stayed inside (its position), else null.
type PageBreakState = { recalc: number; edit: number; textBlock: number | null };

// Ancestors a leaf may have without the pass seeing more than the leaf: the walk
// descends these (CONTAINER_TAGS), and their height is the sum of their blocks'.
const FLOW_CONTAINERS = new Set(['bulletList', 'orderedList', 'listItem', 'blockquote']);
// Ancestors of a caret block the pass places on the page grid: not a note, frame or section.
const CARET_FLOW = new Set([...FLOW_CONTAINERS, 'table', 'tableRow', 'tableCell', 'tableHeader']);

// The textblock a transaction only put text into or took text out of — the one block
// whose height an edit like that can change. Null for anything else: a node, a split, a
// join, an edit in a cell, a note or a frame, whose height reaches further than itself.
function textOnlyBlock(tr: Transaction): number | null {
  let block: number | null = null;
  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i];
    if (!(step instanceof ReplaceStep) || step.slice.openStart || step.slice.openEnd) return null;
    let textOnly = true;
    step.slice.content.forEach((n) => { if (!n.isText) textOnly = false; });
    if (!textOnly) return null;
    const $from = tr.docs[i].resolve(step.from);
    if (!$from.parent.isTextblock || step.to > $from.end()) return null;
    for (let d = 1; d < $from.depth; d++) {
      if (!FLOW_CONTAINERS.has($from.node(d).type.name)) return null;
    }
    const b = $from.before();
    if (block !== null && block !== b) return null;
    block = b;
  }
  return block;
}

// Exported for tabStops.ts: a placement change moves lines, so the tab advances
// measured before it are stale.
export const pageBreakKey = new PluginKey<PageBreakState>('pageBreaks');

// Transaction meta flag: set it (e.g. when page margins change) to force a
// pagination recompute even though the document content is unchanged.
export const FORCE_PAGE_RECALC = 'forcePageBreakRecalc';

// A field that reads the settled layout — an index's page numbers, a cross-reference's.
// It measures, and what it returns writes: its own DOM, and its cached result on the
// round's transaction. A write may return one more phase, run after every other write.
export type FieldWrite = (tr: Transaction) => FieldWrite | void;
export type FieldRead = (vm: VMargins) => FieldWrite | void;

type FieldRound = { jobs: Map<object, FieldRead>; raf: number | null };
const fieldRounds = new WeakMap<EditorView, FieldRound>();

// Every field of one editor answers a pagination pass together: all measure before any
// writes, or each write lays the whole document out again for the next reader — and one
// transaction carries the results, a dispatch costing a view update over the document.
export function scheduleFieldRound(view: EditorView, owner: object, read: FieldRead): void {
  let round = fieldRounds.get(view);
  if (!round) fieldRounds.set(view, (round = { jobs: new Map(), raf: null }));
  round.jobs.set(owner, read);
  if (round.raf === null) round.raf = requestAnimationFrame(() => runFieldRound(view));
}

function runFieldRound(view: EditorView): void {
  const round = fieldRounds.get(view);
  if (!round) return;
  round.raf = null;
  // One reading of the page grid for the round: getComputedStyle is a style pass over
  // the whole document, and every field resolves its pages against the same grid.
  const vm = readVerticalMargins(view.dom as HTMLElement);
  let phase = Array.from(round.jobs.values(), (read) => read(vm));
  round.jobs.clear();
  const tr = view.state.tr.setMeta('addToHistory', false);
  // Bounded: measure, write, and the one read-back a write can ask for.
  for (let i = 0; i < 2 && phase.some(Boolean); i++) {
    phase = phase.map((write) => (write ? write(tr) : undefined));
  }
  // A field that only moved its own rows carries no document change, and still needs the
  // pass to measure the height it just changed.
  if (tr.docChanged || tr.getMeta(FORCE_PAGE_RECALC)) view.dispatch(tr);
}

// A split view's second pane (Editor.svelte marks its host). Both panes are the same
// width, so it renders the decorations the first pane's pass produced; a layout pass of
// its own would measure the same DOM twice and fight over the shared result.
export function isSplitPane(view: EditorView): boolean {
  return !!view.dom.closest('[data-split-pane]');
}

// The live split and grid panes. A frame placed by measurement sits on each view's own
// DOM, so the pass that moves the page grid re-places it in every pane of its document.
const panes = new Set<EditorView>();

// A table-row spacer: the colspan bridging the row, plus the lines that close the table
// at the break — LibreOffice draws the row separator the break falls on, or, where the
// rows carry none, the table's own box (its top border closes, its bottom border opens).
// `header` is set for a table that repeats its first row (ODF table:table-header-rows,
// Word w:tblHeader): the spacer grows by that row's height and draws a copy of it at the
// foot of the gap, which is the top of the continuation.
type RowSpacer = { columns: number; close: string; open: string; header: { html: string; height: number } | null };

// What a spacer's DOM shows, as the widget key: without one a fresh toDOM is a fresh
// widget, and an edit near the top moves — and so rebuilds — every spacer below it.
function spacerKey(p: { height: number; row?: RowSpacer | null }): string {
  if (!p.row) return `s${p.height}`;
  return `r${p.height}|${p.row.columns}|${p.row.close}|${p.row.open}|${p.row.header?.html ?? ''}`;
}

type Leaf = {
  el: HTMLElement;
  kind: 'atomic' | 'splittable';
  naturalTop: number;
  naturalHeight: number;
  // Set when the leaf is a <tr> of a paginated table; each row is atomic so the
  // table breaks between rows across pages. `isFirstRow` pushes the whole table (block
  // spacer before the wrapper); later rows push via a spacer <tr> inside the table.
  tableRow?: { columns: number; wrapperEl: HTMLElement; isFirstRow: boolean };
  // True for paragraph leaves from inside a too-tall cell whose content flows across
  // pages. Their breaks get a full-width close/open mask so the single continuous
  // table box looks closed at each page break (it can't break structurally).
  inTableCell?: boolean;
  // The block's space below (px). A word processor's paragraph frame includes it, so it
  // must fit on the page too — a block whose text fits but whose spacing doesn't moves.
  spaceAfter?: number;
  // The block's space above (px), always the declared one: the leaf is measured as if
  // the page-top drop below had not been applied, so a pass can't read its own answer.
  spaceAbove?: number;
  // The extra leading a spacing above single puts below the block's last line (px): it
  // may hang past the text area's bottom, which LibreOffice lets it (probed at 300%).
  hang?: number;
  // Manual page break before this block (ODF fo:break-before; pageBreak.ts): force the
  // leaf to the next page's top even when it would otherwise fit on the current page.
  forceBreakBefore?: boolean;
  // Keep with next (DOCX w:keepNext, ODF fo:keep-with-next; pageBreak.ts): the leaf
  // moves to the next page when its successor's first line no longer fits below it.
  keepNext?: boolean;
  // First block of a new section (pageBreak.ts `sectionBreak`): the page it lands on
  // is where that section's header/footer starts repeating.
  sectionStart?: boolean;
  // Flow brackets for a too-tall row's cells (each cell is an independent flow from
  // the row top, so placement resets cumulative shift per cell): cellStart = a cell's
  // first leaf, rowStart = the row's first cell, rowEnd = last leaf of the last cell.
  cellStart?: boolean;
  rowStart?: boolean;
  rowEnd?: boolean;
  // A multi-column section fragment (columns.ts): pagination only pushes it when
  // the first block alone can't fit the remaining space (else columnsFlow.ts splits
  // the overflow at a block boundary).
  // `spaceAbovePx`: the first block's space above, which a page break it makes keeps
  // (as `kept` below) above the whole section, so both columns start below it.
  columnsFragment?: { firstBlockNeededPx: number; spaceAbovePx: number };
  // Footnote anchors inside this leaf (notes.ts), at their spacer-free offset from its
  // top: the note goes to the page its anchor lands on, and a leaf split across a
  // boundary carries the anchors below the split onto the next page with it.
  refs?: NoteAnchor[];
};

type NoteAnchor = { id: string; dy: number };

// One footnote waiting for a place at the foot of its anchor's page.
type FootnoteBox = { id: string; el: HTMLElement; height: number };

// Reserving space for a page's notes moves its own anchors, which may change the page
// they sit on. The placement runs again on the new reservation until the two agree —
// bounded, because a note that keeps its own anchor moving never settles.
const MAX_NOTE_FIT_PASSES = 3;

/** A node decoration that survives its node being replaced (see repairDecos). */
export const blockDeco = (from: number, to: number, attrs: Record<string, string>): Decoration =>
  Decoration.node(from, to, attrs, { block: attrs });

export const isBlockDeco = (spec: { block?: Record<string, string> }): boolean => spec.block !== undefined;

/** A widget in front of a block that survives its neighbours being replaced. */
export const spacerDeco = (pos: number, toDOM: () => HTMLElement, key: string): Decoration =>
  Decoration.widget(pos, toDOM, { side: -1, key, spacer: toDOM });

/** A decoration repairDecos can restore when a mapping drops it. */
export const isRepairable = (spec: { block?: unknown; spacer?: unknown }): boolean =>
  spec.block !== undefined || spec.spacer !== undefined;

// The mapping drops a node decoration whose node a step replaced, and changing a block's
// type or attrs is exactly that step; a spacer between two blocks goes with either. Re-cut
// the node spans over the blocks the range now holds, and re-seat a spacer still before one.
export function repairDecos(before: DecorationSet, mapped: DecorationSet, tr: Transaction): DecorationSet {
  const decos = mapped.find(undefined, undefined, (spec) => !isBlockDeco(spec));
  for (const d of before.find(undefined, undefined, isBlockDeco)) {
    // A bound inside a deleted range means the block was replaced (an open), not restyled:
    // re-cut, its height would land on whatever blocks now fill the range.
    // Neighbours restyled in the same transaction delete both sides of every bound, so a
    // block whose content survived at its mapped place was restyled all the same.
    const inside = (p: number) => tr.mapping.mapResult(p, -1).deleted && tr.mapping.mapResult(p, 1).deleted;
    const old = tr.before.nodeAt(d.from);
    const kept = !!old && !!tr.doc.nodeAt(tr.mapping.map(d.from, -1))?.content.eq(old.content);
    if (!kept && (inside(d.from) || inside(d.to))) continue;
    const to = tr.mapping.map(d.to, 1);
    for (let pos = tr.mapping.map(d.from, -1); pos < to;) {
      const node = tr.doc.nodeAt(pos);
      if (!node?.isBlock) break;
      decos.push(blockDeco(pos, pos + node.nodeSize, d.spec.block));
      pos += node.nodeSize;
    }
  }
  for (const d of before.find(undefined, undefined, (spec) => spec.spacer !== undefined)) {
    if (!tr.mapping.mapResult(d.from, -1).deleted) continue;
    const pos = tr.mapping.map(d.from, 1);
    if (tr.doc.resolve(pos).nodeAfter?.isBlock) decos.push(spacerDeco(pos, d.spec.spacer, d.spec.key));
  }
  return DecorationSet.create(tr.doc, decos);
}

const ATOMIC_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const SPLITTABLE_TAGS = new Set(['P']);
const CONTAINER_TAGS = new Set(['UL', 'OL', 'LI', 'BLOCKQUOTE']);

export const PageBreaks = Extension.create({
  name: 'pageBreaks',

  addProseMirrorPlugins() {
    let decorations = DecorationSet.empty;
    let isUpdating = false;
    // The last pass's frame margins, which a grid cell that catches up later still takes
    // (Editor.svelte updates a cell off the caret's page only after a pause).
    let framesOf: { view: EditorView; doc: PMNode; grid: PageGrid } | null = null;
    const framesCopied = new WeakMap<EditorView, object>();
    let rafId: number | null = null;
    // A long document paginates slower than keys come, so an edit's pass waits for this
    // much quiet: while the typing goes on, only the keystroke itself costs.
    const EDIT_IDLE_MS = 300;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    // Where the content ended after the last pass: the same bottom after edits confined to
    // one textblock means no block moved, and the pass has nothing to find.
    let lastBottom = -1;
    // The textblock every edit since the last pass stayed inside; false once one didn't.
    let editBlock: number | null | false = null;
    let lastPlacementsKey = '';
    // The layout before the current one: two layouts can each imply the other (a block
    // below a float's overhang moves further than the model's spacer), so seeing the older
    // key return means a ping-pong. null, not '' — that is a spacer-free layout's own key.
    let prevPlacementsKey: string | null = null;
    let lastAnnounced = '';
    // Each pass measures against the spacers left by the previous pass, so a changed
    // result needs one more pass to re-measure and settle (see calculate). Bounded so
    // a hypothetical two-layout ping-pong can't loop forever; reset per external change.
    let convergePasses = 0;
    const MAX_CONVERGE_PASSES = 4;

    const plugin = new Plugin<PageBreakState>({
      key: pageBreakKey,
      // Counters `update` watches. The plugin's own decoration dispatches carry neither
      // FORCE_PAGE_RECALC nor a doc change, so this never self-triggers.
      state: {
        init: () => ({ recalc: 0, edit: 0, textBlock: null }),
        apply(tr, value) {
          // The spacers follow the text until the next pass: left unmapped, an edit above
          // them puts every widget one position off and the view tears them all down.
          if (tr.docChanged) {
            let dropped = false;
            const mapped = decorations.map(tr.mapping, tr.doc,
              { onRemove: (spec) => { dropped ||= isRepairable(spec); } });
            decorations = dropped ? repairDecos(decorations, mapped, tr) : mapped;
          }
          const recalc = value.recalc + (tr.getMeta(FORCE_PAGE_RECALC) ? 1 : 0);
          const edit = value.edit
            + (tr.docChanged && tr.getMeta('addToHistory') !== false ? 1 : 0);
          if (recalc === value.recalc && edit === value.edit) return value;
          const own = tr.docChanged ? textOnlyBlock(tr) : null;
          // An appended transaction rides its root's dispatch: both must name the block.
          const appended = tr.getMeta('appendedTransaction') !== undefined;
          return { recalc, edit, textBlock: appended && value.textBlock !== own ? null : own };
        },
      },
      props: {
        decorations() {
          return decorations;
        },
      },
      view(editorView) {
        if (isSplitPane(editorView)) {
          panes.add(editorView);
          return {
            update: (view) => {
              const f = framesOf;
              if (!f || view.state.doc !== f.doc || framesCopied.get(view) === f) return;
              framesCopied.set(view, f);
              copyPageFrames(f.view, view, f.grid);
            },
            destroy: () => panes.delete(editorView),
          };
        }
        let lastSnapshot: PageBreakDebugSnapshot | null = null;

        paginating.set(editorView, () => isUpdating || rafId !== null || idleTimer !== null);
        layingOut.set(editorView, () => isUpdating || rafId !== null);
        debugAccessors.set(editorView, (): PageBreakDebugSnapshot | null => {
          const snap: PageBreakDebugSnapshot | null = lastSnapshot;
          if (snap === null) return null;
          const dom = editorView.dom;
          const tipRect = dom.getBoundingClientRect();
          const renderedSpacers = Array.from(
            dom.querySelectorAll<HTMLElement>('[data-page-break-spacer]'),
          ).map((sp) => {
            const r = sp.getBoundingClientRect();
            return {
              height: sp.offsetHeight,
              offsetTopInDoc: r.top - tipRect.top,
              viewportTop: r.top,
            };
          });
          return { ...snap, renderedSpacers, overlay: captureOverlay(tipRect) };
        });

        // Capture the rendered table-break overlay + table geometry from the live DOM.
        // .band-layer is a sibling inside .paper, reached by climbing to .paper. Viewport
        // rects are divided by the paper scale → unscaled doc px, same space as bands/leaves.
        function captureOverlay(tipRect: DOMRect): OverlayDebug {
          const dom = editorView.dom;
          const offH = dom.offsetHeight;
          const scale = offH ? tipRect.height / offH : 1;
          const toDoc = (r: DOMRect) => ({
            top: (r.top - tipRect.top) / scale,
            bottom: (r.bottom - tipRect.top) / scale,
            left: (r.left - tipRect.left) / scale,
            right: (r.right - tipRect.left) / scale,
          });
          const paper = dom.closest('.paper') as HTMLElement | null;
          const bandLayer = paper?.querySelector('.band-layer') as HTMLElement | null;
          const bandEls = paper
            ? Array.from(paper.querySelectorAll<HTMLElement>('.table-break-band'))
            : [];
          const stripeEls = paper
            ? Array.from(paper.querySelectorAll<HTMLElement>('.page-gap-stripe'))
            : [];
          const cs = getComputedStyle(dom);
          return {
            scale,
            paperFound: !!paper,
            bandLayerFound: !!bandLayer,
            bandLayerOrigin: bandLayer
              ? (() => { const d = toDoc(bandLayer.getBoundingClientRect()); return { top: d.top, left: d.left }; })()
              : null,
            cssVars: {
              pageBg: cs.getPropertyValue('--color-page-bg').trim(),
              pageBorder: cs.getPropertyValue('--color-page-border').trim(),
              bg: cs.getPropertyValue('--color-bg').trim(),
            },
            bands: bandEls.map((e) => {
              const d = toDoc(e.getBoundingClientRect());
              const ecs = getComputedStyle(e);
              return {
                top: d.top, left: d.left, right: d.right, bottom: d.bottom,
                width: d.right - d.left, height: d.bottom - d.top,
                background: ecs.backgroundColor, zIndex: ecs.zIndex, position: ecs.position,
              };
            }),
            stripes: stripeEls.map((e) => {
              const d = toDoc(e.getBoundingClientRect());
              return { top: d.top, left: d.left, right: d.right, bottom: d.bottom, height: d.bottom - d.top };
            }),
            tables: Array.from(dom.querySelectorAll<HTMLElement>('table')).map((t) => {
              const d = toDoc(t.getBoundingClientRect());
              // x of each vertical cell border: use the first body row's cells' left edges
              // plus the row's right edge. These are the lines that bleed across gaps.
              const firstRow = t.querySelector('tbody > tr:not([data-page-break-spacer])') as HTMLElement | null;
              const cells = firstRow
                ? (Array.from(firstRow.children) as HTMLElement[]).filter(c => c.tagName === 'TD' || c.tagName === 'TH')
                : [];
              const verticalEdges: number[] = [];
              for (const c of cells) verticalEdges.push(toDoc(c.getBoundingClientRect()).left);
              if (cells.length) verticalEdges.push(toDoc(cells[cells.length - 1].getBoundingClientRect()).right);
              const firstCell = cells[0];
              return {
                top: d.top, left: d.left, right: d.right, bottom: d.bottom,
                borderColor: firstCell ? getComputedStyle(firstCell).borderTopColor : '',
                verticalEdges,
              };
            }),
          };
        }

        // Memoised per pass: a leaf is asked twice (its spacer, its page-top rule), and
        // each answer walks the parent's children linearly on both sides of posAtDOM.
        let posMemo = new Map<HTMLElement, number | null>();
        function docPosBeforeElement(el: HTMLElement): number | null {
          const memo = posMemo.get(el);
          if (memo !== undefined) return memo;
          const parent = el.parentNode;
          if (!parent) return null;
          let childIndex = 0;
          for (let n = parent.firstChild; n && n !== el; n = n.nextSibling) childIndex++;
          let pos: number | null;
          try {
            pos = editorView.posAtDOM(parent as Node, childIndex);
          } catch {
            pos = null;
          }
          posMemo.set(el, pos);
          return pos;
        }

        // The display scale (.paper has `transform: scale()`): the ratio of .tiptap's
        // painted height to its unscaled offsetHeight. findLineSplit uses it to convert
        // scaled glyph rects back to document px.
        function getScaleFactor(): number {
          const r = editorView.dom.getBoundingClientRect();
          const h = editorView.dom.offsetHeight;
          return h ? r.height / h : 1;
        }

        function previousNonSpacerSibling(el: HTMLElement): HTMLElement | null {
          let prev = el.previousElementSibling as HTMLElement | null;
          while (prev && prev.dataset?.pageBreakSpacer) {
            prev = prev.previousElementSibling as HTMLElement | null;
          }
          return prev;
        }

        // Render the spacer OUTSIDE any <li> wrapper so the bullet marker stays
        // aligned with its text. Walk up <li> ancestors, but stop once `target` has a
        // prior sibling, or we'd also push earlier paragraphs already placed in the LI.
        function preLeafDocPos(leafEl: HTMLElement): number | null {
          let target = leafEl;
          while (
            target.parentElement &&
            target.parentElement.tagName === 'LI' &&
            !previousNonSpacerSibling(target)
          ) {
            target = target.parentElement;
          }
          return docPosBeforeElement(target);
        }

        // What a cell edge draws, as a border shorthand ('' where it draws nothing).
        function edgeLine(cell: Element | null, side: 'Top' | 'Bottom'): string {
          if (!cell) return '';
          const cs = getComputedStyle(cell);
          const width = side === 'Top' ? cs.borderTopWidth : cs.borderBottomWidth;
          const style = side === 'Top' ? cs.borderTopStyle : cs.borderBottomStyle;
          const color = side === 'Top' ? cs.borderTopColor : cs.borderBottomColor;
          return parseFloat(width) > 0 && style !== 'none' ? `${width} ${style} ${color}` : '';
        }

        // The lines closing the table where a break falls before row `tr` (see RowSpacer).
        // The first cell speaks for the row: a spacer bridges every column with one <td>.
        function splitLines(tr: HTMLElement): { close: string; open: string } {
          const cell = (r: Element | null | undefined) => r?.firstElementChild ?? null;
          const sep = edgeLine(cell(tr), 'Top') || edgeLine(cell(previousNonSpacerSibling(tr)), 'Bottom');
          if (sep) return { close: sep, open: sep };
          const rows = Array.from(tr.parentElement?.children ?? [])
            .filter((r) => r.tagName === 'TR' && !(r as HTMLElement).dataset?.pageBreakSpacer);
          return {
            close: edgeLine(cell(rows[0]), 'Top'),
            open: edgeLine(cell(rows[rows.length - 1]), 'Bottom'),
          };
        }

        // The first row of a table that repeats it, as markup plus its rendered height.
        // The copy carries the table's own <colgroup>, so the columns line up.
        function repeatedHeader(wrapperEl: HTMLElement): { html: string; height: number } | null {
          const tableEl = wrapperEl.querySelector('table') as HTMLElement | null;
          if (!tableEl || tableEl.dataset.repeatHeader !== 'true') return null;
          const first = Array.from(tableEl.querySelectorAll('tr'))
            .find((r) => !(r as HTMLElement).dataset?.pageBreakSpacer) as HTMLElement | undefined;
          if (!first) return null;
          const colgroup = tableEl.querySelector('colgroup');
          return {
            html: `<table style="width:100%;table-layout:fixed;border-collapse:collapse">`
              + (colgroup?.outerHTML ?? '')
              + `<tbody>${first.outerHTML}</tbody></table>`,
            height: first.offsetHeight,
          };
        }

        // Where to place a leaf's page-break spacer, and whether it must be a
        // table row (so the widget is valid markup inside a <tbody>).
        function leafSpacer(leaf: Leaf): { docPos: number | null; row: RowSpacer | null } {
          if (leaf.tableRow) {
            // First row crossing the boundary → push the whole table with a block
            // spacer before the wrapper (otherwise the table's top would be
            // orphaned above an in-table gap).
            if (leaf.tableRow.isFirstRow) {
              return { docPos: preLeafDocPos(leaf.tableRow.wrapperEl), row: null };
            }
            // Later rows → a spacer <tr> before the row pushes it (and the rows
            // after it) to the next page while the table stays one element.
            return {
              docPos: docPosBeforeElement(leaf.el),
              row: {
                columns: leaf.tableRow.columns,
                ...splitLines(leaf.el),
                header: repeatedHeader(leaf.tableRow.wrapperEl),
              },
            };
          }
          return { docPos: preLeafDocPos(leaf.el), row: null };
        }

        // One Range for every measurement: a live Range is a document listener, and a pass
        // that leaves hundreds behind slows every DOM removal until the next collection.
        const lineRange = document.createRange();

        // Walks text nodes and inline images inside `el`, skipping any that live inside
        // a spacer widget, and returns one rect per visual line (in viewport coords).
        function getLineRects(el: HTMLElement): { top: number; bottom: number }[] {
          const allRects: DOMRect[] = [];
          // An as-character image is a line box of its own: without it a paragraph of
          // images has no lines at all and can only paginate whole.
          const atomRects = new Set<DOMRect>();
          for (const img of Array.from(el.querySelectorAll<HTMLElement>('.image-node'))) {
            if (img.style.float) continue;
            const rect = img.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              allRects.push(rect);
              atomRects.add(rect);
            }
          }
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
              let parent = node.parentElement;
              while (parent && parent !== el) {
                if ((parent as HTMLElement).dataset?.pageBreakSpacer) {
                  return NodeFilter.FILTER_REJECT;
                }
                parent = parent.parentElement;
              }
              return NodeFilter.FILTER_ACCEPT;
            },
          });
          let textNode: Node | null;
          while ((textNode = walker.nextNode())) {
            if (!textNode.textContent || textNode.textContent.length === 0) continue;
            lineRange.selectNodeContents(textNode);
            for (const rect of Array.from(lineRange.getClientRects())) {
              if (rect.width > 0 && rect.height > 0) allRects.push(rect);
            }
          }
          allRects.sort((a, b) => a.top - b.top);
          // Estimate the line advance (top-to-top distance) from the gaps between
          // rects, ignoring near-zero gaps (multiple runs on one line).
          const gaps: number[] = [];
          for (let i = 1; i < allRects.length; i++) {
            const g = allRects[i].top - allRects[i - 1].top;
            if (g > 2) gaps.push(g);
          }
          gaps.sort((a, b) => a - b);
          const advance = gaps.length ? gaps[gaps.length >> 1] : 0;
          // Group rects into lines by top proximity, not overlap: decorative fonts (e.g.
          // Trattatello) make ink boxes taller than the advance, so an overlap test would
          // chain paragraphs into one phantom line. Tolerance is a fraction of the advance.
          const tol = advance > 0 ? advance * 0.6 : 3;
          const lines: { top: number; bottom: number }[] = [];
          let lineTop = -Infinity;
          // How far down the current line still reaches: an image's own box (text beside
          // it starts well below the image top), otherwise the tolerance alone.
          let lineEnd = -Infinity;
          for (const r of allRects) {
            const isAtom = atomRects.has(r);
            if (r.top - lineTop > tol && r.top >= lineEnd) {
              lines.push({ top: r.top, bottom: r.bottom });
              lineTop = r.top;
              lineEnd = isAtom ? r.bottom - 1 : r.top + tol;
            } else {
              const last = lines[lines.length - 1];
              last.bottom = Math.max(last.bottom, r.bottom);
              if (isAtom) lineEnd = Math.max(lineEnd, r.bottom - 1);
            }
          }
          return lines;
        }

        // What a keep-with-next block has to fit below itself, in unscaled doc px: as many
        // lines of the successor as widow-orphan control would keep together anyway. An
        // empty block falls back to its whole height.
        function firstLinesHeight(el: HTMLElement, scale: number, want: number): number {
          const lines = getLineRects(el);
          if (!lines.length) return el.offsetHeight;
          // A block with fewer lines than orphan and widow control demand together has
          // no legal split point at all, so the pair needs room for the whole of it.
          const keep = lines.length < want * 2 ? lines.length : want;
          return (lines[keep - 1].bottom - lines[0].top) / scale;
        }

        function findLineSplit(
          el: HTMLElement,
          overflowDistance: number,
          scale: number,
          minLines: number,
        ): { naturalLineTop: number; docPos: number; hyphen: boolean } | null {
          const lines = getLineRects(el);
          if (lines.length === 0) return null;
          const elRect = el.getBoundingClientRect();

          // Pre-existing spacers inside this leaf distort the viewport y of lines below
          // them. Build a map: viewport y → natural offset within the leaf (unscaled, no
          // intra-spacers). offsetHeight is already unscaled, so it isn't divided.
          const intraSpacers = Array.from(
            el.querySelectorAll<HTMLElement>('[data-page-break-spacer]'),
          )
            .map((sp) => {
              const r = sp.getBoundingClientRect();
              return { viewportTop: r.top, height: sp.offsetHeight };
            })
            .sort((a, b) => a.viewportTop - b.viewportTop);

          // Returns the line's offset within the leaf in unscaled document
          // pixels, with intra-leaf spacers subtracted.
          function toNatural(viewportY: number): number {
            let dropped = 0;
            for (const sp of intraSpacers) {
              if (sp.viewportTop < viewportY) dropped += sp.height;
            }
            return (viewportY - elRect.top) / scale - dropped;
          }

          // A spacing above single half-leads each line's glyphs down by the block's lift
          // (editor.css), so a line box starts that far above its glyphs.
          const cs = getComputedStyle(el);
          const lift = cs.position === 'relative' ? Math.max(0, -parseFloat(cs.top) || 0) : 0;

          // Line-box bottom in natural coords. getClientRects reports glyph bottoms,
          // which sit a hair above the layout line-box, missing sub-pixel overflows. Use
          // the next line's box top (and offsetHeight for the last line) as the boundary.
          const intraSpacerTotal = intraSpacers.reduce((s, sp) => s + sp.height, 0);
          const leafNaturalHeight = el.offsetHeight - intraSpacerTotal;
          function lineBoxBottomNatural(i: number): number {
            if (i + 1 < lines.length) return toNatural(lines[i + 1].top) - lift;
            return leafNaturalHeight;
          }

          let k = -1;
          for (let i = 0; i < lines.length; i++) {
            if (lineBoxBottomNatural(i) > overflowDistance + 0.5) {
              k = i;
              break;
            }
          }
          if (k <= 0) return null;
          // Widow: too few lines would carry over, so take one more down with them.
          if (lines.length - k < minLines) k = lines.length - minLines;
          // Orphan: too few lines would stay behind — the caller pushes the whole
          // block to the next page instead, which is what Word/LibreOffice do.
          if (k < minLines) return null;

          // The carried line's box top lands on the page start; LibreOffice puts the lift
          // below the line instead — without it the rest of the block rides that high.
          const naturalLineTop = toNatural(lines[k].top) - lift;
          // Binary search runs in viewport space (coordsAtPos returns scaled
          // viewport coords just like Range.getClientRects()), so the target
          // stays unscaled-free here.
          const targetViewportTop = lines[k].top;

          let startPos: number;
          let endPos: number;
          try {
            startPos = editorView.posAtDOM(el, 0);
            const $start = editorView.state.doc.resolve(startPos);
            endPos = startPos + $start.parent.content.size;
          } catch {
            return null;
          }

          let lo = startPos;
          let hi = endPos;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            let midTop: number;
            try {
              midTop = editorView.coordsAtPos(mid).top;
            } catch {
              lo = mid + 1;
              continue;
            }
            if (midTop >= targetViewportTop - 0.5) {
              hi = mid;
            } else {
              lo = mid + 1;
            }
          }
          // Chromium reports the first letters after an automatic hyphen on the line above,
          // which lands the split inside the word ("pract|ice"). A hit test at the line's
          // edges finds its true start; the earlier edge wins, a right-to-left line's first.
          const y = (lines[k].top + lines[k].bottom) / 2;
          const hit = Math.min(
            editorView.posAtCoords({ left: elRect.left + 1, top: y })?.pos ?? Infinity,
            editorView.posAtCoords({ left: elRect.right - 1, top: y })?.pos ?? Infinity,
          );
          if (hit > startPos && hit < lo && !/\s/.test(editorView.state.doc.textBetween(hit, lo, ' ', ' '))) lo = hit;
          // The spacer ends the line by force, so the hyphen the automatic break drew
          // has to be drawn again (`pb-hyphen`, editor.css).
          const hyphen = cs.hyphens === 'auto' && /^\p{L}{2}$/u.test(editorView.state.doc.textBetween(lo - 1, lo + 1));
          return { naturalLineTop, docPos: lo, hyphen };
        }

        // The larger-of spacing model draws the space above as a margin (editor.css): it lies
        // outside the box and collapses with the space below the block before it.
        const spaceAboveIsMargin = () =>
          editorView.dom.closest('.paper')?.getAttribute('data-spacing-model') === 'max';

        function collectLeaves(contentHeight: number, scaleFactor: number): Leaf[] {
          const dom = editorView.dom;
          const marginModel = spaceAboveIsMargin();
          const leaves: Leaf[] = [];
          // cumulativeSpacerHeight accumulates spacer offsetHeights (unscaled
          // layout px), matching the offsetHeight-based naturalHeight.
          let cumulativeSpacerHeight = 0;
          // Space above that the page-top rule has already taken off the blocks walked
          // so far: added back, so what is measured is the document, not the last pass's
          // answer to it. Reading the answer back is what made the layout flip-flop.
          let cumulativeDropped = 0;
          // Only the first collected note opens a page; the rest follow it down.
          let seenCollected = false;

          // A leaf's border-box top within .tiptap, in document px. Summing offsetTop up
          // the offsetParent chain is unaffected by .paper's transform:scale, so it's the
          // same at every zoom; the chain ends at .tiptap so the origin is the page top.
          function topWithin(el: HTMLElement, elStyle?: CSSStyleDeclaration): number {
            let top = 0;
            let node: HTMLElement | null = el;
            while (node && node !== dom) {
              // A block spaced above single is drawn half a leading above its flow
              // position (editor.css), and offsetTop reports where it is drawn — so the
              // shift comes back off, or the flow inherits a paint correction.
              const cs = node === el && elStyle ? elStyle : getComputedStyle(node);
              const shift = cs.position === 'relative' ? parseFloat(cs.top) : 0;
              top += node.offsetTop - (Number.isFinite(shift) ? shift : 0);
              node = node.offsetParent as HTMLElement | null;
            }
            return top;
          }

          // A leaf's top in the undecorated document: the rendered top with the spacers
          // above it taken out and the space they swallowed put back, so a pass never
          // measures its own previous answer. Every leaf must be born through this.
          function naturalTopOf(el: HTMLElement, elStyle?: CSSStyleDeclaration): number {
            return topWithin(el, elStyle) - cumulativeSpacerHeight + cumulativeDropped;
          }

          // The footnote anchors this leaf holds, offset from its own top with the
          // spacers above each of them taken back out — measured within the leaf, so
          // naturalTopOf already carries everything above it.
          function refsWithin(el: HTMLElement): NoteAnchor[] {
            const refs = Array.from(el.querySelectorAll<HTMLElement>('.note-ref[data-note-kind="footnote"]'));
            if (!refs.length) return [];
            const spacers = Array.from(el.querySelectorAll<HTMLElement>('[data-page-break-spacer]'));
            const base = topWithin(el);
            return refs.map((ref) => {
              let above = 0;
              for (const sp of spacers) {
                if (sp.compareDocumentPosition(ref) & Node.DOCUMENT_POSITION_FOLLOWING) above += sp.offsetHeight;
              }
              return { id: ref.dataset.noteRef ?? '', dy: topWithin(ref) - base - above };
            });
          }

          // Emit one atomic leaf per table row so the table breaks between rows across
          // pages (a whole table is usually taller than a page). TipTap renders tables as
          // <div class="tableWrapper"><table><colgroup><tbody>…, so walk the tbody rows.
          // A table opens a section and forces the page in front of it like a paragraph
          // does (pageBreak.ts); both ride its first leaf, where the placement reads them.
          function walkTableRows(wrapperEl: HTMLElement, inTableCell = false) {
            const first = leaves.length;
            walkTableBody(wrapperEl, inTableCell);
            const t = wrapperEl.tagName === 'TABLE' ? wrapperEl : wrapperEl.querySelector('table');
            const leaf = leaves[first];
            if (!leaf || inTableCell || !(t instanceof HTMLElement)) return;
            if (t.dataset.pageBreakBefore === 'page') leaf.forceBreakBefore = true;
            if (t.dataset.sectionBreak === 'true') leaf.sectionStart = true;
          }

          function walkTableBody(wrapperEl: HTMLElement, inTableCell = false) {
            const tableEl = (wrapperEl.tagName === 'TABLE'
              ? wrapperEl
              : wrapperEl.querySelector('table')) as HTMLElement | null;
            const tbody = tableEl?.querySelector('tbody') as HTMLElement | null;
            const rowEls = tbody
              ? (Array.from(tbody.children) as HTMLElement[])
              : [];
            const realRows = rowEls.filter(r => r.tagName === 'TR' && !r.dataset?.pageBreakSpacer);
            const spacerHeight = rowEls
              .filter(r => r.dataset?.pageBreakSpacer)
              .reduce((sum, r) => sum + r.offsetHeight, 0);
            // No break may fall between the rows (ODF style:may-break-between-rows), so
            // the table moves whole — unless it is taller than a page, where the rule
            // cannot be met and LibreOffice breaks it anyway.
            const keepRows = tableEl?.dataset?.keepRows === 'true'
              && wrapperEl.offsetHeight - spacerHeight <= contentHeight;
            // Fallback: no rows found — measure the whole wrapper as one atomic leaf.
            if (realRows.length === 0 || keepRows) {
              const top = naturalTopOf(wrapperEl);
              cumulativeSpacerHeight += spacerHeight;
              leaves.push({
                el: wrapperEl,
                kind: 'atomic',
                naturalTop: top,
                naturalHeight: wrapperEl.offsetHeight - spacerHeight,
              });
              return;
            }
            const colgroup = tableEl?.querySelector('colgroup');
            const columns = colgroup?.children.length || realRows[0].children.length || 1;
            const leaderIdx = rowSpanGroups(realRows.map((r) => ({
              spans: (Array.from(r.children) as HTMLElement[])
                .map((c) => (c as HTMLTableCellElement).rowSpan || 1),
              top: naturalTopOf(r),
              height: r.offsetHeight,
            })), contentHeight, tableEl?.dataset.repeatHeader === 'true' ? 1 : 0);
            const groupLeader = new Map<HTMLElement, HTMLElement>();
            leaderIdx.forEach((li, i) => {
              if (li === i) return;
              groupLeader.set(realRows[i], realRows[li]);
              groupLeader.set(realRows[li], realRows[li]);
            });
            let seenRealRow = false;
            let openGroup: Leaf | null = null;
            for (const tr of rowEls) {
              if (tr.dataset?.pageBreakSpacer) {
                cumulativeSpacerHeight += tr.offsetHeight;
                continue;
              }
              if (tr.tagName !== 'TR') continue;
              const rowHeight = tr.offsetHeight;
              const leader = groupLeader.get(tr);
              if (openGroup && leader && leader !== tr) {
                // A row its leader's cell spans into: it grows that leaf rather than
                // opening a break candidate of its own.
                openGroup.naturalHeight = naturalTopOf(tr) + rowHeight - openGroup.naturalTop;
                seenRealRow = true;
                continue;
              }
              openGroup = null;
              if (rowHeight <= contentHeight) {
                // Row fits on a page → atomic leaf; the table breaks between rows.
                const rowLeaf: Leaf = {
                  el: tr,
                  kind: 'atomic',
                  naturalTop: naturalTopOf(tr),
                  naturalHeight: rowHeight,
                  tableRow: { columns, wrapperEl, isFirstRow: !seenRealRow },
                };
                leaves.push(rowLeaf);
                if (leader === tr) openGroup = rowLeaf;
              } else {
                // Row taller than a page: each cell is an independent flow from the row
                // top, breaking in its own column. Walk every cell, resetting the spacer
                // baseline per cell; the row consumes the tallest cell's spacers.
                const cells = (Array.from(tr.children) as HTMLElement[]).filter(
                  c => c.tagName === 'TD' || c.tagName === 'TH',
                );
                // A row that may not break starts on a fresh page before it breaks there
                // anyway (LibreOffice): a zero-height leaf forcing the row's own spacer.
                if (tr.dataset.cantSplit === 'true') {
                  leaves.push({
                    el: tr,
                    kind: 'atomic',
                    naturalTop: naturalTopOf(tr),
                    naturalHeight: 0,
                    tableRow: { columns, wrapperEl, isFirstRow: !seenRealRow },
                    forceBreakBefore: true,
                  });
                }
                const baseline = cumulativeSpacerHeight;
                let maxDelta = 0;
                let rowStartSet = false;
                let rowLastLeafIdx = -1;
                for (const cell of cells) {
                  cumulativeSpacerHeight = baseline; // reset for this cell's flow
                  const startIdx = leaves.length;
                  walk(cell, true);
                  if (leaves.length > startIdx) {
                    leaves[startIdx].cellStart = true;
                    if (!rowStartSet) {
                      leaves[startIdx].rowStart = true;
                      rowStartSet = true;
                    }
                    rowLastLeafIdx = leaves.length - 1;
                  }
                  maxDelta = Math.max(maxDelta, cumulativeSpacerHeight - baseline);
                }
                // The row's height grows by the tallest cell's spacer total.
                cumulativeSpacerHeight = baseline + maxDelta;
                if (rowLastLeafIdx >= 0) leaves[rowLastLeafIdx].rowEnd = true;
              }
              seenRealRow = true;
            }
          }

          function walk(container: HTMLElement, inTableCell = false) {
            for (const child of Array.from(container.children) as HTMLElement[]) {
              if (child.dataset?.pageBreakSpacer) {
                // A lifting spacer carries its (negative) contribution as a margin, which
                // offsetHeight doesn't report — without it the next pass measures its own answer.
                cumulativeSpacerHeight += child.offsetHeight + (parseFloat(child.style.marginTop) || 0);
                continue;
              }
              // Skip the resize-handle widgets (tableColumnResize/tableRowResize), which
              // are position:absolute — not flow content, and measuring one yields garbage
              // geometry. Out of flow, so skip without touching cumulativeSpacerHeight.
              if (
                child.classList.contains('column-resize-handle') ||
                child.classList.contains('row-resize-handle')
              ) {
                continue;
              }
              const tag = child.tagName;
              // TipTap renders tables inside a <div class="tableWrapper"> node
              // view (see extensions.ts Table config), so the top-level child is
              // the wrapper DIV, not the TABLE. Break the table into per-row leaves.
              if (tag === 'TABLE' || (tag === 'DIV' && child.classList.contains('tableWrapper'))) {
                walkTableRows(child, inTableCell);
                continue;
              }
              // The note section (notes.ts) is not body text. A note at the foot of its
              // page is out of the flow and placed below; a collected one flows here and
              // starts its own page, as LibreOffice collects both classes.
              if (child.classList.contains('note-section')) {
                walk(child, inTableCell);
                continue;
              }
              if (child.classList.contains('note')) {
                // The setting reaches this through editor.css, which takes a collected
                // footnote out of `position: absolute` — the note's own box is the truth.
                if (getComputedStyle(child).position === 'absolute') continue;
                // ponytail: one page for the collected notes, in anchor order. LibreOffice
                // groups the classes onto a page each, which needs a section order that
                // isn't the anchor order the exports read.
                leaves.push({
                  el: child,
                  kind: 'splittable',
                  naturalTop: naturalTopOf(child),
                  naturalHeight: child.offsetHeight,
                  forceBreakBefore: !seenCollected,
                });
                seenCollected = true;
                continue;
              }
              // The generated table of contents (tableOfContents.ts) is a block atom with
              // no inner doc positions, so it can't be line-split — measure it atomically
              // (pushed whole if it overflows; a TOC taller than a page can't be pushed).
              if (child.dataset?.toc) {
                leaves.push({
                  el: child,
                  kind: 'atomic',
                  naturalTop: naturalTopOf(child),
                  naturalHeight: child.offsetHeight,
                  inTableCell,
                  // An index can open a section and break the page in front of it
                  // (pageBreak.ts), like a paragraph or a table.
                  forceBreakBefore: !inTableCell && child.dataset?.pageBreakBefore === 'page',
                  sectionStart: !inTableCell && child.dataset?.sectionBreak === 'true',
                });
                continue;
              }
              // A multi-column section fragment: also atomic for spacer purposes (a
              // spacer inside a multicol container rebalances around it), but the
              // placement logic defers overflow to columnsFlow.ts via columnsFragment.
              if (child.classList.contains('columns-node')) {
                const count = Math.max(1, parseInt(child.dataset?.columns ?? '', 10) || 1);
                const first = child.firstElementChild as HTMLElement | null;
                const breaks = !inTableCell && first?.dataset?.pageBreakBefore === 'page';
                const firstPx = first ? headFitPx(first, count, scaleFactor) : 0;
                leaves.push({
                  el: child,
                  kind: 'atomic',
                  naturalTop: naturalTopOf(child),
                  naturalHeight: child.offsetHeight,
                  inTableCell,
                  // A section's first block breaking the page breaks it before the section.
                  forceBreakBefore: breaks,
                  columnsFragment: {
                    firstBlockNeededPx: Math.max(firstPx, 16),
                    spaceAbovePx: breaks ? parseFloat(getComputedStyle(first!).getPropertyValue('--space-before')) || 0 : 0,
                  },
                });
                continue;
              }
              // A paragraph holding a floated frame — a picture or a text box —
              // paginates atomically: a line-split spacer beside the float is dropped by
              // ProseMirror. An as-character frame is an ordinary line box, so its
              // paragraph breaks between lines like any other.
              const splittableTag = SPLITTABLE_TAGS.has(tag);
              const floats = Array.from(child.querySelectorAll<HTMLElement>('.image-node, .textbox-node'))
                .filter((f) => !!f.style.float);
              const hasImage = splittableTag && floats.length > 0;
              // Keep lines together (w:keepLines, fo:keep-together): the block moves
              // whole. One taller than a page still splits — as it does in Word.
              const keepLines = child.dataset?.keepLines === 'true' && child.offsetHeight <= contentHeight;
              const isAtomic = ATOMIC_TAGS.has(tag) || hasImage || (splittableTag && keepLines);
              const isSplittable = splittableTag && !hasImage && !keepLines;
              if (isAtomic || isSplittable) {
                let intraSpacerHeight = 0;
                for (const sp of Array.from(
                  child.querySelectorAll<HTMLElement>('[data-page-break-spacer]'),
                )) {
                  intraSpacerHeight += sp.offsetHeight;
                }
                // A float hangs out of its paragraph's box, so offsetHeight stops above
                // it and the image would walk off the page bottom. Reach down to the
                // lowest float instead — that space belongs to this leaf.
                let floatBottom = 0;
                if (floats.length) {
                  const top = child.getBoundingClientRect().top;
                  for (const img of floats) {
                    const below = (img.getBoundingClientRect().bottom - top) / scaleFactor;
                    floatBottom = Math.max(floatBottom, below);
                  }
                }
                const cs = getComputedStyle(child);
                // The block's own space above, and how much of it the last pass took off at
                // a page top. A cell's first block never carries any (LibreOffice adds none
                // there), so missing padding is the document, not a decoration to add back.
                const spaceAbove = parseFloat(cs.getPropertyValue('--space-before')) || 0;
                const dropped = spaceAbove > 0.5 && !inTableCell
                  && parseFloat(cs.paddingTop) < 0.5 && parseFloat(cs.marginTop) < 0.5
                  ? spaceAbove : 0;
                // A dropped margin moved the box itself up, by what the space below the block
                // before did not already cover; a dropped padding only made the box shorter.
                const droppedAbove = marginModel && dropped
                  ? Math.max(0, dropped - (leaves[leaves.length - 1]?.spaceAfter ?? 0)) : 0;
                // editor.css draws the block up by half its extra leading (`top`); a bottom
                // padding or border holds the last line's leading inside the block.
                const lift = cs.position === 'relative' ? -parseFloat(cs.top) || 0 : 0;
                const hang = lift > 0 && !isAtomic && !inTableCell && floatBottom <= child.offsetHeight
                  && parseFloat(cs.paddingBottom) < 0.5 && parseFloat(cs.borderBottomWidth) < 0.5 ? 2 * lift : 0;
                leaves.push({
                  el: child,
                  kind: isAtomic ? 'atomic' : 'splittable',
                  naturalTop: naturalTopOf(child, cs) + droppedAbove,
                  naturalHeight: Math.max(child.offsetHeight, floatBottom) - intraSpacerHeight + (marginModel ? 0 : dropped),
                  spaceAfter: inTableCell ? 0 : parseFloat(cs.marginBottom) || 0,
                  spaceAbove,
                  hang,
                  inTableCell,
                  // A manual page break is honored for top-level blocks only (not in
                  // a table cell, where the table breaks atomically between rows).
                  forceBreakBefore: !inTableCell && child.dataset?.pageBreakBefore === 'page',
                  // A heading keeps with the next block in both Word and LibreOffice,
                  // unless the file's own heading style drops it (`false`).
                  keepNext: !inTableCell && (child.dataset?.keepNext === 'true'
                    || (/^H[1-5]$/.test(child.tagName) && child.dataset?.keepNext !== 'false')),
                  sectionStart: !inTableCell && child.dataset?.sectionBreak === 'true',
                  refs: refsWithin(child),
                });
                cumulativeSpacerHeight += intraSpacerHeight;
                cumulativeDropped += marginModel ? droppedAbove : dropped;
                continue;
              }
              if (CONTAINER_TAGS.has(tag)) {
                walk(child, inTableCell);
                continue;
              }
              // Unknown block. Out-of-flow elements (absolute/fixed) can't be paginated
              // and measure as garbage, so skip them. getComputedStyle is read only here,
              // off the common path, to avoid a per-child reflow cost.
              const position = getComputedStyle(child).position;
              if (position === 'absolute' || position === 'fixed') continue;
              // Otherwise measure as a splittable leaf with no intra-spacers.
              leaves.push({
                el: child,
                kind: 'splittable',
                naturalTop: naturalTopOf(child),
                naturalHeight: child.offsetHeight,
                inTableCell,
              });
            }
          }

          walk(dom);
          return leaves;
        }

        // A pass that throws must not leave the layout marked running: no later pass
        // would start, and the status would show the document loading for good.
        function calculate() {
          try { layoutPass(); } catch (err) { isUpdating = false; throw err; }
        }

        function layoutPass() {
          rafId = null;
          if (isUpdating || !editorView.dom.isConnected) return;
          isUpdating = true;
          editBlock = null;
          posMemo = new Map();

          const dom = editorView.dom;
          void dom.offsetHeight; // force reflow

          const vm = readVerticalMargins(dom);
          const CONTENT_HEIGHT = vm.contentHeight;

          const csRoot = getComputedStyle(dom);
          // Page 1's own header/footer (different first page) may reach further than the
          // others, so its content starts lower / ends sooner; each falls back to the
          // shared effective margin.
          const ctFirst = parseFloat(csRoot.getPropertyValue('--pb-content-top-first'));
          const effTopFirst = Number.isFinite(ctFirst) ? ctFirst : vm.top;
          const cbFirst = parseFloat(csRoot.getPropertyValue('--pb-content-bottom-first'));
          const effBottomFirst = Number.isFinite(cbFirst) ? cbFirst : vm.bottom;
          // Each section's own reaches (Editor.svelte), so a later section's tall header
          // clears its own pages. Missing/short → the document-wide pair above.
          const reach = csRoot.getPropertyValue('--pb-section-reach').split(',')
            .map((g) => g.split('|').map(Number))
            .filter((g): g is Band => g.length === 4 && g.every(Number.isFinite));
          const reachAt = (i: number): Band => reach[Math.min(i, reach.length - 1)]
            ?? [effTopFirst, vm.top, effBottomFirst, vm.bottom];
          // Its side margins, as a delta on the document's: .tiptap's padding draws only
          // one pair, so a section wanting others insets its own blocks by the difference.
          const inset = csRoot.getPropertyValue('--pb-section-inset').split(',')
            .map((g) => g.split('|').map(Number))
            .filter((g) => g.length === 4 && g.every(Number.isFinite));
          const insetAt = (i: number) => inset[Math.min(i, inset.length - 1)] ?? [0, 0, 0, 0];
          // Its own paper's height (px), where the section has one — a landscape page
          // amid portrait ones is shorter, and every page below it moves up.
          const paper = csRoot.getPropertyValue('--pb-section-page').split(',').map(Number);
          const paperAt = (i: number) => {
            const h = paper[Math.min(i, paper.length - 1)];
            return Number.isFinite(h) && h > 0 ? h : vm.pageHeight;
          };
          // Mirrored margins: the padding draws the odd page's pair, so an even page's
          // blocks move right by the difference. Per section — a cover between mirrored
          // ones has margins of its own and mirrors nothing.
          // The document's "spacing at the start of a page" switch (spacingModel.ts).
          const spacingAtStart = csRoot.getPropertyValue('--pb-space-at-page-start').trim() !== '0';
          const marginModel = spaceAboveIsMargin();
          // Where each section restarts numbering ('x' = it counts on), section 0 the
          // document's own start: the side a page is on follows its number, not its sheet.
          const numStarts = csRoot.getPropertyValue('--pb-section-numstart').split(',')
            .map((v) => (Number.isFinite(Number(v)) && v.trim() !== '' ? Number(v) : null));
          // The side a section must open on ('o'/'e'), else 'x'.
          const sides = csRoot.getPropertyValue('--pb-section-startson').split(',').map((v) => v.trim());
          const sideAt = (i: number) => (sides[i] === 'o' ? 'odd' : sides[i] === 'e' ? 'even' : null);
          const mirrors = csRoot.getPropertyValue('--pb-section-mirror').split(',')
            .map((g) => g.split('|').map(Number))
            .filter((g) => g.length === 2 && g.every(Number.isFinite));
          const mirrorAt = (i: number) => mirrors[Math.min(i, mirrors.length - 1)] ?? [0, 0];
          // Only then does any block need its position: docPosBeforeElement is a pass's dearest call.
          const sided = inset.some((g) => g.some(Boolean)) || mirrors.some((g) => g.some(Boolean));

          const scale = getScaleFactor();
          const leaves = collectLeaves(CONTENT_HEIGHT, scale);

          // One placement of every leaf against a given per-page note reservation. It
          // owns all its accumulators, so the note fixed-point below can simply run it
          // again on a reservation that changed.
          function placeLeaves(reservedByPage: Map<number, number>) {
            let cumulativeShift = 0;
            // Per-cell flow bracketing for a too-tall row (see Leaf flow markers): each
            // cell restarts from the shift inherited at the row top; the row then
            // advances the main shift by the tallest cell's added shift.
            let rowBaseline = 0;
            let maxCellDelta = 0;
            // Page each footnote anchor lands on, which is the page its note goes to.
            const anchorPages = new Map<string, number>();
            // Lowest rendered content bottom across all leaves (incl. parallel cells),
            // used for the page count — a single last-leaf reading misses taller cells.
            let maxEffectiveBottom = 0;
            // Page each section after the first begins on, in body order — the layer picks
            // a page's header/footer set from it.
            const sectionStartPages: number[] = [];
            let sectionIndex = 0;
            let sectionFirstPage = 1;
            // First page per section, which is what a numbering restart counts from.
            const sectionFirstPages: number[] = [1];
            // The grid this placement lays out against, grown as each section's first
            // page becomes known, with its reaches. Built here, not read back, so a pass
            // never measures its own last answer.
            const grid = new PageGrid(paperAt(0), 0, reachAt(0));
            const placements: {
              docPos: number;
              height: number;
              row: RowSpacer | null;
              hyphen?: boolean;
            }[] = [];
            // Node-decoration range collapsing the trailing empty paragraph after a
            // document-final columns chain when it sits past the page content area.
            let collapsedTrailing: { from: number; to: number } | null = null;
            // Node-decoration ranges dropping the space before a block a soft break put
            // at a page top (probed in LibreOffice); a hard break and the first block keep it.
            const pageTopBlocks: { from: number; to: number }[] = [];
            // Top-level blocks a section's own side margins inset, keyed by doc position.
            const sectionInsets = new Map<number, { to: number; left: number; right: number }>();
            // Columns sections whose page break keeps their first block's space above.
            const sectionTops: { from: number; to: number; px: number }[] = [];
            // Parts of a block moved across to their own page's sides (placeSides).
            const sideShifts: { from: number; to: number; dx: number; inline: boolean; end?: boolean }[] = [];
            // Close/open bands for in-cell + between-rows table breaks. Keyed by the
            // rounded openY (the grouping id) → the unrounded openY (so the band lands
            // exactly on the page cycle) plus whether it's a between-rows break.
            const tableBands = new Map<number, { openY: number; rowBreak: boolean; lines: boolean; left: number; right: number }>();
            const leavesDebug: PageBreakDebugSnapshot['leaves'] = [];
            const placementsDebug: PageBreakDebugSnapshot['placements'] = [];

            // A page's side insets against .tiptap's padding: the section's own margins,
            // and on a left page of a mirrored section the difference between its two.
            const sideInset = (pg: number): [number, number] => {
              const ins = insetAt(sectionIndex);
              const first = pg === sectionFirstPage;
              const printed = printedPageNumber(pg, sectionIndex, numStarts, (i) => sectionFirstPages[i] ?? 1);
              const mir = isLeftPage(printed) ? mirrorAt(sectionIndex)[first ? 0 : 1] : 0;
              return [Math.round((first ? ins[0] : ins[2]) + mir), Math.round((first ? ins[1] : ins[3]) - mir)];
            };
            // The inset the top-level block takes is the page its first leaf starts on. A
            // later part on a page of the same text width but other sides is moved across
            // (`pb-shift`, out of the flow so nothing is re-measured), as both word processors
            // set each part at its own page's margins; a width change would re-break the lines.
            const blockSides = new Map<HTMLElement, { from: number; left: number; right: number }>();
            const placeSides = (leaf: Leaf, shiftAtTop: number, applied: { at: number; height: number; docPos: number; split: boolean }[]) => {
              let shift = shiftAtTop;
              for (const a of applied) if (!a.split) shift += a.height;
              const [left, right] = sideInset(grid.pageAt(leaf.naturalTop + shift));
              let block: HTMLElement = leaf.el;
              while (block.parentElement && block.parentElement !== dom) block = block.parentElement;
              let sides = blockSides.get(block);
              if (!sides) {
                const from = block.parentElement === dom ? docPosBeforeElement(block) : null;
                const node = from !== null ? editorView.state.doc.nodeAt(from) : null;
                if (from === null || !node) return;
                sides = { from, left, right };
                blockSides.set(block, sides);
                if (left || right) sectionInsets.set(from, { to: from + node.nodeSize, left, right });
              }
              if (leaf.inTableCell) return;
              const width = sides.left + sides.right;
              const leafFrom = leaf.el === block ? sides.from : docPosBeforeElement(leaf.el);
              const leafNode = leafFrom !== null ? editorView.state.doc.nodeAt(leafFrom) : null;
              if (leafFrom === null || !leafNode) return;
              let leafLeft = sides.left;
              if (leaf.el !== block && left !== sides.left && left + right === width) {
                sideShifts.push({ from: leafFrom, to: leafFrom + leafNode.nodeSize, dx: left - sides.left, inline: false });
                leafLeft = left;
              }
              const splits = applied.filter((a) => a.split);
              for (let k = 0; k < splits.length; k++) {
                shift += splits[k].height;
                const [l, r] = sideInset(grid.pageAt(leaf.naturalTop + splits[k].at + shift));
                if (l === leafLeft || l + r !== width) continue;
                const to = splits[k + 1]?.docPos ?? leafFrom + leafNode.nodeSize - 1;
                // The last part takes what is typed at the paragraph's end along until the next pass.
                sideShifts.push({ from: splits[k].docPos, to, dx: l - leafLeft, inline: true, end: !splits[k + 1] });
              }
            };

            for (let i = 0; i < leaves.length; i++) {
              const leaf = leaves[i];
              // Enter a cell flow: capture the previous cell's added shift, then restart
              // this cell from the row baseline so its measured tops align.
              if (leaf.cellStart) {
                if (leaf.rowStart) {
                  rowBaseline = cumulativeShift;
                  maxCellDelta = 0;
                } else {
                  maxCellDelta = Math.max(maxCellDelta, cumulativeShift - rowBaseline);
                }
                cumulativeShift = rowBaseline;
              }
              let effectiveTop = leaf.naturalTop + cumulativeShift;
              let effectiveBottom = effectiveTop + leaf.naturalHeight;
              const page = grid.pageAt(effectiveTop);
              // The space a manual break keeps is a margin in the larger-of spacing model,
              // outside the box the leaf is measured by, less the space below the block
              // before it, which LibreOffice still collapses with it (probed: 24 − 6pt → 18).
              const keeps = !!leaf.forceBreakBefore && spacingAtStart;
              const sectionTop = keeps ? Math.max(0, (leaf.columnsFragment?.spaceAbovePx ?? 0) - (leaves[i - 1]?.spaceAfter ?? 0)) : 0;
              if (sectionTop > 0.5) {
                const from = docPosBeforeElement(leaf.el);
                const node = from !== null ? editorView.state.doc.nodeAt(from) : null;
                if (from !== null && node) sectionTops.push({ from, to: from + node.nodeSize, px: Math.round(sectionTop) });
              }
              const kept = keeps && !leaf.inTableCell ? Math.max(0,
                (parseFloat(getComputedStyle(leaf.el).marginTop) || 0) - (leaves[i - 1]?.spaceAfter ?? 0)) : 0;
              // A section's first page uses its "first" reaches, every other page its
              // "rest" ones — page 1 is section 1's first page.
              if (leaf.sectionStart) {
                // Where the section really begins: a forced break moves its first block to
                // the next page, and that page is the one its "first" zones belong to.
                const prevStart = grid.topOf(page) + reachAt(sectionIndex)[1];
                const pushed = !!leaf.forceBreakBefore && i > 0 && effectiveTop - kept > prevStart + 0.5;
                sectionIndex++;
                sectionFirstPage = pushed ? page + 1 : page;
                sectionFirstPages[sectionIndex] = sectionFirstPage;
                // A section that must open on a right or left page takes the blank page
                // before it — never the document's first page. The sheet decides, not the
                // printed number: LibreOffice pads a restart at 1 onto an even sheet (probed).
                const side = i > 0 ? sideAt(sectionIndex) : null;
                if (side) {
                  if ((sectionFirstPage % 2 === 0 ? 'even' : 'odd') !== side) {
                    sectionFirstPage++;
                    sectionFirstPages[sectionIndex] = sectionFirstPage;
                  }
                }
                // Its paper governs from its first page on. Setting it here can only move
                // pages *below* that one, so the page just resolved stays valid.
                grid.setFrom(sectionFirstPage, paperAt(sectionIndex), 0, reachAt(sectionIndex));
              }
              const [topFirst, topRest, bottomFirst, bottomRest] = reachAt(sectionIndex);
              const onFirst = page === sectionFirstPage;
              const pageTop = grid.topOf(page);
              const contentStart = pageTop + (onFirst ? topFirst : topRest);
              const contentEnd = pageTop + grid.heightOf(page) - (onFirst ? bottomFirst : bottomRest)
                - (reservedByPage.get(page) ?? 0);


              // A leaf may need several spacers: a splittable block taller than one
              // page crosses multiple boundaries, one break each.
              const breaks: {
                height: number;
                docPos: number | null;
                hyphen?: boolean;
                row: RowSpacer | null;
                bandOpenY: number | null;
                reason: string;
                // Offset from the leaf's top this break applies from: 0 for a whole-leaf
                // push, the line's own top for a split — which is what tells an anchor
                // below the split apart from one above it.
                naturalY: number;
              }[] = [];
              // Set when a leaf overflows but no spacer can bridge it (block > one page).
              let noPushReason: string | null = null;
              // A section whose top page margin is smaller than the document's starts above
              // where .tiptap's own padding puts it. Only where nothing was pushed down onto
              // this page ahead of it — a spacer can add space, so only a lift is missing.
              if (
                leaf.sectionStart && onFirst
                && effectiveTop > contentStart + 0.5 && effectiveTop <= pageTop + vm.top + 0.5
              ) {
                const { docPos, row } = leafSpacer(leaf);
                breaks.push({ height: contentStart - effectiveTop, docPos, row, bandOpenY: null, reason: 'section-margin-lift', naturalY: 0 });
                effectiveBottom += contentStart - effectiveTop;
                effectiveTop = contentStart;
              }
              // Space above this leaf loses for opening a page — taken off the flow below it.
              let droppedShift = 0;

              // A sequential-fill chain's fragment box may run to the page bottom, which
              // would shove this trailing empty paragraph onto a phantom extra page —
              // leave it in place and out of the page count; typed text re-enables it.
              if (
                i === leaves.length - 1 &&
                leaf.el.tagName === 'P' &&
                !(leaf.el.textContent ?? '').length &&
                leaves[i - 1]?.columnsFragment
              ) {
                // Past the content area its height (+ .tiptap bottom padding) grows the
                // element into the next page cycle, where the background gradient paints
                // a phantom page top — collapse it visually (height:0 node decoration).
                if (effectiveBottom > contentEnd) {
                  const from = docPosBeforeElement(leaf.el);
                  const node = from !== null ? editorView.state.doc.nodeAt(from) : null;
                  if (from !== null && node) collapsedTrailing = { from, to: from + node.nodeSize };
                }
                leavesDebug.push({
                  index: i,
                  tag: leaf.el.tagName,
                  kind: leaf.kind,
                  inTableCell: !!leaf.inTableCell,
                  tableRow: null,
                  naturalTop: leaf.naturalTop,
                  naturalHeight: leaf.naturalHeight,
                  textPreview: '',
                  intraSpacerHeights: [],
                  effectiveTop,
                  effectiveBottom,
                  pageOfTop: page,
                  pageOfBottom: grid.pageAt(effectiveBottom),
                  contentStart,
                  contentEnd,
                  overflowsPageEnd: effectiveBottom > contentEnd,
                });
                placementsDebug.push({
                  leafIndex: i,
                  docPos: null,
                  height: 0,
                  reason: collapsedTrailing
                    ? 'trailing-empty-after-columns-collapsed'
                    : 'trailing-empty-after-columns',
                  spacerKind: 'none',
                  columns: null,
                });
                continue;
              }

              // A manual page break forces the block to the next page's top (never the first
              // leaf, so no leading blank page); once settled at a page top the guard stops.
              // A forced block that then overflows is split by the normal logic next pass.
              // A section held back for its own side skips the sheets between: its first
              // page is settled above, so the spacer reaches straight for that one.
              const skipTo = leaf.sectionStart && sectionFirstPage > page ? sectionFirstPage : 0;
              const forced = skipTo > 0 || (!!leaf.forceBreakBefore && i > 0 && effectiveTop - kept > contentStart + 0.5);

              if (forced) {
                // The target page's own content start: a section beginning there brings
                // its first-page header with it.
                const targetPage = skipTo || page + 1;
                const nextTop = targetPage === sectionFirstPage ? topFirst : topRest;
                const target = pageContentStart(targetPage, nextTop, grid);
                const { docPos, row } = leafSpacer(leaf);
                breaks.push({
                  height: target + kept - effectiveTop,
                  docPos,
                  row,
                  bandOpenY: target,
                  reason: 'forced-page-break',
                  naturalY: 0,
                });
              } else if (effectiveTop < contentStart && (i > 0 || effectiveTop < contentStart - 1)) {
                // i === 0 only reaches here when a tall header on page 1 pushes the very
                // first block down below its content start (a >1px gap); otherwise the
                // first block already sits at the content start.
                const { docPos, row } = leafSpacer(leaf);
                breaks.push({
                  height: contentStart - effectiveTop,
                  docPos,
                  row,
                  bandOpenY: contentStart,
                  reason: 'pre-leaf-push-to-content-start',
                  naturalY: 0,
                });
              } else if (effectiveTop >= contentEnd) {
                const target = pageContentStart(page + 1, topRest, grid);
                const { docPos, row } = leafSpacer(leaf);
                breaks.push({
                  height: target - effectiveTop,
                  docPos,
                  row,
                  bandOpenY: target,
                  reason: 'leaf-jump-to-next-page',
                  naturalY: 0,
                });
                // Space below is not part of what has to fit: a block whose last line ends
                // on the page keeps it and the gap is dropped at the page bottom, the way
                // space above is at a page top (probed: 2cm below a line 8mm short of it).
              } else if (effectiveBottom - (leaf.hang ?? 0) > contentEnd) {
                // Nothing above it on this page: moving it on would leave the page empty, so
                // it stays and overflows, as in LibreOffice — e.g. below a page-tall footer.
                const pageOpener = effectiveTop - (parseFloat(getComputedStyle(leaf.el).marginTop) || 0) <= contentStart + 0.5;
                if (leaf.kind === 'atomic') {
                  const cf = leaf.columnsFragment;
                  if (cf && cf.firstBlockNeededPx + COLUMNS_FIT_MARGIN_PX <= contentEnd - effectiveTop) {
                    // columnsFlow.ts will split the fragment, between blocks or inside the
                    // first, so a prefix fills this page; pushing it whole would fight that.
                    noPushReason = 'columns-await-flow';
                  } else if (cf && effectiveTop <= contentStart + 0.5) {
                    // Already at a page top and still too tall (a paragraph taller
                    // than the page slot): pushing just moves the problem one page
                    // down forever — the flow line-splits the paragraph instead.
                    noPushReason = 'columns-line-split-pending';
                  } else if (pageOpener && !cf) {
                    noPushReason = 'page-opener-no-push';
                  } else if (leaf.naturalHeight <= CONTENT_HEIGHT || cf) {
                    // A columns fragment may be pushed even when taller than a page:
                    // the flow splits it again once it sits at the next page top.
                    const target = pageContentStart(page + 1, topRest, grid);
                    const { docPos, row } = leafSpacer(leaf);
                    breaks.push({
                      height: target - effectiveTop,
                      docPos,
                      row,
                      bandOpenY: target,
                      reason: 'atomic-push-to-next-page',
                      naturalY: 0,
                    });
                  } else {
                    noPushReason = 'atomic-too-tall-no-push';
                  }
                } else {
                  // A splittable leaf taller than one page crosses several boundaries:
                  // keep splitting until the rest fits. Boundaries are in the leaf's
                  // spacer-free natural coords, so successive splits stay correct.
                  let boundaryNatural = contentEnd - effectiveTop;
                  let targetPage = page + 1;
                  let extraShift = 0;
                  const guarded = leaf.naturalHeight <= CONTENT_HEIGHT
                    && leaf.el.getAttribute('data-widow-control') !== 'false';
                  // Taller than a page slot: the widow-orphan rule is unsatisfiable there,
                  // and splitting beats overflowing.
                  const minLines = guarded ? MIN_KEPT_LINES : 1;
                  const hang = leaf.hang ?? 0;
                  while (boundaryNatural + hang < leaf.naturalHeight) {
                    const split = findLineSplit(leaf.el, boundaryNatural + hang, scale, minLines);
                    if (split === null) break;
                    const target = pageContentStart(targetPage, topRest, grid);
                    const h = target - (effectiveTop + extraShift + split.naturalLineTop);
                    if (h <= 0) break;
                    breaks.push({
                      height: h,
                      docPos: split.docPos,
                      hyphen: split.hyphen,
                      row: null,
                      bandOpenY: target,
                      reason: 'line-split',
                      naturalY: split.naturalLineTop,
                    });
                    extraShift += h;
                    boundaryNatural = split.naturalLineTop + CONTENT_HEIGHT;
                    targetPage++;
                  }
                  if (breaks.length === 0) {
                    if (pageOpener) {
                      noPushReason = 'page-opener-no-push';
                    } else if (leaf.naturalHeight <= CONTENT_HEIGHT) {
                      const target = pageContentStart(page + 1, topRest, grid);
                      breaks.push({
                        height: target - effectiveTop,
                        docPos: preLeafDocPos(leaf.el),
                        row: null,
                        bandOpenY: target,
                        reason: 'split-fallback-push-whole-leaf',
                        naturalY: 0,
                      });
                    } else {
                      noPushReason = 'splittable-too-tall-no-push';
                    }
                  }
                }
              }

              // Keep with next: a heading that fits but whose successor's first line does
              // not is left stranded at the page foot, so it goes down with it. One level
              // only — a run of them would need the pass to reconsider earlier leaves.
              if (
                breaks.length === 0 && leaf.keepNext && i + 1 < leaves.length
                && effectiveTop > contentStart + 0.5
              ) {
                const next = leaves[i + 1];
                // What the pair needs below this block: its own space below, then the
                // successor's space above (its padding; an atomic leaf's height has it
                // already) and its first line.
                const wantLines = next.el.getAttribute('data-widow-control') === 'false' ? 1 : MIN_KEPT_LINES;
                const needed = next.kind === 'atomic'
                  ? Math.min(next.naturalHeight, CONTENT_HEIGHT)
                  : firstLinesHeight(next.el, scale, wantLines) + (parseFloat(getComputedStyle(next.el).paddingTop) || 0);
                if (effectiveBottom + (leaf.spaceAfter ?? 0) + needed > contentEnd) {
                  const target = pageContentStart(page + 1, topRest, grid);
                  const { docPos, row } = leafSpacer(leaf);
                  breaks.push({
                    height: target - effectiveTop,
                    docPos,
                    row,
                    bandOpenY: target,
                    reason: 'keep-with-next',
                    naturalY: 0,
                  });
                }
              }

              // A page break the flow had to make — its own spacer, or one that left it at
              // the top — swallows the block's space above; a break the document asks for
              // keeps it (probed: a page top is 20.01mm, a manual break with 6/20mm above
              // puts the block at 26.00/40.01, an automatic one at 20.01 for either) —
              // unless the document turns spacing at a page start off altogether, where
              // even a manual break loses it. A line split doesn't: there the page starts
              // mid-block. `effectiveTop` still excludes this leaf's own push.
              if (
                i > 0 && !leaf.inTableCell && !keeps && (leaf.spaceAbove ?? 0) > 0.5
                && (breaks.some((b) => b.reason !== 'line-split')
                  || (breaks.length === 0 && Math.abs(effectiveTop - contentStart) < 0.5))
              ) {
                const from = docPosBeforeElement(leaf.el);
                const node = from !== null ? editorView.state.doc.nodeAt(from) : null;
                if (from !== null && node) {
                  pageTopBlocks.push({ from, to: from + node.nodeSize });
                  // The block is that much shorter from here on; the leaves below it were
                  // measured with the space still in place.
                  if (!marginModel) droppedShift += leaf.spaceAbove ?? 0;
                  else {
                    // A margin is outside the box: dropping it lifts the box, so the push
                    // that brought the box top to the page start reaches that much further.
                    const rise = Math.max(0, (leaf.spaceAbove ?? 0) - (leaves[i - 1]?.spaceAfter ?? 0));
                    const push = breaks.find((b) => b.reason !== 'line-split');
                    if (push) push.height += rise;
                    else if (rise > 0.5) {
                      const { docPos, row } = leafSpacer(leaf);
                      breaks.push({ height: rise, docPos, row, bandOpenY: null, reason: 'page-top-margin', naturalY: 0 });
                    }
                    droppedShift += rise;
                  }
                }
              }

              leavesDebug.push({
                index: i,
                tag: leaf.el.tagName,
                kind: leaf.kind,
                inTableCell: !!leaf.inTableCell,
                tableRow: leaf.tableRow
                  ? { columns: leaf.tableRow.columns, isFirstRow: leaf.tableRow.isFirstRow }
                  : null,
                naturalTop: leaf.naturalTop,
                naturalHeight: leaf.naturalHeight,
                // Read when the snapshot is, not by every pass for every leaf.
                get textPreview() { return (leaf.el.textContent ?? '').slice(0, 120); },
                get intraSpacerHeights() {
                  return Array.from(leaf.el.querySelectorAll<HTMLElement>('[data-page-break-spacer]')).map((sp) => sp.offsetHeight);
                },
                effectiveTop,
                effectiveBottom,
                pageOfTop: page,
                pageOfBottom: grid.pageAt(effectiveBottom),
                contentStart,
                contentEnd,
                overflowsPageEnd: effectiveBottom > contentEnd,
              });

              // Round each spacer to integer px (the browser renders spacers at integer
              // height, so an unrounded model shakes 1px per keystroke at non-100% zoom).
              let placedAny = false;
              const shiftAtLeafTop = cumulativeShift;
              const applied: { at: number; height: number; docPos: number; split: boolean }[] = [];
              for (const br of breaks) {
                if (br.docPos === null) continue;
                // A repeated header row sits in the gap, so the rows below start that
                // much lower — the same number has to reach the shift below.
                const h = Math.round(br.height) + (br.row?.header?.height ?? 0);
                if (h === 0) continue;
                // In-cell or between-rows breaks sit inside the continuous table box,
                // whose borders bleed through the gap, so they need a close/open band.
                const inBand = !!leaf.inTableCell || br.row !== null;
                if (inBand && br.bandOpenY !== null) {
                  const key = Math.round(br.bandOpenY);
                  const rowBreak = br.row !== null;
                  const lines = tableDrawsBorders(leaf.el);
                  // The table's own box, not the document's text area: a section's
                  // margins, or a page centred beside a wider section, move it.
                  const table = (leaf.el.closest('table') ?? leaf.el) as HTMLElement;
                  const left = leftInEditor(editorView, table);
                  const right = left + table.offsetWidth;
                  const existing = tableBands.get(key);
                  if (existing) {
                    existing.left = Math.min(existing.left, left);
                    existing.right = Math.max(existing.right, right);
                  }
                  if (!existing) tableBands.set(key, { openY: br.bandOpenY, rowBreak, lines, left, right });
                  else if (lines) existing.lines = true;
                  // An in-cell break sharing the boundary needs the full mask, so a
                  // band stays rowBreak only if every break at this key is one.
                  else if (!rowBreak) existing.rowBreak = false;
                }
                placements.push({ docPos: br.docPos, height: h, row: br.row, hyphen: br.hyphen });
                placementsDebug.push({
                  leafIndex: i,
                  docPos: br.docPos,
                  height: h,
                  reason: br.reason,
                  spacerKind: br.row ? 'table-row' : 'block',
                  columns: br.row ? br.row.columns : null,
                });
                cumulativeShift += h;
                applied.push({ at: br.naturalY, height: h, docPos: br.docPos, split: br.reason === 'line-split' });
                placedAny = true;
              }
              // Where each anchor in this leaf ended up: the shift at the leaf's top plus
              // every break that falls above the anchor, so a leaf split across a page
              // boundary sends the notes below the split to the next page.
              for (const anchor of leaf.refs ?? []) {
                let shift = shiftAtLeafTop;
                for (const br of applied) if (br.at <= anchor.dy + 0.5) shift += br.height;
                anchorPages.set(anchor.id, grid.pageAt(leaf.naturalTop + anchor.dy + shift));
              }
              if (!placedAny && noPushReason !== null) {
                placementsDebug.push({
                  leafIndex: i,
                  docPos: null,
                  height: 0,
                  reason: noPushReason,
                  spacerKind: 'none',
                  columns: null,
                });
              }

              // Read after this leaf's own spacer, so the page is the one it really lands on.
              const landedPage = grid.pageAt(leaf.naturalTop + cumulativeShift);
              if (leaf.sectionStart) sectionStartPages.push(landedPage);
              if (sided) placeSides(leaf, shiftAtLeafTop, applied);
              cumulativeShift -= droppedShift;
              // Track the lowest rendered content bottom (cumulativeShift now includes
              // this leaf's own spacer, so a pushed/split leaf counts at its real spot).
              maxEffectiveBottom = Math.max(
                maxEffectiveBottom,
                leaf.naturalTop + cumulativeShift + leaf.naturalHeight,
              );
              // Leave a cell flow: the row's added shift is its tallest cell's; the main
              // flow continues below the row from there.
              if (leaf.rowEnd) {
                maxCellDelta = Math.max(maxCellDelta, cumulativeShift - rowBaseline);
                cumulativeShift = rowBaseline + maxCellDelta;
              }
            }
            return {
              anchorPages, maxEffectiveBottom, sectionStartPages, placements, collapsedTrailing,
              pageTopBlocks, sectionInsets, sectionTops, sideShifts, tableBands, leavesDebug, placementsDebug, grid,
            };
          }

          // Every footnote, in anchor order, at the height it renders at. They are out
          // of the flow at a fixed width, so the height stands whatever page they land on
          // and the fixed point below only has to settle *which* page that is.
          const footnotes: FootnoteBox[] = Array
            .from(dom.querySelectorAll<HTMLElement>('.note[data-note-kind="footnote"]'))
            .filter((el) => getComputedStyle(el).position === 'absolute')
            .map((el) => ({ id: el.dataset.noteId ?? '', el, height: el.offsetHeight }));
          // The separator's own band. The three lengths are registered (@property in
          // editor.css), so these read back in px rather than as "0.1cm".
          const sepSpace = (['--note-sep-above', '--note-sep-weight', '--note-sep-below'] as const)
            .reduce((sum, name) => sum + (parseFloat(csRoot.getPropertyValue(name)) || 0), 0);

          // The room each page's own notes take out of its content area.
          function reservationFor(anchorPages: Map<string, number>): Map<number, number> {
            const out = new Map<number, number>();
            for (const note of footnotes) {
              const page = anchorPages.get(note.id);
              if (!page) continue;
              out.set(page, (out.get(page) ?? 0) + note.height);
            }
            // ponytail: a note is never split across pages — a page whose notes outgrow
            // its content area keeps one line of body text and overflows. Splitting the
            // note, as LibreOffice does, is the upgrade path.
            for (const [page, sum] of out) out.set(page, Math.min(sum + sepSpace, CONTENT_HEIGHT - 1));
            return out;
          }

          const sameReservation = (a: Map<number, number>, b: Map<number, number>) =>
            a.size === b.size && Array.from(a).every(([k, v]) => Math.abs((b.get(k) ?? NaN) - v) < 0.5);

          let reserved = new Map<number, number>();
          let placed = placeLeaves(reserved);
          for (let pass = 0; footnotes.length && pass < MAX_NOTE_FIT_PASSES; pass++) {
            const next = reservationFor(placed.anchorPages);
            if (sameReservation(next, reserved)) break;
            reserved = next;
            placed = placeLeaves(reserved);
          }
          const {
            maxEffectiveBottom, sectionStartPages, placements, collapsedTrailing,
            pageTopBlocks, sectionInsets, sectionTops, sideShifts, tableBands, leavesDebug, placementsDebug,
          } = placed;

          // Stack each page's notes up from its content end, in anchor order. The top
          // of the block is where the separator is drawn (editor.css).
          const notePlacements: { from: number; to: number; top: number; opensPage: boolean }[] = [];
          const nextTop = new Map<number, number>();
          const notePages = new Set<number>();
          for (const note of footnotes) {
            const page = placed.anchorPages.get(note.id);
            if (!page) continue;
            const base = placed.grid.bottomOf(page) - vm.bottom - (reserved.get(page) ?? 0) + sepSpace;
            const top = nextTop.get(page) ?? base;
            nextTop.set(page, top + note.height);
            // Resolved here, not at the decoration below: the key must watch the position
            // too, or an edit above the section leaves the decorations on a stale one.
            const from = docPosBeforeElement(note.el);
            const node = from === null ? null : editorView.state.doc.nodeAt(from);
            if (from === null || !node) continue;
            notePlacements.push({ from, to: from + node.nodeSize, top, opensPage: !notePages.has(page) });
            notePages.add(page);
          }

          // Skip the decoration rebuild + dispatch when placements are identical to the
          // previous pass. Most keystrokes don't change pagination, and re-dispatching
          // recreates the spacer DOM nodes (no `key` on the widgets) for no gain.
          const placementsKey =
            placements.map((p) => `${p.docPos}:${p.height}:${p.row ? `${p.row.columns}${p.row.close}${p.row.open}${p.row.header?.height ?? ''}` : p.hyphen ? 'h' : 'b'}`).join('|') +
            (collapsedTrailing ? `|c${collapsedTrailing.from}` : '') +
            pageTopBlocks.map((b) => `|t${b.from}`).join('') +
            Array.from(sectionInsets, ([f, s]) => `|i${f}:${s.left}:${s.right}`).join('') +
            sectionTops.map((t) => `|o${t.from}:${t.px}`).join('') +
            sideShifts.map((s) => `|s${s.from}-${s.to}:${s.dx}`).join('') +
            // The notes ride the same guard: a frozen layout would leave every footnote
            // at the position, and on the page, it used to belong to.
            notePlacements.map((n) => `|n${n.from}:${Math.round(n.top)}`).join('');
          const placementsChanged =
            placementsKey !== lastPlacementsKey && placementsKey !== prevPlacementsKey;
          if (placementsChanged) {
            prevPlacementsKey = lastPlacementsKey;
            lastPlacementsKey = placementsKey;
            const doc = editorView.state.doc;
            // Every spacer is built per view: a split pane renders the same decorations,
            // and one DOM node cannot sit in two documents at once — each would keep
            // taking it back from the other.
            const decoArray: Decoration[] = placements.map((p) => {
              // The open line and the repeated header belong to the row below, on its page's sides.
              const dx = p.row ? sideShifts.find((s) => !s.inline && s.from === p.docPos)?.dx ?? 0 : 0;
              return spacerDeco(p.docPos, () => {
                if (p.row) {
                  // A table breaks between rows: the spacer must be a <tr> so it's
                  // valid inside <tbody> and creates a borderless gap that pushes
                  // the following rows to the next page.
                  const trEl = document.createElement('tr');
                  trEl.dataset.pageBreakSpacer = 'true';
                  trEl.setAttribute('contenteditable', 'false');
                  const tdEl = document.createElement('td');
                  tdEl.dataset.pageBreakSpacerCell = 'true';
                  tdEl.setAttribute('colspan', String(p.row.columns));
                  tdEl.style.height = `${p.height}px`;
                  // Collapsed borders paint a shared edge once, so without these lines the
                  // gap keeps it and one of the two fragments ends unclosed. Out of flow:
                  // a collapsed border on the spacer itself moves every row below by half.
                  tdEl.style.position = 'relative';
                  for (const [border, side] of [[p.row.close, 'top'], [p.row.open, 'bottom']] as const) {
                    if (!border) continue;
                    const line = document.createElement('div');
                    const x = side === 'bottom' ? dx : 0;
                    line.style.cssText = `position:absolute;left:${x}px;right:${-x}px;${side}:0;border-${side}:${border}`;
                    tdEl.appendChild(line);
                  }
                  // The repeated header row, drawn at the foot of the gap — which is the
                  // top of the continuation. Out of flow, like the closing lines above.
                  if (p.row.header) {
                    const hdr = document.createElement('div');
                    hdr.style.cssText = `position:absolute;left:${dx}px;right:${-dx}px;bottom:0;pointer-events:none`;
                    hdr.innerHTML = p.row.header.html;
                    for (const el of Array.from(hdr.querySelectorAll('[contenteditable]'))) el.removeAttribute('contenteditable');
                    tdEl.appendChild(hdr);
                  }
                  trEl.appendChild(tdEl);
                  return trEl;
                }
                const spacerEl = document.createElement('div');
                spacerEl.dataset.pageBreakSpacer = 'true';
                // A negative one pulls the block above the padding — the only way up, since
                // a box's height can't be.
                spacerEl.style.height = `${Math.max(0, p.height)}px`;
                if (p.height < 0) spacerEl.style.marginTop = `${p.height}px`;
                spacerEl.style.pointerEvents = 'none';
                spacerEl.style.userSelect = 'none';
                spacerEl.setAttribute('contenteditable', 'false');
                return spacerEl;
              }, `${spacerKey(p)}|${dx}`);
            });
            if (collapsedTrailing) {
              decoArray.push(blockDeco(collapsedTrailing.from, collapsedTrailing.to, {
                style: 'height:0;min-height:0;margin:0;overflow:hidden',
              }));
            }
            for (const [from, s] of sectionInsets) {
              decoArray.push(blockDeco(from, s.to, {
                style: `--sec-inset-left:${s.left}px;--sec-inset-right:${s.right}px`,
              }));
            }
            for (const t of sectionTops) decoArray.push(blockDeco(t.from, t.to, { style: `padding-top:${t.px}px` }));
            for (const p of placements) if (p.hyphen) decoArray.push(Decoration.inline(p.docPos - 1, p.docPos, { class: 'pb-hyphen' }));
            for (const s of sideShifts) {
              const attrs = { class: 'pb-shift', style: `--pb-shift:${s.dx}px` };
              decoArray.push(s.inline ? Decoration.inline(s.from, s.to, attrs, { inclusiveEnd: !!s.end }) : blockDeco(s.from, s.to, attrs));
            }
            for (const b of pageTopBlocks) {
              decoArray.push(blockDeco(b.from, b.to, { style: 'padding-top:0;margin-top:0' }));
            }
            // Each footnote to the foot of its anchor's page; the topmost of a page also
            // carries the separator (editor.css draws it above the box).
            for (const n of notePlacements) {
              decoArray.push(blockDeco(n.from, n.to, {
                style: `top:${Math.round(n.top)}px`,
                ...(n.opensPage ? { 'data-note-page-first': 'true' } : {}),
              }));
            }

            decorations = decoArray.length > 0
              ? DecorationSet.create(doc, decoArray)
              : DecorationSet.empty;

            const tr = editorView.state.tr.setMeta('addToHistory', false).setMeta(pageBreakKey, true);
            editorView.dispatch(tr);
          }

          // maxEffectiveBottom is the lowest rendered content across all leaves,
          // including parallel cells of a too-tall row (a single last-leaf reading
          // would miss a taller sibling column).
          const numPages = Math.max(1, placed.grid.pageAt(maxEffectiveBottom));
          const targetHeight = placed.grid.bottomOf(numPages);
          dom.style.minHeight = `${targetHeight}px`;

          // In-cell table breaks (all values in unscaled document px relative to
          // .tiptap's top). Editor.svelte renders the mask + gap overlay from these.
          // The closing page's own content end and sheet bottom, which a footer taller
          // than the bottom margin lifts above the document's margins, and its footnotes
          // above that: the table closes over them, as LibreOffice sets the notes below.
          const tableBreakBands = Array.from(tableBands, ([key, info]) => {
            const closing = Math.max(1, placed.grid.pageAt(info.openY) - 1);
            const closeY = Math.min(info.openY, placed.grid.contentBottomOf(closing) - (reserved.get(closing) ?? 0));
            return {
              key,
              closeY,
              height: info.openY - closeY,
              rowBreak: info.rowBreak,
              lines: info.lines,
              left: info.left,
              width: info.right - info.left,
              marginBottom: placed.grid.bottomOf(closing) - closeY,
              gap: PAGE_GAP,
            };
          });

          // docHeight (document px) lets Editor.svelte size the scaled scroll footprint.
          // Announced only where the layout differs from the last one: every reader
          // re-reads the whole document from it and writes back what it found, so a pass
          // that lands what the last one did would set the round going again.
          const announced = `${numPages}:${targetHeight}:${sectionStartPages.join()}:${placementsKey}:`
            + tableBreakBands.map((b) => `${b.key}@${Math.round(b.closeY)}|${Math.round(b.left)}|${Math.round(b.width)}`).join();
          if (announced !== lastAnnounced) {
            lastAnnounced = announced;
            dom.dispatchEvent(new CustomEvent('pm-pagecount', {
              bubbles: true,
              detail: { numPages, docHeight: targetHeight, tableBreakBands, sectionStartPages },
            }));
          }

          lastSnapshot = {
            timestamp: new Date().toISOString(),
            layout: {
              PAGE_HEIGHT: vm.pageHeight,
              PAGE_GAP,
              PAGE_MARGIN_TOP: vm.top,
              PAGE_MARGIN_BOTTOM: vm.bottom,
              CONTENT_HEIGHT,
              CYCLE: vm.cycle,
            },
            numPages,
            leaves: leavesDebug,
            placements: placementsDebug,
            renderedSpacers: [],
            tableBreakBands,
            overlay: null, // filled in live by the debug accessor (captureOverlay)
          };

          isUpdating = false;
          lastBottom = contentBottom();

          // The spacers this pass placed moved every page-placed frame's anchor; the
          // frames sit out of the flow, so re-placing them changes no measurement.
          placePageFrames(editorView, vm.grid);
          framesOf = { view: editorView, doc: editorView.state.doc, grid: vm.grid };
          for (const pane of panes) {
            if (pane.state.doc !== editorView.state.doc) continue;
            framesCopied.set(pane, framesOf);
            copyPageFrames(editorView, pane, vm.grid);
          }

          // A per-page restart counts within the page each anchor landed on, which only
          // this pass knows (notes.ts). Renumbering can rewrap, so it takes a pass of its
          // own — on the same budget, since a label that moves its anchor never settles.
          const notePagesMoved = setNoteAnchorPages(placed.anchorPages);
          if (notePagesMoved && convergePasses < MAX_CONVERGE_PASSES) {
            editorView.dispatch(editorView.state.tr.setMeta(RESYNC_NOTES, true).setMeta('addToHistory', false));
          }

          // Each pass measures against the spacers present at its start, so a changed
          // result needs another pass to re-measure and settle (e.g. after an orientation
          // switch). Bounded by MAX_CONVERGE_PASSES against a two-layout ping-pong.
          if ((placementsChanged || notePagesMoved) && convergePasses < MAX_CONVERGE_PASSES) {
            convergePasses++;
            schedule();
          }
        }

        // A pending frame stays, as in columnsFlow.ts: re-requesting it on every update can
        // push it a frame on for as long as transactions keep coming.
        function schedule() {
          if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
          if (rafId === null) rafId = requestAnimationFrame(calculate);
        }
        // The bottom of the last block, not .tiptap's height: its min-height would hide
        // a block growing on a short document's only page.
        function contentBottom(): number {
          const last = editorView.dom.lastElementChild as HTMLElement | null;
          return last ? last.offsetTop + last.offsetHeight : 0;
        }
        // The caret's block reaching past its page's text area: an edit's pause would keep the
        // caret off the page for as long as the keys come (a held Enter), so it paginates now.
        function caretOverflows(): boolean {
          const $head = editorView.state.selection.$head;
          if (!$head.parent.isTextblock || $head.depth === 0) return false;
          for (let d = 1; d < $head.depth; d++) {
            if (!CARET_FLOW.has($head.node(d).type.name)) return false;
          }
          const el = editorView.nodeDOM($head.before());
          if (!(el instanceof HTMLElement)) return false;
          const bottom = topInEditor(editorView, el) + el.offsetHeight;
          const grid = readVerticalMargins(editorView.dom as HTMLElement).grid;
          const page = grid.pageAt(bottom);
          return bottom > grid.contentBottomOf(page) + 1 || bottom < grid.contentTopOf(page);
        }
        function scheduleEdit() {
          if (idleTimer !== null) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            idleTimer = null;
            const b = editBlock;
            editBlock = null;
            if (b === null) return; // a pass has run since the edit and measured it
            // Text typed into one block that is as tall as before moved nothing below it —
            // unless a page break falls inside the block, on a line the text has rewrapped.
            if (b !== false && contentBottom() === lastBottom) {
              const node = editorView.state.doc.nodeAt(b);
              // Widgets only: a node decoration on the block is the page-top rule, not a break.
              const inside = (spec: { key?: string }) => spec.key !== undefined;
              if (node && !decorations.find(b + 1, b + node.nodeSize - 1, inside).length) return;
            }
            schedule();
          }, EDIT_IDLE_MS);
        }

        // Initial calculation
        schedule();

        return {
          update(_view, prevState) {
            const before = pageBreakKey.getState(prevState);
            const after = pageBreakKey.getState(editorView.state);
            const forced = before?.recalc !== after?.recalc;
            const isEditTr = before?.edit !== after?.edit;
            if (!isUpdating && (prevState.doc !== editorView.state.doc || forced)) {
              convergePasses = 0; // fresh convergence budget per external change
              // Layout-only writes — the TOC rewriting its page numbers on every
              // pm-pagecount — answer the last pass, so forgetting the ping-pong
              // memory on them would leave the guard with nothing to catch.
              if (forced || isEditTr) prevPlacementsKey = null;
              if (isEditTr && !forced) {
                const b = after?.textBlock ?? null;
                editBlock = b === null || (editBlock !== null && editBlock !== b) ? false : b;
                if (caretOverflows()) schedule();
                else scheduleEdit();
              } else {
                schedule();
              }
            }
          },
          // The plugin's state outlives this view: a frame left marked pending would keep
          // a view built later (plugin re-registered) from ever scheduling a pass.
          destroy() {
            if (idleTimer !== null) clearTimeout(idleTimer);
            if (rafId !== null) cancelAnimationFrame(rafId);
            idleTimer = null;
            rafId = null;
            debugAccessors.delete(editorView);
            paginating.delete(editorView);
            layingOut.delete(editorView);
          },
        };
      },
    });

    return [plugin];
  },
});
