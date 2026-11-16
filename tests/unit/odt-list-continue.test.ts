import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importOdt } from '../../src/lib/import/odt';

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';

const item = (t: string) => `<text:list-item><text:p>${t}</text:p></text:list-item>`;

// A file converted from DOCX splits one numbered sequence into lists that continue each other.
function odt(body: string): Uint8Array {
  const styles = `<?xml version="1.0"?><office:document-styles ${NS}><office:styles>
   <text:list-style style:name="A"><text:list-level-style-number text:level="1" style:num-format="I"/></text:list-style>
   <text:list-style style:name="B"><text:list-level-style-number text:level="1" style:num-format="1"/></text:list-style>
  </office:styles></office:document-styles>`;
  const content = `<?xml version="1.0"?><office:document-content ${NS}><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  return zipSync({ 'content.xml': strToU8(content), 'styles.xml': strToU8(styles) });
}

const starts = (bytes: Uint8Array) =>
  (importOdt(bytes).content.content as { type: string; attrs?: { start?: number } }[])
    .filter((n) => n.type === 'orderedList').map((n) => n.attrs?.start ?? 1);

describe('ODT list continuation', () => {
  it('continues the latest list of the same style, past one of another style', () => {
    expect(starts(odt(
      `<text:list xml:id="x" text:style-name="A">${item('1')}${item('2')}</text:list>
       <text:list text:style-name="B">${item('b')}</text:list>
       <text:list text:continue-numbering="true" text:style-name="A">${item('3')}</text:list>
       <text:list text:continue-list="x" text:style-name="A">${item('3')}</text:list>
       <text:list text:style-name="A">${item('1')}</text:list>
       <text:list text:continue-list="x" text:style-name="A"><text:list-item text:start-value="1"><text:p>r</text:p></text:list-item></text:list>`,
    ))).toEqual([1, 1, 3, 3, 1, 1]); // an item's own start value restarts a continued list
  });
});
