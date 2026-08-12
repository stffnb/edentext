import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importOdt } from '../../src/lib/import/odt';

// text:display="none" — on a style it hides the paragraph, on a field it hides the
// stored value. A hidden heading is the exception: it carries the outline the running
// head reads, and the editor can hold it only by rendering it.
const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';

const styles = `<?xml version="1.0"?><office:document-styles ${NS}><office:styles>
   <style:default-style style:family="paragraph">
    <style:text-properties fo:font-size="12pt" fo:font-family="Liberation Serif"/>
   </style:default-style>
   <style:style style:name="Standard" style:family="paragraph"/>
   <style:style style:name="Marker" style:family="paragraph" style:parent-style-name="Standard">
    <style:text-properties text:display="none"/>
   </style:style>
  </office:styles></office:document-styles>`;

function odt(body: string): Uint8Array {
  const content = `<?xml version="1.0"?><office:document-content ${NS}>
   <office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  return zipSync({ 'content.xml': strToU8(content), 'styles.xml': strToU8(styles) });
}

const blocks = (body: string) => importOdt(odt(body)).content.content ?? [];
const textOf = (n: { content?: { text?: string }[] }) => (n.content ?? []).map((c) => c.text ?? '').join('');

describe('hidden text on ODF import', () => {
  it('drops the whole paragraph a style hides, not just its text', () => {
    const out = blocks('<text:p text:style-name="Marker">Hidden</text:p><text:p>Visible</text:p>');
    expect(out.map(textOf)).toEqual(['Visible']);
  });

  it('keeps a hidden heading, which the running head reads as the chapter', () => {
    const out = blocks('<text:h text:style-name="Marker" text:outline-level="1">Chapter 1</text:h>'
      + '<text:p>Visible</text:p>');
    expect(out.map(textOf)).toEqual(['Chapter 1', 'Visible']);
  });

  it('renders nothing for a field the file marks as not displayed', () => {
    const out = blocks('<text:p>a<text:user-field-get text:display="none" text:name="M">42</text:user-field-get>b</text:p>');
    expect(out.map(textOf)).toEqual(['ab']);
  });

  it('says so, rather than dropping content silently', () => {
    expect(importOdt(odt('<text:p text:style-name="Marker">x</text:p>')).warnings)
      .toContain('Hidden text was removed');
  });
});
