import { describe, it, expect } from 'vitest';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { buildDocx } from '../src/lib/export/docx';
import { importDocx } from '../src/lib/import/docx';
import { HEADER_SHADE } from '../src/lib/editor/extensions/tableHeaderRow';

type N = { type: string; attrs?: any; content?: N[]; marks?: any[]; text?: string };

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const text = (t: string, marks?: any[]) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const para = (content: any, attrs: any = {}) => ({ type: 'paragraph', attrs, content: Array.isArray(content) ? content : [text(content)] });
const heading = (level: number, t: string, attrs: any = {}) => ({ type: 'heading', attrs: { level, ...attrs }, content: [text(t)] });
const li = (...content: any[]) => ({ type: 'listItem', content });
const cell = (t: string, attrs: any = {}) => ({ type: 'tableCell', attrs, content: [para(t)] });
const headerCell = (t: string, attrs: any = {}) => ({ type: 'tableHeader', attrs: { backgroundColor: HEADER_SHADE, ...attrs }, content: [para(t)] });

function walk(node: N, type: string, out: N[] = []): N[] {
  if (node.type === type) out.push(node);
  for (const c of node.content ?? []) walk(c, type, out);
  return out;
}
const hasMark = (n: N, type: string) => (n.marks ?? []).some((m: any) => m.type === type);
const markAttrs = (n: N, type: string) => (n.marks ?? []).find((m: any) => m.type === type)?.attrs;

