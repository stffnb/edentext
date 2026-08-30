// Word writes a BIBLIOGRAPHY field's cached rows as a borderless w:tbl inside the field.
// The index node is regenerated, so that table is the field's result and not content —
// imported it would print the whole list a second time.
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importDocx } from '../../src/lib/import/docx';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const B = 'http://schemas.openxmlformats.org/officeDocument/2006/bibliography';

const CT = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const sources = (styleName: string) => `<?xml version="1.0"?><b:Sources xmlns:b="${B}" StyleName="${styleName}">
<b:Source><b:Tag>Kaf25</b:Tag><b:SourceType>Book</b:SourceType><b:Title>Der Process</b:Title><b:Year>1925</b:Year>
<b:Author><b:Author><b:NameList><b:Person><b:Last>Kafka</b:Last><b:First>Franz</b:First></b:Person></b:NameList></b:Author></b:Author>
</b:Source></b:Sources>`;

// The shape Word writes: a Bibliographies content control holding the heading, then the
// field, whose cached result between `separate` and `end` is a table.
const DOCUMENT = `<?xml version="1.0"?><w:document ${W}><w:body>
<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Bibliographies"/></w:docPartObj></w:sdtPr><w:sdtContent>
  <w:p><w:r><w:t>Literaturverzeichnis</w:t></w:r></w:p>
  <w:sdt><w:sdtPr><w:bibliography/></w:sdtPr><w:sdtContent>
    <w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>BIBLIOGRAPHY</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>[1] F. Kafka, Der Process, 1925.</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
  </w:sdtContent></w:sdt>
</w:sdtContent></w:sdt>
</w:body></w:document>`;

const build = (styleName: string) => zipSync({
  '[Content_Types].xml': strToU8(CT),
  '_rels/.rels': strToU8(RELS),
  'word/document.xml': strToU8(DOCUMENT),
  'customXml/item1.xml': strToU8(sources(styleName)),
});

const types = (doc: { content?: { type: string }[] }): string[] => (doc.content ?? []).map((b) => b.type);

describe('a BIBLIOGRAPHY field', () => {
  it('becomes one index node, its cached table dropped', () => {
    const doc = importDocx(build('IEEE')).content as unknown as { content?: { type: string }[] };
    expect(types(doc)).toEqual(['paragraph', 'tableOfContents']);
  });

  it('takes the numbered style IEEE names', () => {
    const doc = importDocx(build('IEEE')).content as unknown as { content?: { type: string; attrs?: Record<string, unknown> }[] };
    expect(doc.content![1].attrs).toMatchObject({ index: 'bibliography', citationStyle: 'numbered' });
  });

  it('falls back to cite-by-key where the style is one we have not got', () => {
    const doc = importDocx(build('Gost-Name')).content as unknown as { content?: { attrs?: Record<string, unknown> }[] };
    expect(doc.content![1].attrs).toMatchObject({ citationStyle: 'key' });
  });
});
