import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { canJoin, canSplit } from '@tiptap/pm/transform';
import { DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TableMap } from '@tiptap/pm/tables';
import {
  readVerticalMargins, bandAt, FORCE_PAGE_RECALC, LAYOUT_ANSWER, isSplitPane, blockDeco, isBlockDeco, repairDecos,
} from './pageBreaks';
import {
  sameColumnsAttrs, columnsChain, COLUMNS_FIT_MARGIN_PX, MIN_TAIL_LINES, DEFAULT_LINE_PX, headFitPx, lineRects, lineAdvance,
  type LineRect,
} from './columns';
import { tabStopsKey } from './tabStops';

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
// Height slack on the open last fragment: a freshly typed line must still fit
// column 1 before the next pass grows the decoration, or every line flashes into
// column 2 for one frame.
const OPEN_HEIGHT_SLACK_PX = 40;
// Pass budget per external change: a pass fixes what it can judge, the next measures
// the geometry it changed; bounded against estimate-driven oscillation. The op budget
// within a pass pages a whole section in one go — a split per page.
const MAX_FLOW_PASSES = 48;
const MAX_FLOW_OPS = 64;

type Fragment = { pos: number; node: PMNode };

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

// Where each block starts and ends in the flow as poured into one column: block rects
// plus the collapsed inter-block margins (computed style, unscaled). The split counts
// blocks by the same measure the overflow test uses, or it leaves one block too many.
function flowSpans(children: Element[], scale: number): { start: number[]; end: number[] } {
  const start: number[] = [];
  const end: number[] = [];
  let sum = 0;
  let prevMb = 0;
  for (let i = 0; i < children.length; i++) {
    const cs = getComputedStyle(children[i]);
    const mt = parseFloat(cs.marginTop) || 0;
    const mb = parseFloat(cs.marginBottom) || 0;
    if (i > 0) sum += Math.max(prevMb, mt);
    start.push(sum);
    sum += blockHeightPx(children[i], scale);
    end.push(sum);
    prevMb = mb;
  }
  return { start, end };
}

