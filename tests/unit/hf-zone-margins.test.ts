// A header/footer zone's own vertical margins: LibreOffice keeps them on the Header /
// Footer paragraph style. A footer's space above grows the band; the space *below* the
// zone's last paragraph does not — LibreOffice drops it, so neither zone carries it back.
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
    expect(back.footer?.content?.[0]?.attrs?.spaceBefore).toBeCloseTo(24, 1);
    // Probed: a header of one 10pt line with a 12mm bottom margin puts the body at the
    // band's min-height, not 12mm lower — the trailing margin is no part of the band.
    expect(back.header?.content?.[0]?.attrs?.spaceAfter ?? 0).toBe(0);
  });
});
