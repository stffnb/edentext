// A header/footer zone's tab stops — what a left⇥centre⇥right header rides on. Word
// puts them on the Header style, ODF on the zone paragraph's.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';

type N = any;

const doc: N = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] };
const zone = (stops: string, text: string): N => ({
  type: 'doc',
  content: [{ type: 'paragraph', attrs: { tabStops: stops }, content: [{ type: 'text', text }] }],
});
const hf = {
  header: zone('8.5c;17r', 'Links\tMitte\tRechts'),
  footer: zone('17r.', 'Kapitel\tSeite'),
  headerFirst: null, footerFirst: null, differentFirstPage: false,
  headerEven: null, footerEven: null, differentOddEven: false,
  pageCount: 1,
};
const stopsOf = (d: N) => d?.content?.[0]?.attrs?.tabStops ?? null;

describe('header/footer tab stops', () => {
  it('ride the ODF zone styles and come back', async () => {
    const bytes = await buildOdt(doc, undefined, 'portrait', hf);
    const styles = strFromU8(unzipSync(bytes)['styles.xml']);
    expect(styles).toContain('<style:tab-stop style:position="8.5cm" style:type="center"/>');
    expect(styles).toContain('style:leader-style="dotted" style:leader-text="."');

    const back = await importOdt(bytes);
    expect(stopsOf(back.header)).toBe('8.5c;17r');
    expect(stopsOf(back.footer)).toBe('17r.');
  });

  it('ride the DOCX zone paragraphs and come back', async () => {
    const back = importDocx(await buildDocx(doc, undefined, 'portrait', hf));
    expect(stopsOf(back.header)).toBe('8.5c;17r');
    expect(stopsOf(back.footer)).toBe('17r.');
  });
});
