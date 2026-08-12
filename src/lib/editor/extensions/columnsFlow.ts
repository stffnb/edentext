import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { canJoin, canSplit } from '@tiptap/pm/transform';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { readVerticalMargins, FORCE_PAGE_RECALC } from './pageBreaks';
import { sameColumnsAttrs, COLUMNS_FIT_MARGIN_PX } from './columns';

// Cross-page column flow: keeps a columns chain's fragmentation in sync with the
// page grid (split an overflowing fragment at a block or line boundary, pull a
// fragment with room back) via layout-only transactions that never enter undo history.

const flowKey = new PluginKey<number>('columnsFlow');
const FLOW_TX = 'columnsFlowTx';

// Split underfill guard: the balanced-height estimate (sum of block heights / count)
// ignores line quantization, so leave a little headroom.
const SAFETY_PX = 16;
// A pull-back (join) must fit by clearly more than the estimate error (~one line +
// margins), or a join whose real height exceeds the estimate re-splits forever.
const HYSTERESIS_PX = 40;
const MIN_BLOCK_PX = 16;
const DEFAULT_LINE_PX = 19;
// Height slack on the open last fragment: a freshly typed line must still fit
// column 1 before the next pass grows the decoration, or every line flashes into
// column 2 for one frame.
const OPEN_HEIGHT_SLACK_PX = 40;
// Below this many lines of leftover room, a boundary block splits at the block
// boundary instead of pulling a line or two over (not worth a paragraph split).
const MIN_TAIL_LINES = 2;
// Pass budget per external change: each pass performs one split/join, so a paste
// spanning many pages needs several; bounded against estimate-driven oscillation.
const MAX_FLOW_PASSES = 48;

type Fragment = { pos: number; node: PMNode };
export type LineRect = { left: number; right: number; top: number; height: number };

// Live per-fragment view of the flow's decisions, for the dev Debug dump.
export type ColumnsFlowDebug = {
  timestamp: string;
  fragments: Array<{
    pos: number;
    blocks: number;
    page: number;
    top: number;
    availablePx: number;
    contentPx: number;
    usedPerColumnPx: number;
    count: number;
    hasNext: boolean;
    openAtDocEnd: boolean;
    decorated: boolean;
    firstBlockNeedPx: number;
    overflow: boolean;
    join: null | { needPx: number; headIsJoinPrev: boolean; roomPx: number; wouldJoin: boolean };
  }>;
};

const flowDebugAccessors = new WeakMap<EditorView, () => ColumnsFlowDebug | null>();

export function getColumnsFlowDebug(view: EditorView): ColumnsFlowDebug | null {
  return flowDebugAccessors.get(view)?.() ?? null;
}

// A block's flowed height in document px: sum of its column fragments' rects
// (a block split across columns yields one rect per column).
function blockHeightPx(el: Element, scale: number): number {
  let h = 0;
  for (const r of Array.from(el.getClientRects())) h += r.height;
  return h / scale;
}

// Total content height of a fragment's blocks as poured into one column flow:
// block rects plus the collapsed inter-block margins (computed style, unscaled).
function contentHeightPx(children: Element[], scale: number): number {
  let sum = 0;
  let prevMb = 0;
  for (let i = 0; i < children.length; i++) {
    const cs = getComputedStyle(children[i]);
    const mt = parseFloat(cs.marginTop) || 0;
    const mb = parseFloat(cs.marginBottom) || 0;
    sum += blockHeightPx(children[i], scale);
    if (i > 0) sum += Math.max(prevMb, mt);
    prevMb = mb;
  }
  return sum;
}

// The first rect of each rendered line, in document order — column 1's lines
// before column 2's. A rect joins the line it overlaps by half the taller of the
// two, so a raised run (a verse number, a superscript) is no line of its own.
export function groupLines(rects: LineRect[]): LineRect[] {
  const lines: LineRect[] = [];
  let band: { top: number; bottom: number } | null = null;
  for (const r of rects) {
    const bottom = r.top + r.height;
    if (band) {
      const overlap = Math.min(band.bottom, bottom) - Math.max(band.top, r.top);
      if (overlap >= Math.max(band.bottom - band.top, r.height) / 2) continue;
    }
    band = { top: r.top, bottom };
    lines.push(r);
  }
  return lines;
}

