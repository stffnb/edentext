import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { styleCss, builtinStyleSheet, resolveStyle } from '../../src/lib/styles/styleSheet';
import { importDocx } from '../../src/lib/import/docx';
import { buildDocx } from '../../src/lib/export/docx';

// ODF kerns by default and Word does not, so only the off state is ever stored.
describe('pair kerning', () => {
  it('renders font-kerning only where a style turns it off', () => {
    const sheet = builtinStyleSheet();
    expect(styleCss(sheet)).not.toContain('font-kerning');
    sheet.paragraph.Standard.text = { ...sheet.paragraph.Standard.text, kerning: false };
    expect(styleCss(sheet)).toContain('font-kerning: none');
  });

  it('inherits the off state down the parent chain', () => {
    const sheet = builtinStyleSheet();
    sheet.paragraph.Standard.text = { ...sheet.paragraph.Standard.text, kerning: false };
    const css = styleCss(sheet);
    const heading = css.slice(css.indexOf('[data-style="Heading 1"]'));
    expect(heading.slice(0, heading.indexOf('}'))).toContain('font-kerning: none');
  });

  it('lets a style turn it back on under one that turns it off', () => {
    const sheet = builtinStyleSheet();
    sheet.paragraph.Standard.text = { ...sheet.paragraph.Standard.text, kerning: false };
    sheet.paragraph.Title.text = { ...sheet.paragraph.Title.text, kerning: true };
    const css = styleCss(sheet);
    const title = css.slice(css.indexOf('[data-style="Title"]'));
    expect(title.slice(0, title.indexOf('}'))).toContain('font-kerning: normal');
  });
});

// w:kern names the smallest size pair kerning applies to. A file that declares it on the
// Title style alone kerns the title and nothing else — LibreOffice sets that title 0.34mm
// narrower, which is a line break where the text fills its column.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const STYLES = `<?xml version="1.0"?>
<w:styles xmlns:w="${W}">
  <w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>
    <w:rPr><w:kern w:val="28"/><w:sz w:val="52"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Small"><w:name w:val="Small"/><w:basedOn w:val="Normal"/>
    <w:rPr><w:kern w:val="28"/><w:sz w:val="20"/></w:rPr>
  </w:style>
</w:styles>`;

const docx = () =>
  zipSync({
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>` +
      `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>` +
      `<w:p><w:pPr><w:pStyle w:val="Small"/></w:pPr><w:r><w:t>small</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>body</w:t></w:r></w:p></w:body></w:document>`),
    'word/styles.xml': strToU8(STYLES),
  });

describe('a Word style’s own w:kern', () => {
  const sheet = importDocx(docx()).styles!;

  it('kerns a style set at or above the size it names', () => {
    expect(sheet.paragraph.Title.text.kerning).toBe(true);
  });

  it('leaves the body and a style set below that size unkerned', () => {
    expect(sheet.paragraph.Standard.text.kerning).toBe(false);
    expect(resolveStyle(sheet, 'Small').text.kerning).toBe(false);
  });

  it('survives a round trip through the DOCX export', async () => {
    const doc = importDocx(docx());
    const out = await buildDocx(doc.content as never, undefined, 'portrait', undefined, null, 'A4', doc.styles);
    const again = importDocx(out).styles!;
    expect(again.paragraph.Title.text.kerning).toBe(true);
    expect(again.paragraph.Standard.text.kerning).toBe(false);
  });
});
