import { Extension } from '@tiptap/core';
import { HEADER_SHADE } from './tableHeaderRow';

// Cell shading: a `backgroundColor` attr on table cells, rendered as the cell's CSS
// background and round-tripped to ODF fo:background-color. Set via the built-in
// setCellAttribute, so it covers a whole CellSelection or just the cursor's cell.

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
              if (!bg) return {};
              // The header-row fill doubles as a marker: tag the cell so CSS can render
              // its text bold (presentational, covers typed/pasted text). See tableHeaderRow.
              const cls = bg === HEADER_SHADE ? { class: 'cell-header' } : {};
              return { style: `background-color: ${bg}`, ...cls };
            },
          },
        },
      },
    ];
  },
});
