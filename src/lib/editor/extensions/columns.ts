import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { REBUILDING } from './trackChanges';

// A multi-column (newspaper) section: content flows through balanced CSS columns.
// The doc may hold it as adjacent equal-attr fragments (a "chain") so columnsFlow.ts
// can split/join across page breaks; export merges a chain into one section.

export const DEFAULT_COLUMN_GAP_CM = 0.5;
export const MAX_COLUMN_GAP_CM = 5;
export const MAX_COLUMN_COUNT = 3;

export interface ColumnsAttrs {
  count: number; // 2 or 3; a count-1 columns node never exists (1 unwraps)
  gapCm: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columns: {
      setColumns: (count: number) => ReturnType;
      setColumnGap: (gapCm: number) => ReturnType;
    };
  }
}

// Fit margin for "does the first block fit the remaining page space": the
// balanced-height estimate undershoots real height by margins + line quantization.
// pageBreaks.ts and columnsFlow.ts MUST share this or split/push/join cycles forever.
export const COLUMNS_FIT_MARGIN_PX = 32;

// Below this many lines of leftover room, a boundary block splits at the block
// boundary instead of pulling a line or two over (not worth a paragraph split).
export const MIN_TAIL_LINES = 2;
export const DEFAULT_LINE_PX = 19;

export type LineRect = { left: number; right: number; top: number; height: number };

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
export function lineRects(el: Element): LineRect[] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const rects: LineRect[] = [];
  let textNode: globalThis.Node | null;
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

// Median top-to-top line advance (viewport px); 0 when there are too few lines.
export function lineAdvance(lines: { top: number }[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i].top - lines[i - 1].top;
    if (g > 2) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  return gaps.length ? gaps[gaps.length >> 1] : 0;
}

// What of a section's first block must fit the room left on a page for the section to
// start there: two lines of a paragraph or the first row of a table the flow can cut,
// else its share of the columns. pageBreaks.ts and columnsFlow.ts must agree on it.
export function headFitPx(el: Element, count: number, scale: number): number {
  let whole = 0;
  for (const r of Array.from(el.getClientRects())) whole += r.height;
  whole = whole / scale / count;
  if (el.tagName === 'P') {
    const lines = lineRects(el);
    if (lines.length > MIN_TAIL_LINES) {
      return Math.min(whole, MIN_TAIL_LINES * ((lineAdvance(lines) || DEFAULT_LINE_PX * scale) / scale));
    }
  }
  const rows = el.querySelectorAll<HTMLTableRowElement>(':scope > table > tbody > tr');
  if (rows.length > 1 && Array.from(rows[0].cells).every((c) => c.rowSpan <= 1)) {
    return Math.min(whole, rows[0].getBoundingClientRect().height / scale);
  }
  return whole;
}

export function clampColumnCount(n: number): number {
  return Math.min(MAX_COLUMN_COUNT, Math.max(2, Math.round(n)));
}

export function clampColumnGap(g: number): number {
  return Math.min(MAX_COLUMN_GAP_CM, Math.max(0, g));
}

export function sameColumnsAttrs(a: PMNode, b: PMNode): boolean {
  return a.attrs.count === b.attrs.count && a.attrs.gapCm === b.attrs.gapCm;
}

// The columns fragment enclosing the selection (any ancestor of the cursor).
export function findColumns(state: EditorState): { pos: number; node: PMNode } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'columns') return { pos: $from.before(d), node: n };
  }
  return null;
}

type Fragment = { pos: number; node: PMNode };

// The maximal run of adjacent equal-attr fragments containing the one at `pos` —
// the user-visible "section". Commands act on the whole chain.
export function columnsChain(state: EditorState, pos: number): Fragment[] {
  const all: Fragment[] = [];
  state.doc.forEach((node, offset) => {
    if (node.type.name === 'columns') all.push({ pos: offset, node });
  });
  const idx = all.findIndex((f) => f.pos === pos);
  if (idx < 0) return [];
  let lo = idx;
  while (
    lo > 0 &&
    all[lo - 1].pos + all[lo - 1].node.nodeSize === all[lo].pos &&
    sameColumnsAttrs(all[lo - 1].node, all[lo].node)
  ) lo--;
  let hi = idx;
  while (
    hi + 1 < all.length &&
    all[hi].pos + all[hi].node.nodeSize === all[hi + 1].pos &&
    sameColumnsAttrs(all[hi].node, all[hi + 1].node)
  ) hi++;
  return all.slice(lo, hi + 1);
}

