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

// The alignment default follows the base direction: an unset rtl paragraph sits at the
// right edge, so that edge is suppressed on import and the off-edge kept.
describe('paragraph alignment under w:bidi', () => {
  const P = (attrs: object) => ({ type: 'paragraph', attrs, content: [{ type: 'text', text: 'שלום' }] });

  it('suppresses the rtl default edge, keeps the off-edge', async () => {
    const doc: any = { type: 'doc', content: [
      P({ dir: 'rtl', textAlign: 'right' }), P({ dir: 'rtl', textAlign: 'left' }), P({ textAlign: 'right' }),
    ] };
    const back = (importDocx(await buildDocx(doc)).content as any).content;
    expect(back[0].attrs?.textAlign ?? null).toBeNull();
    expect(back[0].attrs?.dir).toBe('rtl');
    expect(back[1].attrs?.textAlign).toBe('left');
    expect(back[2].attrs?.textAlign).toBe('right');
  });

  // LibreOffice spells an rtl paragraph's physical left as w:jc="start" (probed).
  it('reads w:jc="start" as the physical left edge', async () => {
    const doc: any = { type: 'doc', content: [P({ dir: 'rtl', textAlign: 'left' })] };
    const files = unzipSync(await buildDocx(doc));
    files['word/document.xml'] = strToU8(strFromU8(files['word/document.xml'])
      .replace('<w:jc w:val="left"/>', '<w:jc w:val="start"/>'));
    const back = (importDocx(zipSync(files)).content as any).content;
    expect(back[0].attrs?.textAlign).toBe('left');
    expect(back[0].attrs?.dir).toBe('rtl');
  });
});
