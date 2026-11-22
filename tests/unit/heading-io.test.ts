// Headings through import and export: style sizes and bold, keep with next, lists on a heading.
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { getSchema } from '@tiptap/core';
import { extensions } from '../../src/lib/editor/extensions';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { builtinStyleSheet } from '../../src/lib/styles/styleSheet';
import { decimalOutline } from '../../src/lib/styles/outlineNumbering';
import { docxOf } from '../docxFixture';

type N = any;

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';
const odtOf = (styles: string, content: string) => zipSync({
  'styles.xml': strToU8(`<?xml version="1.0"?><office:document-styles ${NS}><office:styles>${styles}</office:styles></office:document-styles>`),
  'content.xml': strToU8(`<?xml version="1.0"?><office:document-content ${NS}>${content}</office:document-content>`),
});
const NORMAL = '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>';
const margins = { top: 2, bottom: 2, left: 2, right: 2 };

// LibreOffice defines heading styles relative to the Heading style ("130%"), so a
// percentage must resolve against the inherited size — otherwise the file's own size is
// dropped and the editor default silently overrides it.
describe('percentage font sizes in the ODF style chain', () => {
  const odtWithHeading = (base: string, size: string) => odtOf(`
   <style:default-style style:family="paragraph"><style:text-properties fo:font-size="12pt" fo:font-family="Liberation Serif"/></style:default-style>
   <style:style style:name="Standard" style:family="paragraph"/>
   <style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard">
    <style:text-properties style:font-name="Liberation Sans" fo:font-size="${base}" fo:font-weight="bold"/>
   </style:style>
   <style:style style:name="Heading_20_1" style:family="paragraph" style:parent-style-name="Heading">
    <style:text-properties fo:font-size="${size}"/>
   </style:style>`,
  '<office:body><office:text><text:h text:style-name="Heading_20_1" text:outline-level="1">Kapitel</text:h></office:text></office:body>');

  // The size a heading renders at: from the imported style registry, since a named
  // style's formatting is no longer copied onto the block.
  const styleSizeOf = (base: string, size: string) =>
    importOdt(odtWithHeading(base, size)).styles.paragraph['Heading 1']?.text.fontSizePt;
  const markSizeOf = (base: string, size: string) => {
    const marks = (importOdt(odtWithHeading(base, size)).content.content?.[0] as N).content[0].marks ?? [];
    return marks.find((m: N) => m.type === 'textStyle')?.attrs?.fontSize;
  };

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
  const doc = importOdt(odtOf(`
   <style:default-style style:family="paragraph"><style:text-properties fo:font-size="12pt" fo:font-family="Liberation Serif"/></style:default-style>
   <style:style style:name="Standard" style:family="paragraph"/>
   <style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard">
    <style:text-properties style:font-name="Liberation Sans" fo:font-weight="bold"/>
   </style:style>${headingStyles}`,
  `<office:body><office:text>${LO_SIZES.map((_, i) => `<text:h text:style-name="Heading_20_${i + 1}" text:outline-level="${i + 1}">H${i + 1}</text:h>`).join('')}</office:text></office:body>`)).content;

  it('keeps levels 1-5 without any direct formatting', () => {
    const blocks = (doc.content ?? []) as N[];
    expect(blocks.map((b) => b.type)).toEqual(Array(5).fill('heading'));
    expect(blocks.map((b) => b.attrs.level)).toEqual([1, 2, 3, 4, 5]);
    // No size mark (sizes match), no font mark (Liberation Sans is the heading default),
    // no spacing attrs (margins match) — the file renders as the editor's own heading style.
    expect(blocks.flatMap((b) => b.content[0].marks ?? [])).toEqual([]);
    expect(blocks.flatMap((b) => [b.attrs.spaceBefore, b.attrs.spaceAfter].filter((v) => v != null))).toEqual([]);
  });
});

// A heading in a table cell carries no style name: the level's style renders it, so the
// file's own definition of that style has to arrive even where no top-level block uses it,
// and under any other style the 9pt has to stay on the heading itself.
describe('a heading in a table cell', () => {
  const sizeOf = (res: N) => {
    const find = (n: N): N => n.type === 'heading' ? n : (n.content ?? []).map(find).find(Boolean);
    const h = find(res.content);
    const mark = h.content[0].marks?.find((m: N) => m.type === 'textStyle')?.attrs?.fontSize;
    return parseFloat(mark ?? h.attrs.fontSize ?? '') || res.styles.paragraph[`Heading ${h.attrs.level}`]?.text.fontSizePt;
  };
  const docx = (id: string, name: string) => importDocx(docxOf(`<w:tbl><w:tr><w:tc><w:p><w:pPr><w:pStyle w:val="${id}"/></w:pPr>`
    + '<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>When, where</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/>', {
    styles: NORMAL + `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>`
      + '<w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style>' }));
  const odt = (id: string, name: string) => importOdt(odtOf(`
    <style:default-style style:family="paragraph"><style:text-properties fo:font-size="12pt"/></style:default-style>
    <style:style style:name="Standard" style:family="paragraph"/>
    <style:style style:name="${id}" style:display-name="${name}" style:family="paragraph" style:parent-style-name="Standard">
     <style:text-properties fo:font-size="9pt"/></style:style>`,
  '<office:body><office:text><table:table xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"><table:table-row><table:table-cell>'
    + `<text:h text:style-name="${id}" text:outline-level="3">When, where</text:h></table:table-cell></table:table-row></table:table></office:text></office:body>`));
  it.each([
    ['DOCX, the level\'s style', () => docx('Heading3', 'heading 3')],
    ['DOCX, a style of its own', () => docx('Dates', 'Dates')],
    ['ODT, the level\'s style', () => odt('Heading_20_3', 'Heading 3')],
    ['ODT, a style of its own', () => odt('Dates', 'Dates')],
  ])('renders at the file\'s size (%s)', (_name, load) => {
    expect(sizeOf(load())).toBe(9);
  });
});