const WRAPPABLE = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'table']);

// Pagination breaks a columns fragment as a whole, so a manual page break inside one is
// honoured by nothing — the blocks lose theirs on the way in.
function withoutPageBreaks(blocks: PMNode[]): PMNode[] {
  return blocks.map((b) => (b.attrs?.breakBefore ? b.type.create({ ...b.attrs, breakBefore: null }, b.content, b.marks) : b));
}

function childArray(n: PMNode): PMNode[] {
  const out: PMNode[] = [];
  n.forEach((c) => out.push(c));
  return out;
}

// Re-merge paragraphs and tables split by columnsFlow at a page boundary (the second
// part carries joinPrev). Used wherever fragment content leaves the chain context:
// unwrap, absorb-into-a-new-section; export does the same on the JSON level.
export function mergeJoinedBlocks(blocks: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    if (b.attrs.joinPrev && (b.type.name === 'paragraph' || b.type.name === 'table') && prev?.type === b.type) {
      out[out.length - 1] = prev.type.create(prev.attrs, prev.content.append(b.content));
    } else {
      out.push(b);
    }
  }
  return out;
}

// The parts marked joinPrev that no file can join to the block before them: that block is
// of another type, in another section (other columns) or in none, or there is none.
function strandedJoins(doc: PMNode): number[] {
  const out: number[] = [];
  let last: PMNode | null = null;
  let section: PMNode | null = null;
  doc.forEach((node, offset) => {
    if (node.type.name !== 'columns') {
      if (node.attrs.joinPrev) out.push(offset);
      last = section = null;
      return;
    }
    let before = section && sameColumnsAttrs(section, node) ? last : null;
    node.forEach((child, off) => {
      if (child.attrs.joinPrev && before?.type !== child.type) out.push(offset + 1 + off);
      before = child;
    });
    last = before;
    section = node;
  });
  return out;
}

// With no selection, columns apply to the whole document. Wrappable runs
// (absorbing existing sections) become one section each; boxes/TOCs stay
// between them. Replacements run bottom-up so earlier positions stay valid.
function applyToWholeDoc(state: EditorState, tr: Transaction, attrs: ColumnsAttrs): boolean {
  const type = state.schema.nodes.columns;
  type Run = { from: number; to: number; blocks: PMNode[] };
  const runs: Run[] = [];
  let run: Run | null = null;
  state.doc.forEach((n, offset) => {
    if (WRAPPABLE.has(n.type.name) || n.type.name === 'columns') {
      const blocks = n.type.name === 'columns' ? childArray(n) : [n];
      if (run) { run.to = offset + n.nodeSize; run.blocks.push(...blocks); }
      else run = { from: offset, to: offset + n.nodeSize, blocks };
    } else if (run) {
      runs.push(run);
      run = null;
    }
  });
  if (run) runs.push(run);
  if (!runs.length) return false;
  for (const r of [...runs].reverse()) {
    tr.replaceWith(r.from, r.to, type.create(attrs, withoutPageBreaks(mergeJoinedBlocks(r.blocks))));
  }
  return true;
}