describe('DOCX export → import round trip', () => {
  const fixture = {
    type: 'doc',
    content: [
      heading(1, 'Title', { textAlign: 'center' }),
      para([
        text('plain '),
        text('bold', [{ type: 'bold' }]),
        text(' '),
        text('red', [{ type: 'textStyle', attrs: { color: '#FF0000' } }]),
        text(' '),
        text('hi', [{ type: 'highlight', attrs: { color: '#00FF00' } }]),
        text(' '),
        text('site', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
      ], { spaceBefore: 6, spaceAfter: 6, lineHeight: '1.5', indent: 1 }),
      { type: 'paragraph', attrs: { fontSize: '22pt', textAlign: 'center' } }, // empty sized line
      para([text('a\tb')]),
      para([text('line1'), { type: 'hardBreak' }, text('line2')]),
      { type: 'bulletList', content: [li(para('one')), li(para('two'), { type: 'bulletList', content: [li(para('nested'))] })] },
      { type: 'orderedList', attrs: { listStyleType: 'lower-alpha' }, content: [li(para('alpha'))] },
      para([{ type: 'image', attrs: { src: PNG, width: 100, height: 80, wrap: 'left', alt: 'pic' } }]),
      { type: 'textBox', attrs: { width: 288, height: 96, fillColor: '#FFFFFF', strokeColor: '#000000', strokeWidthPt: 1 }, content: [
        para('box text'),
        para([text('bold in box', [{ type: 'bold' }])]),
      ] },
      { type: 'textBox', attrs: { width: 192, height: 96, wrap: 'right', shapeKind: 'ellipse', fillColor: '#FFEE00', strokeColor: '#FF0000', strokeWidthPt: 2.25, rotation: 30 }, content: [para('ellipse text')] },
      { type: 'table', content: [
        { type: 'tableRow', content: [headerCell('Name', { colwidth: [6] }), headerCell('Qty', { colwidth: [3] })] },
        { type: 'tableRow', attrs: { rowHeight: 40 }, content: [cell('Widget', { backgroundColor: '#FFFF00', rowspan: 2 }), cell('1', { borderTop: 'none', borderRight: '2.25pt solid #FF0000' })] },
        { type: 'tableRow', content: [cell('2')] },
      ] },
    ],
  } as any;

  const hf = {
    header: { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'right' }, content: [text('My header')] }] },
    footer: { type: 'doc', content: [{ type: 'paragraph', content: [text('Page '), { type: 'pageNumber' }, text(' of '), { type: 'pageCount' }] }] },
    pageCount: 1,
  } as any;

  let doc: N;
  let result: any;
  it('imports without throwing', async () => {
    const bytes = await buildDocx(fixture, { top: 2.54, bottom: 2.54, left: 2.12, right: 2.12 }, 'portrait', hf, { language: 'en', country: 'US' });
    result = importDocx(bytes);
    doc = result.content;
    expect(doc.type).toBe('doc');
  });

  it('round-trips headings + paragraph block attrs', () => {
    const h = doc.content![0];
    expect(h.type).toBe('heading');
    expect(h.attrs.level).toBe(1);
    expect(h.attrs.textAlign).toBe('center');
    const p = doc.content![1];
    expect(p.attrs.spaceBefore).toBe(6);
    expect(p.attrs.spaceAfter).toBe(6);
    expect(p.attrs.lineHeight).toBe('1.5');
    expect(p.attrs.indent).toBe(1);
  });

  it('round-trips an empty line\'s font size (paragraph-mark size)', () => {
    const empty = doc.content!.find((n) => n.type === 'paragraph' && !n.content && n.attrs?.fontSize);
    expect(empty).toBeTruthy();
    expect(empty!.attrs.fontSize).toBe('22pt');
  });

  it('round-trips run marks (bold, color, highlight, link)', () => {
    const texts = walk(doc, 'text');
    expect(hasMark(texts.find((t) => t.text === 'bold')!, 'bold')).toBe(true);
    expect(markAttrs(texts.find((t) => t.text === 'red')!, 'textStyle').color).toBe('#FF0000');
    expect(markAttrs(texts.find((t) => t.text === 'hi')!, 'highlight').color).toBe('#00FF00');
    expect(markAttrs(texts.find((t) => t.text === 'site')!, 'link').href).toBe('https://example.com');
  });

  it('round-trips tabs and hard breaks', () => {
    expect(walk(doc, 'text').some((t) => t.text!.includes('\t'))).toBe(true);
    expect(walk(doc, 'hardBreak').length).toBeGreaterThan(0);
  });

  it('reconstructs nested bullet lists and an ordered list type', () => {
    const bullets = walk(doc, 'bulletList');
    const top = bullets.find((b) => b.content!.length === 2)!;
    expect(top).toBeTruthy();
    // second item carries a nested bulletList with the "nested" paragraph
    const nested = top.content![1].content!.find((c) => c.type === 'bulletList')!;
    expect(nested).toBeTruthy();
    expect(walk(nested, 'text')[0].text).toBe('nested');
    const ol = walk(doc, 'orderedList')[0];
    expect(ol.attrs.listStyleType).toBe('lower-alpha');
  });

  it('round-trips the image (size + floating wrap)', () => {
    const img = walk(doc, 'image')[0];
    expect(img.attrs.width).toBe(100);
    expect(img.attrs.height).toBe(80);
    expect(img.attrs.wrap).toBe('left');
    expect(img.attrs.src.startsWith('data:image/png')).toBe(true);
  });

  it('round-trips text boxes: geometry, shape kind, fill/stroke, wrap, rotation', () => {
    const boxes = walk(doc, 'textBox');
    expect(boxes.length).toBe(2);
    const [plain, ellipse] = boxes;
    expect(plain.attrs.width).toBe(288);
    expect(plain.attrs.height).toBe(96);
    // Editor defaults (white fill, 1pt black stroke, no wrap/kind) are suppressed.
    expect(plain.attrs.fillColor).toBeUndefined();
    expect(plain.attrs.strokeColor).toBeUndefined();
    expect(plain.attrs.shapeKind).toBeUndefined();
    expect(plain.content!.length).toBe(2);
    expect(hasMark(walk(plain, 'text')[1], 'bold')).toBe(true);
    expect(ellipse.attrs.shapeKind).toBe('ellipse');
    expect(ellipse.attrs.wrap).toBe('right');
    expect(ellipse.attrs.rotation).toBe(30);
    expect(ellipse.attrs.fillColor).toBe('#FFEE00');
    expect(ellipse.attrs.strokeColor).toBe('#FF0000');
    expect(ellipse.attrs.strokeWidthPt).toBe(2.25);
  });

  it('round-trips the table: header shade, merged cell, covered-cell drop, row height', () => {
    const table = walk(doc, 'table')[0];
    const rows = table.content!;
    expect(rows.length).toBe(3);
    // header cells keep the shade and are NOT over-marked bold (CSS renders them)
    const headerCells = rows[0].content!;
    expect(headerCells[0].attrs.backgroundColor).toBe(HEADER_SHADE);
    expect(hasMark(walk(headerCells[0], 'text')[0], 'bold')).toBe(false);
    // rowspan reconstructed from vMerge; the covered cell in row 3 is dropped
    const widget = rows[1].content![0];
    expect(widget.attrs.rowspan).toBe(2);
    expect(widget.attrs.backgroundColor).toBe('#FFFF00');
    expect(rows[2].content!.length).toBe(1);
    expect(rows[1].attrs.rowHeight).toBe(40);
    // per-side borders (w:tcBorders): hidden top + custom red right; defaults stay null
    const qty = rows[1].content![1];
    expect(qty.attrs.borderTop).toBe('none');
    expect(qty.attrs.borderRight).toBe('2.25pt solid #FF0000');
    expect(qty.attrs.borderBottom ?? null).toBe(null);
    expect(widget.attrs.borderTop ?? null).toBe(null);
  });

  it('round-trips page geometry + header/footer with page fields', () => {
    expect(result.orientation).toBe('portrait');
    expect(result.margins.top).toBeCloseTo(2.54, 1);
    expect(result.margins.left).toBeCloseTo(2.12, 1);
    expect(walk(result.header, 'text')[0].text).toBe('My header');
    expect(result.header.content[0].attrs.textAlign).toBe('right');
    expect(walk(result.footer, 'pageNumber').length).toBe(1);
    expect(walk(result.footer, 'pageCount').length).toBe(1);
  });
});

