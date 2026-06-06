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
  }>;
  renderedSpacers: Array<{
    height: number;
    offsetTopInDoc: number;
    viewportTop: number;
  }>;
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
// props the Layout panel writes via applyMarginVars (pageMargins.ts) and
// applyOrientationVars (pageOrientation.ts). These are plain px strings in
// document coordinates — unaffected by the ancestor CSS `zoom`, unlike
// getComputedStyle padding — so they pair directly with the unscaled offsetTop
// measurements below. Side margins don't affect pagination (they change line
// wrapping, which we already measure from the live DOM), so we ignore them.
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
};

// TABLE is atomic: a table that overflows the page is pushed whole to the next
// page (we don't split a table across pages). A table taller than one page will
// overflow visually — an accepted limitation of this version.
const ATOMIC_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE']);
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
          return {
            timestamp: snap.timestamp,
            layout: snap.layout,
            numPages: snap.numPages,
            leaves: snap.leaves,
            placements: snap.placements,
            renderedSpacers,
          };
        });

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

        // CSS `zoom` is applied to the `.paper` ancestor in Editor.svelte. Under
        // zoom, getBoundingClientRect / Range.getClientRects / coordsAtPos all
        // return viewport (scaled) pixels, while offsetTop/offsetHeight and the
        // page layout constants stay in unscaled document pixels. Read the
        // computed zoom so we can divide viewport measurements back into
        // document coordinates.
        function getZoomFactor(): number {
          let el: HTMLElement | null = editorView.dom.parentElement;
          while (el) {
            const z = parseFloat(getComputedStyle(el).zoom || '1');
            if (z && z !== 1) return z;
            el = el.parentElement;
          }
          return 1;
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
          zoom: number,
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
            return (viewportY - elRect.top) / zoom - dropped;
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

        function collectLeaves(zoom: number): Leaf[] {
          const dom = editorView.dom;
          const tiptapRect = dom.getBoundingClientRect();
          const leaves: Leaf[] = [];
          // cumulativeSpacerHeight accumulates spacer offsetHeights — already
          // in unscaled document pixels — so it pairs with the unscaled
          // naturalTop/Height below.
          let cumulativeSpacerHeight = 0;

          function walk(container: HTMLElement) {
            for (const child of Array.from(container.children) as HTMLElement[]) {
              if (child.dataset?.pageBreakSpacer) {
                cumulativeSpacerHeight += child.offsetHeight;
                continue;
              }
              const tag = child.tagName;
              // TipTap renders tables inside a <div class="tableWrapper"> node
              // view (see extensions.ts Table config), so the top-level child is
              // the wrapper DIV, not the TABLE. Treat either as an atomic table.
              const isTable =
                tag === 'TABLE' ||
                (tag === 'DIV' && child.classList.contains('tableWrapper'));
              const isAtomic = ATOMIC_TAGS.has(tag) || isTable;
              const isSplittable = SPLITTABLE_TAGS.has(tag);
              if (isAtomic || isSplittable) {
                const rect = child.getBoundingClientRect();
                let intraSpacerHeight = 0;
                for (const sp of Array.from(
                  child.querySelectorAll<HTMLElement>('[data-page-break-spacer]'),
                )) {
                  intraSpacerHeight += sp.offsetHeight;
                }
                leaves.push({
                  el: child,
                  kind: isAtomic ? 'atomic' : 'splittable',
                  naturalTop: (rect.top - tiptapRect.top) / zoom - cumulativeSpacerHeight,
                  naturalHeight: rect.height / zoom - intraSpacerHeight,
                });
                cumulativeSpacerHeight += intraSpacerHeight;
                continue;
              }
              if (CONTAINER_TAGS.has(tag)) {
                walk(child);
                continue;
              }
              // Unknown block — measure as a splittable leaf with no intra-spacers
              const rect = child.getBoundingClientRect();
              leaves.push({
                el: child,
                kind: 'splittable',
                naturalTop: (rect.top - tiptapRect.top) / zoom - cumulativeSpacerHeight,
                naturalHeight: rect.height / zoom,
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

          const zoom = getZoomFactor();
          const leaves = collectLeaves(zoom);

          let cumulativeShift = 0;
          const placements: { docPos: number; height: number }[] = [];
          const leavesDebug: PageBreakDebugSnapshot['leaves'] = [];
          const placementsDebug: PageBreakDebugSnapshot['placements'] = [];

          for (let i = 0; i < leaves.length; i++) {
            const leaf = leaves[i];
            const effectiveTop = leaf.naturalTop + cumulativeShift;
            const effectiveBottom = effectiveTop + leaf.naturalHeight;
            const page = getPageForY(effectiveTop, CYCLE_PX);
            const contentStart = pageContentStart(page, vm.top, CYCLE_PX);
            const contentEnd = pageContentEnd(page, vm.top, CONTENT_HEIGHT, CYCLE_PX);

            let spacerHeight = 0;
            let spacerDocPos: number | null = null;
            let reason = 'fits';

            if (effectiveTop < contentStart && i > 0) {
              spacerHeight = contentStart - effectiveTop;
              spacerDocPos = preLeafDocPos(leaf.el);
              reason = 'pre-leaf-push-to-content-start';
            } else if (effectiveTop >= contentEnd) {
              spacerHeight = pageContentStart(page + 1, vm.top, CYCLE_PX) - effectiveTop;
              spacerDocPos = preLeafDocPos(leaf.el);
              reason = 'leaf-jump-to-next-page';
            } else if (effectiveBottom > contentEnd) {
              if (leaf.kind === 'atomic') {
                if (leaf.naturalHeight <= CONTENT_HEIGHT) {
                  spacerHeight = pageContentStart(page + 1, vm.top, CYCLE_PX) - effectiveTop;
                  spacerDocPos = preLeafDocPos(leaf.el);
                  reason = 'atomic-push-to-next-page';
                } else {
                  reason = 'atomic-too-tall-no-push';
                }
              } else {
                const split = findLineSplit(leaf.el, contentEnd - effectiveTop, zoom);
                if (split === null) {
                  if (leaf.naturalHeight <= CONTENT_HEIGHT) {
                    spacerHeight = pageContentStart(page + 1, vm.top, CYCLE_PX) - effectiveTop;
                    spacerDocPos = preLeafDocPos(leaf.el);
                    reason = 'split-fallback-push-whole-leaf';
                  } else {
                    reason = 'splittable-too-tall-no-push';
                  }
                } else {
                  spacerHeight = pageContentStart(page + 1, vm.top, CYCLE_PX) - (effectiveTop + split.naturalLineTop);
                  spacerDocPos = split.docPos;
                  reason = 'line-split';
                }
              }
            }

            leavesDebug.push({
              index: i,
              tag: leaf.el.tagName,
              kind: leaf.kind,
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
                placements.push({ docPos: spacerDocPos, height: h });
                placementsDebug.push({ leafIndex: i, docPos: spacerDocPos, height: h, reason });
                cumulativeShift += h;
              }
            } else if (reason !== 'fits') {
              placementsDebug.push({ leafIndex: i, docPos: spacerDocPos, height: spacerHeight, reason });
            }
          }

          // Skip the decoration rebuild + transaction dispatch when the
          // placement set is identical to the previous pass. Most keystrokes
          // don't change pagination, and re-dispatching forces ProseMirror to
          // recreate the spacer DOM nodes (no `key` on the widgets) for no
          // visible gain.
          const placementsKey = placements.map((p) => `${p.docPos}:${p.height}`).join('|');
          if (placementsKey !== lastPlacementsKey) {
            lastPlacementsKey = placementsKey;
            const doc = editorView.state.doc;
            const decoArray: Decoration[] = placements.map((p) => {
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

          let numPages = 1;
          if (leaves.length > 0) {
            const lastLeaf = leaves[leaves.length - 1];
            const effectiveBottom = lastLeaf.naturalTop + cumulativeShift + lastLeaf.naturalHeight;
            numPages = Math.max(1, getPageForY(effectiveBottom, CYCLE_PX));
          }
          const targetHeight = numPages * CYCLE_PX - PAGE_GAP;
          dom.style.minHeight = `${targetHeight}px`;

          dom.dispatchEvent(new CustomEvent('pm-pagecount', { bubbles: true, detail: { numPages } }));

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
