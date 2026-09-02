import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importOdt } from '../../src/lib/import/odt';

// Two masters naming each other through style:next-style-name are LibreOffice's Left
// Page / Right Page: one mirrored setup whose left half is the even-page variant, not a
// title page handing over to a running one.
const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';

function odt(chained: boolean): Uint8Array {
  const layout = (name: string, usage: string, left: string, right: string) =>
    `<style:page-layout style:name="${name}" style:page-usage="${usage}"><style:page-layout-properties
      fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="2cm" fo:margin-bottom="2cm"
      fo:margin-left="${left}" fo:margin-right="${right}"/></style:page-layout>`;
  const next = (n: string) => (chained ? ` style:next-style-name="${n}"` : '');
  const styles = `<?xml version="1.0"?><office:document-styles ${NS}><office:styles>
   <style:style style:name="Standard" style:family="paragraph"/>
   <style:style style:name="Body" style:family="paragraph" style:master-page-name="Right"/>
  </office:styles><office:automatic-styles>
   ${layout('pmR', 'right', '3.6cm', '2.7cm')}${layout('pmL', 'left', '2.7cm', '3.6cm')}
  </office:automatic-styles><office:master-styles>
   <style:master-page style:name="Right" style:page-layout-name="pmR"${next('Left')}>
    <style:header><text:p text:style-name="Standard">odd head</text:p></style:header></style:master-page>
   <style:master-page style:name="Left" style:page-layout-name="pmL"${next('Right')}>
    <style:header><text:p text:style-name="Standard">even head</text:p></style:header></style:master-page>
  </office:master-styles></office:document-styles>`;
  const content = `<?xml version="1.0"?><office:document-content ${NS}><office:body><office:text>
   <text:p text:style-name="Standard">first</text:p>
   <text:p text:style-name="Body">second</text:p>
  </office:text></office:body></office:document-content>`;
  return zipSync({ 'content.xml': strToU8(content), 'styles.xml': strToU8(styles) });
}

const zoneText = (doc: unknown): string =>
  JSON.stringify(doc).match(/"text":"([^"]*)"/)?.[1] ?? '';

describe('a left/right master pair', () => {
  const section = importOdt(odt(true)).hfSections?.[1];

  it('is one mirrored page setup, stored as the right (odd) page', () => {
    expect(section?.margins).toEqual({ top: 2, bottom: 2, left: 3.6, right: 2.7, mirrored: true });
    expect(section?.marginsFirst).toBeNull();
  });

  it('makes the left master the even-page variant', () => {
    expect(section?.differentOddEven).toBe(true);
    expect(section?.differentFirstPage).toBe(false);
    expect(zoneText(section?.header)).toBe('odd head');
    expect(zoneText(section?.headerEven)).toBe('even head');
  });

  it('leaves an unchained pair alone', () => {
    const plain = importOdt(odt(false)).hfSections?.[1];
    expect(plain?.differentOddEven).toBe(false);
    expect(zoneText(plain?.header)).toBe('odd head');
  });
});
