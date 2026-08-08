// odf-kit writes the fo:padding shorthand, which LibreOffice drops when given the
// two-value form Word's asymmetric cell margins need — so the export expands it per
// side. jsdom (vitest `environment`) supplies the global DOMParser.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';
import { cellPaddingAttr } from '../../src/lib/editor/extensions/tableCellPadding';

type N = any;

const P = (text: string): N => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const cell = (text: string): N =>
  ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [120] }, content: [P(text)] });

const doc: N = {
  type: 'doc',
  content: [
    P('Before'),
    { type: 'table', content: [
      { type: 'tableRow', content: [cell('A1'), cell('B1')] },
      { type: 'tableRow', content: [cell('A2'), cell('B2')] },
    ] },
  ],
};

describe('table cell padding', () => {
  it('exports per-side padding, never the shorthand', async () => {
    const bytes = await buildOdt(doc, { top: 2, bottom: 2, left: 2, right: 2 }, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);

    const cellProps = xml.match(/<style:table-cell-properties\b[^>]*>/g) ?? [];
    expect(cellProps.length).toBeGreaterThan(0);
    for (const props of cellProps) {
      expect(props).not.toMatch(/fo:padding="/);
      expect(props).toMatch(/fo:padding-left="0\.19cm"/);
      expect(props).toMatch(/fo:padding-right="0\.19cm"/);
      expect(props).toMatch(/fo:padding-top="0cm"/);
      expect(props).toMatch(/fo:padding-bottom="0cm"/);
    }
  });

  it('collapses a producer-rounded default, keeps a real value', () => {
    // Word's 108 twips and LibreOffice's 0.191cm are both our 0.19cm default.
    expect(cellPaddingAttr([0, 0.1905, 0, 0.191])).toBeNull();
    expect(cellPaddingAttr([0.026, 0.026, 0.026, 0.026])).toEqual([0.026, 0.026, 0.026, 0.026]);
  });

  it('round-trips a table’s own cell margins', async () => {
    const tight: N = structuredClone(doc);
    tight.content[1].attrs = { cellPadding: [0.03, 0.05, 0.03, 0.05] };
    const bytes = await buildOdt(tight, { top: 2, bottom: 2, left: 2, right: 2 }, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    expect(xml).toMatch(/fo:padding-left="0\.05cm"/);
    expect(xml).toMatch(/fo:padding-top="0\.03cm"/);

    const back = await importOdt(bytes);
    const table = back.content.content!.find((n: N) => n.type === 'table') as N;
    expect(table.attrs?.cellPadding).toEqual([0.03, 0.05, 0.03, 0.05]);

    const docx = await buildDocx(tight, { top: 2, bottom: 2, left: 2, right: 2 }, 'portrait');
    const backDocx = importDocx(docx);
    const docxTable = backDocx.content.content!.find((n: N) => n.type === 'table') as N;
    // Word measures in twips, so 0.05cm comes back a twentieth of a point off.
    for (const [i, cm] of [0.03, 0.05, 0.03, 0.05].entries()) {
      expect(docxTable.attrs?.cellPadding[i]).toBeCloseTo(cm, 2);
    }
  });
});
