import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';

// ODF style:writing-mode="rl-tb" / Word w:bidi: a right-to-left page, whose columns
// fill from the right. The vertical modes (tb-rl) are deliberately not read.
const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';

function odt(mode: string): Uint8Array {
  const styles = `<?xml version="1.0"?><office:document-styles ${NS}><office:styles/>
   <office:automatic-styles>
    <style:page-layout style:name="pm1">
     <style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" ${mode}
      fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2cm" fo:margin-right="2cm"/>
    </style:page-layout>
   </office:automatic-styles>
   <office:master-styles>
    <style:master-page style:name="Standard" style:page-layout-name="pm1"/>
   </office:master-styles></office:document-styles>`;
  const content = `<?xml version="1.0"?><office:document-content ${NS}>
   <office:body><office:text><text:p>שלום</text:p></office:text></office:body></office:document-content>`;
  return zipSync({ 'content.xml': strToU8(content), 'styles.xml': strToU8(styles) });
}

const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'שלום' }] }] };
const margins = { top: 2, bottom: 2, left: 2, right: 2 };

describe('a right-to-left page', () => {
  it('reads style:writing-mode from the page layout', () => {
    expect(importOdt(odt('style:writing-mode="rl-tb"')).rtl).toBe(true);
    expect(importOdt(odt('')).rtl).toBe(false);
    expect(importOdt(odt('style:writing-mode="lr-tb"')).rtl).toBe(false);
  });

  it('round-trips through an ODF export', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait', undefined, null, 'A4', undefined, undefined, 'add', true);
    expect(strFromU8(unzipSync(bytes)['styles.xml'])).toContain('style:writing-mode="rl-tb"');
    expect(importOdt(bytes).rtl).toBe(true);
  });

  it('leaves a left-to-right export alone', async () => {
    const bytes = await buildOdt(doc, margins);
    expect(strFromU8(unzipSync(bytes)['styles.xml'])).not.toContain('rl-tb');
    expect(importOdt(bytes).rtl).toBe(false);
  });

  it('round-trips through a DOCX export as w:bidi', async () => {
    const bytes = await buildDocx(doc, margins, 'portrait', undefined, null, 'A4', undefined, undefined, undefined, true);
    expect(strFromU8(unzipSync(bytes)['word/document.xml'])).toContain('<w:bidi/>');
    expect(importDocx(bytes).rtl).toBe(true);
  });

  it('leaves a left-to-right DOCX export alone', async () => {
    const bytes = await buildDocx(doc, margins);
    expect(strFromU8(unzipSync(bytes)['word/document.xml'])).not.toContain('<w:bidi/>');
    expect(importDocx(bytes).rtl).toBe(false);
  });
});

