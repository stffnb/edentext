// Paragraph indents: the first line (split into w:firstLine / w:hanging by sign in
// OOXML, one signed fo:text-indent in ODF) and the right indent. jsdom (vitest
// `environment`) supplies the global DOMParser.
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
  content: [
    P('plain'),
    P('hanging', { indent: 2.5, indentFirst: -2.5 }),
    P('first line in', { indentFirst: 1.25 }),
    P('narrowed', { indent: 1, indentRight: 3 }),
  ],
};

const margins = { top: 2, bottom: 2, left: 2, right: 2 };
const firstOf = (d: N, i: number) => d.content[i].attrs?.indentFirst ?? null;
const rightOf = (d: N, i: number) => d.content[i].attrs?.indentRight ?? null;

describe('first-line indent', () => {
  it('round-trips through ODF', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait');
    expect(strFromU8(unzipSync(bytes)['content.xml'])).toMatch(/fo:text-indent="-2\.5cm"/);

    // odf-kit has no right-indent option, so it rides the PBX sentinel's minted style.
    expect(strFromU8(unzipSync(bytes)['content.xml'])).toMatch(/fo:margin-right="3cm"/);

    const back = importOdt(bytes).content as N;
    expect(firstOf(back, 0)).toBe(null);
    expect(firstOf(back, 1)).toBe(-2.5);
    expect(firstOf(back, 2)).toBe(1.25);
    expect(rightOf(back, 3)).toBe(3);
    expect(rightOf(back, 0)).toBe(null);
  });

  it('round-trips through DOCX', async () => {
    const bytes = await buildDocx(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toMatch(/w:hanging="1417"/);
    expect(xml).toMatch(/w:firstLine="709"/);
    expect(xml).toMatch(/w:right="1701"/);

    const back = importDocx(bytes).content as N;
    expect(firstOf(back, 0)).toBe(null);
    expect(firstOf(back, 1)).toBe(-2.5);
    expect(firstOf(back, 2)).toBe(1.25);
    expect(rightOf(back, 3)).toBe(3);
    expect(rightOf(back, 0)).toBe(null);
  });
});
