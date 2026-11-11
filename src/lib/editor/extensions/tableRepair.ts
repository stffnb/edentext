import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Mapping } from '@tiptap/pm/transform';
import { TableMap, tableNodeTypes } from '@tiptap/pm/tables';

// Rows two clients changed at once can differ in length; fixTables, run after this, only
// adds cells, so a row longer than most first loses its empty cells past that width (never
// content). The result depends on the table alone, so every client repairs it alike.

const plainEmpty = (cell: PMNode) =>
  (cell.attrs.colspan ?? 1) === 1 && (cell.attrs.rowspan ?? 1) === 1 && cell.childCount === 1 && cell.firstChild!.isTextblock && cell.firstChild!.content.size === 0;

// Each row's width, row spans from above counted in.
function widths(table: PMNode): number[] {
  const filled: number[][] = [];
  table.forEach((row, _o, r) => {
    let col = 0;
    row.forEach((cell) => {
      while (filled[r]?.[col]) col++;
      for (let dr = 0; dr < (cell.attrs.rowspan ?? 1); dr++)
        for (let dc = 0; dc < (cell.attrs.colspan ?? 1); dc++) (filled[r + dr] ??= [])[col + dc] = 1;
      col += cell.attrs.colspan ?? 1;
    });
  });
  return Array.from({ length: table.childCount }, (_, r) => (filled[r] ?? []).filter(Boolean).length);
}

function trimRows(state: EditorState): Transaction | null {
  const cuts: [number, number][] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.spec.tableRole !== 'table') return !node.isTextblock;
    if (!TableMap.get(node).problems) return true;
    const w = widths(node);
    const count = new Map<number, number>();
    for (const x of w) count.set(x, (count.get(x) ?? 0) + 1);
    // The most common width; a tie keeps the wider one.
    let target = 0, most = 0;
    for (const [x, n] of count) if (n > most || (n === most && x > target)) { target = x; most = n; }
    if (!target) return true;
    let rowPos = pos + 1;
    node.forEach((row, _o, r) => {
      let over = w[r] - target;
      let end = rowPos + row.nodeSize - 1;
      for (let i = row.childCount - 1; i >= 0 && over > 0 && plainEmpty(row.child(i)); i--) {
        cuts.push([end - row.child(i).nodeSize, end]);
        end -= row.child(i).nodeSize;
        over--;
      }
      rowPos += row.nodeSize;
    });
    return true;
  });
  if (!cuts.length) return null;
  const tr = state.tr;
  for (const [from, to] of cuts.sort((a, b) => b[0] - a[0])) tr.delete(from, to);
  return tr;
}

// A row without cells (the one a repair fills an emptied table with) gets the table's width
// in empty cells; a table no row of which has one takes the width it had before `trs`.
function fillRows(trs: readonly Transaction[], old: EditorState, state: EditorState): Transaction | null {
  const adds: [number, number][] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.spec.tableRole !== 'table') return !node.isTextblock;
    let bare = false;
    node.forEach((row) => { bare ||= !row.childCount; });
    if (!bare) return true;
    let width = Math.max(0, ...widths(node));
    if (!width) {
      const back = new Mapping();
      for (const t of trs) back.appendMapping(t.mapping);
      const was = old.doc.nodeAt(back.invert().map(pos, -1));
      width = was?.type === node.type ? Math.max(1, ...widths(was)) : 1;
    }
    node.forEach((row, off) => { if (!row.childCount) adds.push([pos + 2 + off, width]); });
    return true;
  });
  if (!adds.length) return null;
  const tr = state.tr, cell = tableNodeTypes(state.schema).cell;
  for (const [at, n] of adds.reverse()) tr.insert(at, Array.from({ length: n }, () => cell.createAndFill()!));
  return tr;
}

/** Runs ahead of prosemirror-tables' fixTables, which then adds what is still missing. */
export const tableRepair = () => new Plugin({
  key: new PluginKey('tableRepair'),
  appendTransaction: (trs, old, state) => (trs.some((t) => t.docChanged) ? fillRows(trs, old, state) ?? trimRows(state) : null),
});
