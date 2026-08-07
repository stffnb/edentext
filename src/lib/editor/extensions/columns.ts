import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';

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

const WRAPPABLE = new Set(['paragraph', 'heading', 'bulletList', 'orderedList']);

// Top-level blocks of [start, end) as columns content: wrappable blocks collected
// as-is, existing columns fragments absorbed (their content joins the run);
// null when the range holds anything else (table, text box, TOC).
function collectWrappable(state: EditorState, start: number, end: number): { blocks: PMNode[]; from: number; to: number } | null {
  const blocks: PMNode[] = [];
  let ok = true;
  let from = -1;
  let to = -1;
  state.doc.nodesBetween(start, end, (n, pos, parent) => {
    if (parent?.type.name !== 'doc') return false;
    if (from < 0) from = pos;
    to = pos + n.nodeSize;
    if (WRAPPABLE.has(n.type.name)) blocks.push(n);
    else if (n.type.name === 'columns') blocks.push(...childArray(n));
    else ok = false;
    return false;
  });
  return ok && blocks.length ? { blocks: mergeJoinedBlocks(blocks), from, to } : null;
}

function childArray(n: PMNode): PMNode[] {
  const out: PMNode[] = [];
  n.forEach((c) => out.push(c));
  return out;
}

// Re-merge paragraphs split by columnsFlow's page-boundary line split (the second
// part carries joinPrev). Used wherever fragment content leaves the chain context:
// unwrap, absorb-into-a-new-section; export does the same on the JSON level.
export function mergeJoinedBlocks(blocks: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    if (
      b.type.name === 'paragraph' && b.attrs.joinPrev &&
      prev?.type.name === 'paragraph'
    ) {
      out[out.length - 1] = prev.type.create(prev.attrs, prev.content.append(b.content));
    } else {
      out.push(b);
    }
  }
  return out;
}

// With no selection, columns apply to the whole document. Wrappable runs
// (absorbing existing sections) become one section each; tables/boxes/TOCs stay
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
    tr.replaceWith(r.from, r.to, type.create(attrs, mergeJoinedBlocks(r.blocks)));
  }
  return true;
}

export const Columns = Node.create({
  name: 'columns',
  // Own group (not `block`): only the doc admits it, so it can't nest in table
  // cells, list items, text boxes, or other columns sections.
  group: 'columns',
  content: '(paragraph | heading | bulletList | orderedList)+',
  // Not isolating/selectable: the section must feel like flowing text, not an
  // object — selection, Backspace, and joins cross fragment boundaries freely
  // (a join merges fragments; columnsFlow re-splits as needed).
  isolating: false,
  defining: true,
  selectable: false,

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          // Layout-internal: marks the second part of a paragraph that columnsFlow
          // split at a page boundary. Never rendered/parsed; export and unwrap
          // merge a joinPrev paragraph back into its predecessor.
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

  addCommands() {
    return {
      // Inside a section: 1 unwraps the whole chain, 2/3 update its count. Outside:
      // with a selection, 2/3 wrap the covered top-level blocks (fails on tables
      // etc.); with a bare cursor, the whole document gets columns.
      setColumns:
        (count: number) =>
        ({ state, dispatch }) => {
          const type = state.schema.nodes.columns;
          if (!type) return false;
          const found = findColumns(state);
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
              dispatch(tr.scrollIntoView());
            }
            return true;
          }
          if (count <= 1) return false;
          const attrs: ColumnsAttrs = { count: clampColumnCount(count), gapCm: DEFAULT_COLUMN_GAP_CM };
          const { $from, $to, empty } = state.selection;
          if (empty) {
            const tr = state.tr;
            if (!applyToWholeDoc(state, tr, attrs)) return false;
            if (dispatch) {
              tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min($from.pos, tr.doc.content.size))));
              dispatch(tr.scrollIntoView());
            }
            return true;
          }
          if ($from.depth < 1 || $to.depth < 1) return false;
          const covered = collectWrappable(state, $from.before(1), $to.after(1));
          if (!covered) return false;
          if (dispatch) {
            const tr = state.tr.replaceWith(covered.from, covered.to, type.create(attrs, covered.blocks));
            tr.setSelection(TextSelection.near(tr.doc.resolve(covered.from + 1)));
            dispatch(tr.scrollIntoView());
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
