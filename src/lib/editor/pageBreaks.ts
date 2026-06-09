import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

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
    // Table provenance: inTableCell = this leaf lives inside a cell of a row that
    // was itself too tall to fit a page (so we split its content). tableRow is set
    // when the leaf *is* a whole table row (columns = colspan to bridge, isFirstRow
    // = the table's first row, which breaks before the wrapper rather than mid-table).
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
  // Live snapshot of the *rendered* table-break overlay + table geometry (captured from
  // the DOM at dump time), so we can tell whether the band-layer actually masks the
  // table's borders bleeding through each gap. All rects are unscaled document px
  // relative to .tiptap's top-left — the same space as `leaves`/`tableBreakBands` — so
  // they line up directly. null until the first dump after the overlay mounts.
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
  left: number;       // content-area left (mask left)
  width: number;      // content-area width (mask width)
  marginBottom: number;
  gap: number;
};

const debugAccessors = new WeakMap<EditorView, () => PageBreakDebugSnapshot | null>();

export function getPageBreakDebug(view: EditorView): PageBreakDebugSnapshot | null {
  return debugAccessors.get(view)?.() ?? null;
}

// A4 page layout constants (px at 96 dpi). The page height (and thus cycle) is
// orientation-dependent and the content-area inset (top/bottom margin) is
// user-adjustable, so both are read per layout pass from live CSS vars instead
// of being constants — the values below are only portrait fallbacks.
const PAGE_HEIGHT = 1123;
const PAGE_GAP = 20;
const DEFAULT_MARGIN_TOP = 96;
const DEFAULT_MARGIN_BOTTOM = 96;

type VMargins = {
  top: number;
  bottom: number;
  contentHeight: number;
  pageHeight: number;
  cycle: number;
};

// Reads the vertical page margins + page height (px) from the --user-* custom
// props the Layout panel writes (pageMargins.ts / pageOrientation.ts). These are
// document-px values, so they pair directly with the offsetTop measurements below.
// Side margins don't affect pagination (only line wrapping), so we ignore them.
function readVerticalMargins(dom: HTMLElement): VMargins {
  const cs = getComputedStyle(dom);
  const top = parseFloat(cs.getPropertyValue('--user-margin-top'));
  const bottom = parseFloat(cs.getPropertyValue('--user-margin-bottom'));
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
  };
}

function pageContentStart(page: number, marginTop: number, cycle: number): number {
  return (page - 1) * cycle + marginTop;
}

function pageContentEnd(page: number, marginTop: number, contentHeight: number, cycle: number): number {
  return (page - 1) * cycle + marginTop + contentHeight;
}

function getPageForY(y: number, cycle: number): number {
  return Math.floor(y / cycle) + 1;
}

const pageBreakKey = new PluginKey<number>('pageBreaks');

// Transaction meta flag: set it (e.g. when page margins change) to force a
// pagination recompute even though the document content is unchanged.
export const FORCE_PAGE_RECALC = 'forcePageBreakRecalc';

