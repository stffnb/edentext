// odf-kit writes the fo:padding shorthand, which LibreOffice drops when given the
// two-value form Word's asymmetric cell margins need — so the export expands it per
// side. jsdom (vitest `environment`) supplies the global DOMParser.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';

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
});
