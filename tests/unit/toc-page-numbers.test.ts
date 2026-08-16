// An index that deliberately shows no page numbers: Word's TOC \n, an ODF entry template
// naming no <text:index-entry-page-number/>.
import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { importDocx } from '../../src/lib/import/docx';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { buildOdt } from '../../src/lib/export/odt';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MARGINS = { top: 2, bottom: 2, left: 2, right: 2 };

const docx = (instr: string) => zipSync({
  'word/document.xml': strToU8(`<?xml version="1.0"?>
<w:document xmlns:w="${W}"><w:body>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Chapter</w:t></w:r></w:p>
  <w:p>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText xml:space="preserve">${instr}</w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="separate"/></w:r>
    <w:r><w:t>Chapter</w:t></w:r>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
</w:body></w:document>`),
});

const toc = (doc: any) => doc.content.content.find((n: any) => n.type === 'tableOfContents');

describe('an index without page numbers', () => {
  it('reads Word\'s \\n switch', () => {
    expect(toc(importDocx(docx(' TOC \\h \\z \\n \\o "1-3" '))).attrs.pageNumbers).toBe(false);
    expect(toc(importDocx(docx(' TOC \\h \\z \\o "1-3" '))).attrs.pageNumbers).not.toBe(false);
  });

  it('round-trips through DOCX', async () => {
    const res: any = importDocx(docx(' TOC \\h \\z \\n \\o "1-3" '));
    const back: any = importDocx(await buildDocx(res.content, MARGINS, 'portrait'));
    expect(toc(back).attrs.pageNumbers).toBe(false);
  });

  it('round-trips through ODF as an entry template with no page number', async () => {
    const res: any = importDocx(docx(' TOC \\h \\z \\n \\o "1-3" '));
    const bytes = await buildOdt(res.content, MARGINS, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    expect(xml).toContain('<text:table-of-content-entry-template');
    expect(xml).not.toContain('<text:index-entry-page-number/>');
    expect(toc(importOdt(bytes)).attrs.pageNumbers).toBe(false);
  });

  it('keeps the page numbers of an ordinary index', async () => {
    const res: any = importDocx(docx(' TOC \\h \\z \\o "1-3" '));
    const bytes = await buildOdt(res.content, MARGINS, 'portrait');
    expect(strFromU8(unzipSync(bytes)['content.xml'])).toContain('<text:index-entry-page-number/>');
    expect(toc(importOdt(bytes)).attrs.pageNumbers).not.toBe(false);
  });
});
