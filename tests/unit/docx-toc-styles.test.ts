// A Word TOC field regenerates its rows from the file's `toc 1`…`toc 9` styles. The
// cached rows are skipped on import, so the styles are read straight off styles.xml —
// without them the index falls back to the editor's own 0.5cm-per-level indent.
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importDocx } from '../../src/lib/import/docx';
import { buildDocx } from '../../src/lib/export/docx';
import { unzipSync, strFromU8 } from 'fflate';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

const CT = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

// Word's own ids are localized (Verzeichnis1 in a German file); w:name is what names the level.
const STYLES = `<?xml version="1.0"?><w:styles ${W}>
<w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Verzeichnis1"><w:name w:val="toc 1"/><w:basedOn w:val="Standard"/><w:pPr><w:spacing w:after="100"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Verzeichnis2"><w:name w:val="toc 2"/><w:basedOn w:val="Standard"/><w:pPr><w:spacing w:after="100"/><w:ind w:left="220"/></w:pPr></w:style>
</w:styles>`;

// The field's cached rows sit between `separate` and `end` and are skipped on import.
const DOCUMENT = `<?xml version="1.0"?><w:document ${W}><w:body>
<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> TOC \\o "1-3" \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Verzeichnis1"/></w:pPr><w:r><w:t>Abstract</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Verzeichnis2"/></w:pPr><w:r><w:t>Radar</w:t></w:r></w:p>
<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="berschrift1"/></w:pPr><w:r><w:t>Abstract</w:t></w:r></w:p>
</w:body></w:document>`;

const FILE = zipSync({
  '[Content_Types].xml': strToU8(CT),
  '_rels/.rels': strToU8(RELS),
  'word/_rels/document.xml.rels': strToU8(DOC_RELS),
  'word/styles.xml': strToU8(STYLES),
  'word/document.xml': strToU8(DOCUMENT),
});

const imported = () => importDocx(FILE);

describe('a TOC field', () => {
  it('names the file’s entry style for each level it lists', () => {
    const doc = imported().content as unknown as { content: { type: string; attrs?: Record<string, unknown> }[] };
    const toc = doc.content.find((b) => b.type === 'tableOfContents');
    expect(toc?.attrs?.levelStyles).toEqual(['Contents 1', 'Contents 2']);
  });

  it('brings those styles into the registry with their own indent and spacing', () => {
    const sheet = imported().styles;
    expect(sheet.paragraph['Contents 1'].para).toEqual({ spaceAfter: 5 });
    expect(sheet.paragraph['Contents 2'].para).toEqual({ spaceAfter: 5, indent: 0.39 });
  });

  it('writes the rows back under those styles, not the fallback indent', async () => {
    const r = imported();
    const toc = (r.content as never as { content: { type: string; attrs: Record<string, unknown> }[] })
      .content.find((b) => b.type === 'tableOfContents')!;
    toc.attrs.entries = [{ text: 'Radar', level: 2, page: 3 }];
    const files = unzipSync(await buildDocx(r.content as never, undefined, 'portrait', undefined, null, 'A4', r.styles));
    expect(strFromU8(files['word/document.xml'])).toContain('<w:pStyle w:val="Contents2"/>');
    expect(strFromU8(files['word/styles.xml'])).toContain('w:styleId="Contents2"');
  });
});
