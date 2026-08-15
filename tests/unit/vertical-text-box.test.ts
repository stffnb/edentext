// A text box whose text runs top-to-bottom. ODF keeps it as the frame style's own
// writing mode (in its *paragraph* properties — probed: in the graphic properties
// LibreOffice drops it), Word as the shape body's `vert`.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';

type N = any;

const box = (attrs: N): N => ({
  type: 'textBox',
  attrs: { width: 200, height: 160, ...attrs },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Senkrecht' }] }],
});
const doc: N = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'davor' }] }, box({ textVertical: true })],
};
const margins = { top: 2, bottom: 2, left: 2, right: 2 };

const boxOf = (r: N): N => ((r.content as N).content ?? []).find((n: N) => n.type === 'textBox');

describe('a text box with vertical text', () => {
  it('round-trips through ODF', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    expect(xml).toContain('<style:paragraph-properties style:writing-mode="tb-rl"/>');
    expect(boxOf(importOdt(bytes))?.attrs.textVertical).toBe(true);
  });

  it('round-trips through DOCX', async () => {
    const bytes = await buildDocx(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toContain('vert="vert"');
    expect(boxOf(importDocx(bytes))?.attrs.textVertical).toBe(true);
  });

  it('leaves a horizontal box alone', async () => {
    const flat: N = { ...doc, content: [doc.content[0], box({})] };
    const odt = strFromU8(unzipSync(await buildOdt(flat, margins, 'portrait'))['content.xml']);
    expect(odt).not.toContain('writing-mode="tb-rl"');
    const docx = strFromU8(unzipSync(await buildDocx(flat, margins, 'portrait'))['word/document.xml']);
    expect(docx).toContain('vert="horz"');
    expect(boxOf(importOdt(await buildOdt(flat, margins, 'portrait')))?.attrs.textVertical).toBeUndefined();
  });
});