type Leaf = {
  el: HTMLElement;
  kind: 'atomic' | 'splittable';
  naturalTop: number;
  naturalHeight: number;
  // Present when the leaf is a <tr> of a paginated table. Each row is an atomic
  // leaf so the table can break between rows across pages (a whole table is
  // usually taller than a page). `isFirstRow` pushes the entire table (a block
  // spacer before the wrapper); later rows push via a spacer <tr> inside the table.
  tableRow?: { columns: number; wrapperEl: HTMLElement; isFirstRow: boolean };
  // True for paragraph leaves emitted from inside a too-tall table cell (the cell
  // content is flowed across pages). Their breaks get a full-width close/open
  // border + margin/gap mask so the single table element looks closed at each
  // page break (it can't break structurally — it's one continuous box).
  inTableCell?: boolean;
  // Flow brackets for a too-tall row's cells. Each cell is an independent vertical
  // flow that starts at the row top, so the placement loop resets its cumulative
  // shift per cell: `cellStart` marks a cell's first leaf (`rowStart` additionally
  // the row's first cell), `rowEnd` the last leaf of the last cell.
  cellStart?: boolean;
  rowStart?: boolean;
  rowEnd?: boolean;
};

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

    const plugin = new Plugin<number>({
      key: pageBreakKey,
      // A counter bumped whenever a FORCE_PAGE_RECALC transaction arrives. The
      // plugin's own decoration dispatches don't carry that meta, so this never
      // self-triggers. `update` reschedules a layout pass when the counter moves.
      state: {
        init: () => 0,
        apply(tr, value) {
          return tr.getMeta(FORCE_PAGE_RECALC) ? value + 1 : value;
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
        // The overlay (.band-layer) is a sibling of the editor's host inside .paper, so we
        // reach it by climbing to .paper. Viewport rects are converted to unscaled doc px
        // relative to .tiptap's top-left (divide by the measured paper scale) so they sit
        // in the same coordinate space as the bands/leaves and can be compared directly.
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

        // For a pre-leaf push we want the spacer to render OUTSIDE any
        // list-item wrapper, so the <li>'s bullet marker stays aligned with
        // its own text. Walk up through <li> ancestors — but stop the moment
        // `target` has a prior sibling, otherwise we'd also push earlier
        // already-placed paragraphs inside the same <li> (e.g. a multi-
        // paragraph LI produced by backspacing across a page break).
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

        // Where to place a leaf's page-break spacer, and whether it must be a
        // table row (so the widget is valid markup inside a <tbody>).
        function leafSpacer(leaf: Leaf): { docPos: number | null; row: { columns: number } | null } {
          if (leaf.tableRow) {
            // First row crossing the boundary → push the whole table with a block
            // spacer before the wrapper (otherwise the table's top would be
            // orphaned above an in-table gap).
            if (leaf.tableRow.isFirstRow) {
              return { docPos: preLeafDocPos(leaf.tableRow.wrapperEl), row: null };
            }
            // Later rows → a spacer <tr> before the row pushes it (and the rows
            // after it) to the next page while the table stays one element.
            return { docPos: docPosBeforeElement(leaf.el), row: { columns: leaf.tableRow.columns } };
          }
          return { docPos: preLeafDocPos(leaf.el), row: null };
        }

        // Walks text nodes inside `el`, skipping any that live inside a spacer
        // widget, and returns one rect per visual line (in viewport coords).
        function getLineRects(el: HTMLElement): { top: number; bottom: number }[] {
          const allRects: DOMRect[] = [];
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
          const lines: { top: number; bottom: number }[] = [];
          for (const r of allRects) {
            const last = lines[lines.length - 1];
            // Rects are sorted by top → r.top ≥ last.top. Merge into the
            // current line when they vertically overlap, so an inline run with
            // a smaller font (lower ascender → larger `top`) shares the line
            // of its larger-font neighbours instead of becoming a phantom
            // line. The −1 px tolerance keeps touching-but-not-overlapping
            // rects on separate lines.
            if (last && r.top < last.bottom - 1) {
              last.top = Math.min(last.top, r.top);
              last.bottom = Math.max(last.bottom, r.bottom);
            } else {
              lines.push({ top: r.top, bottom: r.bottom });
            }
          }
          return lines;
        }

        function findLineSplit(
          el: HTMLElement,
          overflowDistance: number,
          scale: number,
        ): { naturalLineTop: number; docPos: number } | null {
          const lines = getLineRects(el);
          if (lines.length === 0) return null;
          const elRect = el.getBoundingClientRect();

          // Any pre-existing spacers inside this leaf distort the viewport
          // y-coordinates of lines below them. Build a table to translate
          // viewport y → natural offset within the leaf (unscaled, no intra-
          // spacers). offsetHeight is already unscaled, so we don't divide it.
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

          // Line-box bottom in natural coords. Range.getClientRects() reports
          // glyph-level bottoms (descender), which can sit a hair above the
          // line-box bottom used by layout — enough for sub-pixel overflows to
          // be missed at zoom 100. Use the next line's top as the boundary,
          // and the leaf's own offsetHeight for the last line so the threshold
          // matches the outer `effectiveBottom > contentEnd` check.
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

        function collectLeaves(contentHeight: number): Leaf[] {
          const dom = editorView.dom;
          const leaves: Leaf[] = [];
          // cumulativeSpacerHeight accumulates spacer offsetHeights (unscaled
          // layout px), matching the offsetHeight-based naturalHeight.
          let cumulativeSpacerHeight = 0;

          // A leaf's border-box top within .tiptap, in document px. Summing offsetTop
          // up the offsetParent chain is unaffected by the `transform: scale()` on
          // .paper, so the value is the same at every display zoom. offsetTop includes
          // each offsetParent's top padding; the chain ends at .tiptap, whose padding-
          // top is the page top margin, so the sum already uses the page-cycle origin
          // (page top = 0, content starts at the top margin).
          function topWithin(el: HTMLElement): number {
            let top = 0;
            let node: HTMLElement | null = el;
            while (node && node !== dom) {
              top += node.offsetTop;
              node = node.offsetParent as HTMLElement | null;
            }
            return top;
          }

          // Emit one atomic leaf per table row so the table can break between
          // rows across pages. TipTap renders tables inside a node-view
          // <div class="tableWrapper"><table><colgroup><tbody>…. A whole table is
          // typically taller than a page, so treating it as a single atomic leaf
          // left it overflowing (atomic-too-tall-no-push); row leaves fix that.
          function walkTableRows(wrapperEl: HTMLElement, inTableCell = false) {
            const tableEl = (wrapperEl.tagName === 'TABLE'
              ? wrapperEl
              : wrapperEl.querySelector('table')) as HTMLElement | null;
            const tbody = tableEl?.querySelector('tbody') as HTMLElement | null;
            const rowEls = tbody
              ? (Array.from(tbody.children) as HTMLElement[])
              : [];
            const realRows = rowEls.filter(r => r.tagName === 'TR' && !r.dataset?.pageBreakSpacer);
            // Fallback: no rows found — measure the whole wrapper as one atomic leaf.
            if (realRows.length === 0) {
              leaves.push({
                el: wrapperEl,
                kind: 'atomic',
                naturalTop: topWithin(wrapperEl) - cumulativeSpacerHeight,
                naturalHeight: wrapperEl.offsetHeight,
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
                  naturalTop: topWithin(tr) - cumulativeSpacerHeight,
                  naturalHeight: rowHeight,
                  tableRow: { columns, wrapperEl, isFirstRow: !seenRealRow },
                });
              } else {
                // Row taller than a page: each cell is an independent vertical flow
                // that starts at the row top and breaks in its own column (like
                // LibreOffice/Word row fragments per page). Walk every cell, resetting
                // the spacer baseline per cell so a sibling cell's spacers don't shift
                // this cell's measured tops; the row consumes the tallest cell's
                // spacers. Flow markers (cellStart/rowStart/rowEnd) let the placement
                // loop bracket its cumulative shift the same way.
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
                cumulativeSpacerHeight += child.offsetHeight;
                continue;
              }
              // Skip the column-/row-resize handle widgets (tableColumnResize.ts /
              // tableRowResize.ts), which ProseMirror injects as direct children of
              // the active cells. They're position:absolute, so they're neither
              // document content nor part of the flow — measuring one as a leaf yields
              // garbage geometry (negative offsetTop, full-table height) that corrupts
              // pagination. Being out of flow they take no vertical space, so unlike a
              // page-break spacer we skip them without touching cumulativeSpacerHeight.
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
              const isAtomic = ATOMIC_TAGS.has(tag);
              const isSplittable = SPLITTABLE_TAGS.has(tag);
              if (isAtomic || isSplittable) {
                let intraSpacerHeight = 0;
                for (const sp of Array.from(
                  child.querySelectorAll<HTMLElement>('[data-page-break-spacer]'),
                )) {
                  intraSpacerHeight += sp.offsetHeight;
                }
                leaves.push({
                  el: child,
                  kind: isAtomic ? 'atomic' : 'splittable',
                  naturalTop: topWithin(child) - cumulativeSpacerHeight,
                  naturalHeight: child.offsetHeight - intraSpacerHeight,
                  inTableCell,
                });
                cumulativeSpacerHeight += intraSpacerHeight;
                continue;
              }
              if (CONTAINER_TAGS.has(tag)) {
                walk(child, inTableCell);
                continue;
              }
              // Unknown block. Out-of-flow elements (absolute/fixed) — e.g. any other
              // injected widget decoration — can't be paginated and measure as garbage,
              // so skip them. getComputedStyle is read only here, off the common path
              // (known block tags are handled above), to avoid a per-child reflow cost.
              const position = getComputedStyle(child).position;
              if (position === 'absolute' || position === 'fixed') continue;
              // Otherwise measure as a splittable leaf with no intra-spacers.
              leaves.push({
                el: child,
                kind: 'splittable',
                naturalTop: topWithin(child) - cumulativeSpacerHeight,
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
          const CYCLE_PX = vm.cycle;

          // Side margins + page width (px) for table close/open bands. These don't
          // affect pagination (only line wrapping), so readVerticalMargins ignores
          // them; we read them here just to size the bands to the content width.
          const csRoot = getComputedStyle(dom);
          const mlRaw = parseFloat(csRoot.getPropertyValue('--user-margin-left'));
          const mrRaw = parseFloat(csRoot.getPropertyValue('--user-margin-right'));
          const pwRaw = parseFloat(csRoot.getPropertyValue('--user-page-width'));
          const marginLeft = Number.isFinite(mlRaw) ? mlRaw : 80;
          const contentWidth = (Number.isFinite(pwRaw) ? pwRaw : 794) - marginLeft - (Number.isFinite(mrRaw) ? mrRaw : 80);

          const scale = getScaleFactor();
          const leaves = collectLeaves(CONTENT_HEIGHT);

          let cumulativeShift = 0;
          // Per-cell flow bracketing for a too-tall row (see Leaf flow markers): each
          // cell restarts from the shift inherited at the row top; the row then
          // advances the main shift by the tallest cell's added shift.
          let rowBaseline = 0;
          let maxCellDelta = 0;
          // Lowest rendered content bottom across all leaves (incl. parallel cells),
          // used for the page count — a single last-leaf reading misses taller cells.
          let maxEffectiveBottom = 0;
          const placements: {
            docPos: number;
            height: number;
            row: { columns: number } | null;
          }[] = [];
          // Full-width close/open borders for in-cell table breaks (see Leaf.inTableCell).
          // openY is the page-content-top where the cell content resumes; the band runs
          // from the previous page's content-bottom (close) down through margin/gap/margin
          // to openY (open). Keyed by the ROUNDED openY (the grouping id, matching the
          // spacers' data-page-break-boundary attr) → mapped to the UNROUNDED openY so the
          // band geometry below lands on the exact page-cycle position. A rounded openY
          // would shift the band's gap stripe up to ~0.5px off the CSS background gap,
          // showing as a seam at the table's edges with non-integer margins.
          const tableBands = new Map<number, number>();
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
            const effectiveTop = leaf.naturalTop + cumulativeShift;
            const effectiveBottom = effectiveTop + leaf.naturalHeight;
            const page = getPageForY(effectiveTop, CYCLE_PX);
            const contentStart = pageContentStart(page, vm.top, CYCLE_PX);
            const contentEnd = pageContentEnd(page, vm.top, CONTENT_HEIGHT, CYCLE_PX);

            let spacerHeight = 0;
            let spacerDocPos: number | null = null;
            let spacerRow: { columns: number } | null = null;
            let bandOpenY: number | null = null;
            let reason = 'fits';

            if (effectiveTop < contentStart && i > 0) {
              spacerHeight = contentStart - effectiveTop;
              ({ docPos: spacerDocPos, row: spacerRow } = leafSpacer(leaf));
              bandOpenY = contentStart;
              reason = 'pre-leaf-push-to-content-start';
            } else if (effectiveTop >= contentEnd) {
              spacerHeight = pageContentStart(page + 1, vm.top, CYCLE_PX) - effectiveTop;
              ({ docPos: spacerDocPos, row: spacerRow } = leafSpacer(leaf));
              bandOpenY = pageContentStart(page + 1, vm.top, CYCLE_PX);
              reason = 'leaf-jump-to-next-page';
            } else if (effectiveBottom > contentEnd) {
              if (leaf.kind === 'atomic') {
                if (leaf.naturalHeight <= CONTENT_HEIGHT) {
                  spacerHeight = pageContentStart(page + 1, vm.top, CYCLE_PX) - effectiveTop;
                  ({ docPos: spacerDocPos, row: spacerRow } = leafSpacer(leaf));
                  bandOpenY = pageContentStart(page + 1, vm.top, CYCLE_PX);
                  reason = 'atomic-push-to-next-page';
                } else {
                  reason = 'atomic-too-tall-no-push';
                }
              } else {
                const split = findLineSplit(leaf.el, contentEnd - effectiveTop, scale);
                if (split === null) {
                  if (leaf.naturalHeight <= CONTENT_HEIGHT) {
                    spacerHeight = pageContentStart(page + 1, vm.top, CYCLE_PX) - effectiveTop;
                    spacerDocPos = preLeafDocPos(leaf.el);
                    bandOpenY = pageContentStart(page + 1, vm.top, CYCLE_PX);
                    reason = 'split-fallback-push-whole-leaf';
                  } else {
                    reason = 'splittable-too-tall-no-push';
                  }
                } else {
                  spacerHeight = pageContentStart(page + 1, vm.top, CYCLE_PX) - (effectiveTop + split.naturalLineTop);
                  spacerDocPos = split.docPos;
                  bandOpenY = pageContentStart(page + 1, vm.top, CYCLE_PX);
                  reason = 'line-split';
                }
              }
            }

            // A leaf needs a close/open band whenever its break sits inside the single
            // continuous table box, where the table's outer left/right borders bleed
            // through the borderless page gap:
            //   • inTableCell — a too-tall cell whose content flows across the page, or
            //   • a between-rows push (spacerRow set) — the bridging spacer <tr> is
            //     borderless, but the browser still paints the table's outer side
            //     borders continuously across it (grey lines through the margins + gap).
            // Both get the same page-coloured mask + gap stripe overlay (Editor.svelte).
            // First-row pushes use a block spacer before the wrapper (spacerRow === null)
            // → the whole table moves to the next page, no internal gap, so no band.
            const inBand = !!leaf.inTableCell || spacerRow !== null;
            if (inBand && bandOpenY !== null && spacerHeight > 0) {
              const key = Math.round(bandOpenY);
              if (!tableBands.has(key)) tableBands.set(key, bandOpenY);
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
              pageOfBottom: getPageForY(effectiveBottom, CYCLE_PX),
              contentStart,
              contentEnd,
              overflowsPageEnd: effectiveBottom > contentEnd,
            });

            if (spacerHeight > 0 && spacerDocPos !== null) {
              // Round to integer px: the browser renders the spacer at integer
              // offsetHeight regardless, so storing the unrounded value would
              // make the model disagree with the DOM on the next pass and
              // cause 1-px shake on every keystroke at non-100 % zoom.
              const h = Math.round(spacerHeight);
              if (h > 0) {
                placements.push({
                  docPos: spacerDocPos,
                  height: h,
                  row: spacerRow,
                });
                placementsDebug.push({
                  leafIndex: i,
                  docPos: spacerDocPos,
                  height: h,
                  reason,
                  spacerKind: spacerRow ? 'table-row' : 'block',
                  columns: spacerRow ? spacerRow.columns : null,
                });
                cumulativeShift += h;
              }
            } else if (reason !== 'fits') {
              placementsDebug.push({
                leafIndex: i,
                docPos: spacerDocPos,
                height: spacerHeight,
                reason,
                spacerKind: 'none',
                columns: null,
              });
            }

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

          // Skip the decoration rebuild + transaction dispatch when the
          // placement set is identical to the previous pass. Most keystrokes
          // don't change pagination, and re-dispatching forces ProseMirror to
          // recreate the spacer DOM nodes (no `key` on the widgets) for no
          // visible gain.
          const placementsKey =
            placements.map((p) => `${p.docPos}:${p.height}:${p.row ? p.row.columns : 'b'}`).join('|');
          if (placementsKey !== lastPlacementsKey) {
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
                trEl.appendChild(tdEl);
                return Decoration.widget(p.docPos, trEl, { side: -1 });
              }
              const spacerEl = document.createElement('div');
              spacerEl.dataset.pageBreakSpacer = 'true';
              spacerEl.style.height = `${p.height}px`;
              spacerEl.style.pointerEvents = 'none';
              spacerEl.style.userSelect = 'none';
              spacerEl.setAttribute('contenteditable', 'false');
              return Decoration.widget(p.docPos, spacerEl, { side: -1 });
            });

            decorations = decoArray.length > 0
              ? DecorationSet.create(doc, decoArray)
              : DecorationSet.empty;

            const tr = editorView.state.tr.setMeta('addToHistory', false).setMeta(pageBreakKey, true);
            editorView.dispatch(tr);
          }

          // maxEffectiveBottom is the lowest rendered content across all leaves,
          // including parallel cells of a too-tall row (a single last-leaf reading
          // would miss a taller sibling column).
          const numPages = Math.max(1, getPageForY(maxEffectiveBottom, CYCLE_PX));
          const targetHeight = numPages * CYCLE_PX - PAGE_GAP;
          dom.style.minHeight = `${targetHeight}px`;

          // In-cell table breaks (all values in unscaled document px relative to
          // .tiptap's top). Editor.svelte renders the mask + gap overlay from these.
          const bandSpan = vm.bottom + PAGE_GAP + vm.top;
          const tableBreakBands = Array.from(tableBands, ([key, openY]) => ({
            key,
            closeY: openY - bandSpan,
            height: bandSpan,
            left: marginLeft,
            width: contentWidth,
            marginBottom: vm.bottom,
            gap: PAGE_GAP,
          }));

          // docHeight (document px) lets Editor.svelte size the scaled scroll footprint.
          dom.dispatchEvent(new CustomEvent('pm-pagecount', {
            bubbles: true,
            detail: { numPages, docHeight: targetHeight, tableBreakBands },
          }));

          lastSnapshot = {
            timestamp: new Date().toISOString(),
            layout: {
              PAGE_HEIGHT: vm.pageHeight,
              PAGE_GAP,
              PAGE_MARGIN_TOP: vm.top,
              PAGE_MARGIN_BOTTOM: vm.bottom,
              CONTENT_HEIGHT,
              CYCLE: CYCLE_PX,
            },
            numPages,
            leaves: leavesDebug,
            placements: placementsDebug,
            renderedSpacers: [],
            tableBreakBands,
            overlay: null, // filled in live by the debug accessor (captureOverlay)
          };

          isUpdating = false;
        }

        function schedule() {
          if (rafId !== null) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(calculate);
        }

        // Initial calculation
        schedule();

        return {
          update(_view, prevState) {
            const forced =
              pageBreakKey.getState(prevState) !== pageBreakKey.getState(editorView.state);
            if (!isUpdating && (prevState.doc !== editorView.state.doc || forced)) {
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
