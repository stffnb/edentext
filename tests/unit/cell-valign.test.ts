// A cell's verticalAlign attr round-trips through DOCX (w:vAlign); the ODF leg
// (style:vertical-align) rides along in roundtrip.test.ts.
import { describe, it, expect } from 'vitest';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';

type N = any;

const cell = (text: string, verticalAlign?: string): N => ({
  type: 'tableCell',
  attrs: { colspan: 1, rowspan: 1, colwidth: [120], ...(verticalAlign ? { verticalAlign } : {}) },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('table cell vertical alignment', () => {
  it('round-trips middle/bottom and leaves top unset', async () => {
    const doc: N = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        { type: 'table', content: [
          { type: 'tableRow', content: [cell('A', 'middle'), cell('B', 'bottom'), cell('C')] },
        ] },
      ],
    };
    const res = importDocx(await buildDocx(doc, { top: 2, bottom: 2, left: 2, right: 2 }, 'portrait'));
    const cells = (res.content.content!.find((n: N) => n.type === 'table') as N).content[0].content;
    expect(cells.map((c: N) => c.attrs?.verticalAlign ?? null)).toEqual(['middle', 'bottom', null]);
  });
});
