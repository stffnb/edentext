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
import { HEADER_SHADE, TableHeaderRow, isHeaderStyled } from '../../src/lib/editor/extensions/tableHeaderRow';
import {
  DEFAULT_TABLE_LOOK, TABLE_REGIONS, builtinTableStyles, parseTableLook, previewCellCss,
  previewTextCss, resolveTableCell, styleLook, tableLookAttr,
  type TableLook, type TableRegion, type TableStyle as TableStyleDef,
} from '../../src/lib/styles/tableStyles';

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

const ALL_ON: TableLook = {
  headerRow: true, lastRow: true, firstColumn: true,
  lastColumn: true, bandedRow: true, bandedColumn: true,
};

const at = (style: TableStyleDef, row: number, col: number, rows = 4, cols = 2, look = ALL_ON) =>
  resolveTableCell(style, { row, col, rows, cols }, look);

describe('resolveTableCell', () => {
  it('layers overlapping regions in Word precedence order', () => {
    const corner = at(banded, 0, 0);
    expect(corner.regions).toEqual(['firstColumn', 'headerRow']);
    // Both contribute: the header's bold and the first column's italic.
    expect(corner.text).toEqual({ italic: true, bold: true });
    expect(corner.fill).toBe('#EEEEEE');
  });

  it('starts the stripes at the first body row, past a header row', () => {
    expect(at(banded, 1, 1).fill).toBe('#FAFAFA'); // first body row
    expect(at(banded, 2, 1).fill).toBe(null);
    expect(at(banded, 3, 1).fill).toBe('#FAFAFA');

    // Without a header region the body starts at row 0, and so do the stripes.
    const noHeader: TableStyleDef = { ...banded, regions: { bandedRow: { fill: '#FAFAFA' } } };
    expect(at(noHeader, 0, 0).fill).toBe('#FAFAFA');
    expect(at(noHeader, 1, 0).fill).toBe(null);
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
      TableCellBackground, TableCellBorders, TableHeaderRow,
      TableStyle.configure({ styles: () => styles }),
    ],
    content: { type: 'doc', content: [{ type: 'table', content }] },
  });
}

const table = (editor: Editor): N => editor.getJSON().content![0];
const fills = (editor: Editor): (string | null)[] =>
  table(editor).content.map((r: N) => r.content[0].attrs.backgroundColor ?? null);

describe('table style options (Word\'s tblLook)', () => {
  it('only paints a region the table opts into', () => {
    const off: TableLook = { ...ALL_ON, headerRow: false };
    expect(at(banded, 0, 1).fill).toBe('#EEEEEE');
    // The header's own fill is gone; row 0 is the body's first stripe now.
    expect(at(banded, 0, 1, 4, 2, off).fill).toBe('#FAFAFA');
    // The header's rule goes with it, from both sides of that grid line.
    expect(at(banded, 0, 0, 4, 2, off).borders.borderBottom).toBe('none');
    expect(at(banded, 1, 0, 4, 2, off).borders.borderTop).toBe('none');
  });

  it('shifts the banding when the header row is switched off', () => {
    const off: TableLook = { ...ALL_ON, headerRow: false };
    // Header on: row 0 is the header, so the first stripe is row 1.
    expect([0, 1, 2, 3].map(r => at(banded, r, 1).fill)).toEqual([
      '#EEEEEE', '#FAFAFA', null, '#FAFAFA',
    ]);
    // Header off: the body starts at row 0, so the stripes move up one row.
    expect([0, 1, 2, 3].map(r => at(banded, r, 1, 4, 2, off).fill)).toEqual([
      '#FAFAFA', null, '#FAFAFA', null,
    ]);
  });

  it('drops the banding entirely when switched off', () => {
    const off: TableLook = { ...ALL_ON, bandedRow: false };
    expect([1, 2, 3].map(r => at(banded, r, 1, 4, 2, off).fill)).toEqual([null, null, null]);
    // The header still counts for the (now unused) body offset, and still paints.
    expect(at(banded, 0, 1, 4, 2, off).fill).toBe('#EEEEEE');
  });

  it('round-trips the look attr, defaulting to Word\'s', () => {
    expect(parseTableLook(null)).toEqual(DEFAULT_TABLE_LOOK);
    expect(parseTableLook('')).toEqual({
      headerRow: false, lastRow: false, firstColumn: false,
      lastColumn: false, bandedRow: false, bandedColumn: false,
    });
    const look = parseTableLook('headerRow bandedRow');
    expect(look.headerRow && look.bandedRow).toBe(true);
    expect(look.firstColumn || look.lastRow).toBe(false);
    expect(parseTableLook(tableLookAttr(ALL_ON))).toEqual(ALL_ON);
  });
});

