// Table properties through ODF: alignment against the margins and rows kept together.
import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';
import { DEFAULT_MARGINS } from '../../src/lib/storage/pageMargins';
import { docxOf } from '../docxFixture';

type N = any;

// table:align="margins" is a table stretched between the text margins. Its style:width is
// the width the producing page had, so deriving a margin from it against ours would leave
// the table narrow.
describe('a table aligned to the margins', () => {
  const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
    + 'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
    + 'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';
  const attrsOf = (tableProps: string): Record<string, unknown> => (importOdt(zipSync({
    'styles.xml': strToU8(`<?xml version="1.0"?><office:document-styles ${NS}><office:styles><style:style style:name="Standard" style:family="paragraph"/></office:styles>
      <office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-left="3.6cm" fo:margin-right="2.7cm"/></style:page-layout></office:automatic-styles>
      <office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>`),
    'content.xml': strToU8(`<?xml version="1.0"?><office:document-content ${NS}><office:automatic-styles>
      <style:style style:name="T1" style:family="table"><style:table-properties ${tableProps}/></style:style></office:automatic-styles>
      <office:body><office:text><table:table table:name="T" table:style-name="T1"><table:table-column/>
      <table:table-row><table:table-cell><text:p text:style-name="Standard">a</text:p></table:table-cell></table:table-row></table:table></office:text></office:body></office:document-content>`),
  })).content as N).content?.[0]?.attrs ?? {};

  it.each([
    ['keeps the full text width whatever width the producer wrote', 'style:width="14.7cm" table:align="margins"', [undefined, undefined]],
    ['still honours the margins the file declares itself', 'style:width="12cm" table:align="margins" fo:margin-left="1.5cm"', [1.5, undefined]],
    ['leaves a centred table centred', 'style:width="10.7cm" table:align="center"', [2, 2]],
  ])('%s', (_name, props, want) => {
    const { marginLeft, marginRight } = attrsOf(props);
    expect([marginLeft, marginRight]).toEqual(want);
  });
});

// style:may-break-between-rows="false": the table moves whole rather than break.
describe('table keep-rows', () => {
  const cell = (text: string): N => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const roundTrip = async (attrs: N) => {
    const bytes = await buildOdt({ type: 'doc', content: [{ type: 'table', attrs, content: [0, 1].map((r) => ({ type: 'tableRow', content: [cell(`a${r}`), cell(`b${r}`)] })) }] } as N);
    return { xml: strFromU8(unzipSync(bytes)['content.xml']), keepRows: (importOdt(bytes).content as N).content?.[0]?.attrs?.keepRows ?? null };
  };
  it('round-trips style:may-break-between-rows', async () => {
    const { xml, keepRows } = await roundTrip({ keepRows: true });
    expect(xml).toContain('style:may-break-between-rows="false"');
    expect(keepRows).toBe(true);
  });
  it('leaves a table that may break without the attribute', async () => {
    const { xml, keepRows } = await roundTrip({});
    expect(xml).not.toContain('may-break-between-rows');
    expect(keepRows).toBe(null);
  });

  // fo:keep-with-next on the table; Word spells it as every paragraph in it kept.
  it('keeps a table with the next block through both formats', async () => {
    // One cell holds a list: its items keep with the next as well, or Word's reading drops the keep.
    const list = { ...cell('l'), content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'i' }] }] }] }] };
    const doc = { type: 'doc', content: [{ type: 'table', attrs: { keepNext: true }, content: [0, 1].map((r) => ({ type: 'tableRow', content: [cell(`a${r}`), r ? list : cell(`b${r}`)] })) }] } as N;
    const odt = await buildOdt(doc);
    expect(strFromU8(unzipSync(odt)['content.xml'])).toContain('fo:keep-with-next="always"');
    const keeps = (d: N) => d.content?.[0]?.attrs?.keepNext ?? null;
    expect(keeps(importOdt(odt).content)).toBe(true);
    expect(keeps(importDocx(await buildDocx(doc)).content)).toBe(true);
    expect(keeps(importDocx(await buildDocx({ ...doc, content: [{ ...doc.content[0], attrs: {} }] })).content)).toBe(null);
  });
});

// A cell's box properties — where its content sits (w:vAlign, style:vertical-align) and
// which way its text runs (w:textDirection, ODF writing-mode) — keep through both formats.
const cell = (text: string, attrs: Record<string, unknown> = {}): N => ({
  type: 'tableCell',
  attrs: { colspan: 1, rowspan: 1, colwidth: [120], ...attrs },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('table cell box properties', () => {
  const doc: N = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
      { type: 'table', content: [{ type: 'tableRow', attrs: { rowHeight: 80 }, content: [
        cell('A', { verticalAlign: 'middle', textFlow: 'btLr' }), cell('B', { verticalAlign: 'bottom', textFlow: 'tbRl' }), cell('C'),
      ] }] },
    ],
  };
  const props = (res: { content: N }) => (res.content.content!.find((n: N) => n.type === 'table') as N).content[0].content
    .map((c: N) => [c.attrs?.verticalAlign ?? null, c.attrs?.textFlow ?? null]);
  const expected = [['middle', 'btLr'], ['bottom', 'tbRl'], [null, null]];
  it('round-trips through DOCX', async () => {
    expect(props(importDocx(await buildDocx(doc, { top: 2, bottom: 2, left: 2, right: 2 }, 'portrait')))).toEqual(expected);
  });
  it('round-trips through ODT', async () => {
    expect(props(importOdt(await buildOdt(doc)))).toEqual(expected);
  });
});

// A row's own properties — may not break across pages (w:cantSplit, ODF's row
// fo:keep-together), an exact height (w:hRule="exact", ODF style:row-height) or a
// minimum one — keep through both formats.
const row = (trPr: string) => `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}<w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr>`;
const docx = docxOf(`<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>${row('<w:cantSplit/>')}${row('')}`
  + `${row('<w:trHeight w:val="284" w:hRule="exact"/>')}${row('<w:trHeight w:val="284"/>')}</w:tbl><w:p/>`);
const flags = (doc: any) => doc.content.find((n: any) => n.type === 'table').content
  .map((r: any) => [r.attrs?.cantSplit ?? false, r.attrs?.fixedHeight ?? false, r.attrs?.rowHeight ?? null]);
const expected = [[true, false, null], [false, false, null], [false, true, 18.93], [false, false, 18.93]];

describe("a row's own properties", () => {
  const imported = importDocx(docx);
  it('imports from w:trPr', () => expect(flags(imported.content)).toEqual(expected));
  it('survives a DOCX round trip', async () => {
    expect(flags(importDocx(await buildDocx(imported.content as any, DEFAULT_MARGINS, 'portrait')).content)).toEqual(expected);
  });
  it('survives an ODT round trip', async () => {
    expect(flags(importOdt(await buildOdt(imported.content as any, DEFAULT_MARGINS, 'portrait')).content)).toEqual(expected);
  });
});
