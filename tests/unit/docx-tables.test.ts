// DOCX import of tables: grid, content controls and the table style a cell bakes in.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { importDocx } from '../../src/lib/import/docx';
import { buildDocx } from '../../src/lib/export/docx';
import { docxOf, blocksOf } from '../docxFixture';

type N = any;

const tc = (t: string, tcPr = '') => `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ''}<w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
const text = (c: N) => c.content[0].content?.[0]?.text ?? '';
const tables = (bytes: Uint8Array): N[] => ((importDocx(bytes).content as N).content as N[]).filter((n) => n.type === 'table');
const cellsOf = (bytes: Uint8Array): N[][] => tables(bytes)[0].content.map((row: N) => row.content);
const marksOf = (cell: N): N[] => cell.content[0].content[0].marks ?? [];
const MARGINS = { top: 2, bottom: 2, left: 2, right: 2 };

describe('the table grid', () => {
  // Grid columns a row leaves without a cell (w:gridBefore/w:gridAfter) draw nothing, and
  // the row's first and last cell take the table's outer sides, not its inside line.
  it('keeps the grid rectangular with borderless empty cells where a row skips columns', () => {
    const rows = tables(docxOf(`<w:tbl><w:tblPr><w:tblBorders><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>
      <w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>
      <w:tr>${tc('a')}${tc('b')}${tc('c')}</w:tr>
      <w:tr><w:trPr><w:gridAfter w:val="1"/></w:trPr>${tc('d')}${tc('e')}</w:tr>
      <w:tr><w:trPr><w:gridBefore w:val="2"/></w:trPr>${tc('f')}</w:tr></w:tbl>`))[0].content;
    expect(rows[1].content.map(text)).toEqual(['d', 'e', '']);
    expect(rows[2].content.map(text)).toEqual(['', 'f']);
    expect(rows[2].content[0].attrs.colspan).toBe(2);
    for (const c of [rows[1].content[2], rows[2].content[0]])
      for (const side of ['borderTop', 'borderBottom', 'borderLeft', 'borderRight']) expect(c.attrs[side]).toBe('none');
    expect([rows[1].content[1].attrs.borderRight, rows[2].content[1].attrs.borderLeft]).toEqual(['none', 'none']);
    expect(rows[0].content[1].attrs.borderRight).toBeUndefined();
  });

  it('keeps the cells a content control wraps, around a cell or a whole row', () => {
    const sdt = (inner: string) => `<w:sdt><w:sdtPr><w:text/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
    const [table] = tables(docxOf(`<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>
      <w:tr>${tc('Type:')}${sdt(tc('value'))}</w:tr>${sdt(`<w:tr>${tc('row')}${tc('control')}</w:tr>`)}</w:tbl><w:p/>`));
    expect(table.content.map((r: N) => r.content.map(text))).toEqual([['Type:', 'value'], ['row', 'control']]);
  });

  // A cell's paragraphs carry no style name, so their style chain is baked in.
  it("centres a cell paragraph whose style centres it", () => {
    const [table] = tables(docxOf(`<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p><w:pPr><w:pStyle w:val="Centred"/></w:pPr><w:r><w:t>caption</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`, {
      styles: '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
        + '<w:style w:type="paragraph" w:styleId="Centred"><w:name w:val="Centred"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr></w:style>',
    }));
    expect(table.content[0].content[0].content[0].attrs?.textAlign).toBe('center');
  });
});

// A row band's own top/bottom close every band row; where it declares neither, its
// insideH rules the edges inside the banded region.
describe('a row band in a table style', () => {
  const B = (side: string) => `<w:${side} w:val="single" w:sz="12" w:space="0" w:color="000000"/>`;
  const STYLES: Record<string, string> = {
    own: `<w:tblPr><w:tblBorders>${B('top')}${B('bottom')}</w:tblBorders></w:tblPr><w:tblStylePr w:type="band1Horz"><w:tcPr><w:tcBorders>${B('top')}${B('bottom')}<w:insideH w:val="nil"/></w:tcBorders></w:tcPr></w:tblStylePr>`,
    inside: `<w:tblPr><w:tblBorders>${B('top')}${B('bottom')}${B('insideH')}</w:tblBorders></w:tblPr><w:tblStylePr w:type="band1Horz"><w:tcPr><w:tcBorders><w:insideH w:val="nil"/></w:tcBorders></w:tcPr></w:tblStylePr><w:tblStylePr w:type="band2Horz"><w:tcPr><w:tcBorders><w:insideH w:val="nil"/></w:tcBorders></w:tcPr></w:tblStylePr>`,
  };
  const tbl = (id: string) => `<w:tbl><w:tblPr><w:tblStyle w:val="${id}"/><w:tblLook w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>`
    + Array.from({ length: 4 }, (_, i) => `<w:tr>${tc(`r${i}`)}</w:tr>`).join('') + '</w:tbl><w:p/>';
  // Per row boundary: whether it draws a line, from either cell's side.
  const edges = (table: N) => {
    const sides = table.content.map((r: N) => r.content[0].attrs);
    const line = (v: unknown) => typeof v === 'string' && v !== 'none';
    return sides.slice(0, -1).map((a: N, i: number) => line(a.borderBottom) || line(sides[i + 1].borderTop));
  };
  const [own, inside] = tables(docxOf(tbl('own') + tbl('inside'), {
    styles: Object.entries(STYLES).map(([k, v]) => `<w:style w:type="table" w:styleId="${k}"><w:name w:val="${k}"/>${v}</w:style>`).join(''),
  }));
  it('closes every band row with its own top and bottom', () => {
    expect(edges(own)).toEqual([true, true, true]);
  });
  it('rules nothing inside where it declares insideH nil and no edges', () => {
    expect(edges(inside)).toEqual([false, false, false]);
  });
});

