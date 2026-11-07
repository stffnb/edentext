// A paragraph style's own rule line (Word's w:pBdr, ODF fo:border-*) and the gap it keeps
// to the text (w:space / fo:padding). Both live in the style registry, not on the block.
import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { importDocx } from '../../src/lib/import/docx';
import { importOdt } from '../../src/lib/import/odt';
import { buildOdt } from '../../src/lib/export/odt';
import { styleCss } from '../../src/lib/styles/styleSheet';
import { Editor } from '@tiptap/core';
import { zoneExtensions } from '../../src/lib/editor/extensions';

type N = any;

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const styles = (pBdr: string) => `<?xml version="1.0"?><w:styles xmlns:w="${W}">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>
    <w:pPr>${pBdr}</w:pPr></w:style>
</w:styles>`;

const doc = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
  <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Heading</w:t></w:r></w:p>
</w:body></w:document>`;

const imported = (pBdr: string) =>
  importDocx(zipSync({ 'word/document.xml': strToU8(doc), 'word/styles.xml': strToU8(styles(pBdr)) })).styles.paragraph['Title'].para;

describe('a paragraph style’s rule line', () => {
  const rule = '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="4" w:color="4F81BD"/></w:pBdr>';

  it('is read from the style, not only from direct formatting', () => {
    const para = imported(rule);
    expect(para.borderBottom).toBe('1pt solid #4F81BD');
    expect(para.borderTop).toBeUndefined();
    expect(para.borderPadding).toBe(4);
  });

  it('keeps no padding where it draws no rule', () => {
    expect(imported('').borderBottom).toBeUndefined();
    expect(imported('<w:pBdr><w:bottom w:val="nil"/></w:pBdr>').borderPadding).toBeUndefined();
  });

  it('round-trips through an ODF export as fo:border + fo:padding on that side', async () => {
    const res = importDocx(zipSync({ 'word/document.xml': strToU8(doc), 'word/styles.xml': strToU8(styles(rule)) }));
    const bytes = await buildOdt(
      res.content as N, { top: 2, bottom: 2, left: 2, right: 2 }, 'portrait',
      undefined, null, 'A4', res.styles,
    );
    const xml = strFromU8(unzipSync(bytes)['styles.xml']);
    expect(xml).toContain('fo:border-bottom="1pt solid #4F81BD"');
    expect(xml).toContain('fo:padding-bottom="4pt"');
    expect(xml).not.toContain('fo:padding-top');

    const back = importOdt(bytes).styles.paragraph['Title'].para;
    expect(back.borderBottom).toBe('1pt solid #4F81BD');
    expect(back.borderPadding).toBe(4);
  });

  it('starts where a hanging first line does, as LibreOffice draws it', () => {
    const hang = '<w:ind w:left="1134" w:hanging="567"/>';
    const sheet = importDocx(zipSync({ 'word/document.xml': strToU8(doc), 'word/styles.xml': strToU8(styles(rule + hang)) })).styles;
    const css = styleCss(sheet).split('\n\n').find((r) => r.includes('[data-style="Title"]'))!;
    expect(css).toContain('--box-hang: min(0px, var(--indent-first, 0px))');
    expect(css).toContain('margin-left: calc(var(--sec-inset-left, 0px) + var(--ind, 0px) + var(--box-hang, 0px))');
    // A unitless 0 in that calc() would void the whole padding shorthand, the rule's gap with it.
    expect(css).toContain('--pad-left: 0px');
    expect(css).toContain('padding: 0px 0px 4pt calc(var(--pad-left, 0px) - var(--box-hang, 0px))');
  });
});

// A file or a paste names a colour; only a colour may reach CSS, never a rule's end or a URL.
describe('hostile style values', () => {
  const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
    + 'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
    + 'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';
  const bad = (n: number) => `#0}body{background:url(//e.invalid/${n})`;
  const odt = zipSync({
    'styles.xml': strToU8(`<?xml version="1.0"?><office:document-styles ${NS}><office:styles>
      <style:style style:name="Standard" style:family="paragraph"/>
      <style:style style:name="Ruled" style:family="paragraph"><style:paragraph-properties fo:border="1pt solid ${bad(1)}"/></style:style>
      </office:styles></office:document-styles>`),
    'content.xml': strToU8(`<?xml version="1.0"?><office:document-content ${NS}><office:automatic-styles>
      <style:style style:name="C1" style:family="table-cell"><style:table-cell-properties fo:background-color="red;background-image:url(//e.invalid/2)" fo:border="1pt solid ${bad(3)}"/></style:style>
      <style:style style:name="P1" style:family="paragraph" style:parent-style-name="Ruled"><style:paragraph-properties fo:border-top="2pt solid ${bad(4)}"/></style:style>
      </office:automatic-styles><office:body><office:text>
      <text:p text:style-name="P1">a</text:p>
      <table:table table:name="T"><table:table-column/><table:table-row><table:table-cell table:style-name="C1"><text:p>b</text:p></table:table-cell></table:table-row></table:table>
      </office:text></office:body></office:document-content>`),
  });
  const paste = '<p data-bg="red;background:url(//e.invalid/5)">c <span style="color: red; text-decoration-color: blue">d</span></p>'
    + '<table><tr><td style="background-color: red; background-image: url(//e.invalid/6)"><p>e</p></td></tr></table>';

  it('reach neither the stylesheet nor the rendered document', () => {
    const res = importOdt(odt);
    expect(styleCss(res.styles)).not.toContain('e.invalid');
    for (const content of [res.content, paste]) {
      const editor = new Editor({ extensions: zoneExtensions(), content: content as N });
      expect(editor.getHTML()).not.toContain('e.invalid');
      editor.destroy();
    }
  });
});
