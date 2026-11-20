// Paragraph indents: the first line (split into w:firstLine / w:hanging by sign in
// OOXML, one signed fo:text-indent in ODF) and the right indent. jsdom (vitest
// `environment`) supplies the global DOMParser.
import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';

type N = any;

const P = (text: string, attrs?: N): N =>
  ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content: [{ type: 'text', text }] });

const doc: N = {
  type: 'doc',
  content: [
    P('plain'),
    P('hanging', { indent: 2.5, indentFirst: -2.5 }),
    P('first line in', { indentFirst: 1.25 }),
    P('narrowed', { indent: 1, indentRight: 3 }),
    // Out into both margins, as a page-wide picture's paragraph does.
    P('bleeding', { indent: -2.54, indentRight: -2.54 }),
    // Past a cell's padding and edge, which LibreOffice draws too.
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 },
      content: [P('cell', { indent: -0.6, indentRight: -0.6 })] }] }] },
    P('after'),
  ],
};

const margins = { top: 2, bottom: 2, left: 2, right: 2 };
const firstOf = (d: N, i: number) => d.content[i].attrs?.indentFirst ?? null;
const rightOf = (d: N, i: number) => d.content[i].attrs?.indentRight ?? null;
const cellIndents = (d: N) => { const a = d.content[5].content[0].content[0].content[0].attrs; return [a?.indent, a?.indentRight]; };

describe('first-line indent', () => {
  it('round-trips through ODF', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait');
    expect(strFromU8(unzipSync(bytes)['content.xml'])).toMatch(/fo:text-indent="-2\.5cm"/);

    // odf-kit has no right-indent option, so it rides the PBX sentinel's minted style.
    expect(strFromU8(unzipSync(bytes)['content.xml'])).toMatch(/fo:margin-right="3cm"/);

    const back = importOdt(bytes).content as N;
    expect(firstOf(back, 0)).toBe(null);
    expect(firstOf(back, 1)).toBe(-2.5);
    expect(firstOf(back, 2)).toBe(1.25);
    expect(rightOf(back, 3)).toBe(3);
    expect(rightOf(back, 0)).toBe(null);
    expect([back.content[4].attrs?.indent, rightOf(back, 4)]).toEqual([-2.54, -2.54]);
    expect(cellIndents(back)).toEqual([-0.6, -0.6]);
  });

  it('round-trips through DOCX', async () => {
    const bytes = await buildDocx(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toMatch(/w:hanging="1417"/);
    expect(xml).toMatch(/w:firstLine="709"/);
    expect(xml).toMatch(/w:right="1701"/);

    const back = importDocx(bytes).content as N;
    expect(firstOf(back, 0)).toBe(null);
    expect(firstOf(back, 1)).toBe(-2.5);
    expect(firstOf(back, 2)).toBe(1.25);
    expect(rightOf(back, 3)).toBe(3);
    expect(rightOf(back, 0)).toBe(null);
    expect([back.content[4].attrs?.indent, rightOf(back, 4)]).toEqual([-2.54, -2.54]);
    expect(cellIndents(back)).toEqual([-0.6, -0.6]);
  });
});

// East Asian text indents its first line by characters of the block's size.
describe('first-line indent in characters', () => {
  const cjk: N = { type: 'doc', content: [
    P('中文段落', { indentFirstChars: 2, fontSize: '16pt' }),
    P('悬挂', { indentFirstChars: -1 }),
  ] };
  const charsOf = (d: N, i: number) => d.content[i].attrs?.indentFirstChars ?? null;

  it('round-trips through ODF as LibreOffice writes it', async () => {
    const bytes = await buildOdt(cjk, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    expect(xml).toMatch(/loext:text-indent="2ic"/);
    expect(xml).toMatch(/xmlns:loext=/);
    const back = importOdt(bytes).content as N;
    expect([charsOf(back, 0), charsOf(back, 1)]).toEqual([2, -1]);
    expect(firstOf(back, 0)).toBe(null);
  });

  it('round-trips through DOCX with a twips fallback', async () => {
    const bytes = await buildDocx(cjk, margins, 'portrait');
    const files = unzipSync(bytes);
    const xml = strFromU8(files['word/document.xml']);
    expect(xml).toMatch(/w:firstLineChars="200"/);
    expect(xml).toMatch(/w:firstLine="640"/);
    expect(charsOf(importDocx(bytes).content as N, 0)).toBe(2);

    files['word/document.xml'] = strToU8(xml.replace('w:firstLineChars="200"', 'w:hangingChars="150"'));
    expect(charsOf(importDocx(zipSync(files)).content as N, 0)).toBe(-1.5);
  });

  const lefts: N = { type: 'doc', content: [
    P('左缩进', { indentChars: 2, indentFirstChars: -1 }),
    P('只有左', { indentChars: 3 }),
    P('右', { indentRightChars: 1.5 }),
  ] };
  const rightCharsOf = (d: N, i: number) => d.content[i].attrs?.indentRightChars ?? null;
  const leftOf = (d: N, i: number) => d.content[i].attrs?.indentChars ?? null;

  it('carries left and right indents in characters', async () => {
    const odt = await buildOdt(lefts, margins, 'portrait');
    expect(strFromU8(unzipSync(odt)['content.xml'])).toMatch(/loext:margin-left="2ic"/);
    const fromOdt = importOdt(odt).content as N;
    expect([leftOf(fromOdt, 0), charsOf(fromOdt, 0), leftOf(fromOdt, 1)]).toEqual([2, -1, 3]);
    expect(strFromU8(unzipSync(odt)['content.xml'])).toMatch(/loext:margin-right="1\.5ic"/);
    expect(rightCharsOf(fromOdt, 2)).toBe(1.5);

    // Word counts the left indent without the hanging part (LibreOffice adds them).
    const docx = await buildDocx(lefts, margins, 'portrait');
    const xml = strFromU8(unzipSync(docx)['word/document.xml']);
    expect(xml).toMatch(/<w:ind w:leftChars="100" w:hangingChars="100" w:left="\d+" w:hanging="\d+"\/>/);
    expect(xml).not.toMatch(/\uE025/);
    const fromDocx = importDocx(docx).content as N;
    expect([leftOf(fromDocx, 0), charsOf(fromDocx, 0), leftOf(fromDocx, 1)]).toEqual([2, -1, 3]);
    expect(xml).toMatch(/<w:ind w:rightChars="150" w:right="\d+"\/>/);
    expect([rightCharsOf(fromDocx, 2), fromDocx.content[2].attrs.indentRight ?? null]).toEqual([1.5, null]);
    expect(fromDocx.content[0].attrs.indent ?? null).toBe(null);
  });

  it('reads Word character indents as LibreOffice does', async () => {
    const files = unzipSync(await buildDocx({ type: 'doc', content: [P('x'), P('y'), P('z')] }, margins, 'portrait'));
    const xml = strFromU8(files['word/document.xml']);
    const inds = ['w:left="1134" w:hangingChars="100"', 'w:leftChars="0" w:left="1134"', 'w:leftChars="200" w:left="2000"'];
    let i = 0;
    files['word/document.xml'] = strToU8(xml.replace(/<w:p>/g, () => `<w:p><w:pPr><w:ind ${inds[i++]}/></w:pPr>`));
    const back = importDocx(zipSync(files)).content as N;
    expect([leftOf(back, 0), charsOf(back, 0)]).toEqual([1, -1]);
    expect([leftOf(back, 1), back.content[1].attrs.indent]).toEqual([null, 2]);
    expect(leftOf(back, 2)).toBe(2);
  });
});
