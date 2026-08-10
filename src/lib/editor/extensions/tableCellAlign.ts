import { Extension } from '@tiptap/core';

// Where a cell's content sits in its box: a `verticalAlign` attr on table cells,
// rendered as the cell's CSS vertical-align. null = top, which is what both
// LibreOffice (style:vertical-align="top") and Word (no w:vAlign) default to.

export type CellVerticalAlign = 'middle' | 'bottom';

export const TableCellAlign = Extension.create({
  name: 'tableCellAlign',

  addGlobalAttributes() {
    return [
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          verticalAlign: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const v = element.style.verticalAlign;
              return v === 'middle' || v === 'bottom' ? v : null;
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const v = attributes.verticalAlign;
              return v === 'middle' || v === 'bottom' ? { style: `vertical-align: ${v}` } : {};
            },
          },
        },
      },
    ];
  },
});
