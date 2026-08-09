import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';
import { DEFAULT_MARGINS } from '../../src/lib/storage/pageMargins';

type N = { type: string; attrs?: any; content?: N[]; marks?: any[]; text?: string };

const bm = (text: string, name: string): N => ({ type: 'text', text, marks: [{ type: 'bookmark', attrs: { name } }] });
const ref = (name: string, format: 'text' | 'page', text: string): N =>
  ({ type: 'crossRef', attrs: { name, format, text } });

const doc: N = {
  type: 'doc',
  content: [
    { type: 'paragraph', attrs: {}, content: [{ type: 'text', text: 'Figure ' }, bm('Figure 1', 'Fig1'), { type: 'text', text: ' – a caption' }] },
    {
      type: 'paragraph',
      attrs: {},
      content: [
        { type: 'text', text: 'See ' },
        ref('Fig1', 'text', 'Figure 1'),
        { type: 'text', text: ' on page ' },
        ref('Fig1', 'page', '1'),
        { type: 'text', text: ' or ' },
        { type: 'text', text: 'jump', marks: [{ type: 'link', attrs: { href: '#Fig1' } }] },
        { type: 'text', text: '.' },
      ],
    },
  ],
};

function walk(node: N, type: string, out: N[] = []): N[] {
  if (node.type === type) out.push(node);
  for (const c of node.content ?? []) walk(c, type, out);
  return out;
}
const texts = (node: N) => walk(node, 'text');
const markAttrs = (n: N, type: string) => (n.marks ?? []).find((m: any) => m.type === type)?.attrs;

describe('bookmarks and cross-references round trip', () => {
  it('writes ODF bookmarks and reads them back', async () => {
    const bytes = await buildOdt(doc as any, DEFAULT_MARGINS, 'portrait');
    const content = strFromU8(unzipSync(bytes)['content.xml']);

    expect(content).toContain('<text:bookmark-start text:name="Fig1"/>');
    expect(content).toContain('<text:bookmark-end text:name="Fig1"/>');
    expect(content).toContain('<text:bookmark-ref text:reference-format="text" text:ref-name="Fig1">Figure 1</text:bookmark-ref>');
    expect(content).toContain('<text:bookmark-ref text:reference-format="page" text:ref-name="Fig1">1</text:bookmark-ref>');
    expect(content).not.toMatch(/[-]/);

    const back = importOdt(bytes).content as unknown as N;
    expect(texts(back).find((t) => t.text === 'Figure 1' && markAttrs(t, 'bookmark'))?.marks?.[0].attrs.name).toBe('Fig1');
    expect(walk(back, 'crossRef').map((r) => [r.attrs.name, r.attrs.format, r.attrs.text])).toEqual([
      ['Fig1', 'text', 'Figure 1'],
      ['Fig1', 'page', '1'],
    ]);
    expect(texts(back).some((t) => markAttrs(t, 'link')?.href === '#Fig1')).toBe(true);
  });

  it('writes DOCX bookmarks and reads them back', async () => {
    const bytes = await buildDocx(doc as any, DEFAULT_MARGINS, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);

    expect(xml).toContain('w:name="Fig1"');
    expect(xml).toContain('<w:bookmarkEnd');
    expect(xml).toMatch(/w:instr=" ?REF Fig1 \\h ?"/);
    expect(xml).toMatch(/w:instr=" ?PAGEREF Fig1 \\h ?"/);
    expect(xml).toContain('w:anchor="Fig1"');

    const back = importDocx(bytes).content as unknown as N;
    expect(texts(back).find((t) => t.text === 'Figure 1' && markAttrs(t, 'bookmark'))?.marks?.[0].attrs.name).toBe('Fig1');
    expect(walk(back, 'crossRef').map((r) => [r.attrs.name, r.attrs.format, r.attrs.text])).toEqual([
      ['Fig1', 'text', 'Figure 1'],
      ['Fig1', 'page', '1'],
    ]);
    expect(texts(back).some((t) => markAttrs(t, 'link')?.href === '#Fig1')).toBe(true);
  });
});
