import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importOdt } from '../../src/lib/import/odt';

// table:align="margins" is a table stretched between the text margins. Its style:width
// is the width the producing page had, so deriving a margin from it against ours leaves
// the table narrow — measured 12.4cm on a 14.7cm text width.
const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';

function odtWithTable(tableProps: string): Uint8Array {
  const styles = `<?xml version="1.0"?><office:document-styles ${NS}><office:styles>
   <style:style style:name="Standard" style:family="paragraph"/>
  </office:styles><office:automatic-styles>
   <style:page-layout style:name="pm1"><style:page-layout-properties
     fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-left="3.6cm" fo:margin-right="2.7cm"/></style:page-layout>
  </office:automatic-styles><office:master-styles>
   <style:master-page style:name="Standard" style:page-layout-name="pm1"/>
  </office:master-styles></office:document-styles>`;
  const content = `<?xml version="1.0"?><office:document-content ${NS}><office:automatic-styles>
   <style:style style:name="T1" style:family="table"><style:table-properties ${tableProps}/></style:style>
  </office:automatic-styles><office:body><office:text>
   <table:table table:name="T" table:style-name="T1">
    <table:table-column/>
    <table:table-row><table:table-cell><text:p text:style-name="Standard">a</text:p></table:table-cell></table:table-row>
   </table:table>
  </office:text></office:body></office:document-content>`;
  return zipSync({ 'content.xml': strToU8(content), 'styles.xml': strToU8(styles) });
}

const attrsOf = (tableProps: string) =>
  (importOdt(odtWithTable(tableProps)).content.content?.[0] as { attrs?: Record<string, unknown> }).attrs ?? {};

describe('a table aligned to the margins', () => {
  it('keeps the full text width whatever width the producer wrote', () => {
    const attrs = attrsOf('style:width="14.7cm" table:align="margins"');
    expect(attrs.marginLeft).toBeUndefined();
    expect(attrs.marginRight).toBeUndefined();
  });

  it('still honours the margins the file declares itself', () => {
    const attrs = attrsOf('style:width="12cm" table:align="margins" fo:margin-left="1.5cm"');
    expect(attrs.marginLeft).toBe(1.5);
    expect(attrs.marginRight).toBeUndefined();
  });

  it('leaves a centred table centred', () => {
    const attrs = attrsOf('style:width="10.7cm" table:align="center"');
    expect(attrs.marginLeft).toBe(2);
    expect(attrs.marginRight).toBe(2);
  });
});
