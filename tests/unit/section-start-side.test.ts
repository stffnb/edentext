// A section can demand the side it opens on (ODF style:page-usage right/left on its
// page layout, Word's w:type oddPage/evenPage): where the flow would open it on the
// other one, both word processors insert a blank page.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';
import { EMPTY_HF_SET } from '../../src/lib/storage/headerFooter';

type N = any;

const P = (text: string, attrs?: N): N =>
  ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content: [{ type: 'text', text }] });

const doc: N = {
  type: 'doc',
  content: [P('front'), P('chapter', { sectionBreak: true, breakBefore: 'page' })],
};
const zone: N = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'z' }] }] };
const hf = {
  header: zone, footer: null, pageCount: 2,
  sections: [{ ...EMPTY_HF_SET, header: zone }, { ...EMPTY_HF_SET, header: zone, startsOn: 'odd' as const }],
};
const margins = { top: 2, bottom: 2, left: 2, right: 2 };
const sides = (r: N) => (r.hfSections ?? []).map((s: N) => s.startsOn ?? null);

describe('the side a section opens on', () => {
  it('round-trips through ODF as style:page-usage', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait', hf as never);
    expect(strFromU8(unzipSync(bytes)['styles.xml'])).toContain('style:page-usage="right"');
    expect(sides(importOdt(bytes))).toEqual([null, 'odd']);
  });

  it('round-trips through DOCX as w:type', async () => {
    const bytes = await buildDocx(doc, margins, 'portrait', hf as never);
    expect(strFromU8(unzipSync(bytes)['word/document.xml'])).toContain('<w:type w:val="oddPage"');
    expect(sides(importDocx(bytes))).toEqual([null, 'odd']);
  });

  it('leaves a section that takes any side alone', async () => {
    const plain = { ...hf, sections: [hf.sections[0], { ...EMPTY_HF_SET, header: zone }] };
    const odt = await buildOdt(doc, margins, 'portrait', plain as never);
    expect(strFromU8(unzipSync(odt)['styles.xml'])).not.toContain('page-usage="right"');
    expect(sides(importOdt(odt))).toEqual([null, null]);
    const docx = await buildDocx(doc, margins, 'portrait', plain as never);
    expect(strFromU8(unzipSync(docx)['word/document.xml'])).not.toContain('w:val="oddPage"');
    expect(sides(importDocx(docx))).toEqual([null, null]);
  });
});