describe('DOCX import of a foreign Word document', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Foreign Title</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First</w:t></w:r></w:p>
    <w:tbl><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>
      <w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr>
  </w:body></w:document>`;
  const stylesXml = `<?xml version="1.0"?><w:styles ${W}>
    <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="40"/><w:rFonts w:ascii="Arial"/></w:rPr></w:style>
  </w:styles>`;
  const numberingXml = `<?xml version="1.0"?><w:numbering ${W}>
    <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  </w:numbering>`;

  const bytes = zipSync({
    'word/document.xml': strToU8(documentXml),
    'word/styles.xml': strToU8(stylesXml),
    'word/numbering.xml': strToU8(numberingXml),
  });
  const result = importDocx(bytes);
  const doc = result.content as N;

  it('resolves a heading via its style chain (style-only run props)', () => {
    const h = doc.content![0];
    expect(h.type).toBe('heading');
    expect(h.attrs.level).toBe(1);
    const t = walk(h, 'text')[0];
    expect(hasMark(t, 'bold')).toBe(false); // heading bold is presentational
    expect(markAttrs(t, 'textStyle')?.fontFamily).toBe('Arial'); // resolved from the style
  });

  it('reconstructs a numbered list and a vertically-merged table', () => {
    expect(walk(doc, 'orderedList').length).toBe(1);
    const rows = walk(doc, 'table')[0].content!;
    expect(rows[0].content![0].attrs.rowspan).toBe(2); // vMerge restart → rowspan
    expect(rows[1].content!.length).toBe(1); // covered cell dropped
    expect(result.margins.top).toBeCloseTo(2.54, 1);
  });
});

describe('DOCX import: empty line keeps its paragraph-mark font size', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  // An empty paragraph whose only formatting is the paragraph mark (w:pPr/w:rPr) — 44
  // half-points = 22pt, like a title's blank spacer lines. And a plain empty paragraph.
  const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:sz w:val="44"/></w:rPr></w:pPr></w:p>
    <w:p><w:pPr><w:rPr><w:sz w:val="24"/></w:rPr></w:pPr></w:p>
    <w:p/>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr>
  </w:body></w:document>`;
  const bytes = zipSync({ 'word/document.xml': strToU8(documentXml) });
  const doc = importDocx(bytes).content as N;

  it('carries the 22pt paragraph-mark size onto the empty line', () => {
    const p = doc.content![0];
    expect(p.type).toBe('paragraph');
    expect(p.content).toBeUndefined(); // still empty
    expect(p.attrs.fontSize).toBe('22pt');
    expect(p.attrs.textAlign).toBe('center');
  });

  it('suppresses a paragraph-mark size equal to the 12pt body default', () => {
    expect(doc.content![1].attrs?.fontSize ?? null).toBeNull();
    expect(doc.content![2].attrs?.fontSize ?? null).toBeNull();
  });
});

