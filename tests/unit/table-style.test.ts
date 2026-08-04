// Table styles: region resolution (precedence, banding, shared grid lines) and the
// command that materializes them into cell attrs, incl. re-banding after a row insert.
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import { Table, TableHeader, TableCell } from '@tiptap/extension-table';
import { ResizableTableRow } from '../../src/lib/editor/extensions/tableRow';
import { TableCellBackground } from '../../src/lib/editor/extensions/tableCellBackground';
import { TableCellBorders } from '../../src/lib/editor/extensions/tableCellBorders';
import { TableStyle } from '../../src/lib/editor/extensions/tableStyle';
import { resolveTableCell, type TableStyle as TableStyleDef } from '../../src/lib/styles/tableStyles';

type N = any;

const RULE = '1pt solid #000000';

const banded: TableStyleDef = {
  name: 'Test Bands',
  border: null,
  innerBorder: 'none',
  regions: {
    headerRow: { fill: '#EEEEEE', text: { bold: true }, borders: { bottom: RULE } },
    bandedRow: { fill: '#FAFAFA' },
    firstColumn: { text: { italic: true } },
  },
};
const styles = { [banded.name]: banded };

const at = (style: TableStyleDef, row: number, col: number, rows = 4, cols = 2) =>
  resolveTableCell(style, { row, col, rows, cols });

describe('resolveTableCell', () => {
  it('layers overlapping regions in Word precedence order', () => {
    const corner = at(banded, 0, 0);
    expect(corner.regions).toEqual(['firstColumn', 'headerRow']);
    // Both contribute: the header's bold and the first column's italic.
    expect(corner.text).toEqual({ italic: true, bold: true });
    expect(corner.fill).toBe('#EEEEEE');
  });

  it('counts banding over body rows, so a header row does not shift the stripes', () => {
    expect(at(banded, 1, 1).fill).toBe(null); // first body row
    expect(at(banded, 2, 1).fill).toBe('#FAFAFA');
    expect(at(banded, 3, 1).fill).toBe(null);

    // Without a header region the stripes start one row higher.
    const noHeader: TableStyleDef = { ...banded, regions: { bandedRow: { fill: '#FAFAFA' } } };
    expect(at(noHeader, 0, 0).fill).toBe(null);
    expect(at(noHeader, 1, 0).fill).toBe('#FAFAFA');
  });

  it('gives both cells of a grid line the same border', () => {
    // The rule under the header row, seen from above and from below.
    expect(at(banded, 0, 0).borders.borderBottom).toBe(RULE);
    expect(at(banded, 1, 0).borders.borderTop).toBe(RULE);
    // Outer edges take `border`, inner lines `innerBorder`.
    expect(at(banded, 0, 0).borders.borderTop).toBe(null);
    expect(at(banded, 0, 0).borders.borderRight).toBe('none');
    expect(at(banded, 0, 1).borders.borderLeft).toBe('none');
    expect(at(banded, 0, 1).borders.borderRight).toBe(null);
  });
});