// The rendered lines of `el`, in viewport coordinates.
function lineRects(el: Element): LineRect[] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const rects: LineRect[] = [];
  let textNode: Node | null;
  while ((textNode = walker.nextNode())) {
    if (!textNode.textContent) continue;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    for (const r of Array.from(range.getClientRects())) {
      if (r.width > 0 && r.height > 0) {
        rects.push({ left: r.left, right: r.right, top: r.top, height: r.height });
      }
    }
  }
  return groupLines(rects);
}

// How many of `lines` a flow budget buys, measured top to top: a line carrying a
// raised run is taller than the rest, so one median advance for all of them is
// well short. `advance` stands in where the tops reset at a column break.
export function linesWithin(lines: LineRect[], budgetPx: number, advance: number, scale: number): number {
  let used = 0;
  for (let n = 1; n < lines.length; n++) {
    const gap = (lines[n].top - lines[n - 1].top) / scale;
    used += gap > 2 && gap < advance * 3 ? gap : advance;
    if (used > budgetPx) return n - 1;
  }
  return lines.length;
}

// Median top-to-top line advance (viewport px); 0 when there are too few lines.
function lineAdvance(lines: { top: number }[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i].top - lines[i - 1].top;
    if (g > 2) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  return gaps.length ? gaps[gaps.length >> 1] : 0;
}

