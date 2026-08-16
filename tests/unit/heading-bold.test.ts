// A heading's own bold run is only "what the style supplies" where the editor's bold
// built-in still renders it — a file declaring its own heading style re-parents it.
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importDocx } from '../../src/lib/import/docx';
import { importOdt } from '../../src/lib/import/odt';
import { buildOdt } from '../../src/lib/export/odt';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const docx = (styles: string) => zipSync({
  'word/document.xml': strToU8(`<?xml version="1.0"?>
<w:document xmlns:w="${W}"><w:body>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
    <w:r><w:rPr><w:b/></w:rPr><w:t>Title</w:t></w:r></w:p>
</w:body></w:document>`),
  'word/styles.xml': strToU8(`<?xml version="1.0"?>
<w:styles xmlns:w="${W}">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  ${styles}
</w:styles>`),
});

const HEADING_BASED = '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>'
  + '<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr>'
  + '<w:rPr><w:sz w:val="40"/></w:rPr></w:style>';
const HEADING_ROOT = HEADING_BASED.replace('<w:basedOn w:val="Normal"/>', '');

const marks = (doc: any) => JSON.stringify(doc.content.content[0].content[0].marks ?? []);

describe('heading bold', () => {
  it('keeps the run mark where the file re-parents its heading style (DOCX)', () => {
    expect(marks(importDocx(docx(HEADING_BASED)))).toContain('bold');
  });

  it('drops it where the bold built-in renders the heading (DOCX)', () => {
    expect(marks(importDocx(docx(HEADING_ROOT)))).not.toContain('bold');
  });

  it('survives the ODT round trip under a re-parented heading style', async () => {
    const res: any = importDocx(docx(HEADING_BASED));
    const m = { top: 2, bottom: 2, left: 2, right: 2 };
    const back: any = importOdt(await buildOdt(res.content, m, 'portrait', undefined, undefined, 'A4', res.styles));
    expect(marks(back)).toContain('bold');
  });
});