describe('DOCX import: alignment inherited from a paragraph style', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  // The default paragraph style (Standard) sets justify; body paragraphs and a heading
  // based on it inherit it. A direct w:jc still wins over the style.
  const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:r><w:t>Inherits justify from Standard</w:t></w:r></w:p>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Direct center wins</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Heading based on Standard</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr>
  </w:body></w:document>`;
  const stylesXml = `<?xml version="1.0"?><w:styles ${W}>
    <w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/><w:pPr><w:jc w:val="both"/></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:basedOn w:val="Standard"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  </w:styles>`;
  const bytes = zipSync({ 'word/document.xml': strToU8(documentXml), 'word/styles.xml': strToU8(stylesXml) });
  const doc = importDocx(bytes).content as N;

  it('inherits justify onto a body paragraph with no direct alignment', () => {
    expect(doc.content![0].attrs.textAlign).toBe('justify');
  });
  it('lets a direct w:jc override the style', () => {
    expect(doc.content![1].attrs.textAlign).toBe('center');
  });
  it('inherits justify onto a heading based on the default style', () => {
    expect(doc.content![2].type).toBe('heading');
    expect(doc.content![2].attrs.textAlign).toBe('justify');
  });
});

describe('DOCX import resolves theme fonts (Word default = Calibri)', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  // No explicit w:ascii anywhere — the font lives only in the theme, like a real Word doc.
  const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:r><w:t>Body text</w:t></w:r></w:p>
  </w:body></w:document>`;
  const stylesXml = `<?xml version="1.0"?><w:styles ${W}>
    <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/></w:rPr></w:rPrDefault></w:docDefaults>
  </w:styles>`;
  const themeXml = `<?xml version="1.0"?><a:theme ${A}><a:themeElements><a:fontScheme>
    <a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>
    <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
  </a:fontScheme></a:themeElements></a:theme>`;

  const bytes = zipSync({
    'word/document.xml': strToU8(documentXml),
    'word/styles.xml': strToU8(stylesXml),
    'word/theme/theme1.xml': strToU8(themeXml),
  });
  const doc = importDocx(bytes).content as N;

  it('tags body text with the theme body font instead of the editor default', () => {
    const t = walk(doc, 'text')[0];
    expect(t.text).toBe('Body text');
    expect(markAttrs(t, 'textStyle')?.fontFamily).toBe('Calibri');
  });
});