// The model stores the edge the reader sees. An unset block sits at the edge its direction
// starts at, so that edge is suppressed on import and the other one kept.
describe('paragraph alignment and direction', () => {
  const P = (attrs: object) => ({ type: 'paragraph', attrs, content: [{ type: 'text', text: 'שלום' }] });
  const formats = {
    odt: async (d: any) => importOdt(await buildOdt(d)),
    docx: async (d: any) => importDocx(await buildDocx(d)),
  };
  const seen = (b: any) => `${b.attrs?.dir ?? 'page'}/${b.attrs?.textAlign ?? 'unset'}`;

  it.each(Object.keys(formats) as (keyof typeof formats)[])('round-trips every edge in both directions through %s', async (format) => {
    const aligns = [null, 'left', 'right', 'center', 'justify'];
    const blocks = ['rtl', null].flatMap((dir) => aligns.map((textAlign) => P({ ...(dir ? { dir } : {}), ...(textAlign ? { textAlign } : {}) })));
    const back = ((await formats[format]({ type: 'doc', content: blocks })).content as any).content;
    expect(back.map(seen)).toEqual([
      'rtl/unset', 'rtl/left', 'rtl/unset', 'rtl/center', 'rtl/justify',
      'page/unset', 'page/unset', 'page/right', 'page/center', 'page/justify',
    ]);
  });

  // The page's direction is the document's default (ODF default-style, DOCX docDefaults), so
  // a block following it carries nothing and one running against it keeps its own.
  it.each(Object.keys(formats) as (keyof typeof formats)[])('keeps the blocks of a right-to-left page free of formatting through %s', async (format) => {
    const aligns = [null, 'left', 'right', 'center', 'justify'];
    const blocks = (prefix: string) => [null, 'ltr'].flatMap((dir) => aligns.map((textAlign) =>
      ({ ...P({ ...(dir ? { dir } : {}), ...(textAlign ? { textAlign } : {}) }), content: [{ type: 'text', text: `${prefix}${dir ?? 'page'}${textAlign ?? ''}` }] })));
    const body = [
      ...blocks('p'),
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'h' }] },
      { type: 'bulletList', content: blocks('li').map((b) => ({ type: 'listItem', content: [b] })) },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: {}, content: blocks('c') }] }] },
      { type: 'paragraph', content: [{ type: 'textBox', attrs: { width: 240, height: 240 }, content: blocks('b') }] },
    ];
    const hf = { header: { type: 'doc', content: blocks('z') }, footer: null, pageCount: 1 } as any;
    const bytes = format === 'odt'
      ? await buildOdt({ type: 'doc', content: body } as any, margins, 'portrait', hf, null, 'A4', undefined, undefined, 'add', true)
      : await buildDocx({ type: 'doc', content: body } as any, margins, 'portrait', hf, null, 'A4', undefined, undefined, undefined, true);
    const files = unzipSync(bytes);
    expect(strFromU8(files[format === 'odt' ? 'styles.xml' : 'word/styles.xml']))
      .toMatch(format === 'odt' ? /<style:default-style style:family="paragraph">[^]*?rl-tb/ : /<w:pPrDefault>[^]*?<w:bidi\/>[^]*?<\/w:pPrDefault>/);
    const back = format === 'odt' ? importOdt(bytes) : importDocx(bytes);
    expect(back.rtl).toBe(true);
    const found: string[] = [];
    const walk = (n: any) => {
      if ((n.type === 'paragraph' || n.type === 'heading') && n.content?.[0]?.type === 'text') found.push(seen(n));
      (n.content ?? []).forEach(walk);
    };
    walk(back.content);
    walk(back.header);
    const group = ['page/unset', 'page/left', 'page/unset', 'page/center', 'page/justify', 'ltr/unset', 'ltr/unset', 'ltr/right', 'ltr/center', 'ltr/justify'];
    expect(found).toEqual([...group, 'page/unset', ...group, ...group, ...group, ...group]);
  });

  // Word takes a paragraph's direction from w:bidi on it, its style or the defaults, never
  // from the section. Files of this editor that name it on the section alone still read.
  it('reads a w:bidi section without w:bidi paragraphs by its producer', async () => {
    const doc = { type: 'doc', content: [P({}), P({ textAlign: 'left' }), P({ dir: 'ltr' })] } as any;
    const files = unzipSync(await buildDocx(doc, margins, 'portrait', undefined, null, 'A4', undefined, undefined, undefined, true));
    files['word/styles.xml'] = strToU8(strFromU8(files['word/styles.xml']).replace(/(<w:pPrDefault><w:pPr>)<w:bidi\/>/, '$1'));
    files['word/document.xml'] = strToU8(strFromU8(files['word/document.xml']).replace('<w:jc w:val="right"/>', '<w:jc w:val="left"/>'));
    const own = importDocx(zipSync(files));
    expect((own.content as any).content.map(seen)).toEqual(['page/unset', 'page/left', 'ltr/unset']);
    files['docProps/app.xml'] = strToU8(strFromU8(files['docProps/app.xml']).replace(/\/>\s*$/, '><Application>Microsoft Office Word</Application></Properties>'));
    const other = importDocx(zipSync(files));
    expect(other.rtl).toBe(true);
    expect((other.content as any).content.map(seen)).toEqual(['ltr/unset', 'ltr/unset', 'ltr/unset']);
  });

  // In a w:bidi paragraph Word reads left/start as the leading (right) edge and right/end
  // as the trailing (left) one; without w:bidi all four are physical.
  it('reads w:jc by the paragraph\'s own w:bidi', async () => {
    const files = unzipSync(await buildDocx({ type: 'doc', content: [P({})] } as any));
    const body = (ppr: string) => `<w:p><w:pPr>${ppr}</w:pPr><w:r><w:t>x</w:t></w:r></w:p>`;
    const cases: [string, string][] = [
      ['<w:bidi/><w:jc w:val="left"/>', 'rtl/unset'], ['<w:bidi/><w:jc w:val="start"/>', 'rtl/unset'],
      ['<w:bidi/><w:jc w:val="right"/>', 'rtl/left'], ['<w:bidi/><w:jc w:val="end"/>', 'rtl/left'],
      ['<w:bidi/><w:jc w:val="both"/>', 'rtl/justify'], ['<w:bidi/>', 'rtl/unset'],
      ['<w:jc w:val="end"/>', 'page/right'], ['<w:jc w:val="start"/>', 'page/unset'],
    ];
    files['word/document.xml'] = strToU8(strFromU8(files['word/document.xml'])
      .replace(/<w:p>.*?<\/w:p>|<w:p [^>]*>.*?<\/w:p>/, cases.map(([ppr]) => body(ppr)).join('')));
    const back = (importDocx(zipSync(files)).content as any).content;
    expect(back.map(seen)).toEqual(cases.map(([, want]) => want));
  });

  // fo:text-align start/end follow the direction. LibreOffice before 26.2 and this editor's
  // earlier builds wrote the physical left and right under those names.
  it('reads fo:text-align start/end by direction, or by an older producer as physical', async () => {
    const files = unzipSync(await buildOdt({ type: 'doc', content: [P({ dir: 'rtl', textAlign: 'left' })] } as any));
    const read = (align: string, generator: string) => {
      const out = { ...files };
      out['content.xml'] = strToU8(strFromU8(files['content.xml']).replace(/fo:text-align="left"/g, `fo:text-align="${align}"`));
      out['meta.xml'] = strToU8(strFromU8(files['meta.xml']).replace(/<meta:generator>[^<]*/, `<meta:generator>${generator}`));
      return seen((importOdt(zipSync(out)).content as any).content[0]);
    };
    expect(strFromU8(files['content.xml'])).toContain('fo:text-align="left"');
    for (const logical of ['LibreOffice/26.2.3.2$MacOSX', 'Other Writer 1.0']) {
      expect(read('end', logical)).toBe('rtl/left');
      expect(read('start', logical)).toBe('rtl/unset');
    }
    for (const physical of ['LibreOffice/7.6.4.1$Linux_X86_64', 'EdenText']) {
      expect(read('end', physical)).toBe('rtl/unset');
      expect(read('start', physical)).toBe('rtl/left');
    }
  });
  // A table's columns run the page's way unless it has a `dir` of its own. A cell's left
  // faces the column before it: w:left in a w:bidiVisual table, the drawn right in ODF.
  describe('a table', () => {
    const cell = (text: string, attrs: Record<string, unknown> = {}) =>
      ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, ...attrs }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
    const table = (dir: string | null) => ({ type: 'doc', content: [{
      type: 'table', attrs: { marginLeft: 1, marginRight: 2, cellPadding: [0, 0.1, 0, 0.5], ...(dir ? { dir } : {}) },
      content: [
        { type: 'tableRow', content: [
          cell('A1', { colwidth: [1000], borderLeft: '3pt solid #FF0000' }), cell('B1', { colwidth: [2000] }),
          cell('C1', { colwidth: [3000], borderRight: '2pt solid #0000FF', cellPadding: [0, 0.8, 0, 0.3] })] },
        { type: 'tableRow', content: [cell('A2', { colspan: 2, colwidth: [1000, 2000] }), cell('C2', { colwidth: [3000] })] },
      ],
    }, { type: 'paragraph' }] }) as any;
    const shape = (doc: any) => {
      const t = doc.content.find((n: any) => n.type === 'table');
      const cells = t.content.flatMap((r: any) => r.content);
      const width = (c: any) => c.attrs.colwidth.reduce((n: number, w: number) => n + w, 0);
      const total = t.content[0].content.reduce((n: number, c: any) => n + width(c), 0);
      const cm = (v: number | undefined) => Math.round((v ?? 0) * 100) / 100;
      return {
        dir: t.attrs.dir ?? null, margins: [cm(t.attrs.marginLeft), cm(t.attrs.marginRight)], pad: t.attrs.cellPadding,
        cells: cells.map((c: any, i: number) => [c.attrs.colspan, i < 3 ? Math.round(6 * width(c) / total) : 0, c.attrs.borderLeft ?? null,
          c.attrs.borderRight ?? null, c.attrs.cellPadding ?? null]),
      };
    };
    const docx = (doc: any, rtl: boolean) => buildDocx(doc, margins, 'portrait', undefined, null, 'A4', undefined, undefined, undefined, rtl);
    const odtOf = (doc: any, rtl: boolean) => buildOdt(doc, margins, 'portrait', undefined, null, 'A4', undefined, undefined, 'add', rtl);
    const cases: [boolean, string | null][] = [[true, null], [true, 'ltr'], [false, 'rtl'], [false, null]];

    it.each(cases)('round-trips on a page rtl=%s with dir %s', async (rtl, dir) => {
      const want = shape(table(dir));
      expect(shape(importDocx(await docx(table(dir), rtl)).content)).toEqual(want);
      expect(shape(importOdt(await odtOf(table(dir), rtl)).content)).toEqual(want);
    });

    it('writes the direction and the leading sides Word reads', async () => {
      const xml = async (rtl: boolean, dir: string | null) => strFromU8(unzipSync(await docx(table(dir), rtl))['word/document.xml']);
      expect(await xml(false, null)).not.toContain('bidiVisual');
      const mirrored = await xml(true, null);
      expect(mirrored).toMatch(/<w:bidiVisual\/>/);
      expect(await xml(false, 'rtl')).toMatch(/<w:bidiVisual\/>/);
      expect(await xml(true, 'ltr')).toMatch(/<w:bidiVisual w:val="(off|0|false)"\/>/);
      // The indent is the leading edge's: the right margin of a right-to-left table.
      expect(mirrored).toMatch(/<w:tblInd [^>]*w:w="1134"/);
      expect(await xml(false, null)).toMatch(/<w:tblInd [^>]*w:w="567"/);
      // Cell margins stay drawn sides: the leading 0.5cm is the right of a mirrored table.
      expect(mirrored).toMatch(/<w:tblCellMar>.*?<w:left [^>]*w:w="57"\/>.*?<w:right [^>]*w:w="283"\/>/);
      expect(await xml(false, null)).toMatch(/<w:tblCellMar>.*?<w:left [^>]*w:w="283"\/>/);
      // ODF draws the first column's leading border on the right.
      const content = strFromU8(unzipSync(await odtOf(table(null), true))['content.xml']);
      expect(content).toMatch(/fo:border-right="[^"]*#ff0000"/i);
      expect(content).not.toMatch(/fo:border-left="[^"]*#ff0000"/i);
    });

    // LibreOffice runs a nested table by what stands around it, so each one says its own way.
    it('keeps a nested table\'s direction and names it in the file', async () => {
      const inner = (dir: string | null, text: string) => ({ type: 'table', attrs: dir ? { dir } : {}, content: [{ type: 'tableRow', content: [cell(text), cell('x')] }] });
      const nested = { type: 'doc', content: [{ type: 'table', attrs: { dir: 'rtl' }, content: [{ type: 'tableRow', content: [
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [inner(null, 'plain')] },
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [inner('rtl', 'mirrored')] },
      ] }] }, { type: 'paragraph' }] } as any;
      const dirs = (doc: any) => {
        const out: (string | null)[] = [];
        (function walk(n: any) { if (n.type === 'table') out.push(n.attrs?.dir ?? null); (n.content ?? []).forEach(walk); })(doc);
        return out;
      };
      const word = await docx(nested, false), odf = await odtOf(nested, false);
      expect(dirs(importDocx(word).content)).toEqual(['rtl', null, 'rtl']);
      expect(dirs(importOdt(odf).content)).toEqual(['rtl', null, 'rtl']);
      expect(strFromU8(unzipSync(word)['word/document.xml']).match(/<w:bidiVisual[^>]*>/g)).toHaveLength(3);
      expect(strFromU8(unzipSync(odf)['content.xml']).match(/<style:table-properties[^>]*style:writing-mode=/g)).toHaveLength(3);
    });

    // Before tables wrote w:bidiVisual the sides went out as drawn and the section alone
    // carried the direction: such a file still shows what it showed.
    it('reads this editor\'s earlier right-to-left files as they were drawn', async () => {
      const files = unzipSync(await docx(table(null), true));
      files['word/styles.xml'] = strToU8(strFromU8(files['word/styles.xml']).replace(/(<w:pPrDefault><w:pPr>)<w:bidi\/>/, '$1'));
      files['word/document.xml'] = strToU8(strFromU8(files['word/document.xml']).replace('<w:bidiVisual/>', ''));
      const old = shape(importDocx(zipSync(files)).content);
      expect(old.dir).toBe(null);
      expect(old.cells[0].slice(2, 4)).toEqual([null, '3pt solid #FF0000']);
      // The margins of the file at hand are drawn ones already; they swap like the borders.
      expect(old.pad).toEqual([0, 0.1, 0, 0.5]);
      expect(old.margins).toEqual([2, 1]);
      // Any other producer's table without w:bidiVisual runs left to right, as in Word.
      files['docProps/app.xml'] = strToU8(strFromU8(files['docProps/app.xml']).replace(/\/>\s*$/, '><Application>Microsoft Office Word</Application></Properties>'));
      expect(shape(importDocx(zipSync(files)).content).dir).toBe('ltr');
    });

    // w:jc places a table narrower than the text; in a w:bidiVisual one its edges mirror.
    it('reads a table\'s w:jc', async () => {
      const files = unzipSync(await docx(table(null), false));
      const read = (tblPr: string) => {
        const out = { ...files };
        out['word/document.xml'] = strToU8(strFromU8(files['word/document.xml'])
          .replace(/<w:tblInd [^>]*\/>/, '').replace('<w:tblPr>', `<w:tblPr>${tblPr}`));
        return shape(importDocx(zipSync(out)).content).margins;
      };
      expect(read('<w:jc w:val="right"/>')).toEqual([3, 0]);
      expect(read('<w:jc w:val="center"/>')).toEqual([1.5, 1.5]);
      expect(read('<w:bidiVisual/><w:jc w:val="left"/>')).toEqual([3, 0]);
      expect(read('<w:bidiVisual/><w:jc w:val="end"/>')).toEqual([0, 3]);
    });

    // A table style's w:tblPr mirrors its tables, down the w:basedOn chain; the table's own wins.
    it('reads w:bidiVisual from the table style', async () => {
      const files = unzipSync(await docx(table(null), false));
      const read = (tblPr: string) => {
        const out = { ...files };
        out['word/document.xml'] = strToU8(strFromU8(files['word/document.xml']).replace('<w:tblPr>', `<w:tblPr><w:tblStyle w:val="Leaf"/>${tblPr}`));
        out['word/styles.xml'] = strToU8(strFromU8(files['word/styles.xml']).replace('</w:styles>',
          '<w:style w:type="table" w:styleId="Base"><w:name w:val="Base"/><w:tblPr><w:bidiVisual/></w:tblPr></w:style>'
          + '<w:style w:type="table" w:styleId="Leaf"><w:name w:val="Leaf"/><w:basedOn w:val="Base"/></w:style></w:styles>'));
        return shape(importDocx(zipSync(out)).content).dir;
      };
      expect(read('')).toBe('rtl');
      expect(read('<w:bidiVisual w:val="0"/>')).toBe(null);
    });
  });
});
