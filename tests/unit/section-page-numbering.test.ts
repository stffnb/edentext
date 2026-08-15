// A section of its own can restart the page numbering (Word's w:pgNumType start,
// LibreOffice's style:page-number on the paragraph that switches master page). Only a
// section that really restarts carries one; the rest count on.
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

// Three sections; only the third restarts, at page 1 (a front matter / body split).
const doc: N = {
  type: 'doc',
  content: [P('front matter'), P('body', { sectionBreak: true }), P('appendix', { sectionBreak: true })],
};

const zone: N = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'pageNumber' }] }] };
const sets = [
  { ...EMPTY_HF_SET, footer: zone },
  { ...EMPTY_HF_SET, footer: zone },
  { ...EMPTY_HF_SET, footer: zone, pageNumberStart: 1 },
];
const hf = { header: null, footer: zone, sections: sets, pageCount: 3 };
const margins = { top: 2, bottom: 2, left: 2, right: 2 };
const starts = (r: N) => (r.hfSections ?? []).map((s: N) => s.pageNumberStart ?? null);

describe('per-section page numbering', () => {
  it('round-trips through ODF', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait', hf as never);
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    expect(xml).toContain('style:page-number="1"');
    expect(starts(importOdt(bytes))).toEqual([null, null, 1]);
  });

  it('round-trips through DOCX', async () => {
    const bytes = await buildDocx(doc, margins, 'portrait', hf as never);
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toContain('<w:pgNumType w:start="1"');
    // A continuous section is one both word processors ignore the start on (probed),
    // so the restarting section is the one break that is not continuous.
    expect(xml.match(/<w:type w:val="continuous"\/>/g)).toHaveLength(1);
    expect(starts(importDocx(bytes))).toEqual([null, null, 1]);
  });
});
