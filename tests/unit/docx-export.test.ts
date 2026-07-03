import { describe, it, expect, beforeAll } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildDocx } from '../../src/lib/export/docx';
import { HEADER_SHADE } from '../../src/lib/editor/extensions/tableHeaderRow';

// 1×1 transparent PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const text = (t: string, marks?: any[]) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const para = (content: any, attrs: any = {}) => ({ type: 'paragraph', attrs, content: Array.isArray(content) ? content : [text(content)] });
const heading = (level: number, t: string, attrs: any = {}) => ({ type: 'heading', attrs: { level, ...attrs }, content: [text(t)] });
const li = (...content: any[]) => ({ type: 'listItem', content });
const cell = (t: string, attrs: any = {}) => ({ type: 'tableCell', attrs, content: [para(t)] });
const headerCell = (t: string, attrs: any = {}) => ({ type: 'tableHeader', attrs: { backgroundColor: HEADER_SHADE, ...attrs }, content: [para(t)] });

const fixture = {
  type: 'doc',
  content: [
    heading(1, 'Title', { textAlign: 'center' }),
    para(
      [
        text('plain '),
        text('bold', [{ type: 'bold' }]),
        text(' '),
        text('red', [{ type: 'textStyle', attrs: { color: '#FF0000' } }]),
        text(' '),
        text('hi', [{ type: 'highlight', attrs: { color: '#00FF00' } }]),
        text(' '),
        text('site', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
      ],
      { spaceBefore: 6, spaceAfter: 6, lineHeight: '1.5', indent: 1 },
    ),
    para([text('a\tb')]),
    para([text('line1'), { type: 'hardBreak' }, text('line2')]),
    { type: 'bulletList', attrs: { indent: 0 }, content: [
      li(para('one')),
      li(para('two'), { type: 'bulletList', content: [li(para('nested'))] }),
    ] },
    { type: 'orderedList', attrs: { listStyleType: 'lower-alpha' }, content: [li(para('alpha'))] },
    para([{ type: 'image', attrs: { src: PNG, width: 100, height: 80, wrap: 'left', alt: 'pic' } }]),
    { type: 'textBox', attrs: { width: 288, height: 96, wrap: 'right', shapeKind: 'ellipse', fillColor: '#FFEE00', strokeColor: '#FF0000', strokeWidthPt: 2.25, rotation: 30 }, content: [para('box text')] },
    { type: 'table', content: [
      { type: 'tableRow', content: [headerCell('Name', { colwidth: [6] }), headerCell('Qty', { colwidth: [3] })] },
      { type: 'tableRow', attrs: { rowHeight: 40 }, content: [cell('Widget', { backgroundColor: '#FFFF00', rowspan: 2 }), cell('1')] },
      { type: 'tableRow', content: [cell('2')] },
    ] },
  ],
} as any;

const hf = {
  header: { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'right' }, content: [text('My header')] }] },
  footer: { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [text('Page '), { type: 'pageNumber' }, text(' of '), { type: 'pageCount' }] }] },
  pageCount: 1,
} as any;

