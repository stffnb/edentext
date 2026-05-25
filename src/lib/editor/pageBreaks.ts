import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, EditorView } from '@tiptap/pm/view';

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
        function calculate() {
          rafId = null;
          if (isUpdating || !editorView.dom.isConnected) return;
          isUpdating = true;

          const dom = editorView.dom;
          void dom.offsetHeight; // force reflow

          // Walk DOM children: measure content blocks, track spacer heights
          const blocks: { top: number; height: number }[] = [];
          let spacerHeightAbove = 0;

          for (const child of Array.from(dom.children)) {
            const el = child as HTMLElement;
            if (el.dataset?.pageBreakSpacer) {
              spacerHeightAbove += el.offsetHeight;
            } else {
              blocks.push({
                // Subtract spacer heights to get "natural" position
                top: el.offsetTop - spacerHeightAbove,
                height: el.offsetHeight,
              });
            }
          }

          // Calculate which blocks need page break spacers
          let cumulativeShift = 0;
          const spacers: { beforeIndex: number; height: number }[] = [];

          for (let i = 0; i < blocks.length; i++) {
            const m = blocks[i];
            const effectiveTop = m.top + cumulativeShift;
            const effectiveBottom = effectiveTop + m.height;

            const page = getPageForY(effectiveTop);
            const contentStart = pageContentStart(page);
            const contentEnd = pageContentEnd(page);

            let spacerHeight = 0;

            if (effectiveTop < contentStart && i > 0) {
              spacerHeight = contentStart - effectiveTop;
            } else if (effectiveTop >= contentEnd) {
              const nextStart = pageContentStart(page + 1);
              spacerHeight = nextStart - effectiveTop;
            } else if (effectiveBottom > contentEnd && m.height <= CONTENT_HEIGHT) {
              const nextStart = pageContentStart(page + 1);
              spacerHeight = nextStart - effectiveTop;
            }

            if (spacerHeight > 0) {
              spacers.push({ beforeIndex: i, height: spacerHeight });
              cumulativeShift += spacerHeight;
            }
          }

          // Build widget decorations at correct document positions
          const doc = editorView.state.doc;
          const decoArray: Decoration[] = [];
          const spacerMap = new Map(spacers.map((s) => [s.beforeIndex, s.height]));

          let nodeIndex = 0;
          doc.forEach((_node, offset) => {
            const height = spacerMap.get(nodeIndex);
            if (height !== undefined) {
              const spacerEl = document.createElement('div');
              spacerEl.dataset.pageBreakSpacer = 'true';
              spacerEl.style.height = `${height}px`;
              spacerEl.style.pointerEvents = 'none';
              spacerEl.style.userSelect = 'none';
              spacerEl.setAttribute('contenteditable', 'false');
              decoArray.push(Decoration.widget(offset, spacerEl, { side: -1 }));
            }
            nodeIndex++;
          });

          // Update decorations
          const newDecorations = decoArray.length > 0
            ? DecorationSet.create(doc, decoArray)
            : DecorationSet.empty;

          // Only dispatch if something actually changed
          const oldCount = decorations === DecorationSet.empty ? 0 : -1; // force update comparison
          decorations = newDecorations;

          // Trigger view update with a no-op transaction
          const tr = editorView.state.tr.setMeta('addToHistory', false).setMeta(pageBreakKey, true);
          editorView.dispatch(tr);

            // Set min-height based on the last content block's effective position.
            // Using scrollHeight would be circular (scrollHeight is clamped by min-height
            // itself, so it never shrinks when content is deleted).
            let numPages = 1;
            if (blocks.length > 0) {
                const lastBlock = blocks[blocks.length - 1];
                const effectiveBottom = lastBlock.top + cumulativeShift + lastBlock.height;
                numPages = Math.max(1, getPageForY(effectiveBottom));
            }
            const targetHeight = numPages * CYCLE - PAGE_GAP; // = N*PAGE_HEIGHT + (N-1)*PAGE_GAP
          dom.style.minHeight = `${targetHeight}px`;

          // Notify the Svelte layer of the current page count
          dom.dispatchEvent(new CustomEvent('pm-pagecount', { bubbles: true, detail: { numPages } }));

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
          },
        };
      },
    });

    return [plugin];
  },
});
