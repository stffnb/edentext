// OOXML toggles are ST_OnOff: the element being present does not mean "on", since
// w:val="false"/"0"/"off" turns it off. Word and the docx lib both write the explicit
// false form. jsdom (vitest `environment`) supplies the global DOMParser.
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importDocx } from '../../src/lib/import/docx';

const CT = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
</Relationships>`;

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const HEADER = `<?xml version="1.0"?><w:hdr ${W}><w:p><w:r><w:t>Running head</w:t></w:r></w:p></w:hdr>`;
const DOCUMENT = `<?xml version="1.0"?><w:document ${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p>
<w:sectPr><w:headerReference w:type="default" r:id="rH"/><w:titlePg w:val="false"/></w:sectPr>
</w:body></w:document>`;

const settings = (val: string) =>
  `<?xml version="1.0"?><w:settings ${W}><w:evenAndOddHeaders w:val="${val}"/></w:settings>`;

const build = (settingsXml: string) => zipSync({
  '[Content_Types].xml': strToU8(CT),
  '_rels/.rels': strToU8(RELS),
  'word/_rels/document.xml.rels': strToU8(DOC_RELS),
  'word/document.xml': strToU8(DOCUMENT),
  'word/header1.xml': strToU8(HEADER),
  'word/settings.xml': strToU8(settingsXml),
});

describe('DOCX on/off toggles', () => {
  it('reads an explicit false as off', () => {
    const r = importDocx(build(settings('false')));
    expect(r.header).not.toBeNull();
    // Both off, so the one header repeats on every page instead of odd/even variants.
    expect(r.differentOddEven).toBe(false);
    expect(r.differentFirstPage).toBe(false);
  });

  it('still reads a bare element as on', () => {
    const r = importDocx(build(`<?xml version="1.0"?><w:settings ${W}><w:evenAndOddHeaders/></w:settings>`));
    expect(r.differentOddEven).toBe(true);
  });
});
