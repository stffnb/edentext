// A DATE/TIME field whose picture the catalog does not list: it stays a live field,
// keyed by the picture itself, and renders and re-exports the same.
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { importDocx } from '../../src/lib/import/docx';
import { buildDocx } from '../../src/lib/export/docx';
import { findFormat, renderFormat, docxPicture } from '../../src/lib/utils/dateTime';

const CT = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const DOCUMENT = `<?xml version="1.0"?><w:document ${W}><w:body><w:p>
<w:r><w:fldChar w:fldCharType="begin"/></w:r>
<w:r><w:instrText xml:space="preserve"> DATE  \\@ "MMMM d"  \\* MERGEFORMAT </w:instrText></w:r>
<w:r><w:fldChar w:fldCharType="separate"/></w:r>
<w:r><w:t>July 10</w:t></w:r>
<w:r><w:fldChar w:fldCharType="end"/></w:r>
</w:p></w:body></w:document>`;

const file = zipSync({
  '[Content_Types].xml': strToU8(CT),
  '_rels/.rels': strToU8(RELS),
  'word/document.xml': strToU8(DOCUMENT),
});

const walk = (n: any, type: string, out: any[] = []): any[] => {
  for (const c of n.content ?? []) { if (c.type === type) out.push(c); walk(c, type, out); }
  return out;
};

describe('a date field format the catalog does not list', () => {
  it('imports as a live field keyed by its own picture', () => {
    const fields = walk(importDocx(file).content, 'dateTimeField');
    expect(fields).toHaveLength(1);
    expect(fields[0].attrs).toMatchObject({ kind: 'date', format: 'MMMM d', fixed: false });
  });

  it('renders the current date in that format', () => {
    const fmt = findFormat('MMMM d')!;
    expect(renderFormat(fmt, new Date(2026, 8, 10), 'en-US')).toBe('September 10');
    // A Slavic locale declines the month beside a day; the stand-alone form is "сентябрь".
    expect(renderFormat(fmt, new Date(2026, 8, 10), 'ru-RU')).toBe('сентября 10');
    expect(docxPicture(fmt)).toBe('MMMM d');
  });

  it('exports the picture back, so the field stays live in Word', async () => {
    const doc = importDocx(file).content;
    const xml = strFromU8(unzipSync(await buildDocx(doc as any))['word/document.xml']);
    expect(xml).toMatch(/<w:fldSimple[^>]*w:instr="[^"]*DATE[^"]*MMMM d/);
  });
});
