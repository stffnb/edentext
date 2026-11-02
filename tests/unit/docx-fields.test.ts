// DOCX index fields whose cached result is regenerated: bibliography and table of contents.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { importDocx } from '../../src/lib/import/docx';
import { buildDocx } from '../../src/lib/export/docx';
import { docxOf, roundTrips } from '../docxFixture';

type N = any;

const FIELD = (instr: string) => `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>${instr}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>`;
const END = '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';

// The BIBLIOGRAPHY field's cached rows are a borderless w:tbl inside the field. The index
// node is regenerated, so that table is the field's result; imported, it would print twice.
describe('a BIBLIOGRAPHY field', () => {
  const build = (styleName: string) => (importDocx(docxOf(`
    <w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Bibliographies"/></w:docPartObj></w:sdtPr><w:sdtContent>
      <w:p><w:r><w:t>Literaturverzeichnis</w:t></w:r></w:p>
      <w:sdt><w:sdtPr><w:bibliography/></w:sdtPr><w:sdtContent>
        ${FIELD('BIBLIOGRAPHY')}
        <w:tbl><w:tr><w:tc><w:p><w:r><w:t>[1] F. Kafka, Der Process, 1925.</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
        ${END}
      </w:sdtContent></w:sdt>
    </w:sdtContent></w:sdt>`, { files: {
    'customXml/item1.xml': `<?xml version="1.0"?><b:Sources xmlns:b="http://schemas.openxmlformats.org/officeDocument/2006/bibliography" StyleName="${styleName}">
      <b:Source><b:Tag>Kaf25</b:Tag><b:SourceType>Book</b:SourceType><b:Title>Der Process</b:Title><b:Year>1925</b:Year>
      <b:Author><b:Author><b:NameList><b:Person><b:Last>Kafka</b:Last><b:First>Franz</b:First></b:Person></b:NameList></b:Author></b:Author>
      </b:Source></b:Sources>`,
  } })).content as N).content as N[];

  it('becomes one index node, its cached table dropped', () => {
    expect(build('IEEE').map((b) => b.type)).toEqual(['paragraph', 'tableOfContents']);
  });
  it.each([
    ['takes the numbered style IEEE names', 'IEEE', { index: 'bibliography', citationStyle: 'numbered' }],
    ['falls back to cite-by-key where the style is one we have not got', 'Gost-Name', { citationStyle: 'key' }],
  ])('%s', (_name, style, want) => {
    expect(build(style)[1].attrs).toMatchObject(want);
  });
});

// A TOC field regenerates its rows from the file's `toc 1`…`toc 9` styles. The cached rows
// are skipped, so the styles are read off styles.xml; Word's ids are localized, w:name is
// what names the level.
describe('a TOC field', () => {
  const imported = () => importDocx(docxOf(`${FIELD(' TOC \\o "1-3" \\h ')}
    <w:p><w:pPr><w:pStyle w:val="Verzeichnis1"/></w:pPr><w:r><w:t>Abstract</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Verzeichnis2"/></w:pPr><w:r><w:t>Radar</w:t></w:r></w:p>
    ${END}<w:p><w:pPr><w:pStyle w:val="berschrift1"/></w:pPr><w:r><w:t>Abstract</w:t></w:r></w:p>`, { styles: `
    <w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Verzeichnis1"><w:name w:val="toc 1"/><w:basedOn w:val="Standard"/><w:pPr><w:spacing w:after="100"/></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="Verzeichnis2"><w:name w:val="toc 2"/><w:basedOn w:val="Standard"/><w:pPr><w:spacing w:after="100"/><w:ind w:left="220"/></w:pPr></w:style>` }));
  const tocOf = (content: N) => (content.content as N[]).find((b) => b.type === 'tableOfContents');

  it('names the file’s entry style for each level it lists', () => {
    expect(tocOf(imported().content)?.attrs?.levelStyles).toEqual(['Contents 1', 'Contents 2']);
  });
  it('brings those styles into the registry with their own indent and spacing', () => {
    const sheet = imported().styles;
    expect(sheet.paragraph['Contents 1'].para).toEqual({ spaceAfter: 5 });
    expect(sheet.paragraph['Contents 2'].para).toEqual({ spaceAfter: 5, indent: 0.39 });
  });
  it('writes the rows back under those styles, not the fallback indent', async () => {
    const r = imported();
    tocOf(r.content).attrs.entries = [{ text: 'Radar', level: 2, page: 3 }];
    const files = unzipSync(await buildDocx(r.content as never, undefined, 'portrait', undefined, null, 'A4', r.styles));
    expect(strFromU8(files['word/document.xml'])).toContain('<w:pStyle w:val="Contents2"/>');
    expect(strFromU8(files['word/styles.xml'])).toContain('w:styleId="Contents2"');
  });
});

