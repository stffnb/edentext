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
import { isLeftPage, printedPageNumber } from '../../src/lib/storage/pageNumbering';

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

// Probed: LibreOffice's mirrored margins and its left-page zone follow the page
// *number*. A restart onto the wrong parity really does show two left pages in a row —
// the file's own fault, which the word processors show rather than hide.
describe('the side a page is on', () => {
  const firstPage = (i: number) => [1, 3][i] ?? 1;

  it('counts on from the document start where nothing restarts', () => {
    expect(printedPageNumber(3, 0, [1], firstPage)).toBe(3);
    expect(printedPageNumber(1, 0, [3], firstPage)).toBe(3);
  });

  it('counts from the nearest section that restarts', () => {
    // Section 1 opens on sheet 3 and restarts at 2 — measured against LibreOffice.
    expect([3, 4].map((p) => printedPageNumber(p, 1, [1, 2], firstPage))).toEqual([2, 3]);
    expect([3, 4].map((p) => isLeftPage(printedPageNumber(p, 1, [1, 2], firstPage)))).toEqual([true, false]);
    // Two left pages in a row: sheet 2 is number 2 as well.
    expect(isLeftPage(printedPageNumber(2, 0, [1, 2], firstPage))).toBe(true);
  });

  it('is the sheet again where the restart keeps the parity', () => {
    expect([3, 4].map((p) => printedPageNumber(p, 1, [1, 5], firstPage))).toEqual([5, 6]);
    expect([3, 4].map((p) => isLeftPage(printedPageNumber(p, 1, [1, 5], firstPage)))).toEqual([false, true]);
  });
});