const cell = (text: string): N => ({
  type: 'tableCell',
  attrs: { colspan: 1, rowspan: 1, colwidth: null },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const row = (...cells: N[]): N => ({ type: 'tableRow', content: cells });

function makeEditor(rows = 3) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const content = Array.from({ length: rows }, (_, r) => row(cell(`a${r}`), cell(`b${r}`)));
  return new Editor({
    element: el,
    extensions: [
      Document, Paragraph, Text, Bold,
      Table.configure({ resizable: false }), ResizableTableRow, TableHeader, TableCell,
      TableCellBackground, TableCellBorders,
      TableStyle.configure({ styles: () => styles }),
    ],
    content: { type: 'doc', content: [{ type: 'table', content }] },
  });
}

const table = (editor: Editor): N => editor.getJSON().content![0];
const fills = (editor: Editor): (string | null)[] =>
  table(editor).content.map((r: N) => r.content[0].attrs.backgroundColor ?? null);

describe('setTableStyle', () => {
  it('materializes fill, borders and regions, and is idempotent', () => {
    const editor = makeEditor();
    editor.commands.focus('start');
    editor.commands.setTableStyle('Test Bands');

    const t = table(editor);
    expect(t.attrs.tableStyle).toBe('Test Bands');
    expect(t.content[0].content[0].attrs.backgroundColor).toBe('#EEEEEE');
    expect(t.content[0].content[0].attrs.region).toBe('firstColumn headerRow');
    expect(t.content[0].content[1].attrs.region).toBe('headerRow');
    expect(t.content[0].content[0].attrs.borderBottom).toBe(RULE);
    expect(t.content[1].content[0].attrs.borderTop).toBe(RULE);
    expect(fills(editor)).toEqual(['#EEEEEE', null, '#FAFAFA']);

    // Applying again changes nothing — the re-band plugin depends on this.
    const before = JSON.stringify(editor.getJSON());
    editor.commands.setTableStyle('Test Bands');
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    editor.destroy();
  });

  it('re-bands when a row is inserted', () => {
    const editor = makeEditor();
    editor.commands.focus('start');
    editor.commands.setTableStyle('Test Bands');
    expect(fills(editor)).toEqual(['#EEEEEE', null, '#FAFAFA']);

    // Cursor is in the header row; a row added after it shifts every stripe below.
    editor.commands.addRowAfter();
    expect(fills(editor)).toEqual(['#EEEEEE', null, '#FAFAFA', null]);
    editor.destroy();
  });

  it('clears the style-owned attrs again', () => {
    const editor = makeEditor();
    editor.commands.focus('start');
    editor.commands.setTableStyle('Test Bands');
    editor.commands.setTableStyle(null);

    const t = table(editor);
    expect(t.attrs.tableStyle).toBe(null);
    for (const r of t.content) {
      for (const c of r.content) {
        expect(c.attrs.backgroundColor).toBe(null);
        expect(c.attrs.region).toBe(null);
        expect(c.attrs.borderTop).toBe(null);
      }
    }
    editor.destroy();
  });

  it('re-derives the regions of an imported table from the name alone', () => {
    // An imported file carries the style name and the baked fill, but no region attrs
    // (ODF/DOCX have no such concept) — refreshTableStyles restores them on load.
    const el = document.createElement('div');
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      extensions: [
        Document, Paragraph, Text, Bold,
        Table.configure({ resizable: false }), ResizableTableRow, TableHeader, TableCell,
        TableCellBackground, TableCellBorders,
        TableStyle.configure({ styles: () => styles }),
      ],
      content: {
        type: 'doc',
        content: [{
          type: 'table',
          attrs: { tableStyle: 'Test Bands' },
          content: [row(cell('H'), cell('H2')), row(cell('a'), cell('b'))],
        }],
      },
    });
    expect(table(editor).content[0].content[0].attrs.region).toBe(null);

    editor.commands.refreshTableStyles();
    expect(table(editor).content[0].content[0].attrs.region).toBe('firstColumn headerRow');
    expect(table(editor).content[0].content[0].attrs.backgroundColor).toBe('#EEEEEE');
    editor.destroy();
  });

  it('places a merged cell by its top-left grid position', () => {
    const editor = makeEditor();
    editor.commands.focus('start');
    // Merge the two cells of the second row, then style: the merged cell is row 1.
    const cells: number[] = [];
    editor.state.doc.descendants((n, pos) => { if (n.type.name === 'tableCell') cells.push(pos); });
    editor.commands.setCellSelection({ anchorCell: cells[2], headCell: cells[3] });
    editor.commands.mergeCells();
    editor.commands.setTableStyle('Test Bands');
    const t = table(editor);
    expect(t.content[1].content.length).toBe(1);
    expect(t.content[1].content[0].attrs.colspan).toBe(2);
    expect(t.content[1].content[0].attrs.region).toBe('firstColumn');
    // Its bottom is the boundary to the banded row below, its right the table edge.
    expect(t.content[1].content[0].attrs.borderRight).toBe(null);
    editor.destroy();
  });

  it('ignores an unknown style name', () => {
    const editor = makeEditor();
    editor.commands.focus('start');
    expect(editor.commands.setTableStyle('Nope')).toBe(false);
    expect(table(editor).attrs.tableStyle).toBe(null);
    editor.destroy();
  });
});
