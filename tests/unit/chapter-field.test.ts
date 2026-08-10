// The running head's chapter field: ODF <text:chapter>, Word STYLEREF. Both keep the
// outline level; the shown name is resolved per page by HeaderFooterLayer.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';

type N = any;

const margins = { top: 2, bottom: 2, left: 2, right: 2 };
const footer: N = { type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'chapterField', attrs: { level: 1, text: 'Cached chapter' } },
  { type: 'text', text: ' — ' },
  { type: 'pageNumber' },
] }] };
const doc: N = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Cached chapter' }] },
] };
const hf = {
  header: null, footer, headerFirst: null, footerFirst: null, differentFirstPage: false,
  headerEven: null, footerEven: null, differentOddEven: false, sections: [], pageCount: 1,
};
const fieldOf = (d: any) => d?.content?.[0]?.content?.find((n: any) => n.type === 'chapterField');

describe('chapter field', () => {
  it('round-trips through ODF as text:chapter', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait', hf);
    const styles = strFromU8(unzipSync(bytes)['styles.xml']);
    expect(styles).toContain('<text:chapter text:display="name" text:outline-level="1">Cached chapter</text:chapter>');

    const back = await importOdt(bytes);
    expect(fieldOf(back.footer)).toEqual({ type: 'chapterField', attrs: { level: 1, text: 'Cached chapter' } });
  });

  it('round-trips through DOCX as a STYLEREF field', async () => {
    const bytes = await buildDocx(doc, margins, 'portrait', hf);
    const back = importDocx(bytes);
    // Word caches the shown name in the field result, which the import drops — the
    // level is what the live field needs.
    expect(fieldOf(back.footer)?.attrs?.level).toBe(1);
  });
});
