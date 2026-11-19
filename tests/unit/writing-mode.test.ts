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
});
