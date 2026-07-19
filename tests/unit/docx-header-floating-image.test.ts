import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importDocx } from '../../src/lib/import/docx';

// A 1x1 PNG — real bytes so the importer's magic-number sniff accepts the media.
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function docx(files: Record<string, string | Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) entries[k] = typeof v === 'string' ? strToU8(v) : v;
  return zipSync(entries);
}

// Header with a floating full-page VML background ("Falzmarken"-style, position:absolute,
// A4-sized) followed by a genuine inline (as-character) logo. Word templates place page
// backgrounds/watermarks in the header this way; our one-paragraph zone can't position
// them, and at full size they overlay the whole document — so they must be dropped.
const HEADER_XML = `<?xml version="1.0"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
       xmlns:r="${REL}"
       xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:v="urn:schemas-microsoft-com:vml">
  <w:p>
    <w:r><w:pict><v:shape style="position:absolute;width:595pt;height:842pt;z-index:-1"><v:imagedata r:id="rIdBg"/></v:shape></w:pict></w:r>
    <w:r><w:drawing><wp:inline><wp:extent cx="571500" cy="190500"/><a:blip r:embed="rIdLogo"/></wp:inline></w:drawing></w:r>
  </w:p>
</w:hdr>`;

const DOCUMENT_XML = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${REL}">
  <w:body>
    <w:p><w:r><w:t>Body</w:t></w:r></w:p>
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId1"/>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="567" w:footer="567"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const rel = (id: string, type: string, target: string) =>
  `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;

function images(node: any, out: any[] = []): any[] {
  if (node?.type === 'image') out.push(node);
  for (const c of node?.content ?? []) images(c, out);
  return out;
}

describe('DOCX header floating image', () => {
  const bytes = docx({
    'word/document.xml': DOCUMENT_XML,
    'word/_rels/document.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rId1', 'header', 'header1.xml')}</Relationships>`,
    'word/header1.xml': HEADER_XML,
    'word/_rels/header1.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rIdBg', 'image', 'media/bg.png')}${rel('rIdLogo', 'image', 'media/logo.png')}</Relationships>`,
    'word/media/bg.png': PNG,
    'word/media/logo.png': PNG,
  });

  it('drops the full-page floating background but keeps the inline logo', () => {
    const res = importDocx(bytes);
    const imgs = images(res.header);
    // Only the inline logo (571500 EMU ≈ 60px), never the A4-sized page background (≈794px).
    expect(imgs).toHaveLength(1);
    expect(imgs[0].attrs.width).toBe(60);
    expect(imgs.some((i) => i.attrs.width > 700)).toBe(false);
    expect([...res.warnings]).toContain('Drawings were removed');
  });
});
