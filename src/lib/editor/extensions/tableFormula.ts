import { Extension } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { TableMap, selectedRect, isInTable } from '@tiptap/pm/tables';
import {
  evalFormula, parseCellNumber, formatCellNumber, refName,
  type CellRef, type NumberLocale,
} from '../../utils/tableFormula';
import { numberRecognition, tableNumberLocale } from '../../storage/tableOptions.svelte';
import { t } from '../../i18n/i18n.svelte';

// A cell's formula, on the cell itself — which is where ODF puts it
// (`table:formula`), Word keeping it in a field inside the cell instead. The
// result is the cell's own text, recomputed here whenever the table changes.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableFormula: {
      setCellFormula: (formula: string | null) => ReturnType;
    };
  }
}

const key = new PluginKey('tableFormula');

export type CellGrid = {
  map: TableMap;
  nodeAt: (ref: CellRef) => PMNode | null;
  offsetAt: (ref: CellRef) => number | null;
};

export function cellGrid(table: PMNode): CellGrid {
  const map = TableMap.get(table);
  const offsetAt = (ref: CellRef): number | null => {
    if (ref.row < 0 || ref.col < 0 || ref.row >= map.height || ref.col >= map.width) return null;
    return map.map[ref.row * map.width + ref.col];
  };
  return {
    map,
    offsetAt,
    nodeAt: (ref) => {
      const off = offsetAt(ref);
      return off == null ? null : table.nodeAt(off);
    },
  };
}

// Every formula cell's result text, keyed by the cell's offset in the table. A
// reference to another formula resolves through it, so a chain settles in one pass;
// a cycle yields the error text rather than looping.
export function evaluateTable(table: PMNode, loc: NumberLocale, error: string): Map<number, string> {
  const grid = cellGrid(table);
  const results = new Map<number, string>();
  const cache = new Map<number, number | null>();
  const busy = new Set<number>();

  const valueOf = (ref: CellRef): number | null => {
    const off = grid.offsetAt(ref);
    const node = off == null ? null : table.nodeAt(off);
    if (off == null || !node) return null;
    if (cache.has(off)) return cache.get(off) ?? null;
    const formula = node.attrs.formula as string | null;
    if (!formula) return parseCellNumber(node.textContent, loc);
    if (busy.has(off)) return null;
    busy.add(off);
    const value = evalFormula(formula, {
      rows: grid.map.height, cols: grid.map.width, self: ref, valueAt: valueOf,
    });
    busy.delete(off);
    cache.set(off, value);
    results.set(off, value == null ? error : formatCellNumber(value, loc));
    return value;
  };

  for (let row = 0; row < grid.map.height; row++) {
    for (let col = 0; col < grid.map.width; col++) {
      if (grid.nodeAt({ row, col })?.attrs.formula) valueOf({ row, col });
    }
  }
  return results;
}

// The cell the cursor sits in, as a document position.
function cellPosOf($pos: ResolvedPos): number | null {
  for (let d = $pos.depth; d > 0; d--) {
    const role = $pos.node(d).type.spec.tableRole;
    if (role === 'cell' || role === 'header_cell') return $pos.before(d);
  }
  return null;
}

// Replace a cell's text with `text`, keeping the first run's marks — a formula cell
// carries the formatting of the cell it was set in, as a field would.
function setCellText(tr: Transaction, cellPos: number, cell: PMNode, text: string): void {
  const first = cell.firstChild;
  if (!first || !first.isTextblock) return;
  const from = cellPos + 2;
  const to = from + first.content.size;
  if (text) tr.replaceWith(from, to, tr.doc.type.schema.text(text, first.firstChild?.marks));
  else if (to > from) tr.delete(from, to);
}

type Edit = { pos: number; cell: PMNode; text: string };

function formulaEdits(doc: PMNode, loc: NumberLocale): Edit[] {
  const edits: Edit[] = [];
  doc.descendants((node, pos) => {
    // This runs on every edit, so the walk stops at the blocks a table cannot be in —
    // otherwise it visits every run of the document per keystroke.
    if (node.isTextblock) return false;
    if (node.type.name !== 'table') return;
    for (const [off, text] of evaluateTable(node, loc, t().table.formulaError)) {
      const cell = node.nodeAt(off);
      if (cell && cell.textContent !== text) edits.push({ pos: pos + 1 + off, cell, text });
    }
    return false; // a table holds no table
  });
  return edits;
}