describe('built-in styles', () => {
  it('has families that shade the emphasis areas, not only embolden them', () => {
    const sheet = builtinTableStyles();
    const shaded = Object.values(sheet).filter(
      st => ['firstColumn', 'lastColumn', 'lastRow'].every(r => st.regions[r as TableRegion]?.fill),
    );
    // The colourful families (box lists + the two accent tables) fill those areas, so
    // switching one on is as visible as the header row.
    expect(shaded.map(st => st.name)).toContain('Box List Blue');
    expect(shaded.length).toBeGreaterThanOrEqual(6);
    // …and the plain/rule-based ones deliberately stay text-only.
    expect(sheet['Academic'].regions.firstColumn?.fill).toBeUndefined();
    expect(sheet['Academic'].regions.firstColumn?.text?.bold).toBe(true);
  });

  it('renders no two built-ins identically', () => {
    // Each style is previewed the way it is applied: its own options over the default.
    // Giving every style all six areas once made the two list styles indistinguishable.
    const signature = (style: TableStyleDef) => {
      const look = styleLook(style, DEFAULT_TABLE_LOOK);
      const cells: string[] = [];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 4; c++) {
          cells.push(previewCellCss(style, r, c, 5, 4, look) + previewTextCss(style, r, c, 5, 4, look));
        }
      }
      return cells.join('|');
    };
    const seen = new Map<string, string>();
    for (const style of Object.values(builtinTableStyles())) {
      const sig = signature(style);
      expect(seen.get(sig), `${style.name} looks exactly like ${seen.get(sig)}`).toBeUndefined();
      seen.set(sig, style.name);
    }
  });

  it('gives every built-in all six areas, so no toggle is a no-op', () => {
    for (const style of Object.values(builtinTableStyles())) {
      for (const region of TABLE_REGIONS) {
        expect(style.regions[region], `${style.name} / ${region}`).toBeDefined();
      }
    }
  });
});

describe('preview tiles', () => {
  it('shows a bold-only region, which the fills alone cannot', () => {
    const bar = (r: number, c: number, look = ALL_ON) =>
      previewTextCss(banded, r, c, 4, 2, look);
    // The first column is emphasis-only: no fill, so the tile can only show it via
    // the text line's weight.
    const fill = (r: number, c: number) => /^background: [^;]*/.exec(previewCellCss(banded, r, c, 4, 2, ALL_ON))![0];
    expect(fill(1, 0)).toBe(fill(1, 1)); // identical cell background
    // The fixture's first column is italic-only, the header bold — both must show.
    expect(bar(1, 0)).toContain('skewX'); // first column: italic
    expect(bar(1, 1)).toContain('none');  // body: upright
    expect(bar(0, 1)).toContain('height: 2px'); // header row: bold
    expect(bar(1, 1)).toContain('height: 1px');

    // Switching the area off levels them out again.
    const off: TableLook = { ...ALL_ON, firstColumn: false };
    expect(bar(1, 0, off)).toBe(bar(1, 1, off));
  });
});

describe('header toggles and style options are one state', () => {
  it('drives the look on a styled table, the shading otherwise', () => {
    const editor = makeEditor(3);
    editor.commands.focus('start');

    // No style: the toolbar toggle paints the header fill, as before.
    editor.commands.toggleHeaderRowStyle();
    expect(isHeaderStyled(editor.state, 'row')).toBe(true);
    expect(table(editor).content[0].content[0].attrs.backgroundColor).toBe(HEADER_SHADE);
    editor.commands.toggleHeaderRowStyle();
    expect(isHeaderStyled(editor.state, 'row')).toBe(false);

    // With a style the same button flips the Table Style Option instead — so the
    // toolbar button and the gallery checkbox can never disagree.
    editor.commands.setTableStyle('Test Bands');
    expect(isHeaderStyled(editor.state, 'row')).toBe(true);
    editor.commands.toggleHeaderRowStyle();
    expect(parseTableLook(table(editor).attrs.tableLook).headerRow).toBe(false);
    expect(isHeaderStyled(editor.state, 'row')).toBe(false);
    expect(table(editor).content[0].content[0].attrs.backgroundColor).toBe('#FAFAFA');

    // And the other way round: setting the option updates the button's state.
    editor.commands.setTableLook('headerRow', true);
    expect(isHeaderStyled(editor.state, 'row')).toBe(true);
    editor.destroy();
  });

  it('maps the header-column button onto the first-column option', () => {
    const editor = makeEditor(3);
    editor.commands.focus('start');
    editor.commands.setTableStyle('Test Bands');
    expect(isHeaderStyled(editor.state, 'column')).toBe(true);
    editor.commands.toggleHeaderColumnStyle();
    expect(parseTableLook(table(editor).attrs.tableLook).firstColumn).toBe(false);
    expect(isHeaderStyled(editor.state, 'column')).toBe(false);
    editor.destroy();
  });
});

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
    expect(fills(editor)).toEqual(['#EEEEEE', '#FAFAFA', null]);

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
    expect(fills(editor)).toEqual(['#EEEEEE', '#FAFAFA', null]);

    // Cursor is in the header row; a row added after it shifts every stripe below.
    editor.commands.addRowAfter();
    expect(fills(editor)).toEqual(['#EEEEEE', '#FAFAFA', null, '#FAFAFA']);
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
    expect(t.content[1].content[0].attrs.region).toBe('bandedRow firstColumn');
    // Its bottom is the boundary to the banded row below, its right the table edge.
    expect(t.content[1].content[0].attrs.borderRight).toBe(null);
    editor.destroy();
  });

  it('repaints when an option is toggled', () => {
    const editor = makeEditor(4);
    editor.commands.focus('start');
    editor.commands.setTableStyle('Test Bands');
    expect(fills(editor)).toEqual(['#EEEEEE', '#FAFAFA', null, '#FAFAFA']);

    // Header row off: it loses its fill and the stripes move up a row.
    editor.commands.setTableLook('headerRow', false);
    expect(fills(editor)).toEqual(['#FAFAFA', null, '#FAFAFA', null]);
    expect(table(editor).content[0].content[0].attrs.region).toBe('bandedRow firstColumn');

    // And back again.
    editor.commands.setTableLook('headerRow', true);
    expect(fills(editor)).toEqual(['#EEEEEE', '#FAFAFA', null, '#FAFAFA']);
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