// A heading's own bold run is only "what the style supplies" where the editor's bold
// built-in still renders it — a file declaring its own heading style re-parents it.
describe('heading bold', () => {
  const HEADING_BASED = '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>'
    + '<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr>'
    + '<w:rPr><w:sz w:val="40"/></w:rPr></w:style>';
  const HEADING_ROOT = HEADING_BASED.replace('<w:basedOn w:val="Normal"/>', '');
  const docx = (style: string) => docxOf('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Title</w:t></w:r></w:p>',
    { styles: NORMAL + style });
  const marks = (doc: N) => JSON.stringify(doc.content.content[0].content[0].marks ?? []);

  it('keeps the run mark where the file re-parents its heading style (DOCX)', () => {
    expect(marks(importDocx(docx(HEADING_BASED)))).toContain('bold');
  });

  it('drops it where the bold built-in renders the heading (DOCX)', () => {
    expect(marks(importDocx(docx(HEADING_ROOT)))).not.toContain('bold');
  });

  it('survives the ODT round trip under a re-parented heading style', async () => {
    const res: N = importDocx(docx(HEADING_BASED));
    const back: N = importOdt(await buildOdt(res.content, margins, 'portrait', undefined, undefined, 'A4', res.styles));
    expect(marks(back)).toContain('bold');
  });
});

// A heading keeps with the next block because Word's and LibreOffice's heading styles
// say so; a file that defines its heading style without it lets the heading end a page,
// and that survives both formats.
describe('a heading and keep with next', () => {
  const doc: N = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Chapter' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
  ] };
  const keep = (d: N) => d.content[0].attrs.keepNext ?? null;
  const patch = (file: Uint8Array, part: string, edit: (x: string) => string) => {
    const files = unzipSync(file);
    files[part] = strToU8(edit(strFromU8(files[part])));
    return zipSync(files);
  };

  it('keeps it by default in both formats', async () => {
    expect(keep(importOdt(await buildOdt(doc)).content)).toBe(null);
    expect(keep(importDocx(await buildDocx(doc)).content)).toBe(null);
  });

  it('drops it where the DOCX heading style has none, and keeps that through both formats', async () => {
    const docx = patch(await buildDocx(doc), 'word/styles.xml', (x) => x.replace(/<w:keepNext\/>/g, ''));
    const read = importDocx(docx).content as N;
    expect(keep(read)).toBe(false);
    expect(keep(importDocx(await buildDocx(read)).content)).toBe(false);
    expect(keep(importOdt(await buildOdt(read)).content)).toBe(false);
  });

  it('drops it where the ODT heading style has none, and a heading added under that style keeps', async () => {
    const odt = patch(await buildOdt(doc), 'styles.xml', (x) => x.replace(/fo:keep-with-next="always"/g, ''));
    const read = importOdt(odt);
    expect(keep(read.content)).toBe(false);
    // As a converted Word file has it: the heading style sits on the default one.
    read.styles.paragraph['Heading 1'].parent = 'Standard';
    const added: N = { ...read.content, content: [doc.content[0], ...(read.content as N).content] };
    const back = importOdt(await buildOdt(added, undefined, undefined, undefined, undefined, undefined, read.styles)).content as N;
    expect(back.content.slice(0, 2).map((h: N) => h.attrs.keepNext ?? null)).toEqual([null, false]);
  });
});

// The registry holds no keep, so a paragraph style's keep-with-next and keep-together ride
// the block in ODT, as they do in DOCX.
it("keeps an ODT paragraph style's keep flags on its blocks", () => {
  const d = importOdt(odtOf(`
   <style:style style:name="Lead" style:family="paragraph"><style:paragraph-properties fo:keep-with-next="always" fo:keep-together="always"/></style:style>`,
  '<office:body><office:text><text:p text:style-name="Lead">a</text:p><text:p>b</text:p></office:text></office:body>')).content as N;
  expect(d.content.map((p: N) => [p.attrs.keepNext ?? null, p.attrs.keepLines ?? null])).toEqual([[true, true], [null, null]]);
});

