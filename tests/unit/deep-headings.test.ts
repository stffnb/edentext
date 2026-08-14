// Heading levels 7–10: both word processors go that far, HTML stops at h6. The level
// must survive both formats — an outline level ODF writes as-is and Word carries in the
// style name — instead of collapsing onto level 6.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt, MAX_HEADING_LEVEL, HEADING_STYLE_OVERRIDES } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';
import { builtinStyleSheet, resolveStyle } from '../../src/lib/styles/styleSheet';

type N = any;

const H = (level: number): N =>
  ({ type: 'heading', attrs: { level, styleName: `Heading ${level}` }, content: [{ type: 'text', text: `Level ${level}` }] });

const doc: N = { type: 'doc', content: [1, 6, 7, 8, 9, 10].map(H) };
const margins = { top: 2, bottom: 2, left: 2, right: 2 };
const levels = (d: N) => d.content.filter((b: N) => b.type === 'heading').map((b: N) => b.attrs.level);

describe('heading levels 7–10', () => {
  it('offers ten levels, with a built-in style each', () => {
    expect(MAX_HEADING_LEVEL).toBe(10);
    expect(HEADING_STYLE_OVERRIDES).toHaveLength(10);
    const sheet = builtinStyleSheet();
    for (let level = 7; level <= 10; level++) {
      expect(resolveStyle(sheet, `Heading ${level}`).text.fontSizePt).toBe(12);
    }
  });

  it('round-trips through ODF', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    expect(xml).toContain('text:outline-level="10"');
    expect(levels(importOdt(bytes).content as N)).toEqual([1, 6, 7, 8, 9, 10]);
  });

  it('round-trips through DOCX', async () => {
    const bytes = await buildDocx(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toContain('w:val="Heading10"');
    expect(levels(importDocx(bytes).content as N)).toEqual([1, 6, 7, 8, 9, 10]);
  });
});