export const ColumnsFlow = Extension.create({
  name: 'columnsFlow',

  addProseMirrorPlugins() {
    let rafId: number | null = null;
    let passes = 0;
    let decorations = DecorationSet.empty;
    let lastDecoKey = '';

    const plugin = new Plugin<number>({
      key: flowKey,
      // Counts external changes (user edits, margin/orientation changes) so the
      // view hook can reset the pass budget; the plugin's own transactions don't.
      state: {
        init: () => 0,
        apply(tr, value) {
          if (tr.docChanged) decorations = decorations.map(tr.mapping, tr.doc);
          if ((tr.docChanged && !tr.getMeta(FLOW_TX)) || tr.getMeta(FORCE_PAGE_RECALC)) return value + 1;
          return value;
        },
      },
      props: {
        decorations() {
          return decorations;
        },
      },
      view(editorView) {
        function fragments(): Fragment[] {
          const out: Fragment[] = [];
          editorView.state.doc.forEach((node, offset) => {
            if (node.type.name === 'columns') out.push({ pos: offset, node });
          });
          return out;
        }

        // Border-box top within .tiptap in document px (offsetTop chain — immune
        // to the .paper zoom transform, includes rendered spacers above).
        function topWithin(el: HTMLElement): number {
          let top = 0;
          let node: HTMLElement | null = el;
          while (node && node !== editorView.dom) {
            top += node.offsetTop;
            node = node.offsetParent as HTMLElement | null;
          }
          return top;
        }

        function getScale(): number {
          const r = editorView.dom.getBoundingClientRect();
          const h = editorView.dom.offsetHeight;
          return h ? r.height / h : 1;
        }

        function dispatchFlow(tr: Transaction): void {
          editorView.dispatch(tr.setMeta('addToHistory', false).setMeta(FLOW_TX, true));
        }

        function hasNextInChain(frags: Fragment[], i: number): boolean {
          const next = frags[i + 1];
          return !!next &&
            next.pos === frags[i].pos + frags[i].node.nodeSize &&
            sameColumnsAttrs(frags[i].node, next.node);
        }

        // True when nothing but empty paragraphs follows the fragment — the chain
        // is "open" at the document end and fills sequentially while typing.
        function openAtDocEnd(frag: Fragment): boolean {
          const after = frag.pos + frag.node.nodeSize;
          let open = true;
          editorView.state.doc.forEach((n, off) => {
            if (off < after) return;
            if (n.type.name === 'columns') return; // continuation, judged via its own end
            if (!(n.type.name === 'paragraph' && n.content.size === 0)) open = false;
          });
          return open;
        }

        // First document position on a line. Its first rect in document order runs
        // from whichever edge is logically first — the right one on a line of Hebrew
        // or Arabic — so both edges are probed and the earlier position wins.
        function lineStartPos(line: LineRect): number | null {
          const top = line.top + line.height / 2;
          const a = editorView.posAtCoords({ left: line.left + 1, top });
          const b = editorView.posAtCoords({ left: line.right - 1, top });
          const pos = Math.min(a?.pos ?? Infinity, b?.pos ?? Infinity);
          return Number.isFinite(pos) ? pos : null;
        }

        // Split the paragraph at `blockIndex` at the line consuming `budgetPx` (a
        // mid-paragraph page break); the second part is marked joinPrev so joins/export
        // restore the original. `force` takes at least one line for an over-tall paragraph.
        function splitParagraphInBlock(
          frag: Fragment, children: Element[], blockIndex: number, budgetPx: number,
          scale: number, force: boolean,
        ): boolean {
          const block = frag.node.child(blockIndex);
          if (block.type.name !== 'paragraph') return false;
          const blockEl = children[blockIndex];
          if (!blockEl) return false;
          const lines = lineRects(blockEl);
          if (lines.length < 2) return false;
          const advance = (lineAdvance(lines) || DEFAULT_LINE_PX * scale) / scale;
          let budgetLines = linesWithin(lines, budgetPx, advance, scale);
          if (budgetLines < MIN_TAIL_LINES) {
            if (!force) return false;
            budgetLines = 1;
          }
          const prefixLines = Math.min(Math.max(budgetLines, 1), lines.length - 1);
          const pos = lineStartPos(lines[prefixLines]);
          if (pos === null) return false;
          let blockStart = frag.pos + 1;
          for (let j = 0; j < blockIndex; j++) blockStart += frag.node.child(j).nodeSize;
          if (pos <= blockStart + 1 || pos >= blockStart + block.nodeSize - 1) return false;
          const typesAfter = [
            { type: frag.node.type, attrs: frag.node.attrs },
            { type: block.type, attrs: { ...block.attrs, joinPrev: true } },
          ];
          if (!canSplit(editorView.state.doc, pos, 2, typesAfter)) return false;
          dispatchFlow(editorView.state.tr.split(pos, 2, typesAfter));
          return true;
        }

        // One reflow step: fix the first out-of-sync boundary (merge a stray
        // joinPrev part, split an overflowing fragment, or pull a continuation
        // back) and dispatch. Convergence comes from re-running until quiescent.
        function reflow(): boolean {
          if (editorView.composing || !editorView.dom.isConnected) return false;
          const frags = fragments();
          if (!frags.length) return false;

          const vm = readVerticalMargins(editorView.dom);
          const scale = getScale();

          for (let i = 0; i < frags.length; i++) {
            const { pos, node } = frags[i];

            // A joinPrev paragraph inside a fragment (left over after a fragment
            // join) merges into its predecessor right away.
            let childPos = pos + 1;
            for (let j = 0; j < node.childCount; j++) {
              const child = node.child(j);
              if (
                j > 0 && child.type.name === 'paragraph' && child.attrs.joinPrev &&
                node.child(j - 1).type.name === 'paragraph' &&
                canJoin(editorView.state.doc, childPos)
              ) {
                dispatchFlow(editorView.state.tr.join(childPos));
                return true;
              }
              childPos += child.nodeSize;
            }

            const el = editorView.nodeDOM(pos) as HTMLElement | null;
            if (!el || !el.classList.contains('columns-node')) continue;

            const top = topWithin(el);
            const page = Math.floor(top / vm.cycle) + 1;
            const contentStart = (page - 1) * vm.cycle + vm.top;
            const contentEnd = contentStart + vm.contentHeight;
            // Mid-move (pageBreaks hasn't repositioned it yet) — measure next pass.
            if (top < contentStart - 0.5 || top >= contentEnd) continue;
            const available = contentEnd - top;
            const count = Math.max(1, node.attrs.count as number);
            const children = Array.from(el.children).filter(
              (c) => !(c as HTMLElement).dataset?.pageBreakSpacer,
            );
            if (children.length !== node.childCount) continue;
            // The rendered box height is our own decoration, so overflow and room
            // are judged from the content itself (per-column share of the flow).
            const usedPerColumn = contentHeightPx(children, scale) / count;

            if (usedPerColumn > available + 1) {
              // Overflow. Same first-block fit test (incl. margin) as pageBreaks'
              // push decision — the two must agree, or split/push/join cycle.
              const first = Math.max(blockHeightPx(children[0], scale) / count, MIN_BLOCK_PX);
              if (first + COLUMNS_FIT_MARGIN_PX > available) {
                // First block alone doesn't fit. Mid-page, pageBreaks pushes the
                // fragment; at a page top pushing can't help — split the paragraph
                // at a line boundary instead (a mid-paragraph page break).
                if (
                  available >= vm.contentHeight - 1 &&
                  splitParagraphInBlock(frags[i], children, 0, count * (available - SAFETY_PX), scale, true)
                ) {
                  return true;
                }
                continue;
              }
              if (node.childCount < 2) continue;
              let sum = 0;
              let k = 0;
              for (let j = 0; j < children.length - 1; j++) {
                const h = blockHeightPx(children[j], scale);
                if ((sum + h) / count > available - SAFETY_PX && j > 0) break;
                sum += h;
                k = j + 1;
              }
              // Leftover room after k whole blocks: fill it with the boundary
              // block's first lines (line split) rather than leaving it empty.
              const tailBudget = count * (available - SAFETY_PX) - sum;
              if (k < node.childCount && splitParagraphInBlock(frags[i], children, k, tailBudget, scale, false)) {
                return true;
              }
              let boundary = pos + 1;
              for (let j = 0; j < k; j++) boundary += node.child(j).nodeSize;
              const typesAfter = [{ type: node.type, attrs: node.attrs }];
              if (!canSplit(editorView.state.doc, boundary, 1, typesAfter)) continue;
              dispatchFlow(editorView.state.tr.split(boundary, 1, typesAfter));
              return true;
            }

            // Fits: pull the adjacent continuation back when its head would
            // clearly fit too (the overflow branch then re-splits further down).
            if (hasNextInChain(frags, i)) {
              const next = frags[i + 1];
              const nextEl = editorView.nodeDOM(next.pos) as HTMLElement | null;
              const nextFirst = nextEl?.firstElementChild;
              if (!nextFirst) continue;
              const joinPos = pos + node.nodeSize;
              const headBlock = next.node.child(0);
              const headIsJoinPrev =
                headBlock.type.name === 'paragraph' && headBlock.attrs.joinPrev &&
                node.child(node.childCount - 1).type.name === 'paragraph';
              // A joinPrev head needs only one more line row; a multi-line head can be
              // pulled PARTIALLY (the overflow split hands the excess back), so ~two
              // line rows justify the pull — any other block needs its full share.
              const headLines = headBlock.type.name === 'paragraph' ? lineRects(nextFirst) : [];
              const headAdvance = (lineAdvance(headLines) || DEFAULT_LINE_PX * scale) / scale;
              const need = headIsJoinPrev
                ? Math.max(headAdvance, MIN_BLOCK_PX)
                : headLines.length >= 2
                  ? Math.max(MIN_TAIL_LINES * headAdvance, MIN_BLOCK_PX)
                  : Math.max(blockHeightPx(nextFirst, scale) / count, MIN_BLOCK_PX);
              if (usedPerColumn + need <= available - HYSTERESIS_PX && canJoin(editorView.state.doc, joinPos)) {
                // Depth 2 rejoins the split paragraph in the same step.
                const tr = editorView.state.tr;
                try {
                  tr.join(joinPos, headIsJoinPrev ? 2 : 1);
                } catch {
                  continue;
                }
                dispatchFlow(tr);
                return true;
              }
            }
          }
          return false;
        }

        // Sequential-fill heights: a fragment with a continuation spans its page slot;
        // an open last fragment hugs its content (plus slack) so typing fills column 1
        // first. Otherwise the last fragment stays undecorated (CSS balance).
        function updateDecorations(): void {
          const frags = fragments();
          const vm = readVerticalMargins(editorView.dom);
          const scale = getScale();
          const items: { from: number; to: number; height: number }[] = [];

          for (let i = 0; i < frags.length; i++) {
            const { pos, node } = frags[i];
            const el = editorView.nodeDOM(pos) as HTMLElement | null;
            if (!el || !el.classList.contains('columns-node')) continue;
            const top = topWithin(el);
            const page = Math.floor(top / vm.cycle) + 1;
            const contentStart = (page - 1) * vm.cycle + vm.top;
            const contentEnd = contentStart + vm.contentHeight;
            if (top < contentStart - 0.5 || top >= contentEnd) continue;
            const available = contentEnd - top;
            const count = Math.max(1, node.attrs.count as number);
            const children = Array.from(el.children).filter(
              (c) => !(c as HTMLElement).dataset?.pageBreakSpacer,
            );

            let height: number;
            if (hasNextInChain(frags, i)) {
              height = available;
            } else if (openAtDocEnd(frags[i])) {
              // Full single-flow content height: while it's below the page slot,
              // everything pours into column 1 (column 2 only once page 1 is full).
              const contentH = contentHeightPx(children, scale);
              height = Math.min(available, contentH + OPEN_HEIGHT_SLACK_PX);
            } else {
              continue; // balanced end of a mid-document section
            }
            items.push({ from: pos, to: pos + node.nodeSize, height: Math.round(height) });
          }

          const key = items.map((d) => `${d.from}:${d.to}:${d.height}`).join('|');
          if (key === lastDecoKey) return;
          lastDecoKey = key;
          decorations = items.length
            ? DecorationSet.create(editorView.state.doc, items.map((d) =>
                Decoration.node(d.from, d.to, {
                  style: `height:${d.height}px;column-fill:auto;overflow:hidden`,
                })))
            : DecorationSet.empty;
          // Re-render + let pageBreaks re-measure the new box heights.
          editorView.dispatch(
            editorView.state.tr.setMeta(FLOW_TX, true).setMeta(FORCE_PAGE_RECALC, true),
          );
        }

        // Live analysis of every fragment (same math as reflow/updateDecorations),
        // exposed to the dev Debug dump via getColumnsFlowDebug.
        function buildDebug(): ColumnsFlowDebug | null {
          if (!editorView.dom.isConnected) return null;
          const frags = fragments();
          const vm = readVerticalMargins(editorView.dom);
          const scale = getScale();
          const out: ColumnsFlowDebug['fragments'] = [];
          for (let i = 0; i < frags.length; i++) {
            const { pos, node } = frags[i];
            const el = editorView.nodeDOM(pos) as HTMLElement | null;
            if (!el || !el.classList.contains('columns-node')) continue;
            const top = topWithin(el);
            const page = Math.floor(top / vm.cycle) + 1;
            const contentEnd = (page - 1) * vm.cycle + vm.top + vm.contentHeight;
            const available = contentEnd - top;
            const count = Math.max(1, node.attrs.count as number);
            const children = Array.from(el.children).filter(
              (c) => !(c as HTMLElement).dataset?.pageBreakSpacer,
            );
            const contentPx = contentHeightPx(children, scale);
            const usedPerColumn = contentPx / count;
            const hasNext = hasNextInChain(frags, i);
            let join: ColumnsFlowDebug['fragments'][number]['join'] = null;
            if (hasNext) {
              const next = frags[i + 1];
              const nextEl = editorView.nodeDOM(next.pos) as HTMLElement | null;
              const nextFirst = nextEl?.firstElementChild;
              if (nextFirst) {
                const headBlock = next.node.child(0);
                const headIsJoinPrev =
                  headBlock.type.name === 'paragraph' && headBlock.attrs.joinPrev &&
                  node.child(node.childCount - 1).type.name === 'paragraph';
                const headLines = headBlock.type.name === 'paragraph' ? lineRects(nextFirst) : [];
                const headAdvance = (lineAdvance(headLines) || DEFAULT_LINE_PX * scale) / scale;
                const needPx = headIsJoinPrev
                  ? Math.max(headAdvance, MIN_BLOCK_PX)
                  : headLines.length >= 2
                    ? Math.max(MIN_TAIL_LINES * headAdvance, MIN_BLOCK_PX)
                    : Math.max(blockHeightPx(nextFirst, scale) / count, MIN_BLOCK_PX);
                const roomPx = available - HYSTERESIS_PX - usedPerColumn;
                join = { needPx: Math.round(needPx), headIsJoinPrev, roomPx: Math.round(roomPx), wouldJoin: usedPerColumn + needPx <= available - HYSTERESIS_PX };
              }
            }
            out.push({
              pos,
              blocks: node.childCount,
              page,
              top: Math.round(top),
              availablePx: Math.round(available),
              contentPx: Math.round(contentPx),
              usedPerColumnPx: Math.round(usedPerColumn),
              count,
              hasNext,
              openAtDocEnd: openAtDocEnd(frags[i]),
              decorated: /column-fill:\s*auto/.test(el.style.cssText),
              firstBlockNeedPx: Math.round(children[0] ? Math.max(blockHeightPx(children[0], scale) / count, MIN_BLOCK_PX) : 0),
              overflow: usedPerColumn > available + 1,
              join,
            });
          }
          return { timestamp: new Date().toISOString(), fragments: out };
        }
        flowDebugAccessors.set(editorView, buildDebug);

        function run() {
          rafId = null;
          if (passes < MAX_FLOW_PASSES && reflow()) {
            passes++;
            return; // geometry changes; decorations follow next pass
          }
          updateDecorations();
        }

        function schedule() {
          if (rafId !== null) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(run);
        }

        schedule();

        return {
          update(_view, prevState) {
            if (flowKey.getState(prevState) !== flowKey.getState(editorView.state)) {
              passes = 0; // fresh budget per external change
            }
            schedule();
          },
          destroy() {
            if (rafId !== null) cancelAnimationFrame(rafId);
            flowDebugAccessors.delete(editorView);
          },
        };
      },
    });

    return [plugin];
  },
});
