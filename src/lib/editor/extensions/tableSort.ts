import { Extension } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { selectedRect, isInTable } from '@tiptap/pm/tables';
import { cellGrid } from './tableFormula';
import { parseCellNumber, type NumberLocale } from '../../utils/tableFormula';
import { tableLanguage, tableNumberLocale } from '../../storage/tableOptions.svelte';

// LibreOffice's Table ▸ Sort and Word's Table Layout ▸ Sort, reduced to the one
// sort key both offer first. The type is detected per cell rather than chosen:
// a column of numbers sorts numerically, anything else by the document's collation.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableSort: {
      sortTable: (options: TableSortOptions) => ReturnType;
    };
  }
}

export type TableSortOptions = {
  /** 0-based grid column the rows are ordered by. */
  column: number;
  descending: boolean;
  /** Keep the first row where it is, as both sort dialogs offer. */
  headerRow: boolean;
};

// A vertically merged cell belongs to more than one row, so there are no rows to
// reorder; both word processors refuse to sort such a table too.
export function canSortTable(table: PMNode): boolean {
  if (table.childCount < 2) return false;
  let ok = true;
  table.forEach((row) => row.forEach((cell) => {
    if (((cell.attrs.rowspan as number) ?? 1) > 1) ok = false;
  }));
  return ok;
}

export function sortedRows(
  table: PMNode,
  opts: TableSortOptions,
  loc: NumberLocale,
  collator: Intl.Collator,
): PMNode[] {
  const grid = cellGrid(table);
  const rows: PMNode[] = [];
  table.forEach((row) => rows.push(row));
  const first = opts.headerRow ? 1 : 0;
  const keyed = rows.slice(first).map((row, i) => {
    const text = grid.nodeAt({ row: first + i, col: opts.column })?.textContent.trim() ?? '';
    return { row, text, num: parseCellNumber(text, loc) };
  });
  const dir = opts.descending ? -1 : 1;
  // Stable, so rows sharing a key keep the order they were typed in.
  keyed.sort((a, b) => {
    if (a.num != null && b.num != null) return dir * (a.num - b.num);
    // A number ahead of text: the order a mixed column sorts in has to be decided,
    // and this is the one every spreadsheet takes.
    if (a.num != null) return -dir;
    if (b.num != null) return dir;
    return dir * collator.compare(a.text, b.text);
  });
  return [...rows.slice(0, first), ...keyed.map((k) => k.row)];
}

export const TableSort = Extension.create({
  name: 'tableSort',

  addCommands() {
    return {
      sortTable:
        (options: TableSortOptions) =>
        ({ state, dispatch }: CommandProps) => {
          if (!isInTable(state)) return false;
          const rect = selectedRect(state);
          if (!canSortTable(rect.table)) return false;
          if (dispatch) {
            const collator = new Intl.Collator(tableLanguage(), { numeric: true, sensitivity: 'variant' });
            const rows = sortedRows(rect.table, options, tableNumberLocale(), collator);
            const table = rect.table.type.create(rect.table.attrs, rows, rect.table.marks);
            const from = rect.tableStart - 1;
            dispatch(state.tr.replaceWith(from, from + rect.table.nodeSize, table));
          }
          return true;
        },
    };
  },
});
