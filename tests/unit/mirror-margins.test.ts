import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';

// ODF style:page-usage="mirrored" / Word w:mirrorMargins: the declared left and right
// are the inner/outer pair, so an even (left-hand) page swaps them.
const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';

function odt(usage: string): Uint8Array {
  const styles = `<?xml version="1.0"?><office:document-styles ${NS}><office:styles/>
   <office:automatic-styles>
    <style:page-layout ${usage}style:name="pm1">
     <style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm"
      fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="1.5cm" fo:margin-right="3cm"/>
    </style:page-layout>
   </office:automatic-styles>
   <office:master-styles>
    <style:master-page style:name="Standard" style:page-layout-name="pm1"/>
   </office:master-styles></office:document-styles>`;
  const content = `<?xml version="1.0"?><office:document-content ${NS}>
   <office:body><office:text><text:p>Hi</text:p></office:text></office:body></office:document-content>`;
  return zipSync({ 'content.xml': strToU8(content), 'styles.xml': strToU8(styles) });
}

const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] };

describe('mirrored page margins', () => {
  it('reads style:page-usage from the page layout', () => {
    expect(importOdt(odt('style:page-usage="mirrored" ')).margins).toMatchObject({
      left: 1.5, right: 3, mirrored: true,
    });
    // Absent, not false: an unmirrored document's margins keep the plain four.
    expect(importOdt(odt('')).margins).toMatchObject({ left: 1.5, right: 3 });
    expect(importOdt(odt('')).margins?.mirrored).toBeUndefined();
  });

  it('round-trips through an ODF export', async () => {
    const margins = { top: 2, bottom: 2, left: 1.5, right: 3, mirrored: true };
    const bytes = await buildOdt(doc, margins);
    const styles = strFromU8(unzipSync(bytes)['styles.xml']);
    expect(styles).toContain('style:page-usage="mirrored"');
    expect(importOdt(bytes).margins).toMatchObject({ left: 1.5, right: 3, mirrored: true });
  });

  it('leaves an unmirrored export alone', async () => {
    const bytes = await buildOdt(doc, { top: 2, bottom: 2, left: 1.5, right: 3 });
    expect(strFromU8(unzipSync(bytes)['styles.xml'])).not.toContain('page-usage="mirrored"');
    expect(importOdt(bytes).margins?.mirrored).toBeUndefined();
  });

  it('round-trips through a DOCX export as w:mirrorMargins', async () => {
    const margins = { top: 2, bottom: 2, left: 1.5, right: 3, mirrored: true };
    const bytes = await buildDocx(doc, margins);
    expect(strFromU8(unzipSync(bytes)['word/settings.xml'])).toContain('mirrorMargins');
    expect(importDocx(bytes).margins).toMatchObject({ left: 1.5, right: 3, mirrored: true });
  });

  it('leaves an unmirrored DOCX export alone', async () => {
    const bytes = await buildDocx(doc, { top: 2, bottom: 2, left: 1.5, right: 3 });
    expect(strFromU8(unzipSync(bytes)['word/settings.xml'])).not.toContain('mirrorMargins');
    expect(importDocx(bytes).margins?.mirrored).toBeFalsy();
  });
});