describe('buildDocx', () => {
  let files: Record<string, Uint8Array>;
  let bytes: Uint8Array;
  let docXml: string;
  let names: string[];

  beforeAll(async () => {
    bytes = await buildDocx(fixture, { top: 2.54, bottom: 2.54, left: 2.12, right: 2.12 }, 'portrait', hf, { language: 'en', country: 'US' });
    files = unzipSync(bytes);
    names = Object.keys(files);
    docXml = strFromU8(files['word/document.xml']);
  });

  it('produces a valid zip (PK signature) with the core OOXML parts', () => {
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(names).toContain('[Content_Types].xml');
    expect(names).toContain('word/document.xml');
    expect(names).toContain('word/numbering.xml');
    expect(names.some((n) => /^word\/media\/.*\.png$/.test(n))).toBe(true);
    expect(names.some((n) => /^word\/header\d*\.xml$/.test(n))).toBe(true);
    expect(names.some((n) => /^word\/footer\d*\.xml$/.test(n))).toBe(true);
  });

  it('emits well-formed XML in every part (Word rejects malformed XML)', () => {
    const parser = new DOMParser();
    for (const name of names.filter((n) => n.endsWith('.xml'))) {
      const doc = parser.parseFromString(strFromU8(files[name]), 'application/xml');
      expect(doc.getElementsByTagName('parsererror').length, `parse error in ${name}`).toBe(0);
    }
  });

  it('emits headings, alignment, spacing, indent and line spacing', () => {
    expect(docXml).toContain('w:pStyle w:val="Heading1"');
    expect(docXml).toContain('w:jc w:val="center"');
    expect(docXml).toContain('w:line="360"'); // 1.5 × 240
    expect(docXml).toMatch(/w:ind[^>]*w:left="567"/); // 1cm
  });

  it('emits run formatting: bold, color, highlight shading, hyperlink', () => {
    expect(docXml).toContain('<w:b/>');
    expect(docXml).toContain('w:color w:val="FF0000"');
    expect(docXml).toMatch(/w:shd[^>]*w:fill="00FF00"/); // highlight
    expect(docXml).toContain('<w:hyperlink');
  });

  it('emits tabs and hard breaks as elements', () => {
    expect(docXml).toContain('<w:tab/>');
    expect(docXml).toContain('<w:br/>');
  });

  it('emits numbered/bulleted paragraphs and a numbering definition', () => {
    expect(docXml).toContain('<w:numPr>');
    expect(docXml).toContain('<w:numId');
    const numXml = strFromU8(files['word/numbering.xml']);
    expect(numXml).toContain('w:val="bullet"');
    expect(numXml).toContain('w:val="lowerLetter"');
  });

  it('emits a fixed-layout table with merged cells and shading', () => {
    expect(docXml).toContain('<w:tbl>');
    expect(docXml).toContain('<w:tblGrid>');
    expect(docXml).toContain('w:vMerge'); // rowspan
    expect(docXml).toMatch(/w:shd[^>]*w:fill="F2F2F2"/); // header shade
    expect(docXml).toMatch(/w:shd[^>]*w:fill="FFFF00"/); // custom cell fill
    expect(docXml).toMatch(/w:trHeight[^>]*w:val="600"/); // 40px → 600 twips
  });

  it('bakes bold onto header-row cells', () => {
    // The header cells carry no bold mark; bold must be baked into their runs.
    const tbl = docXml.slice(docXml.indexOf('<w:tbl>'));
    expect(tbl).toContain('<w:b/>');
  });

  it('embeds the image as a floating (wrapped) drawing', () => {
    expect(docXml).toContain('<w:drawing>');
    expect(docXml).toContain('wp:anchor'); // floating, not inline
  });

  it('rewrites the text-box marker into a DrawingML shape (post-pack pass)', () => {
    expect(docXml).toContain('<wps:wsp');
    expect(docXml).toContain('<wps:txbx><w:txbxContent>');
    expect(docXml).toContain('prst="ellipse"');
    expect(docXml).toMatch(/a:xfrm rot="1800000"/); // 30° × 60000
    expect(docXml).toMatch(/<wp:wrapSquare wrapText="left"\/>/); // box right ⇒ text left
    expect(docXml).not.toContain('\uE008'); // marker sentinel fully consumed
  });

  it('writes page geometry with header/footer distances', () => {
    expect(docXml).toMatch(/<w:pgSz[^>]*w:w="11906"[^>]*w:h="16838"/);
    expect(docXml).toMatch(/<w:pgMar[^>]*w:header="/);
  });

  it('puts page-number / page-count fields in the footer', () => {
    const footerName = names.find((n) => /^word\/footer\d*\.xml$/.test(n))!;
    const footerXml = strFromU8(files[footerName]);
    expect(footerXml).toContain('PAGE');
    expect(footerXml).toContain('NUMPAGES');
  });
});
