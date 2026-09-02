import { describe, it, expect } from 'vitest';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { builtinStyleSheet } from '../../src/lib/styles/styleSheet';
import { outlineCss, outlineLabel, type OutlineNumbering } from '../../src/lib/styles/outlineNumbering';
import { formatOrdinal } from '../../src/lib/utils/orderedListTypes';

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';

// Level 1 "1. ", level 2 "1.1 " — LibreOffice's own Tools ▸ Heading Numbering shape.
const outline: OutlineNumbering = [
  { format: '1', prefix: '', suffix: '. ', displayLevels: 1, start: 1 },
  { format: '1', prefix: '', suffix: ' ', displayLevels: 2, start: 1 },
  { format: 'A', prefix: '', suffix: ') ', displayLevels: 1, start: 2 },
];

function odtWithOutline(): Uint8Array {
  const styles = `<?xml version="1.0"?><office:document-styles ${NS}><office:styles>
   <style:style style:name="Standard" style:family="paragraph"/>
   <text:outline-style style:name="Outline">
    <text:outline-level-style text:level="1" style:num-suffix=". " style:num-format="1"/>
    <text:outline-level-style text:level="2" style:num-suffix=" " style:num-format="1" text:display-levels="2"/>
    <text:outline-level-style text:level="3" style:num-suffix=") " style:num-format="A" text:start-value="2"/>
   </text:outline-style>
  </office:styles></office:document-styles>`;
  const content = `<?xml version="1.0"?><office:document-content ${NS}><office:body><office:text>
   <text:h text:outline-level="1" text:style-name="Standard">One</text:h>
  </office:text></office:body></office:document-content>`;
  return zipSync({ 'content.xml': strToU8(content), 'styles.xml': strToU8(styles) });
}

const headingDoc = {
  type: 'doc',
  content: [1, 2, 3].map((level) => ({
    type: 'heading', attrs: { level }, content: [{ type: 'text', text: `H${level}` }],
  })),
};
const margins = { top: 2, bottom: 2, left: 2, right: 2 };

describe('chapter numbering', () => {
  it('reads text:outline-style, level 1 first', () => {
    expect(importOdt(odtWithOutline()).styles?.outline).toEqual(outline);
  });

  it('round-trips through ODT', async () => {
    const sheet = { ...builtinStyleSheet(), outline };
    const bytes = await buildOdt(headingDoc as never, margins, 'portrait', undefined, null, 'A4', sheet);
    const styles = strFromU8(unzipSync(bytes)['styles.xml']);
    expect(styles).toContain('<text:outline-style');
    expect(importOdt(bytes).styles?.outline).toEqual(outline);
  });

  it('round-trips through DOCX as a numbering the heading styles carry', async () => {
    const sheet = { ...builtinStyleSheet(), outline };
    const bytes = await buildDocx(headingDoc as never, margins, 'portrait', undefined, null, 'A4', sheet);
    const files = unzipSync(bytes);
    expect(strFromU8(files['word/numbering.xml'])).toContain('<w:pStyle w:val="Heading1"/>');
    expect(strFromU8(files['word/styles.xml'])).toMatch(/w:styleId="Heading2"[\s\S]*?<w:numPr><w:ilvl w:val="1"\/>/);
    // Word carries no prefix/suffix of its own — they live in the level text, so what
    // comes back is the same label, split the same way.
    expect(importDocx(bytes).styles?.outline).toEqual(outline);
  });

  it('labels a level from the counts in force', () => {
    expect(outlineLabel(outline, 1, [3], formatOrdinal)).toBe('3. ');
    expect(outlineLabel(outline, 2, [3, 4], formatOrdinal)).toBe('3.4 ');
    expect(outlineLabel(outline, 3, [3, 4, 2], formatOrdinal)).toBe('B) ');
  });

  it('draws the label with counters that reset down the levels', () => {
    const css = outlineCss(outline);
    expect(css).toContain('counter-increment: edt-outline-1');
    expect(css).toMatch(/h2::before \{\n {2}content: counter\(edt-outline-1, decimal\) "\." counter\(edt-outline-2, decimal\) " ";/);
    // A heading in a cell or a list item is not part of the chapter count.
    expect(css).toContain('counter-increment: none');
  });
});
