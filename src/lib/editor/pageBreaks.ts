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

// A4 page layout constants (px at 96 dpi)
const PAGE_HEIGHT = 1123;
const PAGE_GAP = 20;
const PAGE_MARGIN_TOP = 96;
const PAGE_MARGIN_BOTTOM = 96;
const CONTENT_HEIGHT = PAGE_HEIGHT - PAGE_MARGIN_TOP - PAGE_MARGIN_BOTTOM; // 931
const CYCLE = PAGE_HEIGHT + PAGE_GAP; // 1143

function pageContentStart(page: number): number {
  return (page - 1) * CYCLE + PAGE_MARGIN_TOP;
}

function pageContentEnd(page: number): number {
  return (page - 1) * CYCLE + PAGE_MARGIN_TOP + CONTENT_HEIGHT;
}

function getPageForY(y: number): number {
  return Math.floor(y / CYCLE) + 1;
}

const pageBreakKey = new PluginKey('pageBreaks');

type Leaf = {
  el: HTMLElement;
  kind: 'atomic' | 'splittable';
  naturalTop: number;
  naturalHeight: number;
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

    const plugin = new Plugin({
      key: pageBreakKey,
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

        // For a pre-leaf push we want the spacer to render OUTSIDE any
        // list-item wrapper, so the <li>'s bullet marker stays aligned with
        // its own text. Walk up through <li> ancestors to the outermost one,
        // then take the position before that.
        function preLeafDocPos(leafEl: HTMLElement): number | null {
          let target = leafEl;
          while (target.parentElement && target.parentElement.tagName === 'LI') {
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
            if (!last || r.top - last.top > 2) {
              lines.push({ top: r.top, bottom: r.bottom });
            } else {
              last.bottom = Math.max(last.bottom, r.bottom);
            }
          }
          return lines;
        }

        function findLineSplit(
          el: HTMLElement,
          overflowDistance: number,
        ): { naturalLineTop: number; docPos: number } | null {
          const lines = getLineRects(el);
          if (lines.length === 0) return null;
          const elRect = el.getBoundingClientRect();

          // Any pre-existing spacers inside this leaf distort the viewport
          // y-coordinates of lines below them. Build a table to translate
          // viewport y → natural offset within the leaf (i.e. the offset the
          // line would have if no intra-leaf spacers existed).
          const intraSpacers = Array.from(
            el.querySelectorAll<HTMLElement>('[data-page-break-spacer]'),
          )
            .map((sp) => {
              const r = sp.getBoundingClientRect();
              return { viewportTop: r.top, height: r.height };
            })
            .sort((a, b) => a.viewportTop - b.viewportTop);

          function toNatural(viewportY: number): number {
            let dropped = 0;
            for (const sp of intraSpacers) {
              if (sp.viewportTop < viewportY) dropped += sp.height;
            }
            return viewportY - elRect.top - dropped;
          }

          let k = -1;
          for (let i = 0; i < lines.length; i++) {
            if (toNatural(lines[i].bottom) > overflowDistance + 0.5) {
              k = i;
              break;
            }
          }
          if (k <= 0) return null;

          const naturalLineTop = toNatural(lines[k].top);
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

        function collectLeaves(): Leaf[] {
          const dom = editorView.dom;
          const tiptapRect = dom.getBoundingClientRect();
          const leaves: Leaf[] = [];
          let cumulativeSpacerHeight = 0;

          function walk(container: HTMLElement) {
            for (const child of Array.from(container.children) as HTMLElement[]) {
              if (child.dataset?.pageBreakSpacer) {
                cumulativeSpacerHeight += child.offsetHeight;
                continue;
              }
              const tag = child.tagName;
              const isAtomic = ATOMIC_TAGS.has(tag);
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
                  naturalTop: rect.top - tiptapRect.top - cumulativeSpacerHeight,
                  naturalHeight: rect.height - intraSpacerHeight,
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
                naturalTop: rect.top - tiptapRect.top - cumulativeSpacerHeight,
                naturalHeight: rect.height,
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

          const leaves = collectLeaves();

          let cumulativeShift = 0;
          const placements: { docPos: number; height: number }[] = [];
          const leavesDebug: PageBreakDebugSnapshot['leaves'] = [];
          const placementsDebug: PageBreakDebugSnapshot['placements'] = [];

          for (let i = 0; i < leaves.length; i++) {
            const leaf = leaves[i];
            const effectiveTop = leaf.naturalTop + cumulativeShift;
            const effectiveBottom = effectiveTop + leaf.naturalHeight;
            const page = getPageForY(effectiveTop);
            const contentStart = pageContentStart(page);
            const contentEnd = pageContentEnd(page);

            let spacerHeight = 0;
            let spacerDocPos: number | null = null;
            let reason = 'fits';

            if (effectiveTop < contentStart && i > 0) {
              spacerHeight = contentStart - effectiveTop;
              spacerDocPos = preLeafDocPos(leaf.el);
              reason = 'pre-leaf-push-to-content-start';
            } else if (effectiveTop >= contentEnd) {
              spacerHeight = pageContentStart(page + 1) - effectiveTop;
              spacerDocPos = preLeafDocPos(leaf.el);
              reason = 'leaf-jump-to-next-page';
            } else if (effectiveBottom > contentEnd) {
              if (leaf.kind === 'atomic') {
                if (leaf.naturalHeight <= CONTENT_HEIGHT) {
                  spacerHeight = pageContentStart(page + 1) - effectiveTop;
                  spacerDocPos = preLeafDocPos(leaf.el);
                  reason = 'atomic-push-to-next-page';
                } else {
                  reason = 'atomic-too-tall-no-push';
                }
              } else {
                const split = findLineSplit(leaf.el, contentEnd - effectiveTop);
                if (split === null) {
                  if (leaf.naturalHeight <= CONTENT_HEIGHT) {
                    spacerHeight = pageContentStart(page + 1) - effectiveTop;
                    spacerDocPos = preLeafDocPos(leaf.el);
                    reason = 'split-fallback-push-whole-leaf';
                  } else {
                    reason = 'splittable-too-tall-no-push';
                  }
                } else {
                  spacerHeight = pageContentStart(page + 1) - (effectiveTop + split.naturalLineTop);
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
              pageOfBottom: getPageForY(effectiveBottom),
              contentStart,
              contentEnd,
              overflowsPageEnd: effectiveBottom > contentEnd,
            });

            if (spacerHeight > 0 && spacerDocPos !== null) {
              placements.push({ docPos: spacerDocPos, height: spacerHeight });
              placementsDebug.push({ leafIndex: i, docPos: spacerDocPos, height: spacerHeight, reason });
              cumulativeShift += spacerHeight;
            } else if (reason !== 'fits') {
              placementsDebug.push({ leafIndex: i, docPos: spacerDocPos, height: spacerHeight, reason });
            }
          }

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

          let numPages = 1;
          if (leaves.length > 0) {
            const lastLeaf = leaves[leaves.length - 1];
            const effectiveBottom = lastLeaf.naturalTop + cumulativeShift + lastLeaf.naturalHeight;
            numPages = Math.max(1, getPageForY(effectiveBottom));
          }
          const targetHeight = numPages * CYCLE - PAGE_GAP;
          dom.style.minHeight = `${targetHeight}px`;

          dom.dispatchEvent(new CustomEvent('pm-pagecount', { bubbles: true, detail: { numPages } }));

          lastSnapshot = {
            timestamp: new Date().toISOString(),
            layout: {
              PAGE_HEIGHT,
              PAGE_GAP,
              PAGE_MARGIN_TOP,
              PAGE_MARGIN_BOTTOM,
              CONTENT_HEIGHT,
              CYCLE,
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
            if (!isUpdating && prevState.doc !== editorView.state.doc) {
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
