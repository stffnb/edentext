// A drawing the editor cannot author but must keep: a polygon, a polyline, a bezier
// curve and a connector's elbow. Each imports as a box drawing the file's own outline,
// and both exports write that outline back.
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';
import { presetGeometry } from '../../src/lib/utils/shapePresets';
import { pathHeadPaths } from '../../src/lib/utils/shapes';

type N = any;

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"'
  + ' xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"'
  + ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"'
  + ' xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"'
  + ' xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"'
  + ' xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';

function odt(body: string, styles = ''): Uint8Array {
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS} office:version="1.3">`
    + '<office:automatic-styles><style:style style:name="gr1" style:family="graphic">'
    + '<style:graphic-properties draw:fill="solid" draw:fill-color="#FFD320" draw:stroke="solid"'
    + ` svg:stroke-color="#3465A4" style:wrap="none"/></style:style>${styles}</office:automatic-styles>`
    + `<office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  return zipSync({
    'mimetype': strToU8('application/vnd.oasis.opendocument.text'),
    'content.xml': strToU8(content),
    'styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${NS} office:version="1.3"/>`),
  });
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const VML = 'urn:schemas-microsoft-com:vml';

const docx = (body: string): Uint8Array => zipSync({
  'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:v="${VML}">`
    + `<w:body>${body}</w:body></w:document>`),
});

const shape = (r: N): N => {
  const find = (n: N): N => n?.type === 'textBox' ? n : (n?.content ?? []).map(find).find(Boolean);
  return find((r.content as N));
};
const margins = { top: 2, bottom: 2, left: 2, right: 2 };

describe('a freeform drawing', () => {
  it('reads a polygon as its own closed outline', () => {
    const r = importOdt(odt('<text:p>x</text:p><text:p><draw:polygon draw:style-name="gr1"'
      + ' text:anchor-type="paragraph" svg:width="4cm" svg:height="3cm"'
      + ' svg:viewBox="0 0 4000 3000" draw:points="0,0 4000,1000 2000,3000"/></text:p>'));
    expect(shape(r).attrs.shapePath).toBe('M 0 0 L 100 33.333 L 50 100 Z');
    expect(shape(r).attrs.fillColor).toBe('#FFD320');
  });

  it('leaves a polyline open, so it is stroked and not filled', () => {
    const r = importOdt(odt('<text:p><draw:polyline draw:style-name="gr1"'
      + ' text:anchor-type="paragraph" svg:width="4cm" svg:height="2cm"'
      + ' svg:viewBox="0 0 4000 2000" draw:points="0,0 1000,2000 4000,1000"/></text:p>'));
    expect(shape(r).attrs.shapePath).toBe('M 0 0 L 25 100 L 100 50');
  });

  it('reads the relative bezier LibreOffice writes for a curve', () => {
    const r = importOdt(odt('<text:p><draw:path draw:style-name="gr1" text:anchor-type="paragraph"'
      + ' svg:width="4cm" svg:height="3cm" svg:viewBox="0 0 4000 3000"'
      + ' svg:d="M0 0c1000 0 3000 3000 4000 1500l-4000 1500z"/></text:p>'));
    expect(shape(r).attrs.shapePath).toBe('M 0 0 C 25 0 75 100 100 50 L 0 100 Z');
  });

  it("takes a connector's elbow, and the box its endpoints span", () => {
    const r = importOdt(odt('<text:p><draw:connector draw:style-name="gr1" text:anchor-type="paragraph"'
      + ' draw:type="standard" svg:x1="1cm" svg:y1="0cm" svg:x2="6cm" svg:y2="2cm"'
      + ' svg:viewBox="0 0 5000 2000" svg:d="M1000 0h2500v2000h2500"/></text:p>'));
    const a = shape(r).attrs;
    expect(a.shapePath).toBe('M 20 0 L 70 0 L 70 100 L 120 100');
    // 5cm × 2cm at 96dpi.
    expect(a.width).toBe(189);
    expect(a.height).toBe(75.59);
  });

  it('round-trips through ODF as a non-primitive custom shape', async () => {
    const doc: N = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
        { type: 'paragraph', content: [{
          type: 'textBox',
          attrs: { width: 200, height: 150, shapePath: 'M 0 0 C 25 0 75 100 100 50 L 0 100 Z' },
          content: [{ type: 'paragraph' }],
        }] },
      ],
    };
    const bytes = await buildOdt(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    expect(xml).toContain('draw:type="non-primitive"');
    expect(xml).toContain('draw:enhanced-path="M 0 0 C 5400 0 16200 21600 21600 10800 L 0 21600 Z N"');
    expect(shape(importOdt(bytes)).attrs.shapePath).toBe('M 0 0 C 25 0 75 100 100 50 L 0 100 Z');
  });

  it('round-trips through DOCX as a custGeom', async () => {
    const doc: N = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
        { type: 'paragraph', content: [{
          type: 'textBox',
          attrs: { width: 200, height: 100, shapePath: 'M 0 0 L 100 50 L 0 100 Z' },
          content: [{ type: 'paragraph' }],
        }] },
      ],
    };
    const bytes = await buildDocx(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toContain('<a:custGeom><a:avLst/><a:pathLst><a:path');
    expect(xml).toContain('<a:moveTo><a:pt x="0" y="0"/></a:moveTo>');
    expect(shape(importDocx(bytes)).attrs.shapePath).toBe('M 0 0 L 100 50 L 0 100 Z');
  });

  it('reads the VML path LibreOffice writes into a .docx', () => {
    const body = '<w:p><w:r><w:pict>'
      + '<v:shape id="s1" coordsize="4000,3000" fillcolor="#ffd320"'
      + ' style="position:absolute;width:113.35pt;height:85.05pt"'
      + ' path="m0,0l4000,1000l2000,3000l0,0e"><v:stroke color="#3465a4"/></v:shape>'
      + '</w:pict></w:r></w:p>';
    const r = importDocx(docx(body));
    expect(shape(r).attrs.shapePath).toBe('M 0 0 L 100 33.333 L 50 100 L 0 0');
    expect(shape(r).attrs.fillColor).toBe('#FFD320');
  });

  it('drops a formula that names no equation', () => {
    const r = importOdt(odt('<text:p><draw:custom-shape draw:style-name="gr1" text:anchor-type="paragraph"'
      + ' svg:width="4cm" svg:height="3cm"><text:p/><draw:enhanced-geometry draw:type="mso-spt100"'
      + ' svg:viewBox="0 0 21600 21600" draw:enhanced-path="M 0 0 L ?f0 ?f1 Z N"/></draw:custom-shape></text:p>'));
    expect(shape(r)).toBeUndefined();
    expect(r.warnings.some((w: string) => /shapes/i.test(w))).toBe(true);
  });
});

