import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { COLUMNS_FIT_MARGIN_PX } from './columns';

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
  left: number;       // content-area left (mask left)
  width: number;      // content-area width (mask width)
  marginBottom: number;
  gap: number;
};

const debugAccessors = new WeakMap<EditorView, () => PageBreakDebugSnapshot | null>();

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
  return {
    top: mt,
    bottom: mb,
    contentHeight: pageHeight - mt - mb,
    pageHeight,
    cycle: pageHeight + PAGE_GAP,
    grid: gridFromRuns(cs.getPropertyValue('--pb-page-runs'), pageHeight),
  };
}

// "fromPage|height,…" — the runs the last pass reported (Editor.svelte publishes them).
// A document whose sections share one paper writes none, and the grid is uniform.
export function gridFromRuns(raw: string, pageHeight: number): PageGrid {
  const grid = new PageGrid(pageHeight);
  for (const part of raw.split(',')) {
    const [from, height] = part.split('|').map(Number);
    if (Number.isFinite(from) && Number.isFinite(height) && from > 1 && height > 0) grid.setFrom(from, height);
  }
  return grid;
}

// The rendered page grid. A page's top is the sum of the pages above it, so a section
// on its own paper (a landscape page amid portrait ones) shifts every page below it —
// the uniform document is just the one-run case. Heights are stored as runs, "every
// page from here on is this tall", so both lookups cost one pass over the sections.
export class PageGrid {
  private runs: { from: number; height: number }[];

  constructor(baseHeight: number) {
    this.runs = [{ from: 1, height: baseHeight }];
  }

  /** Every page from `page` on is `height` tall, until a later section says otherwise. */
  setFrom(page: number, height: number): void {
    while (this.runs.length > 1 && this.runs[this.runs.length - 1].from >= page) this.runs.pop();
    if (this.runs[this.runs.length - 1].from === page) this.runs[this.runs.length - 1].height = height;
    else if (this.runs[this.runs.length - 1].height !== height) this.runs.push({ from: Math.max(1, page), height });
  }

