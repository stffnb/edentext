// Where the text sits in a box taller than it is: ODF's draw:textarea-vertical-align,
// Word's wps:bodyPr/@anchor.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';

type N = any;

const doc = (attrs: N): N => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'davor' }] },
    { type: 'paragraph', content: [{
      type: 'textBox',
      attrs: { width: 200, height: 160, ...attrs },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '53%' }] }],
    }] }],
});
const margins = { top: 2, bottom: 2, left: 2, right: 2 };

const boxOf = (r: N): N => {
  const find = (n: N): N => n?.type === 'textBox' ? n : (n?.content ?? []).map(find).find(Boolean);
  return find((r.content as N));
};

describe('a vertically anchored text box', () => {
  it('round-trips through ODF', async () => {
    const bytes = await buildOdt(doc({ textVAlign: 'middle' }), margins, 'portrait');
    expect(strFromU8(unzipSync(bytes)['content.xml'])).toContain('draw:textarea-vertical-align="middle"');
    expect(boxOf(importOdt(bytes))?.attrs.textVAlign).toBe('middle');
  });

  it('round-trips through DOCX', async () => {
    const bytes = await buildDocx(doc({ textVAlign: 'bottom' }), margins, 'portrait');
    expect(strFromU8(unzipSync(bytes)['word/document.xml'])).toContain('anchor="b"');
    expect(boxOf(importDocx(bytes))?.attrs.textVAlign).toBe('bottom');
  });

  it('leaves a top-anchored box alone', async () => {
    const odt = await buildOdt(doc({}), margins, 'portrait');
    expect(strFromU8(unzipSync(odt)['content.xml'])).toContain('draw:textarea-vertical-align="top"');
    expect(boxOf(importOdt(odt))?.attrs.textVAlign).toBeUndefined();
    const docx = await buildDocx(doc({}), margins, 'portrait');
    expect(strFromU8(unzipSync(docx)['word/document.xml'])).toContain('anchor="t"');
    expect(boxOf(importDocx(docx))?.attrs.textVAlign).toBeUndefined();
  });
});
