import { Extension } from '@tiptap/core';

// Word/LibreOffice cell shading: a `backgroundColor` attr on table cells, rendered
// as the cell's CSS background and round-tripped to ODF fo:background-color
// (export/odt.ts exportTable, import/odt.ts convertTable). Set via the built-in
// setCellAttribute command (TableToolbar's ColorPicker). The default cell renderHTML
// emits no style, so this global attribute merges in cleanly.

export const TableCellBackground = Extension.create({
  name: 'tableCellBackground',

  addGlobalAttributes() {
    return [
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          backgroundColor: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.backgroundColor || null,
            renderHTML: (attributes: Record<string, unknown>) => {
              const bg = attributes.backgroundColor;
              return bg ? { style: `background-color: ${bg}` } : {};
            },
          },
        },
      },
    ];
  },
});
