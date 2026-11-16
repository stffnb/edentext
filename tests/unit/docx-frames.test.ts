// DOCX import of drawings: text boxes, shapes and pictures, in the body and in the zones.
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { extensions } from '../../src/lib/editor/extensions';
import { importDocx } from '../../src/lib/import/docx';
import { docxOf, roundTrips, W_NS } from '../docxFixture';

type N = any;

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS = `xmlns:w="${W_NS}" xmlns:r="${REL}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"`
  + ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
  + ' xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:v="urn:schemas-microsoft-com:vml"';
const rels = (...r: [string, string, string][]) => '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + r.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('') + '</Relationships>';
const collect = (root: N, type: string, out: N[] = []): N[] => {
  if (root?.type === type) out.push(root);
  for (const c of root?.content ?? []) collect(c, type, out);
  return out;
};
const ZONE_SECT = (ref: string) => `<w:p><w:r><w:t>Body</w:t></w:r></w:p><w:sectPr>${ref}<w:pgSz w:w="11906" w:h="16838"/>`
  + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="567" w:footer="567"/></w:sectPr>';

// A side-wrapped frame centred on the page or the column keeps the x that centres it:
// a float has no middle, and at x 0 it would sit on the left margin.
it('keeps the x that centres a side-wrapped frame on the column or the page', () => {
  const box = (from: string) => `<w:p><w:r><w:drawing><wp:anchor allowOverlap="1"><wp:positionH relativeFrom="${from}"><wp:align>center</wp:align></wp:positionH>`
    + '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="3600000" cy="360000"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="Box"/>'
    + '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/>'
    + '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3600000" cy="360000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>'
    + '<wps:txbx><w:txbxContent><w:p><w:r><w:t>text</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp>'
    + '</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>';
  // A4, 2cm left and 3cm right margin: the page's centre sits 0.5cm right of the column's.
  const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1701" w:bottom="1134" w:left="1134"/></w:sectPr>';
  const boxes = collect(importDocx(docxOf(box('margin') + box('page') + sect)).content, 'textBox');
  expect(boxes.map((b) => b.attrs.wrapOffset)).toEqual([3, 3.5]);
});

// A shape's spPr leaves fill and line to its wps:style theme references; a custom outline
// takes the xfrm's flips.
describe('a DrawingML shape', () => {
  const shape = (xfrm: string, geom: string, txbx: boolean) => `<w:r><w:drawing><wp:anchor behindDoc="0" relativeHeight="1"><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="720000" cy="720000"/><wp:wrapNone/><wp:docPr id="1" name="s"/><a:graphic><a:graphicData uri="x"><wps:wsp><wps:spPr><a:xfrm ${xfrm}><a:off x="0" y="0"/><a:ext cx="720000" cy="720000"/></a:xfrm>${geom}</wps:spPr><wps:style><a:lnRef idx="3"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef></wps:style>${txbx ? '<wps:txbx><w:txbxContent><w:p/></w:txbxContent></wps:txbx>' : ''}<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
  const tri = '<a:custGeom><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:lnTo><a:pt x="0" y="60"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>';
  const theme = `<?xml version="1.0"?><a:theme ${NS}><a:themeElements><a:clrScheme><a:accent1><a:srgbClr val="006465"/></a:accent1></a:clrScheme><a:fmtScheme><a:lnStyleLst><a:ln w="6350"/><a:ln w="12700"/><a:ln w="19050"/></a:lnStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  const boxes = collect(importDocx(docxOf(`<w:p>${shape('', '<a:prstGeom prst="rect"/>', false)}${shape('rot="10800000" flipH="1"', tri, true)}</w:p>`,
    { files: { 'word/theme/theme1.xml': theme } })).content, 'textBox').map((b) => b.attrs);
  it('takes fill and line from its theme references', () => {
    expect(boxes[0]).toMatchObject({ fillColor: '#006465', strokeColor: '#003233', strokeWidthPt: 1.5 });
  });
  it('mirrors a custom outline by its flips', () => {
    expect(boxes[1].rotation).toBe(180);
    expect(boxes[1].shapePath.replace(/\s+/g, ' ')).toMatch(/^M 100 0 L 0 0 L 100 60 Z/);
  });
});

// A floating full-page VML background followed by an inline logo: templates put
// backgrounds in the header, and the zone keeps both, the background as a frame.
it('keeps a header’s full-page background as a frame beside the inline logo', () => {
  // A 1x1 PNG, real bytes so the importer's magic-number sniff accepts the media.
  const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNwaDgAAAKEAYEml6crAAAAAElFTkSuQmCC'), (c) => c.charCodeAt(0));
  const res = importDocx(docxOf(ZONE_SECT('<w:headerReference w:type="default" r:id="rId1"/>'), { files: {
    'word/_rels/document.xml.rels': rels(['rId1', 'header', 'header1.xml']),
    'word/header1.xml': `<?xml version="1.0"?><w:hdr ${NS}><w:p>`
      + '<w:r><w:pict><v:shape style="position:absolute;width:595pt;height:842pt;z-index:-1"><v:imagedata r:id="rIdBg"/></v:shape></w:pict></w:r>'
      + '<w:r><w:drawing><wp:inline><wp:extent cx="571500" cy="190500"/><a:blip r:embed="rIdLogo"/></wp:inline></w:drawing></w:r></w:p></w:hdr>',
    'word/_rels/header1.xml.rels': rels(['rIdBg', 'image', 'media/bg.png'], ['rIdLogo', 'image', 'media/logo.png']),
    'word/media/bg.png': PNG,
    'word/media/logo.png': PNG,
  } }));
  const imgs = collect(res.header, 'image');
  expect(imgs).toHaveLength(2);
  const [bg, logo] = imgs;
  expect(bg.attrs.wrap).not.toBe('inline');
  expect(bg.attrs.width).toBeGreaterThan(700);
  expect(logo.attrs.width).toBe(60); // 571500 EMU
  expect(logo.attrs.wrap ?? 'inline').toBe('inline');
  expect([...res.warnings]).not.toContain('Drawings were removed');
});

