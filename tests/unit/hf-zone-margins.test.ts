// A header/footer zone's own vertical margins: LibreOffice keeps them on the Header /
// Footer paragraph style, and a footer's space above is what grows the band.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';

type N = any;

const doc: N = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] };
const zone = (attrs: N, text: string): N => ({
  type: 'doc',
  content: [{ type: 'paragraph', attrs, content: [{ type: 'text', text }] }],
});
const hf = {
  header: zone({ spaceAfter: 34 }, 'Kopf'),
  footer: zone({ spaceBefore: 24 }, 'Fuss'),
  headerFirst: null, footerFirst: null, differentFirstPage: false,
  headerEven: null, footerEven: null, differentOddEven: false,
  pageCount: 1,
};

describe('header/footer zone margins', () => {
  it('ride the ODF zone styles and come back', async () => {
    const bytes = await buildOdt(doc, undefined, 'portrait', hf);
    const styles = strFromU8(unzipSync(bytes)['styles.xml']);
    expect(styles).toContain('fo:margin-bottom="34pt"');
    expect(styles).toContain('fo:margin-top="24pt"');

    const back = await importOdt(bytes);
    expect(back.header?.content?.[0]?.attrs?.spaceAfter).toBeCloseTo(34, 1);
    expect(back.footer?.content?.[0]?.attrs?.spaceBefore).toBeCloseTo(24, 1);
  });
});