// The selected blocks take `attrs` (null: one column) and every other block of the
// sections the selection touches keeps its own, so a section splits around the selection;
// runs of equal columns are regrouped. Fails on a box or index taking columns.
function applyToSelection(state: EditorState, tr: Transaction, attrs: ColumnsAttrs | null): boolean {
  const { from: selFrom, to: selTo, $from, $to } = state.selection;
  const chainOf = (pos: number) => (state.doc.nodeAt(pos)?.type.name === 'columns' ? columnsChain(state, pos) : null);
  // The sections touching the selected blocks, so equal runs regroup into one.
  const before = state.doc.resolve($from.before(1)).nodeBefore;
  const after = state.doc.resolve($to.after(1)).nodeAfter;
  const startChain = chainOf(before?.type.name === 'columns' ? $from.before(1) - before.nodeSize : $from.before(1));
  const endChain = chainOf(after?.type.name === 'columns' ? $to.after(1) : $to.before(1));
  const start = startChain ? startChain[0].pos : $from.before(1);
  const tail = endChain?.[endChain.length - 1];
  const end = tail ? tail.pos + tail.node.nodeSize : $to.after(1);
  type Item = { node: PMNode; attrs: ColumnsAttrs | null; sel: boolean };
  const items: Item[] = [];
  const add = (node: PMNode, pos: number, own: ColumnsAttrs | null) => {
    const sel = pos < selTo && pos + node.nodeSize > selFrom;
    const prev = items[items.length - 1];
    // A paragraph or table columnsFlow cut at a page boundary is one block again.
    if (own && prev?.attrs && node.attrs.joinPrev && prev.node.type === node.type) {
      prev.node = mergeJoinedBlocks([prev.node, node])[0];
      prev.sel ||= sel;
    } else {
      items.push({ node, attrs: own, sel });
    }
  };
  state.doc.nodesBetween(start, end, (n, pos, parent) => {
    if (parent?.type.name !== 'doc') return false;
    if (n.type.name === 'columns') n.forEach((c, off) => add(c, pos + 1 + off, n.attrs as ColumnsAttrs));
    else add(n, pos, null);
    return false;
  });
  const same = (a: ColumnsAttrs | null, b: ColumnsAttrs | null) =>
    a && b ? a.count === b.count && a.gapCm === b.gapCm : a === b;
  let changed = false;
  for (const it of items) {
    if (!it.sel) continue;
    if (!WRAPPABLE.has(it.node.type.name)) {
      if (attrs) return false;
      continue;
    }
    changed ||= !same(attrs, it.attrs);
    it.attrs = attrs;
  }
  if (!changed) return false;
  const out: PMNode[] = [];
  let at = start;
  let first = -1;
  let last = -1;
  for (let k = 0; k < items.length; ) {
    const a = items[k].attrs;
    let m = k + 1;
    while (a && m < items.length && same(a, items[m].attrs)) m++;
    const run = items.slice(k, m);
    if (a) at++;
    for (const it of run) {
      if (it.sel && first < 0) first = at;
      if (it.sel) last = at + it.node.nodeSize;
      at += it.node.nodeSize;
    }
    if (a) {
      at++;
      out.push(state.schema.nodes.columns.create(a, withoutPageBreaks(run.map((it) => it.node))));
    } else {
      out.push(items[k].node);
    }
    k = m;
  }
  tr.replaceWith(start, end, out);
  tr.setSelection(TextSelection.between(tr.doc.resolve(first + 1), tr.doc.resolve(last - 1)));
  return true;
}

