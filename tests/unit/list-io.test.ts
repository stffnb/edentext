// List import, export and round trip: label geometry, level indents, label formatting,
// style spacing and items holding more than one block.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';
import { hasXmllint, validateOdt } from '../schemaValidate';
import { docxOf, roundTrips } from '../docxFixture';

type N = any;

const NUM = (numId = 1) => `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`;
const numItem = (text: string, pPr = '', rPr = '') => `<w:p><w:pPr>${pPr}</w:pPr><w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t>${text}</w:t></w:r></w:p>`;
const numbering = (lvl: string, nums = 1) => `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">${lvl}</w:lvl></w:abstractNum>`
  + Array.from({ length: nums }, (_, i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="0"/></w:num>`).join('');
const imported = (body: string, parts: Parameters<typeof docxOf>[1]) => importDocx(docxOf(body, parts));
const listOf = (doc: N, type = 'bulletList') => doc.content.find((n: N) => n.type === type);

// A label set a first-line indent right of the text and followed by a space (w:suff),
// with the geometry on the item's own w:ind.
describe('a list label', () => {
  const docx = (ind: string, lvl: string) => imported(numItem('one', NUM() + ind) + numItem('two', NUM() + ind),
    { numbering: numbering(`<w:start w:val="1"/><w:numFmt w:val="decimal"/>${lvl}<w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>`) }).content;
  const label = (doc: N) => {
    const { hanging = null, markerSuffix = null } = doc.content[0].attrs ?? {};
    return { hanging, markerSuffix };
  };
  const right = docx('<w:ind w:left="880" w:firstLine="480"/>', '<w:suff w:val="space"/>');
  const want = { hanging: -0.85, markerSuffix: 'space' };
  it('set a first-line indent right imports as a negative hang and a space suffix', () => {
    expect(label(right)).toEqual(want);
  });
  it('set a first-line indent right survives DOCX and ODT round trips', async () => {
    expect((await roundTrips(right)).map(label)).toEqual([want, want]);
  });
  it('counts a character indent in the paragraph style size', () => {
    // No style size: 10pt, so 2 characters are 0.71cm.
    expect(label(docx('<w:ind w:left="880" w:leftChars="400" w:firstLine="480" w:firstLineChars="200"/>', '')).hanging).toBe(-0.71);
  });
  it('with the usual hang carries no label attrs through either round trip', async () => {
    const doc = docx('', '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>');
    const none = { hanging: null, markerSuffix: null };
    expect(label(doc)).toEqual(none);
    expect((await roundTrips(doc)).map(label)).toEqual([none, none]);
  });
});

// Word's w:lvl/w:pPr/w:ind w:left and ODF's label-alignment fo:margin-left are absolute;
// the editor nests one step per level, so the attr is the step past the level above.
describe('list level indents', () => {
  const item = (text: string, sub?: N): N => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, ...(sub ? [sub] : [])] });
  const levels = (d: N) => {
    const top = listOf(d);
    return [top, top.content[0].content[1]].map((l) => l.attrs?.indent ?? null);
  };
  it('round-trip per level through both formats', async () => {
    // Level 1 sits 0.5cm right of the base, level 2 0.6cm left of its own base.
    const doc = { type: 'doc', content: [{ type: 'bulletList', attrs: { indent: 0.5 }, content: [
      item('one', { type: 'bulletList', attrs: { indent: -0.6 }, content: [item('nested')] }), item('two')] }] };
    for (const back of await roundTrips(doc)) {
      const [top, nested] = levels(back);
      expect(top).toBeCloseTo(0.5, 2);
      expect(nested).toBeCloseTo(-0.6, 2);
    }
  });
  it('leave an ordinary list unindented in both formats', async () => {
    const plain = { type: 'doc', content: [{ type: 'bulletList', content: [item('one', { type: 'bulletList', content: [item('nested')] })] }] };
    for (const back of await roundTrips(plain)) expect(levels(back)).toEqual([null, null]);
  });
  // A paragraph's own w:ind wins over the numbering level's.
  it('take a DOCX item’s own w:ind over the level’s', () => {
    const doc = imported(numItem('own indent', NUM() + '<w:ind w:left="357" w:hanging="357"/>'),
      { numbering: numbering('<w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>') }).content as N;
    // 0.63cm, one editor step (1.27cm) less than the level's own base.
    expect(doc.content[0].attrs?.indent).toBeCloseTo(0.63 - 1.27, 2);
  });

  // Numbering a paragraph style brings is outranked by that style's own indent, but not
  // by a base style's below it; numbering on the paragraph itself takes the level's.
  describe('with a paragraph style that indents', () => {
    const ind = '<w:ind w:left="357" w:hanging="357"/>';
    const lists = (imported(numItem('style', '<w:pStyle w:val="SNum"/>') + '<w:p/>'
      + numItem('direct', `<w:pStyle w:val="SInd"/>${NUM(2)}`) + '<w:p/>' + numItem('base', '<w:pStyle w:val="SNumOnInd"/>'), {
      styles: `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
        <w:style w:type="paragraph" w:styleId="SNum"><w:name w:val="SNum"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr>${ind}</w:pPr></w:style>
        <w:style w:type="paragraph" w:styleId="SInd"><w:name w:val="SInd"/><w:pPr>${ind}</w:pPr></w:style>
        <w:style w:type="paragraph" w:styleId="SNumOnInd"><w:name w:val="SNumOnInd"/><w:basedOn w:val="SInd"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>`,
      numbering: numbering('<w:numFmt w:val="bullet"/><w:lvlText w:val="*"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr>', 2),
    }).content as N).content.filter((n: N) => n.type === 'bulletList');
    it.each([
      // 0.63cm absolute: one LIST_LEFT_STEP_CM (1.27) less 0.64.
      ['take the style indent where the style brings the numbering', 0, -0.64],
      ["take the level's where the paragraph sets the numbering", 1, 1.27],
      ["take the level's over a base style's indent", 2, 1.27],
    ])('%s', (_name, i, want) => {
      expect(lists[i].attrs?.indent).toBe(want);
    });
  });
});

describe('a named style on a block in a list or a cell', () => {
  const para = { type: 'paragraph', attrs: { styleName: 'Quotations' }, content: [{ type: 'text', text: 'x' }] };
  const plain = { type: 'paragraph', content: [{ type: 'text', text: 'y' }] };
  const item = (...content: N[]) => ({ type: 'orderedList', content: [{ type: 'listItem', content }] });
  const cell = (...content: N[]) => ({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content }] }] });
  const blocks = (n: N, out: N[] = []): N[] => { if (n.type === 'paragraph') out.push(n); (n.content ?? []).forEach((c: N) => blocks(c, out)); return out; };

  it.each([['an item', item(para)], ['a further block', item(plain, para)], ['a cell', cell(para)], ['an item in a cell', cell(item(para))]])('keeps its effect in %s', async (_name, block) => {
    for (const back of await roundTrips({ type: 'doc', content: [block] })) expect(blocks(back).at(-1).attrs?.spaceAfter).toBe(14);
  });
});

describe('a font or bullet name a file can hold', () => {
  const run = (family: string) => ({ type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs: { fontFamily: family } }] });
  const list = (attrs: N, content: N[]) => ({ type: 'doc', content: [{ type: 'bulletList', attrs, content: [{ type: 'listItem', content: [{ type: 'paragraph', content }] }] }] });
  const families = (d: N) => [...JSON.stringify(d).matchAll(/"fontFamily(?:Asian)?":"((?:[^"\\\\]|\\\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));

  it.each(['Liberation Sans', 'Arial', 'AT&T Sans', "Bob's <Font>"])('%s reads back as written wherever it sits', async (family) => {
    const docs = [
      list(null, [run(family)]),
      { type: 'doc', content: [{ type: 'paragraph', attrs: { fontFamily: family }, content: [{ type: 'text', text: 'x' }] }] },
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs: { fontFamilyAsian: family } }] }] }] },
    ];
    for (const doc of docs) for (const back of await roundTrips(doc)) expect(new Set(families(back))).toEqual(new Set([family]));
  });

  it('the default font on a list adds no label format of its own', async () => {
    for (const back of await roundTrips(list(null, [run('Liberation Serif')]))) expect(listOf(back).attrs?.markerFormat ?? null).toBeNull();
  });

  it.each(['&', '<', '"'])('a bullet %s leaves the file readable', async (bulletChar) => {
    for (const back of await roundTrips(list({ bulletChar }, [{ type: 'text', text: 'x' }]))) expect(listOf(back).attrs?.bulletChar).toBe(bulletChar);
  });
});

// A level's own label formatting (w:lvl/w:rPr) colours and sizes the bullet whatever the
// item's text says; a symbol font's bullet is stored as Unicode and keeps its font, which
// sets the label's height in the line.
it("keeps a numbering level's own label formatting through import and both round trips", async () => {
  const doc = imported(numItem('one', NUM()) + numItem('two', NUM(), '<w:b/>'), { numbering: numbering(
    '<w:numFmt w:val="bullet"/><w:lvlText w:val="\uf0a8"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>'
    + '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/><w:b/><w:color w:val="006465"/><w:sz w:val="24"/></w:rPr>') }).content;
  const want = { fontFamily: 'Symbol', fontWeight: 'bold', fontSize: '12pt', color: '#006465' };
  for (const d of [doc, ...await roundTrips(doc)]) expect(listOf(d).attrs?.markerFormat).toEqual(want);
  // Both files address the glyph by its private-use code under the symbol font.
  const numberingXml = strFromU8(unzipSync(await buildDocx(doc as never))['word/numbering.xml']);
  expect(numberingXml).toMatch(/<w:lvlText w:val="\uf0a8"\/>[\s\S]*?w:ascii="Symbol"/);
  const odt = unzipSync(await buildOdt(doc as never));
  expect(strFromU8(odt['content.xml'])).toContain('text:bullet-char="\uf0a8"');
  expect(strFromU8(odt['styles.xml'])).toContain('fo:font-family="Symbol"');
});

// A list item carries no style name, so the spacing its own paragraph style gives it
// rides the block; what the default style already gives it stays off.
it("keeps the spacing an item's paragraph style gives beyond the default style's", async () => {
  const r = imported(numItem('one', '<w:pStyle w:val="Bullet"/>') + numItem('two', '<w:pStyle w:val="Bullet"/>'), {
    styles: `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>
      <w:style w:type="paragraph" w:styleId="Bullet"><w:name w:val="Bullet"/><w:basedOn w:val="Normal"/>
        <w:pPr><w:numPr><w:numId w:val="1"/></w:numPr><w:spacing w:before="40" w:after="120"/></w:pPr></w:style>`,
    numbering: numbering('<w:numFmt w:val="bullet"/><w:lvlText w:val="-"/><w:pPr><w:ind w:left="357" w:hanging="357"/></w:pPr>'),
  });
  const items = (d: N) => listOf(d).content.map((li: N) => [li.content[0].attrs.spaceBefore ?? null, li.content[0].attrs.spaceAfter ?? null]);
  for (const d of [r.content, ...await roundTrips(r.content, r.styles)]) expect(items(d)).toEqual([[2, null], [2, null]]);
});

// odf-kit writes only an item's first paragraph, so the export merges the rest into it
// (SEG) and splits them out again.
describe('a list item holding more than one block', () => {
  const p = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  const list = (item: N[]) => ({ type: 'bulletList', content: [{ type: 'listItem', content: item }] });
  const doc = (content: N[]) => ({ type: 'doc', content }) as N;
  const shape = (n: N): string => n.type + (n.content ? `(${n.content.map(shape).join(',')})` : '');
  it.each([
    ['round-trips a second paragraph', [p('one'), p('two')], 'doc(bulletList(listItem(paragraph(text),paragraph(text))))'],
    ['keeps a paragraph that follows a nested list, in its place', [p('one'), list([p('sub')]), p('after')],
      'doc(bulletList(listItem(paragraph(text),bulletList(listItem(paragraph(text))),paragraph(text))))'],
    ['keeps a second sub-list and the paragraph after it', [p('one'), list([p('sub')]), { type: 'orderedList', content: [{ type: 'listItem', content: [p('num')] }] }, p('after')],
      'doc(bulletList(listItem(paragraph(text),bulletList(listItem(paragraph(text))),orderedList(listItem(paragraph(text))),paragraph(text))))'],
  ])('%s', async (_name, item, want) => {
    const odt = await buildOdt(doc([list(item)]));
    if (hasXmllint) expect(validateOdt(unzipSync(odt))).toEqual([]);
    expect(shape(importOdt(odt).content)).toBe(want);
  });
  // DOCX keeps them on the paragraph; ODF writes a list item's blocks through styles of their own.
  it('keeps each block\'s page break and keep with next through ODF', async () => {
    const h = { type: 'heading', attrs: { level: 1, breakBefore: 'page', keepNext: false }, content: [{ type: 'text', text: 'Chapter' }] };
    const q = { type: 'paragraph', attrs: { keepNext: true }, content: [{ type: 'text', text: 'two' }] };
    const flags = (d: N) => d.content[1].content[0].content.map((b: N) => [b.attrs?.breakBefore ?? null, b.attrs?.keepNext ?? null]);
    const src = doc([p('before'), { type: 'orderedList', content: [{ type: 'listItem', content: [h, q] }] }]);
    expect(flags(importOdt(await buildOdt(src)).content)).toEqual([['page', false], [null, true]]);
  });
  it('writes the further blocks to DOCX too', async () => {
    expect(strFromU8(unzipSync(await buildDocx(doc([list([p('one'), p('two')])])))['word/document.xml'])).toContain('two');
  });
});

// Which end of the hanging indent a list label is set against: Word's w:lvlJc,
// ODF's fo:text-align on the level properties. `right` is what keeps a Roman
// numeral out of the text it labels.
const item = (text: string): N => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const doc = (markerAlign?: string): N => ({
  type: 'doc',
  content: [{
    type: 'orderedList',
    attrs: { listStyleType: 'upper-roman', ...(markerAlign ? { markerAlign } : {}) },
    content: [item('one'), item('two')],
  }],
});

const margins = { top: 2, bottom: 2, left: 2, right: 2 };
const list = (d: N) => d.content.find((n: N) => n.type === 'orderedList');

describe('a list label’s alignment', () => {
  it('round-trips through ODF', async () => {
    expect(list((await importOdt(await buildOdt(doc('right'), margins, 'portrait'))).content).attrs?.markerAlign).toBe('right');
    expect(list((await importOdt(await buildOdt(doc(), margins, 'portrait'))).content).attrs?.markerAlign).toBeUndefined();
  });

  it('round-trips through DOCX', async () => {
    expect(list(importDocx(await buildDocx(doc('right'), margins, 'portrait')).content).attrs?.markerAlign).toBe('right');
    expect(list(importDocx(await buildDocx(doc(), margins, 'portrait')).content).attrs?.markerAlign).toBeUndefined();
  });
});

// DOCX numbers nine levels and ODF ten: a list nested deeper goes on the last one, whose
// kind it takes, and the editor indents no further than the ninth.
describe('a list nested past the levels a format has', () => {
  const chain = (n: number, at = 1): N => ({ type: at % 2 ? 'orderedList' : 'bulletList', content: [{ type: 'listItem', content: [
    { type: 'paragraph', content: [{ type: 'text', text: `L${at}` }] }, ...(at < n ? [chain(n, at + 1)] : [])] }] });
  // Each text's level and the kind of list it is on.
  const levels = (doc: N) => {
    const out: string[] = [];
    const walk = (n: N, level: number, kind: string) => {
      if (n.type === 'text') out.push(`${n.text}:${level}${kind}`);
      const list = n.type === 'bulletList' || n.type === 'orderedList';
      for (const c of n.content ?? []) walk(c, list ? level + 1 : level, list ? n.type[0] : kind);
    };
    walk(doc, 0, '');
    return out;
  };
  const deep = { type: 'doc', content: [chain(12)] };
  it('goes on the ninth level in DOCX and the tenth in ODT, as both read it back', async () => {
    const [docx, odt] = await roundTrips(deep);
    const on = (last: number) => Array.from({ length: 12 }, (_, i) => `L${i + 1}:${Math.min(i + 1, last)}${Math.min(i + 1, last) % 2 ? 'o' : 'b'}`);
    expect(levels(docx)).toEqual(on(9));
    expect(levels(odt)).toEqual(on(10));
    expect(levels(importOdt(await buildOdt(deep)).content)).toEqual(on(10));
    const numbering = strFromU8(unzipSync(await buildDocx(deep))['word/numbering.xml']);
    expect(Math.max(...[...numbering.matchAll(/w:ilvl="(\d+)"/g)].map((m) => Number(m[1])))).toBe(8);
  });
});
