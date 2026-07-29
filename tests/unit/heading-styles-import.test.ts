import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importOdt } from '../../src/lib/import/odt';

// LibreOffice defines heading styles relative to the Heading style ("130%"), so a
// percentage must resolve against the inherited size — otherwise the file's own size is
// dropped and the editor default silently overrides it.
const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';

function odtWithHeading(base: string, size: string): Uint8Array {
  const styles = `<?xml version="1.0"?><office:document-styles ${NS}><office:styles>
   <style:default-style style:family="paragraph"><style:text-properties fo:font-size="12pt" fo:font-family="Liberation Serif"/></style:default-style>
   <style:style style:name="Standard" style:family="paragraph"/>
   <style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard">
    <style:text-properties style:font-name="Liberation Sans" fo:font-size="${base}" fo:font-weight="bold"/>
   </style:style>
   <style:style style:name="Heading_20_1" style:family="paragraph" style:parent-style-name="Heading">
    <style:text-properties fo:font-size="${size}"/>
   </style:style>
  </office:styles></office:document-styles>`;
  const content = `<?xml version="1.0"?><office:document-content ${NS}><office:body><office:text>
   <text:h text:style-name="Heading_20_1" text:outline-level="1">Kapitel</text:h>
  </office:text></office:body></office:document-content>`;
  return zipSync({ 'content.xml': strToU8(content), 'styles.xml': strToU8(styles) });
}

// The size a heading renders at: from the imported style registry, since a named
// style's formatting is no longer copied onto the block.
const styleSizeOf = (base: string, size: string) =>
  importOdt(odtWithHeading(base, size)).styles.paragraph['Heading 1']?.text.fontSizePt;

const markSizeOf = (base: string, size: string) => {
  const marks = (importOdt(odtWithHeading(base, size)).content.content?.[0] as any).content[0].marks ?? [];
  return marks.find((m: any) => m.type === 'textStyle')?.attrs?.fontSize;
};

describe('percentage font sizes in the ODF style chain', () => {
  it('resolves a percentage against the parent style', () => {
    expect(styleSizeOf('12pt', '150%')).toBe(18);
    expect(styleSizeOf('16pt', '125%')).toBe(20);
    expect(styleSizeOf('14pt', '130%')).toBe(18.2);
  });

  it('still reads absolute sizes', () => {
    expect(styleSizeOf('14pt', '24pt')).toBe(24);
  });

  it('leaves the block free of direct formatting either way', () => {
    expect(markSizeOf('12pt', '150%')).toBeUndefined();
    expect(markSizeOf('16pt', '125%')).toBeUndefined();
  });
});

// A document written by LibreOffice must come in looking exactly as it does there:
// its heading styles equal the editor defaults, so nothing lands as direct formatting.
describe('LibreOffice heading styles import unchanged', () => {
  const LO_SIZES = ['18pt', '16pt', '14pt', '13pt', '12pt'];
  const headingStyles = LO_SIZES.map(
    (size, i) => `<style:style style:name="Heading_20_${i + 1}" style:family="paragraph" style:parent-style-name="Heading">
     <style:paragraph-properties fo:margin-top="0.423cm" fo:margin-bottom="0.212cm"/>
     <style:text-properties fo:font-size="${size}"/></style:style>`,
  ).join('');
  const styles = `<?xml version="1.0"?><office:document-styles ${NS}><office:styles>
   <style:default-style style:family="paragraph"><style:text-properties fo:font-size="12pt" fo:font-family="Liberation Serif"/></style:default-style>
   <style:style style:name="Standard" style:family="paragraph"/>
   <style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard">
    <style:text-properties style:font-name="Liberation Sans" fo:font-weight="bold"/>
   </style:style>${headingStyles}</office:styles></office:document-styles>`;
  const content = `<?xml version="1.0"?><office:document-content ${NS}><office:body><office:text>
   ${LO_SIZES.map((_, i) => `<text:h text:style-name="Heading_20_${i + 1}" text:outline-level="${i + 1}">H${i + 1}</text:h>`).join('')}
  </office:text></office:body></office:document-content>`;
  const doc = importOdt(zipSync({ 'content.xml': strToU8(content), 'styles.xml': strToU8(styles) })).content;

  it('keeps levels 1-5 without any direct formatting', () => {
    const blocks = (doc.content ?? []) as any[];
    expect(blocks.map((b) => b.type)).toEqual(Array(5).fill('heading'));
    expect(blocks.map((b) => b.attrs.level)).toEqual([1, 2, 3, 4, 5]);
    // No size mark (sizes match), no font mark (Liberation Sans is the heading default),
    // no spacing attrs (margins match) — the file renders as the editor's own heading style.
    expect(blocks.flatMap((b) => b.content[0].marks ?? [])).toEqual([]);
    expect(blocks.flatMap((b) => [b.attrs.spaceBefore, b.attrs.spaceAfter].filter((v) => v != null))).toEqual([]);
  });
});
