import { Extension } from '@tiptap/core';

// A table's cell margins in cm, [top, right, bottom, left] — Word's w:tblCellMar,
// ODF's fo:padding on the cell style. `null` = the default below, which is Word's
// own and what editor.css falls back to, so an ordinary table carries no attr.
export type CellPadding = [number, number, number, number];
export const DEFAULT_CELL_PADDING: CellPadding = [0, 0.19, 0, 0.19];

const round3 = (n: number) => Math.round(n * 1000) / 1000;
// Word's 108 twips are 0.1905cm and LibreOffice writes 0.19cm back as 0.191, so a
// side this close to the default is the default — otherwise every table carries one.
const SAME_CM = 0.005;

// Clamped, rounded, and collapsed to null when every side is the default.
export function cellPaddingAttr(sides: (number | null | undefined)[]): CellPadding | null {
  const p = DEFAULT_CELL_PADDING.map((d, i) => {
    const v = sides[i];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return d;
    return Math.abs(v - d) <= SAME_CM ? d : round3(Math.min(v, 5));
  }) as CellPadding;
  return p.every((v, i) => v === DEFAULT_CELL_PADDING[i]) ? null : p;
}

export function parseCellPadding(value: unknown): CellPadding | null {
  if (Array.isArray(value) && value.length === 4) return cellPaddingAttr(value as number[]);
  if (typeof value !== 'string') return null;
  const nums = value.trim().split(/\s+/).map((s) => parseFloat(s));
  return nums.length === 4 && nums.every((n) => Number.isFinite(n)) ? cellPaddingAttr(nums) : null;
}

// One custom property carrying the whole shorthand; editor.css reads it with the
// default as its fallback, so nothing to write for an ordinary table.
export function cellPaddingStyle(value: unknown): string | null {
  const p = parseCellPadding(value);
  return p ? `--cell-pad:${p.map((n) => `${n}cm`).join(' ')}` : null;
}

export const TableCellPadding = Extension.create({
  name: 'tableCellPadding',

  addGlobalAttributes() {
    return [
      {
        types: ['table'],
        attributes: {
          cellPadding: {
            default: null,
            parseHTML: (element: HTMLElement) => parseCellPadding(element.style.getPropertyValue('--cell-pad')),
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