  heightOf(page: number): number {
    let h = this.runs[0].height;
    for (const r of this.runs) if (r.from <= page) h = r.height;
    return h;
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

function pageContentStart(page: number, marginTop: number, grid: PageGrid): number {
  return grid.topOf(page) + marginTop;
}

// `recalc` counts forced recomputes, `edit` the document edits. Layout-only writes
// (addToHistory:false) bump neither, so the convergence brake in `update` can tell an
// answer to the last pass from a fresh change.
type PageBreakState = { recalc: number; edit: number };

// Exported for tabStops.ts: a placement change moves lines, so the tab advances
// measured before it are stale.
export const pageBreakKey = new PluginKey<PageBreakState>('pageBreaks');

// Transaction meta flag: set it (e.g. when page margins change) to force a
// pagination recompute even though the document content is unchanged.
export const FORCE_PAGE_RECALC = 'forcePageBreakRecalc';

// A table-row spacer: the colspan bridging the row, plus the lines that close the table
// at the break — LibreOffice draws the row separator the break falls on, or, where the
// rows carry none, the table's own box (its top border closes, its bottom border opens).
// `header` is set for a table that repeats its first row (ODF table:table-header-rows,
// Word w:tblHeader): the spacer grows by that row's height and draws a copy of it at the
// foot of the gap, which is the top of the continuation.
type RowSpacer = { columns: number; close: string; open: string; header: { html: string; height: number } | null };

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
  columnsFragment?: { blockCount: number; firstBlockNeededPx: number };
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

const ATOMIC_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const SPLITTABLE_TAGS = new Set(['P']);
const CONTAINER_TAGS = new Set(['UL', 'OL', 'LI', 'BLOCKQUOTE']);

export const PageBreaks = Extension.create({
  name: 'pageBreaks',

  addProseMirrorPlugins() {
    let decorations = DecorationSet.empty;
    let isUpdating = false;
    let rafId: number | null = null;
    let lastPlacementsKey = '';
    // The layout before the current one: two layouts can each imply the other (a block
    // below a float's overhang moves further than the model's spacer), so seeing the older
    // key return means a ping-pong. null, not '' — that is a spacer-free layout's own key.
    let prevPlacementsKey: string | null = null;
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
        init: () => ({ recalc: 0, edit: 0 }),
        apply(tr, value) {
          const recalc = value.recalc + (tr.getMeta(FORCE_PAGE_RECALC) ? 1 : 0);
          const edit = value.edit
            + (tr.docChanged && tr.getMeta('addToHistory') !== false ? 1 : 0);
          return recalc === value.recalc && edit === value.edit ? value : { recalc, edit };
        },
      },
      props: {
        decorations() {
          return decorations;
        },
      },
      view(editorView) {
        let lastSnapshot: PageBreakDebugSnapshot | null = null;

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

        function docPosBeforeElement(el: HTMLElement): number | null {
          const parent = el.parentNode;
          if (!parent) return null;
          const childIndex = Array.from(parent.childNodes).indexOf(el as ChildNode);
          if (childIndex < 0) return null;
          try {
            return editorView.posAtDOM(parent as Node, childIndex);
          } catch {
            return null;
          }
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
            const range = document.createRange();
            range.selectNodeContents(textNode);
            for (const rect of Array.from(range.getClientRects())) {
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
        ): { naturalLineTop: number; docPos: number } | null {
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

          // Line-box bottom in natural coords. getClientRects reports glyph bottoms,
          // which sit a hair above the layout line-box, missing sub-pixel overflows. Use
          // the next line's top (and offsetHeight for the last line) as the boundary.
          const intraSpacerTotal = intraSpacers.reduce((s, sp) => s + sp.height, 0);
          const leafNaturalHeight = el.offsetHeight - intraSpacerTotal;
          function lineBoxBottomNatural(i: number): number {
            if (i + 1 < lines.length) return toNatural(lines[i + 1].top);
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

          const naturalLineTop = toNatural(lines[k].top);
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
          return { naturalLineTop, docPos: lo };
        }

        function collectLeaves(contentHeight: number, scaleFactor: number): Leaf[] {
          const dom = editorView.dom;
          const leaves: Leaf[] = [];
          // cumulativeSpacerHeight accumulates spacer offsetHeights (unscaled
          // layout px), matching the offsetHeight-based naturalHeight.
          let cumulativeSpacerHeight = 0;
          // Space above that the page-top rule has already taken off the blocks walked
          // so far: added back, so what is measured is the document, not the last pass's
          // answer to it. Reading the answer back is what made the layout flip-flop.
          let cumulativeDropped = 0;
          // Only the first endnote opens a page; the rest follow it down the column.
          let seenEndnote = false;

          // A leaf's border-box top within .tiptap, in document px. Summing offsetTop up
          // the offsetParent chain is unaffected by .paper's transform:scale, so it's the
          // same at every zoom; the chain ends at .tiptap so the origin is the page top.
          function topWithin(el: HTMLElement): number {
            let top = 0;
            let node: HTMLElement | null = el;
            while (node && node !== dom) {
              // A block spaced above single is drawn half a leading above its flow
              // position (editor.css), and offsetTop reports where it is drawn — so the
              // shift comes back off, or the flow inherits a paint correction.
              const cs = getComputedStyle(node);
              const shift = cs.position === 'relative' ? parseFloat(cs.top) : 0;
              top += node.offsetTop - (Number.isFinite(shift) ? shift : 0);
              node = node.offsetParent as HTMLElement | null;
            }
            return top;
          }

          // A leaf's top in the undecorated document: the rendered top with the spacers
          // above it taken out and the space they swallowed put back, so a pass never
          // measures its own previous answer. Every leaf must be born through this.
          function naturalTopOf(el: HTMLElement): number {
            return topWithin(el) - cumulativeSpacerHeight + cumulativeDropped;
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
          function walkTableRows(wrapperEl: HTMLElement, inTableCell = false) {
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
            let seenRealRow = false;
            for (const tr of rowEls) {
              if (tr.dataset?.pageBreakSpacer) {
                cumulativeSpacerHeight += tr.offsetHeight;
                continue;
              }
              if (tr.tagName !== 'TR') continue;
              const rowHeight = tr.offsetHeight;
              if (rowHeight <= contentHeight) {
                // Row fits on a page → atomic leaf; the table breaks between rows.
                leaves.push({
                  el: tr,
                  kind: 'atomic',
                  naturalTop: naturalTopOf(tr),
                  naturalHeight: rowHeight,
                  tableRow: { columns, wrapperEl, isFirstRow: !seenRealRow },
                });
              } else {
                // Row taller than a page: each cell is an independent flow from the row
                // top, breaking in its own column. Walk every cell, resetting the spacer
                // baseline per cell; the row consumes the tallest cell's spacers.
                const cells = (Array.from(tr.children) as HTMLElement[]).filter(
                  c => c.tagName === 'TD' || c.tagName === 'TH',
                );
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
              // The note section (notes.ts) is not body text: a footnote is out of the
              // flow and placed at the foot of its anchor's page below, an endnote flows
              // here and starts its own page, as LibreOffice collects them.
              if (child.classList.contains('note-section')) {
                walk(child, inTableCell);
                continue;
              }
              if (child.classList.contains('note')) {
                if (child.dataset?.noteKind === 'footnote') continue;
                leaves.push({
                  el: child,
                  kind: 'splittable',
                  naturalTop: naturalTopOf(child),
                  naturalHeight: child.offsetHeight,
                  forceBreakBefore: !seenEndnote,
                });
                seenEndnote = true;
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
                });
                continue;
              }
              // A text box paginates atomically: a line-split spacer can't render
              // sanely inside a rotated/floated node view.
              if (child.classList.contains('textbox-node')) {
                // Its anchor paragraph's spacing rides the box (textBox.ts): space above
                // as padding, which a page top drops, space below as the margin.
                const boxCs = getComputedStyle(child);
                const spaceAbove = parseFloat(boxCs.getPropertyValue('--space-before')) || 0;
                const dropped = spaceAbove > 0.5 && !inTableCell && parseFloat(boxCs.paddingTop) < 0.5
                  ? spaceAbove : 0;
                leaves.push({
                  el: child,
                  kind: 'atomic',
                  naturalTop: naturalTopOf(child),
                  naturalHeight: child.offsetHeight + dropped,
                  spaceAfter: inTableCell ? 0 : parseFloat(boxCs.marginBottom) || 0,
                  spaceAbove,
                  inTableCell,
                });
                cumulativeDropped += dropped;
                continue;
              }
              // A multi-column section fragment: also atomic for spacer purposes (a
              // spacer inside a multicol container rebalances around it), but the
              // placement logic defers overflow to columnsFlow.ts via columnsFragment.
              if (child.classList.contains('columns-node')) {
                const count = Math.max(1, parseInt(child.dataset?.columns ?? '', 10) || 1);
                const first = child.firstElementChild as HTMLElement | null;
                let firstPx = 0;
                if (first) {
                  for (const r of Array.from(first.getClientRects())) firstPx += r.height;
                  firstPx = firstPx / scaleFactor / count;
                }
                leaves.push({
                  el: child,
                  kind: 'atomic',
                  naturalTop: naturalTopOf(child),
                  naturalHeight: child.offsetHeight,
                  inTableCell,
                  columnsFragment: {
                    blockCount: child.children.length,
                    firstBlockNeededPx: Math.max(firstPx, 16),
                  },
                });
                continue;
              }
              // A paragraph holding a floated image paginates atomically: a line-split
              // spacer beside the float is dropped by ProseMirror. As-character images
              // are ordinary line boxes, so their paragraph breaks between lines.
              const splittableTag = SPLITTABLE_TAGS.has(tag);
              const floats = Array.from(child.querySelectorAll<HTMLElement>('.image-node'))
                .filter((img) => !!img.style.float);
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
                leaves.push({
                  el: child,
                  kind: isAtomic ? 'atomic' : 'splittable',
                  naturalTop: naturalTopOf(child),
                  naturalHeight: Math.max(child.offsetHeight, floatBottom) - intraSpacerHeight + dropped,
                  spaceAfter: inTableCell ? 0 : parseFloat(cs.marginBottom) || 0,
                  spaceAbove,
                  inTableCell,
                  // A manual page break is honored for top-level blocks only (not in
                  // a table cell, where the table breaks atomically between rows).
                  forceBreakBefore: !inTableCell && child.dataset?.pageBreakBefore === 'page',
                  // A heading keeps with the next block in both Word and LibreOffice,
                  // so their styles carry it and the attr only marks the other blocks.
                  keepNext: !inTableCell
                    && (child.dataset?.keepNext === 'true' || /^H[1-5]$/.test(child.tagName)),
                  sectionStart: !inTableCell && child.dataset?.sectionBreak === 'true',
                  refs: refsWithin(child),
                });
                cumulativeSpacerHeight += intraSpacerHeight;
                cumulativeDropped += dropped;
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

        function calculate() {
          rafId = null;
          if (isUpdating || !editorView.dom.isConnected) return;
          isUpdating = true;

          const dom = editorView.dom;
          void dom.offsetHeight; // force reflow

          const vm = readVerticalMargins(dom);
          const CONTENT_HEIGHT = vm.contentHeight;

          // Side margins + page width (px) for table close/open bands. These don't
          // affect pagination (only line wrapping), so readVerticalMargins ignores
          // them; we read them here just to size the bands to the content width.
          const csRoot = getComputedStyle(dom);
          const mlRaw = parseFloat(csRoot.getPropertyValue('--user-margin-left'));
          const mrRaw = parseFloat(csRoot.getPropertyValue('--user-margin-right'));
          const pwRaw = parseFloat(csRoot.getPropertyValue('--user-page-width'));
          const marginLeft = Number.isFinite(mlRaw) ? mlRaw : 80;
          const contentWidth = (Number.isFinite(pwRaw) ? pwRaw : 794) - marginLeft - (Number.isFinite(mrRaw) ? mrRaw : 80);
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
            .filter((g) => g.length === 4 && g.every(Number.isFinite));
          const reachAt = (i: number) => reach[Math.min(i, reach.length - 1)]
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
          // Mirrored margins (pageMargins.ts): the padding draws the odd page's pair,
          // so an even page's blocks move right by the difference between the two.
          const mirrorRaw = parseFloat(csRoot.getPropertyValue('--user-margin-mirror'));
          const mirror = Number.isFinite(mirrorRaw) ? mirrorRaw : 0;

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
            // The grid this placement lays out against, grown as each section's first
            // page becomes known. Built here, not read back, so a pass never measures
            // its own last answer.
            const grid = new PageGrid(paperAt(0));
            const placements: {
              docPos: number;
              height: number;
              row: RowSpacer | null;
            }[] = [];
            // Node-decoration range collapsing the trailing empty paragraph after a
            // document-final columns chain when it sits past the page content area.
            let collapsedTrailing: { from: number; to: number } | null = null;
            // Node-decoration ranges dropping the space before a block a soft break put
            // at a page top (probed in LibreOffice); a hard break and the first block keep it.
            const pageTopBlocks: { from: number; to: number }[] = [];
            // Top-level blocks a section's own side margins inset, keyed by doc position.
            const sectionInsets = new Map<number, { to: number; left: number; right: number }>();
            // Close/open bands for in-cell + between-rows table breaks. Keyed by the
            // rounded openY (the grouping id) → the unrounded openY (so the band lands
            // exactly on the page cycle) plus whether it's a between-rows break.
            const tableBands = new Map<number, { openY: number; rowBreak: boolean }>();
            const leavesDebug: PageBreakDebugSnapshot['leaves'] = [];
            const placementsDebug: PageBreakDebugSnapshot['placements'] = [];

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
              // A section's first page uses its "first" reaches, every other page its
              // "rest" ones — page 1 is section 1's first page.
              if (leaf.sectionStart) {
                // Where the section really begins: a forced break moves its first block to
                // the next page, and that page is the one its "first" zones belong to.
                const prevStart = grid.topOf(page) + reachAt(sectionIndex)[1];
                const pushed = !!leaf.forceBreakBefore && i > 0 && effectiveTop > prevStart + 0.5;
                sectionIndex++;
                sectionFirstPage = pushed ? page + 1 : page;
                // Its paper governs from its first page on. Setting it here can only move
                // pages *below* that one, so the page just resolved stays valid.
                grid.setFrom(sectionFirstPage, paperAt(sectionIndex));
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
              const forced = !!leaf.forceBreakBefore && i > 0 && effectiveTop > contentStart + 0.5;

              if (forced) {
                // The next page's own content start: a section beginning here brings its
                // first-page header with it.
                const nextTop = page + 1 === sectionFirstPage ? topFirst : topRest;
                const target = pageContentStart(page + 1, nextTop, grid);
                const { docPos, row } = leafSpacer(leaf);
                breaks.push({
                  height: target - effectiveTop,
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
                const target = pageContentStart(page + 1, vm.top, grid);
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
              } else if (effectiveBottom > contentEnd) {
                if (leaf.kind === 'atomic') {
                  const cf = leaf.columnsFragment;
                  if (cf && cf.blockCount > 1 && cf.firstBlockNeededPx + COLUMNS_FIT_MARGIN_PX <= contentEnd - effectiveTop) {
                    // columnsFlow.ts will split the fragment so a prefix fills this
                    // page; pushing it whole here would fight that.
                    noPushReason = 'columns-await-flow';
                  } else if (cf && effectiveTop <= contentStart + 0.5) {
                    // Already at a page top and still too tall (a paragraph taller
                    // than the page slot): pushing just moves the problem one page
                    // down forever — the flow line-splits the paragraph instead.
                    noPushReason = 'columns-line-split-pending';
                  } else if (leaf.naturalHeight <= CONTENT_HEIGHT || cf) {
                    // A columns fragment may be pushed even when taller than a page:
                    // the flow splits it again once it sits at the next page top.
                    const target = pageContentStart(page + 1, vm.top, grid);
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
                  while (boundaryNatural < leaf.naturalHeight) {
                    const split = findLineSplit(leaf.el, boundaryNatural, scale, minLines);
                    if (split === null) break;
                    const target = pageContentStart(targetPage, vm.top, grid);
                    const h = target - (effectiveTop + extraShift + split.naturalLineTop);
                    if (h <= 0) break;
                    breaks.push({
                      height: h,
                      docPos: split.docPos,
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
                    if (leaf.naturalHeight <= CONTENT_HEIGHT) {
                      const target = pageContentStart(page + 1, vm.top, grid);
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
                  const target = pageContentStart(page + 1, vm.top, grid);
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

              // A page break — its own spacer, or one that left it at the top — swallows the
              // block's space above, as LibreOffice does. A line split doesn't: there the
              // page starts mid-block. `effectiveTop` still excludes this leaf's own push.
              if (
                i > 0 && !leaf.inTableCell && (leaf.spaceAbove ?? 0) > 0.5
                && (breaks.some((b) => b.reason !== 'line-split')
                  || (breaks.length === 0 && Math.abs(effectiveTop - contentStart) < 0.5))
              ) {
                const from = docPosBeforeElement(leaf.el);
                const node = from !== null ? editorView.state.doc.nodeAt(from) : null;
                if (from !== null && node) {
                  pageTopBlocks.push({ from, to: from + node.nodeSize });
                  // The block is that much shorter from here on; the leaves below it were
                  // measured with the space still in place.
                  droppedShift += leaf.spaceAbove ?? 0;
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
                textPreview: (leaf.el.textContent ?? '').slice(0, 120),
                intraSpacerHeights: Array.from(
                  leaf.el.querySelectorAll<HTMLElement>('[data-page-break-spacer]'),
                ).map((sp) => sp.offsetHeight),
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
              const applied: { at: number; height: number }[] = [];
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
                  const existing = tableBands.get(key);
                  if (!existing) tableBands.set(key, { openY: br.bandOpenY, rowBreak });
                  // An in-cell break sharing the boundary needs the full mask, so a
                  // band stays rowBreak only if every break at this key is one.
                  else if (!rowBreak) existing.rowBreak = false;
                }
                placements.push({ docPos: br.docPos, height: h, row: br.row });
                placementsDebug.push({
                  leafIndex: i,
                  docPos: br.docPos,
                  height: h,
                  reason: br.reason,
                  spacerKind: br.row ? 'table-row' : 'block',
                  columns: br.row ? br.row.columns : null,
                });
                cumulativeShift += h;
                applied.push({ at: br.naturalY, height: h });
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
              const ins = insetAt(sectionIndex);
              const mir = landedPage % 2 === 0 ? mirror : 0;
              const insLeft = Math.round((landedPage === sectionFirstPage ? ins[0] : ins[2]) + mir);
              const insRight = Math.round((landedPage === sectionFirstPage ? ins[1] : ins[3]) - mir);
              if (insLeft || insRight) {
                // The leaf may be a row, or a line inside one; the inset belongs on the
                // top-level block, which is the ancestor .tiptap holds directly.
                let block: HTMLElement = leaf.el;
                while (block.parentElement && block.parentElement !== dom) block = block.parentElement;
                const from = block.parentElement === dom ? docPosBeforeElement(block) : null;
                const node = from !== null ? editorView.state.doc.nodeAt(from) : null;
                if (from !== null && node && !sectionInsets.has(from)) {
                  sectionInsets.set(from, { to: from + node.nodeSize, left: insLeft, right: insRight });
                }
              }
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
              pageTopBlocks, sectionInsets, tableBands, leavesDebug, placementsDebug, grid,
            };
          }

          // Every footnote, in anchor order, at the height it renders at. They are out
          // of the flow at a fixed width, so the height stands whatever page they land on
          // and the fixed point below only has to settle *which* page that is.
          const footnotes: FootnoteBox[] = Array
            .from(dom.querySelectorAll<HTMLElement>('.note[data-note-kind="footnote"]'))
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
            pageTopBlocks, sectionInsets, tableBands, leavesDebug, placementsDebug,
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
            placements.map((p) => `${p.docPos}:${p.height}:${p.row ? `${p.row.columns}${p.row.close}${p.row.open}${p.row.header?.height ?? ''}` : 'b'}`).join('|') +
            (collapsedTrailing ? `|c${collapsedTrailing.from}` : '') +
            pageTopBlocks.map((b) => `|t${b.from}`).join('') +
            Array.from(sectionInsets, ([f, s]) => `|i${f}:${s.left}:${s.right}`).join('') +
            // The notes ride the same guard: a frozen layout would leave every footnote
            // at the position, and on the page, it used to belong to.
            notePlacements.map((n) => `|n${n.from}:${Math.round(n.top)}`).join('');
          const placementsChanged =
            placementsKey !== lastPlacementsKey && placementsKey !== prevPlacementsKey;
          if (placementsChanged) {
            prevPlacementsKey = lastPlacementsKey;
            lastPlacementsKey = placementsKey;
            const doc = editorView.state.doc;
            const decoArray: Decoration[] = placements.map((p) => {
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
                  line.style.cssText = `position:absolute;left:0;right:0;${side}:0;border-${side}:${border}`;
                  tdEl.appendChild(line);
                }
                // The repeated header row, drawn at the foot of the gap — which is the
                // top of the continuation. Out of flow, like the closing lines above.
                if (p.row.header) {
                  const hdr = document.createElement('div');
                  hdr.style.cssText = 'position:absolute;left:0;right:0;bottom:0;pointer-events:none';
                  hdr.innerHTML = p.row.header.html;
                  for (const el of Array.from(hdr.querySelectorAll('[contenteditable]'))) el.removeAttribute('contenteditable');
                  tdEl.appendChild(hdr);
                }
                trEl.appendChild(tdEl);
                return Decoration.widget(p.docPos, trEl, { side: -1 });
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
              return Decoration.widget(p.docPos, spacerEl, { side: -1 });
            });
            if (collapsedTrailing) {
              decoArray.push(Decoration.node(collapsedTrailing.from, collapsedTrailing.to, {
                style: 'height:0;min-height:0;margin:0;overflow:hidden',
              }));
            }
            for (const [from, s] of sectionInsets) {
              decoArray.push(Decoration.node(from, s.to, {
                style: `--sec-inset-left:${s.left}px;--sec-inset-right:${s.right}px`,
              }));
            }
            for (const b of pageTopBlocks) {
              // --space-top: a text box draws its own space above from it (textBox.ts).
              decoArray.push(Decoration.node(b.from, b.to, { style: 'padding-top:0;margin-top:0;--space-top:0px' }));
            }
            // Each footnote to the foot of its anchor's page; the topmost of a page also
            // carries the separator (editor.css draws it above the box).
            for (const n of notePlacements) {
              decoArray.push(Decoration.node(n.from, n.to, {
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
          const bandSpan = vm.bottom + PAGE_GAP + vm.top;
          const tableBreakBands = Array.from(tableBands, ([key, info]) => ({
            key,
            closeY: info.openY - bandSpan,
            height: bandSpan,
            rowBreak: info.rowBreak,
            left: marginLeft,
            width: contentWidth,
            marginBottom: vm.bottom,
            gap: PAGE_GAP,
          }));

          // docHeight (document px) lets Editor.svelte size the scaled scroll footprint.
          dom.dispatchEvent(new CustomEvent('pm-pagecount', {
            bubbles: true,
            detail: { numPages, docHeight: targetHeight, tableBreakBands, sectionStartPages },
          }));

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

          // Each pass measures against the spacers present at its start, so a changed
          // result needs another pass to re-measure and settle (e.g. after an orientation
          // switch). Bounded by MAX_CONVERGE_PASSES against a two-layout ping-pong.
          if (placementsChanged && convergePasses < MAX_CONVERGE_PASSES) {
            convergePasses++;
            schedule();
          }
        }

        function schedule() {
          if (rafId !== null) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(calculate);
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
              schedule();
            }
          },
          destroy() {
            if (rafId !== null) cancelAnimationFrame(rafId);
            debugAccessors.delete(editorView);
          },
        };
      },
    });

    return [plugin];
  },
});