// A TOC field's \t switch maps styles to levels of their own, which can lie past \o's range.
describe('a TOC field mapping styles with \\t', () => {
  it('lists down to the deepest level either switch names', () => {
    const r = (x: string) => `<w:r>${x}</w:r>`;
    const docx = docxOf('<w:p>'
      + r('<w:fldChar w:fldCharType="begin"/>') + r('<w:instrText xml:space="preserve"> TOC \\o "3-3" \\h \\t "Heading 1;1;Heading 4;4" </w:instrText>')
      + r('<w:fldChar w:fldCharType="separate"/>') + r('<w:t>1</w:t>') + r('<w:tab/>') + r('<w:t>Intro</w:t>') + r('<w:tab/>') + r('<w:t>2</w:t>')
      + `</w:p><w:p>${r('<w:fldChar w:fldCharType="end"/>')}</w:p>`);
    const toc = (importDocx(docx).content as any).content.find((n: any) => n.type === 'tableOfContents');
    expect(toc.attrs.maxLevel).toBe(4);
    expect(toc.attrs.entries[0].text).toBe('1\tIntro');
  });
});

// A contents row's tab between its number and its title is what sets the title at the
// level's hanging indent; read as a space, every title ran on behind its number.
describe('a tab inside a contents row', () => {
  it('survives both formats', async () => {
    const doc = { type: 'doc', content: [
      { type: 'tableOfContents', attrs: { title: '', maxLevel: 2, leader: '.', entries: [
        { text: '1\tPurpose', level: 1, page: 2 },
        { text: '1.2\tText conventions', level: 2, page: 3 },
      ] } },
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Purpose' }] },
    ] };
    for (const back of await roundTrips(doc)) {
      expect(back.content.find((n: any) => n.type === 'tableOfContents').attrs.entries.map((e: any) => e.text)).toEqual(['1\tPurpose', '1.2\tText conventions']);
    }
  });
});

// GOTOBUTTON and MACROBUTTON show text from their instruction, which a producer often
// writes with no result at all; a GOTOBUTTON's jump stays an internal link.
describe('a field showing its instruction', () => {
  const R = (inner: string) => `<w:r>${inner}</w:r>`;
  const complex = (instr: string, result = '') => R('<w:fldChar w:fldCharType="begin"/>') + R(`<w:instrText xml:space="preserve">${instr}</w:instrText>`)
    + (result ? R('<w:fldChar w:fldCharType="separate"/>') + R(`<w:t>${result}</w:t>`) : '') + R('<w:fldChar w:fldCharType="end"/>');
  const para = (field: string) => importDocx(docxOf(`<w:p><w:bookmarkStart w:id="0" w:name="Target"/>${R('<w:t>T</w:t>')}<w:bookmarkEnd w:id="0"/></w:p>
    <w:p>${R('<w:t xml:space="preserve">A </w:t>')}${field}${R('<w:t xml:space="preserve"> B</w:t>')}</w:p>`)).content;
  const shown = (doc: N) => {
    const runs = doc.content[1].content as N[];
    const linked = runs.filter((n) => n.marks?.some((m: N) => m.type === 'link')).map((n) => n.marks.find((m: N) => m.type === 'link').attrs.href);
    return { text: runs.map((n) => n.text ?? '').join(''), links: [...new Set(linked)] };
  };

  it.each([
    ['a simple GOTOBUTTON', '<w:fldSimple w:instr=" GOTOBUTTON Target Click here "/>', ['#Target']],
    ['a GOTOBUTTON without a result', complex(' GOTOBUTTON Target "Click here" '), ['#Target']],
    ['a GOTOBUTTON with a result', complex(' GOTOBUTTON Target Click here ', 'Click here'), ['#Target']],
    ['a MACROBUTTON', complex(' MACROBUTTON NoMacro Click here '), []],
  ])('keeps the text of %s', (_name, field, links) => {
    expect(shown(para(field))).toEqual({ text: 'A Click here B', links });
  });

  it('keeps the jump through both formats', async () => {
    for (const doc of await roundTrips(para(complex(' GOTOBUTTON Target Click here ')))) {
      expect(shown(doc)).toEqual({ text: 'A Click here B', links: ['#Target'] });
    }
  });
});