export const Columns = Node.create({
  name: 'columns',
  // Own group (not `block`): only the doc admits it, so it can't nest in table
  // cells, list items, text boxes, or other columns sections.
  group: 'columns',
  content: '(paragraph | heading | bulletList | orderedList | table)+',
  // Not isolating/selectable: the section must feel like flowing text, not an
  // object — selection, Backspace, and joins cross fragment boundaries freely
  // (a join merges fragments; columnsFlow re-splits as needed).
  isolating: false,
  defining: true,
  selectable: false,

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'table'],
        attributes: {
          // Layout-internal: marks the second part of a paragraph or table that columnsFlow
          // split at a page boundary. Never rendered/parsed; export and unwrap
          // merge it back into its predecessor.
          joinPrev: {
            default: false,
            rendered: false,
            keepOnSplit: false,
          },
        },
      },
    ];
  },

  addAttributes() {
    return {
      count: {
        default: 2,
        parseHTML: el => {
          const n = parseInt((el as HTMLElement).getAttribute('data-columns') ?? '', 10);
          return Number.isFinite(n) ? clampColumnCount(n) : 2;
        },
        renderHTML: () => ({}),
      },
      gapCm: {
        default: DEFAULT_COLUMN_GAP_CM,
        parseHTML: el => {
          const g = parseFloat((el as HTMLElement).getAttribute('data-column-gap') ?? '');
          return Number.isFinite(g) ? clampColumnGap(g) : DEFAULT_COLUMN_GAP_CM;
        },
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-columns]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const a = node.attrs as ColumnsAttrs;
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-columns': String(a.count),
      'data-column-gap': String(a.gapCm),
      class: 'columns-node',
      style: `column-count:${a.count};column-gap:${a.gapCm}cm`,
    }), 0];
  },

  // A part cut off a block that an edit then parted from it (a section's gap or count
  // changed under it, its predecessor removed) is a block of its own, as both files hold it.
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('strandedJoins'),
      appendTransaction(trs, _old, state) {
        if (!trs.some((tr) => tr.docChanged)) return null;
        const stranded = strandedJoins(state.doc);
        if (!stranded.length) return null;
        const tr = state.tr;
        for (const pos of stranded) tr.setNodeAttribute(pos, 'joinPrev', false);
        return tr;
      },
    })];
  },

  // Enter in an empty block: the base chain lifts it out of the section, or splits
  // the fragment mid-run — a section must read as flowing text, so it only ever
  // splits the block. Core keymaps come later, so this binding is reached first.
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $cursor } = editor.state.selection as TextSelection;
        if (!$cursor || $cursor.parent.content.size) return false;
        if ($cursor.node(-1)?.type.name !== 'columns') return false;
        return editor.commands.splitBlock();
      },
    };
  },

  addCommands() {
    return {
      // A selection: its blocks get the columns, splitting a section it lies in (1
      // takes them out). A bare cursor in a section: 1 unwraps its whole chain, 2/3
      // update its count; elsewhere the whole document gets columns.
      setColumns:
        (count: number) =>
        ({ state, dispatch }) => {
          if (!state.schema.nodes.columns) return false;
          const found = findColumns(state);
          const { $from, $to, empty } = state.selection;
          if (!empty) {
            if ($from.depth < 1 || $to.depth < 1) return false;
            const gapCm = (found?.node.attrs.gapCm as number | undefined) ?? DEFAULT_COLUMN_GAP_CM;
            const tr = state.tr;
            if (!applyToSelection(state, tr, count <= 1 ? null : { count: clampColumnCount(count), gapCm })) return false;
            if (dispatch) dispatch(tr.setMeta(REBUILDING, true).scrollIntoView());
            return true;
          }
          if (found) {
            const chain = columnsChain(state, found.pos);
            if (dispatch) {
              const tr = state.tr;
              if (count <= 1) {
                const first = chain[0];
                const last = chain[chain.length - 1];
                const blocks = mergeJoinedBlocks(chain.flatMap((f) => childArray(f.node)));
                tr.replaceWith(first.pos, last.pos + last.node.nodeSize, blocks);
              } else {
                const attrs = { ...found.node.attrs, count: clampColumnCount(count) };
                for (const f of chain) tr.setNodeMarkup(f.pos, undefined, attrs);
              }
              dispatch(tr.setMeta(REBUILDING, true).scrollIntoView());
            }
            return true;
          }
          if (count <= 1) return false;
          const attrs: ColumnsAttrs = { count: clampColumnCount(count), gapCm: DEFAULT_COLUMN_GAP_CM };
          const tr = state.tr;
          if (!applyToWholeDoc(state, tr, attrs)) return false;
          if (dispatch) {
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min($from.pos, tr.doc.content.size))));
            dispatch(tr.setMeta(REBUILDING, true).scrollIntoView());
          }
          return true;
        },

      setColumnGap:
        (gapCm: number) =>
        ({ state, dispatch }) => {
          const found = findColumns(state);
          if (!found || !Number.isFinite(gapCm)) return false;
          if (dispatch) {
            const tr = state.tr;
            const attrs = { ...found.node.attrs, gapCm: clampColumnGap(gapCm) };
            for (const f of columnsChain(state, found.pos)) tr.setNodeMarkup(f.pos, undefined, attrs);
            dispatch(tr);
          }
          return true;
        },
    };
  },
});