describe('DOCX import detects headings by outline level (non-"HeadingN" style ids)', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  // A heading style whose id is NOT "Heading1" — only its w:outlineLvl marks it a heading.
  const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:pPr><w:pStyle w:val="Titel1"/></w:pPr><w:r><w:t>Localised heading</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr>
  </w:body></w:document>`;
  const stylesXml = `<?xml version="1.0"?><w:styles ${W}>
    <w:style w:type="paragraph" w:styleId="Standard"><w:name w:val="Standard"/></w:style>
    <w:style w:type="paragraph" w:styleId="Titel1"><w:basedOn w:val="Standard"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  </w:styles>`;
  const bytes = zipSync({ 'word/document.xml': strToU8(documentXml), 'word/styles.xml': strToU8(stylesXml) });
  const doc = importDocx(bytes).content as N;

  it('maps an outline-level-0 paragraph to heading 1', () => {
    const h = doc.content![0];
    expect(h.type).toBe('heading');
    expect(h.attrs.level).toBe(1);
    expect(walk(h, 'text')[0].text).toBe('Localised heading');
  });
});

describe('DOCX import of foreign text boxes / shapes', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const MC = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
  const WPNS = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  const ANS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  const WPSNS = 'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
  const VNS = 'xmlns:v="urn:schemas-microsoft-com:vml"';

  it('imports a Word-style mc:AlternateContent-wrapped wps text box (Choice only, no VML double-import)', () => {
    // Real Word structure: mc:Choice carries the DrawingML shape, mc:Fallback a VML copy.
    const documentXml = `<?xml version="1.0"?><w:document ${W} ${MC} ${WPNS} ${ANS} ${WPSNS} ${VNS}><w:body>
      <w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>
        <wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="2" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="0">
          <wp:simplePos x="0" y="0"/>
          <wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH>
          <wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>
          <wp:extent cx="1828800" cy="914400"/>
          <wp:wrapSquare wrapText="left"/>
          <wp:docPr id="7" name="Textfeld 7"/>
          <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
            <wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr>
              <a:xfrm rot="1800000"><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm>
              <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
              <a:solidFill><a:srgbClr val="CCFFCC"/></a:solidFill>
              <a:ln w="28575"><a:solidFill><a:srgbClr val="003300"/></a:solidFill></a:ln>
            </wps:spPr>
            <wps:txbx><w:txbxContent>
              <w:p><w:r><w:t>choice text</w:t></w:r></w:p>
              <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold line</w:t></w:r></w:p>
            </w:txbxContent></wps:txbx>
            <wps:bodyPr/></wps:wsp>
          </a:graphicData></a:graphic>
        </wp:anchor>
      </w:drawing></mc:Choice><mc:Fallback><w:pict>
        <v:rect style="width:144pt;height:72pt" fillcolor="#ccffcc"><v:textbox><w:txbxContent><w:p><w:r><w:t>choice text</w:t></w:r></w:p></w:txbxContent></v:textbox></v:rect>
      </w:pict></mc:Fallback></mc:AlternateContent></w:r><w:r><w:t>anchor text</w:t></w:r></w:p>
      <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr>
    </w:body></w:document>`;
    const result = importDocx(zipSync({ 'word/document.xml': strToU8(documentXml) }));
    const boxes = walk(result.content as N, 'textBox');
    expect(boxes.length).toBe(1); // the VML fallback must not double-import
    const b = boxes[0];
    expect(b.attrs.shapeKind).toBe('roundRect');
    expect(b.attrs.width).toBe(192); // 1828800 EMU
    expect(b.attrs.height).toBe(96);
    expect(b.attrs.wrap).toBe('right'); // text left ⇒ box right
    expect(b.attrs.rotation).toBe(30);
    expect(b.attrs.fillColor).toBe('#CCFFCC');
    expect(b.attrs.strokeColor).toBe('#003300');
    expect(b.attrs.strokeWidthPt).toBe(2.25); // 28575 EMU
    expect(walk(b, 'text').map((t) => t.text)).toEqual(['choice text', 'bold line']);
    expect(hasMark(walk(b, 'text')[1], 'bold')).toBe(true);
    // The anchor paragraph's own text survives, the box follows it at top level.
    expect(walk(result.content as N, 'text').some((t) => t.text === 'anchor text')).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('imports a legacy VML-only text box (w:pict)', () => {
    const documentXml = `<?xml version="1.0"?><w:document ${W} ${VNS}><w:body>
      <w:p><w:r><w:pict>
        <v:oval style="width:144pt;height:72pt" fillcolor="#ffee00" strokecolor="#ff0000" strokeweight="2.25pt">
          <v:textbox><w:txbxContent><w:p><w:r><w:t>vml text</w:t></w:r></w:p></w:txbxContent></v:textbox>
        </v:oval>
      </w:pict></w:r></w:p>
      <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr>
    </w:body></w:document>`;
    const result = importDocx(zipSync({ 'word/document.xml': strToU8(documentXml) }));
    const boxes = walk(result.content as N, 'textBox');
    expect(boxes.length).toBe(1);
    const b = boxes[0];
    expect(b.attrs.shapeKind).toBe('ellipse');
    expect(b.attrs.width).toBe(192); // 144pt
    expect(b.attrs.height).toBe(96);
    expect(b.attrs.fillColor).toBe('#FFEE00');
    expect(b.attrs.strokeColor).toBe('#FF0000');
    expect(b.attrs.strokeWidthPt).toBe(2.25);
    expect(walk(b, 'text')[0].text).toBe('vml text');
  });

  it('drops unsupported shapes / blip-less drawings with accurate warnings', () => {
    const documentXml = `<?xml version="1.0"?><w:document ${W} ${WPNS} ${ANS} ${WPSNS}><w:body>
      <w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
        <wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Star"/>
        <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
          <wps:wsp><wps:spPr><a:prstGeom prst="star5"><a:avLst/></a:prstGeom></wps:spPr><wps:bodyPr/></wps:wsp>
        </a:graphicData></a:graphic>
      </wp:inline></w:drawing></w:r></w:p>
      <w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
        <wp:extent cx="914400" cy="914400"/><wp:docPr id="2" name="Chart"/>
        <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic>
      </wp:inline></w:drawing></w:r></w:p>
      <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr>
    </w:body></w:document>`;
    const result = importDocx(zipSync({ 'word/document.xml': strToU8(documentXml) }));
    expect(walk(result.content as N, 'textBox').length).toBe(0);
    expect(result.warnings).toContain('Unsupported shapes were removed');
    expect(result.warnings).toContain('Drawings were removed');
    // The wrong "images could not be read" warning must NOT appear for shapes.
    expect(result.warnings).not.toContain('Some images could not be read and were skipped');
  });
});

describe('DOCX table of contents (TOC field) round trip', () => {
  const tocDoc = {
    type: 'doc',
    content: [
      { type: 'tableOfContents', attrs: { entries: [
        { text: 'Alpha', level: 1, page: 1 },
        { text: 'Beta', level: 2, page: 2 },
      ] } },
      heading(1, 'Alpha'),
      para('body of alpha'),
      heading(2, 'Beta'),
    ],
  };

  it('exports a TOC field (updateFields) and re-imports it as a tableOfContents node', async () => {
    const bytes = await buildDocx(tocDoc as any);
    const files = unzipSync(bytes);
    const docXml = strFromU8(files['word/document.xml']);
    expect(/\bTOC\b/.test(docXml)).toBe(true);
    const settings = files['word/settings.xml'];
    expect(settings ? strFromU8(settings).includes('updateFields') : false).toBe(true);

    const res = importDocx(bytes).content as N;
    const tocs = walk(res, 'tableOfContents');
    expect(tocs.length).toBe(1);
    // Headings survive alongside the TOC.
    const headings = walk(res, 'heading');
    expect(headings.map(h => walk(h, 'text')[0]?.text)).toEqual(['Alpha', 'Beta']);
  });
});
