import { describe, it, expect } from 'vitest';
import { DocxStyles } from '../../src/lib/import/docxStyles';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// Word's "Normal" (here LibreOffice's German "Standard"): the w:default="1" paragraph
// style carries the real body font, while docDefaults still says Times New Roman.
const STYLES = `<?xml version="1.0"?>
<w:styles xmlns:w="${W}">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr></w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Standard">
    <w:name w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Listenabsatz">
    <w:name w:val="List Paragraph"/><w:basedOn w:val="Standard"/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Quote">
    <w:name w:val="Quote"/>
    <w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/></w:rPr>
  </w:style>
</w:styles>`;

const styles = () => new DocxStyles(new DOMParser().parseFromString(STYLES, 'application/xml'), null);

describe('DocxStyles.paragraphRun', () => {
  it('applies the default paragraph style to a paragraph with no w:pStyle', () => {
    expect(styles().paragraphRun(null)).toMatchObject({ font: 'Arial', sizeHalfPt: 22 });
  });

  it('resolves a pStyle through its basedOn chain to the default style', () => {
    expect(styles().paragraphRun('Listenabsatz')).toMatchObject({ font: 'Arial', sizeHalfPt: 22 });
  });

  it("lets a pStyle's own font win over the default style", () => {
    expect(styles().paragraphRun('Quote').font).toBe('Georgia');
  });

  it('falls back to docDefaults when there is no default paragraph style', () => {
    const bare = `<?xml version="1.0"?>
      <w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>
        <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>
      </w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;
    const s = new DocxStyles(new DOMParser().parseFromString(bare, 'application/xml'), null);
    expect(s.paragraphRun(null).font).toBe('Times New Roman');
  });
});

describe('DocxStyles.paragraphSpacing', () => {
  it('is empty when no layer sets spacing (Word implies 0)', () => {
    expect(styles().paragraphSpacing(null)).toEqual({});
  });

  it("reads modern Word's docDefaults spacing", () => {
    const modern = `<?xml version="1.0"?>
      <w:styles xmlns:w="${W}">
        <w:docDefaults><w:pPrDefault><w:pPr>
          <w:spacing w:after="160" w:line="259" w:lineRule="auto"/>
        </w:pPr></w:pPrDefault></w:docDefaults>
        <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
        <w:style w:type="paragraph" w:styleId="NoSpacing">
          <w:name w:val="No Spacing"/><w:basedOn w:val="Normal"/>
          <w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>
        </w:style>
      </w:styles>`;
    const s = new DocxStyles(new DOMParser().parseFromString(modern, 'application/xml'), null);
    expect(s.paragraphSpacing(null)).toMatchObject({ after: 160, line: 259 });
    expect(s.paragraphSpacing('NoSpacing')).toMatchObject({ after: 0, line: 240 });
  });
});
