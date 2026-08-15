// A drawing the editor cannot author but must keep: a polygon, a polyline, a bezier
// curve and a connector's elbow. Each imports as a box drawing the file's own outline,
// and both exports write that outline back.
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';

type N = any;

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"'
  + ' xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"'
  + ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"'
  + ' xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"'
  + ' xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"'
  + ' xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';

function odt(body: string): Uint8Array {
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS} office:version="1.3">`
    + '<office:automatic-styles><style:style style:name="gr1" style:family="graphic">'
    + '<style:graphic-properties draw:fill="solid" draw:fill-color="#FFD320" draw:stroke="solid"'
    + ' svg:stroke-color="#3465A4" style:wrap="none"/></style:style></office:automatic-styles>'
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

const shape = (r: N): N => ((r.content as N).content ?? []).find((n: N) => n.type === 'textBox');
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
        {
          type: 'textBox',
          attrs: { width: 200, height: 150, shapePath: 'M 0 0 C 25 0 75 100 100 50 L 0 100 Z' },
          content: [{ type: 'paragraph' }],
        },
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
        {
          type: 'textBox',
          attrs: { width: 200, height: 100, shapePath: 'M 0 0 L 100 50 L 0 100 Z' },
          content: [{ type: 'paragraph' }],
        },
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

  it('still drops a shape whose geometry is a formula', () => {
    const r = importOdt(odt('<text:p><draw:custom-shape draw:style-name="gr1" text:anchor-type="paragraph"'
      + ' svg:width="4cm" svg:height="3cm"><text:p/><draw:enhanced-geometry draw:type="mso-spt100"'
      + ' svg:viewBox="0 0 21600 21600" draw:enhanced-path="M 0 0 L ?f0 ?f1 Z N"/></draw:custom-shape></text:p>'));
    expect(shape(r)).toBeUndefined();
    expect(r.warnings.some((w: string) => /shapes/i.test(w))).toBe(true);
  });
});