const shapes = (r: N): N[] => {
  const out: N[] = [];
  const walk = (n: N) => { if (n?.type === 'textBox') out.push(n); (n?.content ?? []).forEach(walk); };
  walk(r.content);
  return out;
};

describe('a Word connector preset', () => {
  it('draws the elbow its formula and adjust values give', () => {
    const outline = (name: string, adj = {}, flips = {}) => presetGeometry({ name, adj, ...flips }, 3600, 3600).path;
    expect(outline('bentConnector3')).toBe('M 0 0 L 50 0 L 50 100 L 100 100');
    expect(outline('bentConnector3', { adj1: 25000 }, { flipV: true })).toBe('M 0 100 L 25 100 L 25 0 L 100 0');
    expect(outline('bentConnector2', {}, { flipH: true })).toBe('M 100 0 L 0 0 L 0 100');
    expect(outline('curvedConnector3')).toBe('M 0 0 C 25 0 50 25 50 50 C 50 75 75 100 100 100');
    expect(outline('noSuchPreset')).toBe('');
  });

  it('imports as a box drawing that outline', () => {
    const body = '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1800000" cy="720000"/>'
      + '<a:graphic><a:graphicData><wps:wsp><wps:cNvCnPr/><wps:spPr>'
      + '<a:xfrm flipV="1"><a:off x="0" y="0"/><a:ext cx="1800000" cy="720000"/></a:xfrm>'
      + '<a:prstGeom prst="bentConnector3"><a:avLst><a:gd name="adj1" fmla="val 25000"/></a:avLst></a:prstGeom>'
      + '<a:ln w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></wps:spPr><wps:bodyPr/>'
      + '</wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    const r = importDocx(zipSync({
      'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="${W}"`
        + ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
        + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
        + ' xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'
        + `<w:body>${body}</w:body></w:document>`),
    }));
    expect(shape(r).attrs.shapePath).toBe('M 0 100 L 25 100 L 25 0 L 100 0');
    expect(shape(r).attrs.strokeColor).toBe('#FF0000');
    expect(shape(r).attrs.arrowHeads).toBe('end');
    expect([...r.warnings]).toEqual([]);
  });
});