// Total content height of a fragment's blocks as poured into one column flow.
function contentHeightPx(children: Element[], scale: number): number {
  const { end } = flowSpans(children, scale);
  return end.length ? end[end.length - 1] : 0;
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

// The rendered rows of a table block (its TableView wrapper), or null when they do not
// line up with the node's rows.
function tableRows(blockEl: Element, table: PMNode): HTMLElement[] | null {
  const body = blockEl.querySelector(':scope > table > tbody');
  const rows = body ? Array.from(body.children).filter((r) => r.tagName === 'TR') as HTMLElement[] : [];
  return rows.length === table.childCount ? rows : null;
}

function rowHeights(rows: HTMLElement[], scale: number): number[] {
  return rows.map((r) => r.getBoundingClientRect().height / scale);
}

// How many rows fill `count` columns of `columnPx`, the first from flow offset `startPx`:
// a row is never cut between two columns, so one that does not fit opens the next.
export function rowsWithin(heights: number[], startPx: number, columnPx: number, count: number): number {
  let col = Math.floor(startPx / columnPx);
  let at = startPx - col * columnPx;
  let n = 0;
  for (const h of heights) {
    if (at > 0 && at + h > columnPx + 0.5) { col++; at = 0; }
    if (col >= count) break;
    at += h;
    n++;
  }
  return n;
}

// Whether a table may be cut above row `r`: no cell of the rows above reaches into it.
function rowBoundaryFree(map: TableMap, r: number): boolean {
  for (let c = 0; c < map.width; c++) {
    if (map.map[r * map.width + c] === map.map[(r - 1) * map.width + c]) return false;
  }
  return true;
}

// Two adjacent blocks that a page-boundary split made of one: the second carries joinPrev.
function isJoinedPair(prev: PMNode | undefined, next: PMNode): boolean {
  return !!next.attrs.joinPrev && prev?.type === next.type &&
    (next.type.name === 'paragraph' || next.type.name === 'table');
}

// The end of the section the caret writes in when only empty paragraphs follow it, else
// -1. That one fills column by column, so typing does not reshuffle its columns; every
// other section balances them, as both word processors draw the saved file.
function writingEnd(state: EditorState): number {
  const $head = state.doc.resolve(state.selection.head);
  if ($head.depth < 1 || $head.node(1).type.name !== 'columns') return -1;
  const chain = columnsChain(state, $head.before(1));
  const last = chain[chain.length - 1];
  const end = last.pos + last.node.nodeSize;
  let open = true;
  state.doc.forEach((n, off) => {
    if (off >= end && !(n.type.name === 'paragraph' && n.content.size === 0)) open = false;
  });
  return open ? end : -1;
}

export const ColumnsFlow = Extension.create({
  name: 'columnsFlow',

  addProseMirrorPlugins() {
    let rafId: number | null = null;
    let passes = 0;
    // Boundaries this budget has split at. A multi-line head is pulled back on an
    // estimate of two lines but can cost thirty, and the overflow branch then splits at
    // the very boundary the join removed — measured: four boundaries flip-flopping for
    // as long as the budget lasts. The join that undoes a split(pos) sits at pos + 1.
    const splitAt = new Set<number>();
    let decorations = DecorationSet.empty;

    const plugin = new Plugin<number>({
      key: flowKey,
      // Counts external changes (user edits, margin/orientation changes) so the
      // view hook can reset the pass budget; the plugin's own transactions don't.
      state: {
        init: () => 0,
        apply(tr, value) {
          if (tr.docChanged) {
            // A fragment whose attrs change loses its height decoration to the mapping,
            // and its content pours into the next column until the next pass.
            let dropped = false;
            const mapped = decorations.map(tr.mapping, tr.doc,
              { onRemove: (spec) => { dropped ||= isBlockDeco(spec); } });
            decorations = dropped ? repairDecos(decorations, mapped, tr) : mapped;
          }
          // A pass of its own never refreshes the budget — not even the recalc the
          // decoration update asks for, or reflow and decorations pump each other forever.
          if (tr.getMeta(FLOW_TX)) return value;
          // Nor does the tab pass's recalc: it answers every doc change of ours, so counting
          // it lets a join/split pair at one boundary restart the budget forever.
          if (tr.getMeta(tabStopsKey)) return value;
          if (tr.docChanged || tr.getMeta(FORCE_PAGE_RECALC)) return value + 1;
          return value;
        },
      },
      props: {
        decorations() {
          return decorations;
        },
      },
      view(editorView) {
        if (isSplitPane(editorView)) return {};
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

        // True when nothing but empty paragraphs follows the fragment's chain (debug dump).
        function openAtDocEnd(frag: Fragment): boolean {
          let after = frag.pos + frag.node.nodeSize;
          let open = true;
          editorView.state.doc.forEach((n, off) => {
            if (off < after) return;
            // Its chain's continuation is judged via its own end; another section is content.
            if (off === after && n.type.name === 'columns' && sameColumnsAttrs(n, frag.node)) {
              after += n.nodeSize;
              return;
            }
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

        // Cut the table at `blockIndex` after the rows that fill the columns from flow offset
        // `startPx`, at a boundary no row span crosses; the second part is marked joinPrev
        // like a paragraph's. `force` keeps at least one row for a table taller than the page.
        function splitTableInBlock(
          frag: Fragment, children: Element[], blockIndex: number, startPx: number,
          columnPx: number, count: number, scale: number, force: boolean,
        ): boolean {
          const block = frag.node.child(blockIndex);
          const rows = children[blockIndex] && tableRows(children[blockIndex], block);
          if (!rows || rows.length < 2) return false;
          const fit = rowsWithin(rowHeights(rows, scale), startPx, columnPx, count);
          const map = TableMap.get(block);
          let r = Math.min(fit, rows.length - 1);
          while (r > 0 && !rowBoundaryFree(map, r)) r--;
          if (r === 0 && force) {
            r = 1;
            while (r < rows.length && !rowBoundaryFree(map, r)) r++;
            if (r >= rows.length) return false;
          }
          if (r === 0) return false;
          let pos = frag.pos + 1;
          for (let j = 0; j < blockIndex; j++) pos += frag.node.child(j).nodeSize;
          pos += 1;
          for (let j = 0; j < r; j++) pos += block.child(j).nodeSize;
          const typesAfter = [
            { type: frag.node.type, attrs: frag.node.attrs },
            { type: block.type, attrs: { ...block.attrs, joinPrev: true } },
          ];
          // canSplit refuses any split inside an isolating table; both halves keep rows here.
          const tr = editorView.state.tr;
          try {
            tr.split(pos, 2, typesAfter);
          } catch {
            return false;
          }
          dispatchFlow(tr);
          return true;
        }

        // Split the block at `blockIndex`, which starts at flow offset `startPx`, where the
        // page's columns of `available` px run out.
        function splitBlock(
          frag: Fragment, children: Element[], blockIndex: number, startPx: number,
          available: number, count: number, scale: number, force: boolean,
        ): boolean {
          return frag.node.child(blockIndex).type.name === 'table'
            ? splitTableInBlock(frag, children, blockIndex, startPx, available, count, scale, force)
            : splitParagraphInBlock(frag, children, blockIndex, count * (available - SAFETY_PX) - startPx, scale, force);
        }

        // What a continuation's head needs of the room left to be pulled back: a joinPrev
        // head one more line or row, a multi-line paragraph ~two line rows and a table its
        // first row (the overflow split hands the excess back), any other block its share.
        function headNeed(node: PMNode, next: Fragment, nextFirst: Element, count: number, scale: number) {
          const headBlock = next.node.child(0);
          const headIsJoinPrev = isJoinedPair(node.child(node.childCount - 1), headBlock);
          if (headBlock.type.name === 'table') {
            const first = tableRows(nextFirst, headBlock)?.[0];
            const row = first ? first.getBoundingClientRect().height / scale : blockHeightPx(nextFirst, scale) / count;
            return { headIsJoinPrev, need: Math.max(row, MIN_BLOCK_PX) };
          }
          const headLines = headBlock.type.name === 'paragraph' ? lineRects(nextFirst) : [];
          const headAdvance = (lineAdvance(headLines) || DEFAULT_LINE_PX * scale) / scale;
          const need = headIsJoinPrev
            ? Math.max(headAdvance, MIN_BLOCK_PX)
            : headLines.length >= 2
              ? Math.max(MIN_TAIL_LINES * headAdvance, MIN_BLOCK_PX)
              : Math.max(blockHeightPx(nextFirst, scale) / count, MIN_BLOCK_PX);
          return { headIsJoinPrev, need };
        }

        // One reflow pass: fix each out-of-sync boundary (merge a stray joinPrev part,
        // split an overflowing fragment, or pull a continuation back) and dispatch.
        // Convergence comes from re-running until quiescent.
        function reflow(): boolean {
          if (editorView.composing || !editorView.dom.isConnected) return false;
          const vm = readVerticalMargins(editorView.dom);
          const scale = getScale();
          let ops = 0;
          let fixedAt = -1;
          let i = 0;
          let frags = fragments();
          // An op changes the fragments; `again` keeps the index on the one it changed.
          const done = (again: boolean) => { ops++; frags = fragments(); if (again) { fixedAt = i; i--; } };

          pass: for (; i < frags.length && ops < MAX_FLOW_OPS; i++) {
            // After an op, only its own fragment and chained continuations are judged: a
            // continuation lands at a page top (a full page of room wherever it renders now),
            // anything else still sits where the layout before the op had left it.
            const continued = i > 0 && hasNextInChain(frags, i - 1);
            if (ops && !continued && i !== fixedAt) break;
            const { pos, node } = frags[i];

            // A joinPrev paragraph or table inside a fragment (left over after a
            // fragment join) merges into its predecessor right away.
            let childPos = pos + 1;
            for (let j = 0; j < node.childCount; j++) {
              const child = node.child(j);
              if (
                j > 0 && isJoinedPair(node.child(j - 1), child) &&
                canJoin(editorView.state.doc, childPos)
              ) {
                dispatchFlow(editorView.state.tr.join(childPos));
                done(true);
                continue pass;
              }
              childPos += child.nodeSize;
            }

            const el = editorView.nodeDOM(pos) as HTMLElement | null;
            if (!el || !el.classList.contains('columns-node')) continue;

            // Its page's own content band (pageBreaks.ts): the section's header and
            // footer reach as far as they do, and its paper may be a different height.
            const band = bandAt(vm, topWithin(el));
            let available = band.height;
            if (!continued) {
              const top = topWithin(el);
              // Mid-move (pageBreaks hasn't repositioned it yet) — measure next pass.
              if (top < band.start - 0.5 || top >= band.end) continue;
              // Less the space above a page break keeps on the section (pageBreaks.ts).
              available = band.end - top - (parseFloat(getComputedStyle(el).paddingTop) || 0);
            }
            const count = Math.max(1, node.attrs.count as number);
            const children = Array.from(el.children).filter(
              (c) => !(c as HTMLElement).dataset?.pageBreakSpacer,
            );
            if (children.length !== node.childCount) continue;
            // The rendered box height is our own decoration, so overflow and room
            // are judged from the content itself (per-column share of the flow).
            const spans = flowSpans(children, scale);
            const usedPerColumn = (spans.end[spans.end.length - 1] ?? 0) / count;

            // The estimate averages the flow over the columns, but each column ends on
            // a whole line, so a fragment measuring exactly its slot still spills once
            // the decoration pins the height — split with the budget's own headroom. A
            // table's rows are whole boxes, so one ending the fragment is placed exactly.
            const last = node.childCount - 1;
            const lastRows = node.child(last).type.name === 'table' ? tableRows(children[last], node.child(last)) : null;
            const overflows = lastRows
              ? rowsWithin(rowHeights(lastRows, scale), spans.start[last], available, count) < lastRows.length
              : usedPerColumn > available - SAFETY_PX;
            if (overflows) {
              // Overflow. Same first-block fit test (incl. margin) as pageBreaks'
              // push decision — the two must agree, or split/push/join cycle.
              const first = Math.max(headFitPx(children[0], count, scale), MIN_BLOCK_PX);
              if (first + COLUMNS_FIT_MARGIN_PX > available) {
                // Not even the first block's head fits. Mid-page, pageBreaks pushes the
                // fragment; at a page top pushing can't help — split the paragraph
                // or table at a line or row boundary instead.
                if (
                  available >= band.height - 1 &&
                  splitBlock(frags[i], children, 0, 0, available, count, scale, true)
                ) {
                  done(false);
                }
                continue;
              }
              let k = 0;
              for (let j = 0; j < children.length - 1; j++) {
                if (spans.end[j] / count > available - SAFETY_PX) break;
                k = j + 1;
              }
              // Leftover room after k whole blocks: fill it with the boundary
              // block's first lines or rows rather than leaving it empty.
              if (k < node.childCount && splitBlock(frags[i], children, k, spans.start[k], available, count, scale, false)) {
                done(false);
                continue;
              }
              if (k === 0) continue;
              let boundary = pos + 1;
              for (let j = 0; j < k; j++) boundary += node.child(j).nodeSize;
              const typesAfter = [{ type: node.type, attrs: node.attrs }];
              if (!canSplit(editorView.state.doc, boundary, 1, typesAfter)) continue;
              splitAt.add(boundary + 1);
              dispatchFlow(editorView.state.tr.split(boundary, 1, typesAfter));
              done(false);
              continue;
            }

            // Fits: pull the adjacent continuation back when its head would
            // clearly fit too (the overflow branch then re-splits further down).
            if (hasNextInChain(frags, i)) {
              const next = frags[i + 1];
              const nextEl = editorView.nodeDOM(next.pos) as HTMLElement | null;
              const nextFirst = nextEl?.firstElementChild;
              if (!nextFirst) continue;
              const joinPos = pos + node.nodeSize;
              if (splitAt.has(joinPos)) continue; // this budget split here; see splitAt
              const { headIsJoinPrev, need } = headNeed(node, next, nextFirst, count, scale);
              if (usedPerColumn + need <= available - HYSTERESIS_PX && canJoin(editorView.state.doc, joinPos)) {
                // Depth 2 rejoins the split paragraph in the same step.
                const tr = editorView.state.tr;
                try {
                  tr.join(joinPos, headIsJoinPrev ? 2 : 1);
                } catch {
                  continue;
                }
                dispatchFlow(tr);
                done(true);
                continue;
              }
            }
          }
          return ops > 0;
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
            // A chained continuation spans a full page wherever it renders right now.
            const band = bandAt(vm, topWithin(el));
            let available = band.height;
            if (!(i > 0 && hasNextInChain(frags, i - 1))) {
              const top = topWithin(el);
              if (top < band.start - 0.5 || top >= band.end) continue;
              available = band.end - top;
            }
            const count = Math.max(1, node.attrs.count as number);
            const children = Array.from(el.children).filter(
              (c) => !(c as HTMLElement).dataset?.pageBreakSpacer,
            );

            let height: number;
            if (hasNextInChain(frags, i)) {
              height = available;
            } else if (pos + node.nodeSize === writingEnd(editorView.state)) {
              // Full single-flow content height: while it's below the page slot,
              // everything pours into column 1 (column 2 only once page 1 is full).
              const contentH = contentHeightPx(children, scale);
              height = Math.min(available, contentH + OPEN_HEIGHT_SLACK_PX);
            } else {
              continue; // balanced end of a mid-document section
            }
            items.push({ from: pos, to: pos + node.nodeSize, height: Math.round(height) });
          }

          // Against the live set, which edits map along: typing above a section moves its
          // positions, not its height. A split or join drops the decorations it replaces.
          const style = (height: number) => `height:${height}px;column-fill:auto;overflow:hidden`;
          const key = items.map((d) => `${d.from}:${d.to}:${style(d.height)}`).join('|');
          const live = decorations.find().map((d) => `${d.from}:${d.to}:${d.spec.block?.style}`).join('|');
          if (key === live) return;
          decorations = items.length
            ? DecorationSet.create(editorView.state.doc, items.map((d) => blockDeco(d.from, d.to, { style: style(d.height) })))
            : DecorationSet.empty;
          // Re-render + let pageBreaks re-measure the new box heights: an answer to its pass,
          // so its cycle memory stands.
          editorView.dispatch(
            editorView.state.tr.setMeta(FLOW_TX, true).setMeta(FORCE_PAGE_RECALC, true).setMeta(LAYOUT_ANSWER, true),
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
            const page = vm.grid.pageAt(top);
            const available = bandAt(vm, top).end - top - (parseFloat(getComputedStyle(el).paddingTop) || 0);
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
                const { headIsJoinPrev, need: needPx } = headNeed(node, next, nextFirst, count, scale);
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
              firstBlockNeedPx: Math.round(children[0] ? Math.max(headFitPx(children[0], count, scale), MIN_BLOCK_PX) : 0),
              overflow: usedPerColumn > available + 1,
              join,
            });
          }
          return { timestamp: new Date().toISOString(), fragments: out };
        }
        flowDebugAccessors.set(editorView, buildDebug);

        function run() {
          rafId = null;
          // The budget covers the decoration update too: it asks for a page recalc, whose
          // new geometry can change the next height again — a pump of its own.
          if (passes >= MAX_FLOW_PASSES) return;
          passes++;
          if (reflow()) return; // geometry changes; decorations follow next pass
          updateDecorations();
        }

        // A pending frame stays: run reads the state it finds, and re-requesting on every
        // update let a dispatch from an earlier frame callback (pageBreaks' pass) push it
        // a frame on for as long as the keys come.
        function schedule() {
          if (rafId === null) rafId = requestAnimationFrame(run);
        }

        schedule();

        return {
          update(_view, prevState) {
            // The caret entering or leaving an open section switches its fill too.
            if (
              flowKey.getState(prevState) !== flowKey.getState(editorView.state) ||
              writingEnd(prevState) !== writingEnd(editorView.state)
            ) {
              passes = 0; // fresh budget per external change
              // ponytail: the positions go stale as other fragments move, so a boundary
              // can stay split until the next external change; map them through the
              // transactions if a fragment is ever left visibly short.
              splitAt.clear();
            }
            schedule();
          },
          // The plugin's state outlives this view, so a later one must find no frame pending.
          destroy() {
            if (rafId !== null) cancelAnimationFrame(rafId);
            rafId = null;
            flowDebugAccessors.delete(editorView);
          },
        };
      },
    });

    return [plugin];
  },
});
