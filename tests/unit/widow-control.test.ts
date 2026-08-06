// Widow-orphan control is on by default in both formats, so only "off" travels:
// DOCX w:widowControl (direct or inherited), ODF fo:widows/fo:orphans="0".
// jsdom (vitest `environment`) supplies the global DOMParser.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';

type N = any;

const P = (text: string, attrs?: N): N =>
  ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content: [{ type: 'text', text }] });

const doc: N = {
  type: 'doc',
  content: [P('guarded'), P('unguarded', { widowControl: false })],
};

const margins = { top: 2, bottom: 2, left: 2, right: 2 };
const widowOf = (d: N, i: number) => d.content[i].attrs?.widowControl ?? null;

describe('widow-orphan control', () => {
  it('round-trips through ODF', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    expect(xml).toMatch(/fo:orphans="0" fo:widows="0"/);

    const back = importOdt(bytes).content as N;
    expect(widowOf(back, 0)).toBe(null);
    expect(widowOf(back, 1)).toBe(false);
  });

  it('round-trips through DOCX', async () => {
    const bytes = await buildDocx(doc, margins, 'portrait');
    const back = importDocx(bytes).content as N;
    expect(widowOf(back, 0)).toBe(null);
    expect(widowOf(back, 1)).toBe(false);
  });
});