describe("an open outline's arrow heads", () => {
  it('point along the first and last segment, in real pixels', () => {
    expect(pathHeadPaths('M 0 0 L 100 0', 100, 10, 'end', 10)).toEqual(['M 100,0 L 90,3.5 L 90,-3.5 Z']);
    expect(pathHeadPaths('M 0 0 C 0 50 50 100 100 100', 100, 100, 'start', 10)).toEqual(['M 0,0 L 3.5,10 L -3.5,10 Z']);
    expect(pathHeadPaths('M 0 0 L 100 0 L 50 50 Z', 100, 100, 'both', 10)).toEqual([]);
  });

  it('come from the style ODF names them in', () => {
    const r = importOdt(odt('<text:p><draw:connector draw:style-name="grA" text:anchor-type="paragraph"'
      + ' svg:x1="1cm" svg:y1="0cm" svg:x2="6cm" svg:y2="2cm"'
      + ' svg:viewBox="0 0 5000 2000" svg:d="M0 0h2500v2000h2500"/></text:p>',
    '<style:style style:name="grA" style:family="graphic"><style:graphic-properties draw:stroke="solid"'
      + ' svg:stroke-color="#000000" draw:marker-start="Arrow" draw:marker-end="Arrow"/></style:style>'));
    expect(shape(r).attrs.arrowHeads).toBe('both');
  });

  it('round-trip through both formats', async () => {
    const box = { type: 'textBox', attrs: { width: 200, height: 100, shapePath: 'M 0 0 L 50 0 L 50 100 L 100 100',
      arrowHeads: 'start', strokeColor: '#000000' }, content: [{ type: 'paragraph' }] };
    const doc: N = { type: 'doc', content: [{ type: 'paragraph', content: [box] }] };
    const odtBytes = await buildOdt(doc, margins, 'portrait');
    expect(strFromU8(unzipSync(odtBytes)['styles.xml'])).toContain('draw:name="Arrow"');
    expect(shape(importOdt(odtBytes)).attrs.arrowHeads).toBe('start');
    const docxBytes = await buildDocx(doc, margins, 'portrait');
    expect(strFromU8(unzipSync(docxBytes)['word/document.xml'])).toContain('<a:headEnd type="triangle"/></a:ln>');
    expect(shape(importDocx(docxBytes)).attrs.arrowHeads).toBe('start');
  });
});

describe('an ODF shape group', () => {
  const group = '<style:style style:name="grG" style:family="graphic"><style:graphic-properties'
    + ' style:wrap="run-through" style:run-through="foreground" style:vertical-pos="from-top"'
    + ' style:vertical-rel="paragraph" style:horizontal-pos="from-left" style:horizontal-rel="paragraph"/></style:style>';

  it('opens as its members, placed where they sit in the anchor', () => {
    const r = importOdt(odt('<text:p>a<draw:g text:anchor-type="paragraph" draw:style-name="grG">'
      + '<draw:rect draw:style-name="gr1" svg:x="5cm" svg:y="1cm" svg:width="2cm" svg:height="1cm"><text:p/></draw:rect>'
      + '<draw:g><draw:ellipse draw:style-name="gr1" svg:x="8cm" svg:y="3cm" svg:width="1cm" svg:height="1cm"><text:p/></draw:ellipse></draw:g>'
      + '</draw:g></text:p>', group));
    const [rect, ellipse] = shapes(r);
    // A rectangle that does not grow with its text keeps its height (a thin bar as a rule).
    expect(rect.attrs).toMatchObject({ wrap: 'through', inFront: true, wrapOffset: 5, wrapOffsetY: 1, fillColor: '#FFD320', fixedHeight: true });
    expect(ellipse.attrs).toMatchObject({ shapeKind: 'ellipse', wrap: 'through', inFront: true, wrapOffset: 8, wrapOffsetY: 3 });
    expect([...r.warnings]).toEqual([]);
  });

  it('keeps an as-char group in the line, its other members over the first', () => {
    const r = importOdt(odt('<text:p>a<draw:g text:anchor-type="as-char" draw:style-name="grG">'
      + '<draw:rect draw:style-name="gr1" svg:x="0cm" svg:y="0cm" svg:width="2cm" svg:height="1cm"><text:p/></draw:rect>'
      + '<draw:line draw:style-name="gr1" svg:x1="1cm" svg:y1="0.5cm" svg:x2="3cm" svg:y2="2cm"><text:p/></draw:line>'
      + '</draw:g></text:p>', group));
    const para = (r.content as N).content[0];
    // The members' union box, 3cm by 2cm, is the group's place in the line: no member
    // fills it, so a picture holds it and both run through over it from its corner.
    const [rect, line] = para.content.filter((n: N) => n.type === 'textBox');
    expect(rect.attrs).toMatchObject({ wrap: 'through', wrapOffset: 0, wrapOffsetY: 0 });
    expect(line.attrs).toMatchObject({ shapeKind: 'line', wrap: 'through', wrapOffset: 1, wrapOffsetY: 0.5 });
    const held = para.content.filter((n: N) => n.type === 'image' && !n.attrs.wrap);
    expect(held.map((n: N) => [Math.round(n.attrs.width / 37.8), Math.round(n.attrs.height / 37.8)])).toEqual([[3, 2]]);
  });
});