describe('a list on a heading', () => {
  // `headingList`: the list style Heading 1 itself carries, as a file converted from DOCX has it.
  // LibreOffice's bullet on a heading: the list style rides the heading's automatic style.
  const odt = (listName: string, headingList = '') => odtOf(`
   <style:style style:name="Standard" style:family="paragraph"/>
   <style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph"
    style:parent-style-name="Standard" style:default-outline-level="1"${headingList ? ` style:list-style-name="${headingList}"` : ''}/>
   <text:list-style style:name="WWNum2"><text:list-level-style-number text:level="1" style:num-format="1"/></text:list-style>
   <text:outline-style style:name="Outline"><text:outline-level-style text:level="1" style:num-format=""/></text:outline-style>`,
  `<office:automatic-styles>
   <style:style style:name="P1" style:family="paragraph" style:parent-style-name="Heading_20_1" style:list-style-name="L1"/>
   <text:list-style style:name="L1"><text:list-level-style-bullet text:level="1" text:bullet-char="•"/></text:list-style>
  </office:automatic-styles><office:body><office:text>
   <text:list text:style-name="${listName}"><text:list-item><text:h text:style-name="P1" text:outline-level="1">Title</text:h></text:list-item></text:list>
  </office:text></office:body>`);
  const docx = () => docxOf('<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Title</w:t></w:r></w:p><w:sectPr/>', {
    styles: NORMAL + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>',
    numbering: '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>'
      + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
  });
  const schema = getSchema(extensions);
  const shape = (content: N) => content.content!.map((b: N) => [b.type, b.content?.[0]?.content?.[0]?.type ?? null]);

  it('imports LibreOffice\'s bullet on a heading as a list item holding the heading', () => {
    const { content } = importOdt(odt('L1'));
    expect(() => schema.nodeFromJSON(content).check()).not.toThrow();
    expect(shape(content)).toEqual([['bulletList', 'heading']]);
  });

  it('keeps chapter numbering a plain heading', () => {
    expect(shape(importOdt(odt('Outline')).content)).toEqual([['heading', null]]);
    expect(shape(importOdt(odt('WWNum2', 'WWNum2')).content)).toEqual([['heading', null]]);
  });

  it('imports a heading with a bullet of its own from DOCX as a list item', () => {
    const { content } = importDocx(docx());
    expect(() => schema.nodeFromJSON(content).check()).not.toThrow();
    expect(shape(content)).toEqual([['bulletList', 'heading']]);
  });

  for (const outline of [null, decimalOutline()]) {
    it(`round-trips through both formats${outline ? ' beside chapter numbering' : ''}`, async () => {
      const doc = { type: 'doc', content: [
        { type: 'bulletList', content: [
          { type: 'listItem', content: [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
            { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Sub' }] }] }] },
          ] },
          { type: 'listItem', content: [{ type: 'paragraph', attrs: { textAlign: 'right' }, content: [{ type: 'text', text: 'Next' }] }] },
        ] },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Chapter' }] },
      ] };
      const sheet = { ...builtinStyleSheet(), outline };
      const odtBytes = await buildOdt(doc as never, margins, 'portrait', undefined, null, 'A4', sheet);
      expect(strFromU8(unzipSync(odtBytes)['content.xml'])).toMatch(/<text:list-item>\s*<text:h [^>]*text:outline-level="2">Title<\/text:h><text:p[^>]*>Body/);
      const docxBytes = await buildDocx(doc as never, margins, 'portrait', undefined, null, 'A4', sheet);
      // The ODT leg also holds the items after it to their own alignment, which they keep
      // only while the item blocks are matched in order.
      const odtBack = importOdt(odtBytes).content;
      const list = odtBack.content![0];
      expect(list.content![0].content!.map((b) => b.type)).toEqual(['heading', 'paragraph', 'bulletList']);
      expect(list.content![0].content![0].attrs?.level).toBe(2);
      expect(list.content![0].content![2].content![0].content![0].attrs?.textAlign).toBe('center');
      expect(list.content![1].content![0].attrs?.textAlign).toBe('right');
      expect(odtBack.content!.at(-1)!.type).toBe('heading');
      // DOCX has no further paragraph of an item: it is one indented to the item's text.
      const docxBack = importDocx(docxBytes).content;
      expect(docxBack.content![0].content![0].content!.map((b) => b.type)).toEqual(['heading', 'paragraph', 'bulletList']);
      expect(docxBack.content![0].content![0].content![0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
      expect(docxBack.content!.at(-1)!.type).toBe('heading');
    });
  }

  // A numbered list the heading shares with body text is no chapter numbering.
  it('round-trips a numbered list on a heading through DOCX', async () => {
    const item = (block: object) => ({ type: 'listItem', content: [block] });
    const doc = { type: 'doc', content: [{ type: 'orderedList', content: [
      item({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] }),
      item({ type: 'paragraph', content: [{ type: 'text', text: 'Next' }] }),
    ] }] };
    const back = importDocx(await buildDocx(doc as never, margins, 'portrait', undefined, null, 'A4', builtinStyleSheet()));
    expect(shape(back.content)).toEqual([['orderedList', 'heading']]);
    expect(back.styles?.outline ?? null).toBeNull();
  });
});
