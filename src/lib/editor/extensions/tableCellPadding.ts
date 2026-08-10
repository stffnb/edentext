import { Extension } from '@tiptap/core';

// Cell margins in cm, [top, right, bottom, left] — Word's w:tblCellMar (or w:tcMar on
// the cell), ODF's fo:padding on the cell style. `null` = inherit, which for a table is
// the default below (Word's own, and editor.css's fallback) and for a cell its table's.
export type CellPadding = [number, number, number, number];
export const DEFAULT_CELL_PADDING: CellPadding = [0, 0.19, 0, 0.19];

const round3 = (n: number) => Math.round(n * 1000) / 1000;
// Word's 108 twips are 0.1905cm and LibreOffice writes 0.19cm back as 0.191, so a
// side this close to the default is the default — otherwise every table carries one.
const SAME_CM = 0.005;

// Clamped, rounded, and collapsed to null when every side matches the baseline it would
// override: the table's for a cell (which inherits it), the default for a table.
export function cellPaddingAttr(
  sides: (number | null | undefined)[],
  base: CellPadding = DEFAULT_CELL_PADDING,
): CellPadding | null {
  const p = base.map((d, i) => {
    const v = sides[i];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return d;
    return Math.abs(v - d) <= SAME_CM ? d : round3(Math.min(v, 5));
  }) as CellPadding;
  return p.every((v, i) => v === base[i]) ? null : p;
}

export function parseCellPadding(value: unknown): CellPadding | null {
  if (Array.isArray(value) && value.length === 4) return cellPaddingAttr(value as number[]);
  if (typeof value !== 'string') return null;
  const nums = value.trim().split(/\s+/).map((s) => parseFloat(s));
  return nums.length === 4 && nums.every((n) => Number.isFinite(n)) ? cellPaddingAttr(nums) : null;
}

// One custom property per side; editor.css reads them with the default as their
// fallback, so nothing to write for an ordinary table. Per side rather than one
// shorthand because the bottom one is what the border overshoot comes off (editor.css).
export const CELL_PAD_VARS = ['--cell-pad-t', '--cell-pad-r', '--cell-pad-b', '--cell-pad-l'];

export function cellPaddingStyle(value: unknown): string | null {
  const p = parseCellPadding(value);
  return p ? CELL_PAD_VARS.map((v, i) => `${v}:${p[i]}cm`).join(';') : null;
}

export const TableCellPadding = Extension.create({
  name: 'tableCellPadding',

  addGlobalAttributes() {
    return [
      {
        // On a cell it is the cell's own margin (Word w:tcMar), overriding the table's:
        // the custom property inherits, so the cell's own declaration wins for its td.
        types: ['table', 'tableCell', 'tableHeader'],
        attributes: {
          cellPadding: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              parseCellPadding(CELL_PAD_VARS.map((v) => element.style.getPropertyValue(v)).join(' ')),
            renderHTML: (attributes: Record<string, unknown>) => {
              const style = cellPaddingStyle(attributes.cellPadding);
              return style ? { style } : {};
            },
          },
        },
      },
    ];
  },
});