// Table styles paint their conditional areas (w:tblStylePr). The definition is not in the
// editor's registry, so import bakes it into the cells; a re-export carries the bake.
describe('a table style paints its conditional areas', () => {
  const BLUE = 'single" w:sz="8" w:color="4F81BD';
  const STYLES = `<w:style w:type="table" w:default="1" w:styleId="NormalTable"><w:name w:val="Normal Table"/></w:style>
    <w:style w:type="table" w:styleId="Banded"><w:name w:val="Banded Accent"/><w:basedOn w:val="NormalTable"/>
      <w:tblPr><w:tblStyleRowBandSize w:val="1"/><w:tblBorders>
        <w:top w:val="${BLUE}"/><w:left w:val="${BLUE}"/><w:bottom w:val="${BLUE}"/>
        <w:right w:val="${BLUE}"/><w:insideH w:val="${BLUE}"/><w:insideV w:val="${BLUE}"/>
      </w:tblBorders></w:tblPr>
      <w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr>
        <w:tcPr><w:tcBorders><w:bottom w:val="single" w:sz="18" w:color="4F81BD"/><w:insideV w:val="nil"/></w:tcBorders>
          <w:shd w:val="clear" w:color="auto" w:fill="4F81BD"/></w:tcPr></w:tblStylePr>
      <w:tblStylePr w:type="band1Horz"><w:tcPr><w:tcBorders><w:insideH w:val="nil"/></w:tcBorders>
          <w:shd w:val="clear" w:color="auto" w:fill="D3DFEE"/></w:tcPr></w:tblStylePr>
      <w:tblStylePr w:type="firstCol"><w:rPr><w:b/></w:rPr></w:tblStylePr>
    </w:style>`;
  const LOOK = '<w:tblLook w:firstRow="1" w:firstColumn="1" w:noHBand="0" w:noVBand="1"/>';
  const head = (look: string) => `<w:tbl><w:tblPr><w:tblStyle w:val="Banded"/>${look}</w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>`;
  // 4 rows × 2 columns: header row, first column, row bands.
  const table = (look = LOOK) => head(look) + [0, 1, 2, 3].map((r) => `<w:tr>${tc(`r${r}c0`)}${tc(`r${r}c1`)}</w:tr>`).join('') + '</w:tbl>';
  // The same grid with its first column merged from the first body row down to the last.
  const mergedTable = () => head(LOOK) + [0, 1, 2, 3].map((r) =>
    `<w:tr>${r === 0 ? tc('h') : tc('m', r === 1 ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>')}${tc(`r${r}`)}</w:tr>`).join('') + '</w:tbl>';
  const docxWith = (body: string) => docxOf(body, { styles: STYLES });
  const rows = cellsOf(docxWith(table()));

  it('shades the header row and bands from the first body row', () => {
    expect(rows.map((r) => r[0].attrs.backgroundColor)).toEqual(['#4F81BD', '#D3DFEE', undefined, '#D3DFEE']);
  });
  it('bakes the area’s run properties onto the cell’s text', () => {
    expect(marksOf(rows[0][1])).toEqual([{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#FFFFFF' } }]);
    expect(marksOf(rows[1][0])).toEqual([{ type: 'bold' }]); // first column
    expect(marksOf(rows[1][1])).toEqual([]);
  });
  it('takes an area’s outer side at its edge and its inside line within it', () => {
    expect(rows[0][0].attrs.borderBottom).toBe('2.25pt solid #4F81BD'); // rule under the header
    expect(rows[0][0].attrs.borderRight).toBe('none'); // firstRow insideV nil
    // Only band1 declares insideH, and only a boundary inside the banded region takes it.
    expect(rows[3][0].attrs.borderTop).toBe('none');
    expect(rows[2][0].attrs.borderTop).toBe('1pt solid #4F81BD');
    expect(rows[3][0].attrs.borderBottom).toBe('1pt solid #4F81BD'); // the table's own edge
  });
  it('gives a merged cell the edges of every row it covers', () => {
    const merged = cellsOf(docxWith(mergedTable()));
    expect(merged[1][0].attrs.rowspan).toBe(3);
    expect(merged[1][0].attrs.borderBottom).toBe('1pt solid #4F81BD');
  });
  it('paints nothing the table’s look switches off', () => {
    const off = cellsOf(docxWith(table('<w:tblLook w:firstRow="0" w:firstColumn="0" w:noHBand="1" w:noVBand="1"/>')));
    expect(off[0][0].attrs.backgroundColor).toBeUndefined();
    expect(off[1][0].attrs.backgroundColor).toBeUndefined();
    expect(marksOf(off[1][0])).toEqual([]);
  });
  it('reads the older w:val bitmask where the named flags are absent', () => {
    const hex = cellsOf(docxWith(table('<w:tblLook w:val="04A0"/>')));
    expect(hex[0][0].attrs.backgroundColor).toBe('#4F81BD');
    expect(hex[1][0].attrs.backgroundColor).toBe('#D3DFEE');
  });
  it('carries the bake back out, since the exported style has no areas', async () => {
    const doc = { type: 'doc', content: [{ type: 'table', content: blocksOf(table(), { styles: STYLES })[0].content }] };
    const bytes = await buildDocx(doc as N, MARGINS);
    expect(strFromU8(unzipSync(bytes)['word/document.xml'])).not.toContain('tblStylePr');
    const again = cellsOf(bytes);
    expect(again[0][0].attrs.backgroundColor).toBe('#4F81BD');
    expect(again[2][0].attrs.backgroundColor).toBeUndefined();
    expect(marksOf(again[1][0])).toEqual([{ type: 'bold' }]);
  });
});

// docDefaults ← the table style's w:pPr ← the paragraph style's chain ← direct w:pPr:
// a table style zeroing the space after does not take it off a Normal that declares one,
// but its line spacing does beat docDefaults'.
describe('a table style’s w:pPr ranks under the paragraph style', () => {
  const spacedTable = (cellPPr = '') => docxOf(
    `<w:tbl><w:tblPr><w:tblStyle w:val="Tight"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p>${cellPPr}<w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
    { styles: `<w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:after="200" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
      <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="160"/></w:pPr></w:style>
      <w:style w:type="table" w:styleId="Tight"><w:name w:val="Tight"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>` });
  const attrsOf = (bytes: Uint8Array) => cellsOf(bytes)[0][0].content[0].attrs;

  it('keeps the paragraph style’s space after and takes the table style’s line', () => {
    expect(attrsOf(spacedTable())).toMatchObject({ spaceAfter: 8, lineHeight: '1' });
  });
  it('lets direct w:pPr beat both', () => {
    expect(attrsOf(spacedTable('<w:pPr><w:spacing w:after="480" w:line="480" w:lineRule="auto"/></w:pPr>'))).toMatchObject({ spaceAfter: 24, lineHeight: '2' });
  });
  it('round-trips the baked values', async () => {
    const bytes = await buildDocx({ type: 'doc', content: (importDocx(spacedTable()).content as N).content } as N, MARGINS);
    // The export's default line height is single again, so the re-import drops the baked
    // '1' as default-equal; the non-default space after stays.
    const attrs = attrsOf(bytes);
    expect(attrs).toMatchObject({ spaceAfter: 8 });
    expect(attrs.lineHeight).toBeUndefined();
  });
});

// A table draws only what something declares: its own w:tblBorders, else its table
// style's chain. Nothing anywhere (Normal Table) is no border; on-screen gridlines are
// not printed.
describe('table borders', () => {
  const ALL = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:color="auto"/>`).join('');
  const sides = (styleId: string | null, ownBorders = '') => {
    const [table] = tables(docxOf(`<w:tbl><w:tblPr>${styleId ? `<w:tblStyle w:val="${styleId}"/>` : ''}${ownBorders}</w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr>${tc('x')}</w:tr></w:tbl>`, {
      styles: `<w:style w:type="table" w:default="1" w:styleId="NormalTable"><w:name w:val="Normal Table"/></w:style>
        <w:style w:type="table" w:styleId="Formula"><w:name w:val="Formel-tab"/><w:basedOn w:val="NormalTable"/><w:tblPr/></w:style>
        <w:style w:type="table" w:styleId="Grid"><w:name w:val="Table Grid"/><w:basedOn w:val="NormalTable"/><w:tblPr><w:tblBorders>${ALL}</w:tblBorders></w:tblPr></w:style>
        <w:style w:type="table" w:styleId="Thick"><w:name w:val="Thick"/><w:basedOn w:val="Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="24" w:color="FF0000"/></w:tblBorders></w:tblPr></w:style>`,
    }));
    const attrs = table.content[0].content[0].attrs;
    return ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'].map((s) => attrs[s] ?? null);
  };
  const NONE = ['none', 'none', 'none', 'none'];
  it.each([
    ['draws nothing when no style in the chain declares one', 'Formula', '', NONE],
    ['draws nothing without a table style', null, '', NONE],
    ["takes the table style's borders, the editor default left off the attrs", 'Grid', '', [null, null, null, null]],
    ['lets a leaf style override one side and inherit the rest', 'Thick', '', ['3pt solid #FF0000', null, null, null]],
    ['lets the table’s own w:tblBorders win over its style', 'Grid', '<w:tblBorders><w:top w:val="nil"/></w:tblBorders>', ['none', null, null, null]],
  ])('%s', (_name, style, own, want) => {
    expect(sides(style, own)).toEqual(want);
  });
});