// LibreOffice's number recognition, applied where it applies it: on leaving the cell,
// a text that reads as a number is rewritten in the document's number format.
function recognitionEdit(doc: PMNode, cellPos: number, loc: NumberLocale): Edit | null {
  const cell = doc.nodeAt(cellPos);
  const role = cell?.type.spec.tableRole;
  if (!cell || (role !== 'cell' && role !== 'header_cell') || cell.attrs.formula) return null;
  const value = parseCellNumber(cell.textContent, loc);
  if (value == null) return null;
  const text = formatCellNumber(value, loc);
  return text === cell.textContent ? null : { pos: cellPos, cell, text };
}

export const TableFormula = Extension.create({
  name: 'tableFormula',

  addGlobalAttributes() {
    return [
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          formula: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute('data-formula'),
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.formula ? { 'data-formula': attributes.formula } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setCellFormula:
        (formula: string | null) =>
        ({ state, dispatch }: CommandProps) => {
          if (!isInTable(state)) return false;
          const rect = selectedRect(state);
          const off = cellGrid(rect.table).offsetAt({ row: rect.top, col: rect.left });
          if (off == null) return false;
          const pos = rect.tableStart + off;
          const cell = state.doc.nodeAt(pos);
          if (!cell) return false;
          if (dispatch) {
            dispatch(state.tr.setNodeMarkup(pos, undefined, { ...cell.attrs, formula: formula || null }));
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        appendTransaction(trs, oldState, newState) {
          const loc = tableNumberLocale();
          const tr = newState.tr;
          // Recognition first: it feeds the formulas that read the cell.
          let recognized = false;
          if (numberRecognition()) {
            const left = cellPosOf(oldState.selection.$from);
            const now = cellPosOf(newState.selection.$from);
            const moved = left == null ? null : trs.reduce((p, t) => t.mapping.map(p), left);
            if (moved != null && moved !== now) {
              const edit = recognitionEdit(newState.doc, moved, loc);
              if (edit) {
                setCellText(tr, edit.pos, edit.cell, edit.text);
                recognized = true;
              }
            }
          }
          if (!recognized && !trs.some((t) => t.docChanged)) return null;
          // Descending, so an earlier edit's positions still hold for the next one.
          for (const edit of formulaEdits(tr.doc, loc).reverse()) {
            setCellText(tr, edit.pos, edit.cell, edit.text);
          }
          return tr.steps.length ? tr.setMeta('addToHistory', false) : null;
        },
      }),
    ];
  },
});

// What the Formula dialog offers: Word guesses the numbers above the cell, and the
// ones to its left where there are none.
export function guessFormula(state: EditorState): string {
  if (!isInTable(state)) return '=SUM(ABOVE)';
  const rect = selectedRect(state);
  const grid = cellGrid(rect.table);
  const loc = tableNumberLocale();
  const numeric = (ref: CellRef): boolean => {
    const node = grid.nodeAt(ref);
    return !!node && !node.attrs.formula && parseCellNumber(node.textContent, loc) != null;
  };
  if (rect.top > 0 && numeric({ row: rect.top - 1, col: rect.left })) return '=SUM(ABOVE)';
  if (rect.left > 0 && numeric({ row: rect.top, col: rect.left - 1 })) return '=SUM(LEFT)';
  return '=SUM(ABOVE)';
}

// The cell the cursor is in, named the way a formula refers to it (LibreOffice shows
// this in its status bar).
export function currentCellName(state: EditorState): string | null {
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);
  return refName({ row: rect.top, col: rect.left });
}

// The formula of the cell the cursor is in, '' when it has none.
export function currentCellFormula(state: EditorState): string {
  if (!isInTable(state)) return '';
  const rect = selectedRect(state);
  const node = cellGrid(rect.table).nodeAt({ row: rect.top, col: rect.left });
  const formula = node?.attrs.formula;
  return typeof formula === 'string' && formula ? `=${formula}` : '';
}
