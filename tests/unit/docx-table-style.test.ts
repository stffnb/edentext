// Word's table styles paint their conditional areas (w:tblStylePr) — header row, banded
// rows, first column. The definition is not in the editor's registry, so import bakes it
// into the cells; a re-export then carries the bake, not the areas.
import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { importDocx } from '../../src/lib/import/docx';
import { buildDocx } from '../../src/lib/export/docx';

type N = any;

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const BLUE = 'single" w:sz="8" w:color="4F81BD';

const STYLES = `<?xml version="1.0"?>
<w:styles xmlns:w="${W}">
  <w:style w:type="table" w:default="1" w:styleId="NormalTable"><w:name w:val="Normal Table"/></w:style>
  <w:style w:type="table" w:styleId="Banded"><w:name w:val="Banded Accent"/><w:basedOn w:val="NormalTable"/>
    <w:tblPr><w:tblStyleRowBandSize w:val="1"/><w:tblBorders>
      <w:top w:val="${BLUE}"/><w:left w:val="${BLUE}"/><w:bottom w:val="${BLUE}"/>
      <w:right w:val="${BLUE}"/><w:insideH w:val="${BLUE}"/><w:insideV w:val="${BLUE}"/>
    </w:tblBorders></w:tblPr>
    <w:tblStylePr w:type="firstRow">
      <w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr>
      <w:tcPr><w:tcBorders><w:bottom w:val="single" w:sz="18" w:color="4F81BD"/><w:insideV w:val="nil"/></w:tcBorders>
        <w:shd w:val="clear" w:color="auto" w:fill="4F81BD"/></w:tcPr>
    </w:tblStylePr>
    <w:tblStylePr w:type="band1Horz">
      <w:tcPr><w:tcBorders><w:insideH w:val="nil"/></w:tcBorders>
        <w:shd w:val="clear" w:color="auto" w:fill="D3DFEE"/></w:tcPr>
    </w:tblStylePr>
    <w:tblStylePr w:type="firstCol"><w:rPr><w:b/></w:rPr></w:tblStylePr>
  </w:style>
</w:styles>`;

// 4 rows × 2 columns under Word's default look: header row, first column, row bands.
const table = (look = '<w:tblLook w:firstRow="1" w:firstColumn="1" w:noHBand="0" w:noVBand="1"/>') =>
  `<w:tbl><w:tblPr><w:tblStyle w:val="Banded"/>${look}</w:tblPr>
   <w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>` +
  [0, 1, 2, 3].map((r) =>
    `<w:tr>${[0, 1].map((c) => `<w:tc><w:p><w:r><w:t>r${r}c${c}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`,
  ).join('') + '</w:tbl>';

// The same grid with its first column merged from the first body row down to the last.
const mergedTable = () =>
  `<w:tbl><w:tblPr><w:tblStyle w:val="Banded"/><w:tblLook w:firstRow="1" w:firstColumn="1" w:noHBand="0" w:noVBand="1"/></w:tblPr>
   <w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>` +
  [0, 1, 2, 3].map((r) => {
    const merge = r === 1 ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>';
    const first = r === 0 ? '<w:tc><w:p><w:r><w:t>h</w:t></w:r></w:p></w:tc>'
      : `<w:tc><w:tcPr>${merge}</w:tcPr><w:p><w:r><w:t>m</w:t></w:r></w:p></w:tc>`;
    return `<w:tr>${first}<w:tc><w:p><w:r><w:t>r${r}</w:t></w:r></w:p></w:tc></w:tr>`;
  }).join('') + '</w:tbl>';

const docxWith = (body: string) =>
  zipSync({
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`),
    'word/styles.xml': strToU8(STYLES),
  });

const cellsOf = (bytes: Uint8Array): N[][] => {
  const t = (importDocx(bytes).content.content as N[]).find((n: N) => n.type === 'table')!;
  return t.content.map((row: N) => row.content);
};
const marksOf = (cell: N): N[] => cell.content[0].content[0].marks ?? [];

describe('a Word table style paints its conditional areas', () => {
  const rows = cellsOf(docxWith(table()));

  it('shades the header row and bands from the first body row', () => {
    expect(rows[0][0].attrs.backgroundColor).toBe('#4F81BD');
    expect(rows[1][0].attrs.backgroundColor).toBe('#D3DFEE');
    expect(rows[2][0].attrs.backgroundColor).toBeUndefined();
    expect(rows[3][0].attrs.backgroundColor).toBe('#D3DFEE');
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
    expect(merged[1][0].attrs.borderBottom).toBe('1pt solid #4F81BD'); // the table's own edge
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
    const doc = { type: 'doc', content: [{ type: 'table', content: importDocx(docxWith(table())).content.content[0].content }] };
    const bytes = await buildDocx(doc as N, { top: 2, bottom: 2, left: 2, right: 2 });
    expect(strFromU8(unzipSync(bytes)['word/document.xml'])).not.toContain('tblStylePr');
    const again = cellsOf(bytes);
    expect(again[0][0].attrs.backgroundColor).toBe('#4F81BD');
    expect(again[2][0].attrs.backgroundColor).toBeUndefined();
    expect(marksOf(again[1][0])).toEqual([{ type: 'bold' }]);
  });
});

// docDefaults ← the table style's w:pPr ← the paragraph style's chain ← direct w:pPr.
// Probed against soffice: a table style zeroing the space after does not take it off a
// Normal that declares one, but its line spacing does beat docDefaults'.
const SPACING_STYLES = `<?xml version="1.0"?>
<w:styles xmlns:w="${W}">
  <w:docDefaults><w:pPrDefault><w:pPr>
    <w:spacing w:after="200" w:line="276" w:lineRule="auto"/>
  </w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>
    <w:pPr><w:spacing w:after="160"/></w:pPr></w:style>
  <w:style w:type="table" w:styleId="Tight"><w:name w:val="Tight"/>
    <w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>
</w:styles>`;

const spacedTable = (cellPPr = '') =>
  zipSync({
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>` +
      `<w:tbl><w:tblPr><w:tblStyle w:val="Tight"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>` +
      `<w:tr><w:tc><w:p>${cellPPr}<w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
      `</w:body></w:document>`),
    'word/styles.xml': strToU8(SPACING_STYLES),
  });

describe('a table style’s w:pPr ranks under the paragraph style', () => {
  const attrsOf = (bytes: Uint8Array) => cellsOf(bytes)[0][0].content[0].attrs;

  it('keeps the paragraph style’s space after and takes the table style’s line', () => {
    expect(attrsOf(spacedTable())).toMatchObject({ spaceAfter: 8, lineHeight: '1' });
  });

  it('lets direct w:pPr beat both', () => {
    const direct = spacedTable('<w:pPr><w:spacing w:after="480" w:line="480" w:lineRule="auto"/></w:pPr>');
    expect(attrsOf(direct)).toMatchObject({ spaceAfter: 24, lineHeight: '2' });
  });

  it('round-trips the baked values', async () => {
    const doc = { type: 'doc', content: importDocx(spacedTable()).content.content };
    const bytes = await buildDocx(doc as N, { top: 2, bottom: 2, left: 2, right: 2 });
    // Our own export's default line height is single again, so the re-import drops
    // the baked '1' as default-equal; the non-default space after stays.
    const attrs = attrsOf(bytes);
    expect(attrs).toMatchObject({ spaceAfter: 8 });
    expect(attrs.lineHeight).toBeUndefined();
  });
});