// A page number anchored in a text box at the right margin, next to the footer's own
// line: the zone keeps the box, and the box its live page number. Its offset below the
// bottom margin's strip counts from the footer's top, which is its paragraph's.
it('keeps a footer text box with a live page number in it', () => {
  const res = importDocx(docxOf(ZONE_SECT('<w:footerReference w:type="default" r:id="rId1"/>'), { files: {
    'word/_rels/document.xml.rels': rels(['rId1', 'footer', 'footer1.xml']),
    'word/footer1.xml': `<?xml version="1.0"?><w:ftr ${NS}><w:p>
      <w:pPr><w:tabs><w:tab w:val="center" w:pos="4513"/><w:tab w:val="left" w:pos="5687"/></w:tabs></w:pPr>
      <w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor>
        <wp:positionH relativeFrom="margin"><wp:posOffset>4968240</wp:posOffset></wp:positionH>
        <wp:positionV relativeFrom="bottomMargin"><wp:posOffset>92710</wp:posOffset></wp:positionV><wp:extent cx="788670" cy="395605"/>
        <a:graphic><a:graphicData><wps:wsp><wps:txbx><w:txbxContent><w:p><w:pPr><w:jc w:val="right"/></w:pPr>
          <w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE  \\* Arabic  \\* MERGEFORMAT </w:instrText></w:r>
          <w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>15</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>
        </w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic>
      </wp:anchor></w:drawing></mc:Choice></mc:AlternateContent></w:r>
      <w:r><w:t>Annual report</w:t></w:r></w:p></w:ftr>`,
  } }));
  const inline = (res.footer as N)?.content?.[0]?.content ?? [];
  const box = inline.find((n: N) => n.type === 'textBox');
  expect(inline.map((n: N) => n.type === 'text' ? n.text : `<${n.type}>`).join('')).toBe('<textBox>Annual report');
  expect(box.content[0].content).toEqual([{ type: 'pageNumber' }]);
  expect(box.content[0].attrs.textAlign).toBe('right');
  expect(box.attrs.wrapOffsetY).toBe(0.26);
  expect([...res.warnings]).not.toContain('Text boxes in headers or footers were flattened to text');
});

// An inline wps shape: the frame's own geometry and line, around the given parts.
const inlineShape = (cNvPr: string, xfrm: string, geom: string, rest: string) => '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1800000" cy="360000"/><wp:docPr id="1" name="S"/>'
  + `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp>${cNvPr}`
  + `<wps:spPr><a:xfrm${xfrm}><a:off x="0" y="0"/><a:ext cx="1800000" cy="360000"/></a:xfrm><a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>${rest}`
  + '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';

// Each case reads a property of every text box, then again after both exports; a DOCX
// export writes every box at its fixed extent (see buildDocx), so a growing one comes back fixed.
// A connector flipped across runs from its frame's right edge, so the head at its end
// points left; a head at the start alone is the same line run the other way.
const line = (flip: string, head: string, tail: string) => inlineShape('<wps:cNvCnPr/>', flip, 'straightConnector1',
  `<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:headEnd type="${head}"/><a:tailEnd type="${tail}"/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>`);
// A text box without a:spAutoFit keeps its extent and clips what overflows; with it the
// box grows. The top and bottom insets are apart: the text area is the box less each.
const box = (fit: string, ins = '') => inlineShape('<wps:cNvSpPr txBox="1"/>', '', 'rect',
  `</wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>text</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr${ins}>${fit}</wps:bodyPr></wps:wsp>`);

describe('a text box property through import and both exports', () => {
  it.each([
    ['a line flipped across, or headed at its start', line(' flipH="1"', 'none', 'triangle') + line('', 'triangle', 'none'),
      (b: N) => `${b.attrs.shapeKind} ${b.attrs.flipH ? 'H' : '-'}${b.attrs.flipV ? 'V' : '-'}`, ['lineArrow H-', 'lineArrow HV']],
    ['a box fixed without a:spAutoFit, growing with it', box('<a:noAutofit/>') + box('<a:spAutoFit/>'),
      (b: N) => b.attrs.fixedHeight ?? false, [true, false], [true, true]],
    ['a box with its own top and bottom inset', box('<a:noAutofit/>', ' tIns="36000" bIns="0"'),
      (b: N) => [b.attrs.paddingTopCm, b.attrs.paddingBottomCm], [[0.1, 0]]],
  ])('%s', async (_name, body, pick, want, docxWant = want) => {
    // As the editor holds it: every attr the schema defaults filled in.
    const doc = getSchema(extensions).nodeFromJSON(importDocx(docxOf(body)).content).toJSON();
    expect(collect(doc, 'textBox').map(pick)).toEqual(want);
    const [docx, odt] = await roundTrips(doc);
    expect(collect(docx, 'textBox').map(pick), 'DOCX').toEqual(docxWant);
    expect(collect(odt, 'textBox').map(pick), 'ODT').toEqual(want);
  });
});
