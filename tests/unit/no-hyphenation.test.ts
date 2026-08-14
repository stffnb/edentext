// A paragraph opting out of the document's automatic hyphenation. Only "off" travels
// (Word has no per-paragraph "on"), and only where the document hyphenates at all —
// below that switch it is the default. ODF fo:hyphenate, Word w:suppressAutoHyphens.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';

type N = any;

const P = (text: string, attrs?: N): N =>
  ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content: [{ type: 'text', text }] });

const doc: N = { type: 'doc', content: [P('hyphenated'), P('whole words', { noHyphenation: true })] };
const margins = { top: 2, bottom: 2, left: 2, right: 2 };
const flagOf = (d: N, i: number) => d.content[i].attrs?.noHyphenation ?? null;

// buildOdt/buildDocx take the document switch as their 13th argument.
const odt = (on: boolean) => buildOdt(doc, margins, 'portrait', undefined, undefined, 'A4',
  undefined, undefined, undefined, false, undefined, undefined, on);
const docx = (on: boolean) => buildDocx(doc, margins, 'portrait', undefined, undefined, 'A4',
  undefined, undefined, undefined, false, undefined, undefined, on);

describe('per-paragraph hyphenation', () => {
  it('round-trips through ODF', async () => {
    const bytes = await odt(true);
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    // A text property, not a paragraph one — LibreOffice ignores it in the latter.
    expect(xml).toMatch(/<style:text-properties[^>]*fo:hyphenate="false"/);

    const back = importOdt(bytes).content as N;
    expect(flagOf(back, 0)).toBe(null);
    expect(flagOf(back, 1)).toBe(true);
  });

  it('round-trips through DOCX', async () => {
    const bytes = await docx(true);
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toContain('<w:suppressAutoHyphens/>');
    // The sentinel run is consumed, never left in the text.
    expect(xml).not.toContain('');

    const back = importDocx(bytes).content as N;
    expect(flagOf(back, 0)).toBe(null);
    expect(flagOf(back, 1)).toBe(true);
  });

  it('is dropped where the document does not hyphenate', async () => {
    expect(flagOf(importOdt(await odt(false)).content as N, 1)).toBe(null);
    expect(flagOf(importDocx(await docx(false)).content as N, 1)).toBe(null);
  });
});
