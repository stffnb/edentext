import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importOdt } from '../../src/lib/import/odt';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';

const item = (t: string) => `<text:list-item><text:p>${t}</text:p></text:list-item>`;

// A file converted from DOCX splits one numbered sequence into lists that continue each other.
function odt(body: string): Uint8Array {
  const styles = `<?xml version="1.0"?><office:document-styles ${NS}><office:styles>
   <text:list-style style:name="A"><text:list-level-style-number text:level="1" style:num-format="I"/></text:list-style>
   <text:list-style style:name="B"><text:list-level-style-number text:level="1" style:num-format="1"/><text:list-level-style-number text:level="2" style:num-format="a"/></text:list-style>
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

  it('restarts at a later item\'s own start value, and counts on from there, through both formats', async () => {
    const sv = (n: number, t: string, sub = '') => `<text:list-item text:start-value="${n}"><text:p>${t}</text:p>${sub}</text:list-item>`;
    const doc = importOdt(odt(
      `<text:list text:style-name="B">${item('1')}${item('2')}${sv(7, '7', `<text:list>${item('a')}${sv(5, 'e')}</text:list>`)}${item('8')}${sv(1, '1')}</text:list>
       <text:p/><text:list text:continue-numbering="true" text:style-name="B">${item('2')}</text:list>`,
    )).content;
    // Every ordered list's start, nested ones in document order after their item's.
    type N = { type: string; attrs?: { start?: number }; content?: N[] };
    const all = (n: N): number[] => (n.content ?? []).flatMap((c) => [...(c.type === 'orderedList' ? [c.attrs?.start ?? 1] : []), ...all(c)]);
    const want = [1, 7, 1, 5, 1, 2];
    expect(all(doc as N)).toEqual(want);
    expect(all(importOdt(await buildOdt(doc)).content as N)).toEqual(want);
    expect(all(importDocx(await buildDocx(doc)).content as N)).toEqual(want);
  });
});
