import { Extension } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { selectedRect, isInTable } from '@tiptap/pm/tables';
import { cellGrid } from './tableFormula';
import { parseCellNumber, type NumberLocale } from '../../utils/tableFormula';
import { tableLanguage, tableNumberLocale } from '../../storage/tableOptions.svelte';

// LibreOffice's Table ▸ Sort and Word's Table Layout ▸ Sort: up to three keys, each
// with its own direction and sort type. `auto` is the detected type — a cell that
// reads as a number sorts numerically, anything else by the document's collation.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableSort: {
      sortTable: (options: TableSortOptions) => ReturnType;
    };
  }
}

export type SortType = 'auto' | 'number' | 'text';

export type SortKey = {
  /** 0-based grid column the rows are ordered by. */
  column: number;
  descending: boolean;
  type: SortType;
};

export type TableSortOptions = {
  /** The keys in order; the second decides only where the first ties. */
  keys: SortKey[];
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

export type SortCollators = { natural: Intl.Collator; plain: Intl.Collator };

// Alphanumeric is the plain collation — it puts "10" before "2", which is the whole
// point of picking it over the detected type; detected, a number stays a number.
export function sortCollators(lang: string): SortCollators {
  return {
    natural: new Intl.Collator(lang, { numeric: true, sensitivity: 'variant' }),
    plain: new Intl.Collator(lang, { sensitivity: 'variant' }),
  };
}

type Cell = { text: string; num: number | null };

function compareCells(a: Cell, b: Cell, key: SortKey, coll: SortCollators): number {
  const dir = key.descending ? -1 : 1;
  if (a.num != null && b.num != null) return dir * (a.num - b.num);
  // Sorted numerically, a cell that is no number sorts last either way, as an empty
  // cell does in every spreadsheet.
  if (key.type === 'number') return a.num != null ? -1 : b.num != null ? 1 : 0;
  // Detected, a number goes ahead of text: the order a mixed column sorts in has to be
  // decided, and this is the one every spreadsheet takes.
  if (key.type === 'auto' && a.num != null) return -dir;
  if (key.type === 'auto' && b.num != null) return dir;
  return dir * (key.type === 'text' ? coll.plain : coll.natural).compare(a.text, b.text);
}

export function sortedRows(
  table: PMNode,
  opts: TableSortOptions,
  loc: NumberLocale,
  coll: SortCollators,
): PMNode[] {
  const grid = cellGrid(table);
  const rows: PMNode[] = [];
  table.forEach((row) => rows.push(row));
  const first = opts.headerRow ? 1 : 0;
  const keys = opts.keys.filter((k) => k.column >= 0);
  if (!keys.length) return rows;
  const keyed = rows.slice(first).map((row, i) => ({
    row,
    cells: keys.map((k) => {
      const text = grid.nodeAt({ row: first + i, col: k.column })?.textContent.trim() ?? '';
      return { text, num: k.type === 'text' ? null : parseCellNumber(text, loc) };
    }),
  }));
  // Stable, so rows sharing every key keep the order they were typed in.
  keyed.sort((a, b) => {
    for (let i = 0; i < keys.length; i++) {
      const c = compareCells(a.cells[i], b.cells[i], keys[i], coll);
      if (c) return c;
    }
    return 0;
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
            const rows = sortedRows(rect.table, options, tableNumberLocale(), sortCollators(tableLanguage()));
            const table = rect.table.type.create(rect.table.attrs, rows, rect.table.marks);
            const from = rect.tableStart - 1;
            dispatch(state.tr.replaceWith(from, from + rect.table.nodeSize, table));
          }
          return true;
        },
    };
  },
});
