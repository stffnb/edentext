import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importOdt } from '../../src/lib/import/odt';

// Probed against LibreOffice with the OPG fixture's own styles: it holds a paragraph's
// two vertical margins in one item, so a style declaring just one of them takes the
// *default* style's value for the other instead of the parent chain's.
const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';

// `Normal` sets both margins and 115% spacing; the block's automatic style overrides one.
function odt(autoProps: string): Uint8Array {
  const styles = `<?xml version="1.0"?><office:document-styles ${NS}><office:styles>
   <style:default-style style:family="paragraph">
    <style:paragraph-properties fo:margin-bottom="8pt"/>
    <style:text-properties fo:font-size="12pt" fo:font-family="Liberation Serif"/>
   </style:default-style>
   <style:style style:name="Standard" style:family="paragraph"/>
   <style:style style:name="Normal" style:display-name="Normal" style:family="paragraph">
    <style:paragraph-properties fo:margin-top="20pt" fo:margin-bottom="12pt" fo:line-height="115%"/>
   </style:style>
  </office:styles></office:document-styles>`;
  const content = `<?xml version="1.0"?><office:document-content ${NS}><office:automatic-styles>
   <style:style style:name="P1" style:parent-style-name="Normal" style:family="paragraph">
    <style:paragraph-properties ${autoProps}/>
   </style:style>
  </office:automatic-styles><office:body><office:text>
   <text:p text:style-name="P1">Absatz</text:p>
  </office:text></office:body></office:document-content>`;
  return zipSync({ 'content.xml': strToU8(content), 'styles.xml': strToU8(styles) });
}

const block = (autoProps: string) =>
  (importOdt(odt(autoProps)).content.content?.[0] as { attrs: Record<string, unknown> }).attrs;

describe('ODF paragraph property inheritance', () => {
  it('drops the inherited margin the other half of the pair replaced', () => {
    // Declaring only the top margin resets the bottom one to the default style's 8pt…
    expect(block('fo:margin-top="2.4pt"')).toMatchObject({ spaceBefore: 2.4, spaceAfter: 8 });
    // …and the other way round; the parent's 20pt does not survive.
    expect(block('fo:margin-bottom="6pt"')).toMatchObject({ spaceBefore: 0, spaceAfter: 6 });
  });

  it('keeps both when the style declares neither', () => {
    // Nothing overrides the pair, so both stay with the style and the block adds nothing.
    const attrs = block('fo:text-align="center"');
    expect(attrs.spaceBefore).toBeUndefined();
    expect(attrs.spaceAfter).toBeUndefined();
    expect(importOdt(odt('fo:text-align="center"')).styles.paragraph['Normal']?.para)
      .toMatchObject({ spaceBefore: 20, spaceAfter: 12 });
  });

  it('reads a line spacing as the ODF percentage, against the style it overrides', () => {
    expect(importOdt(odt('fo:text-align="center"')).styles.paragraph['Normal']?.para.lineHeight).toBe('1.15');
    // 100% under a 115% style is direct formatting, not the editor's implicit default.
    expect(block('fo:line-height="100%"').lineHeight).toBe('1');
    expect(block('fo:line-height="115%"').lineHeight).toBeUndefined();
  });
});
