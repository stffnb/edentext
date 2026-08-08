// Tab stops: positions are cm from the left text margin in both formats (probe: a Word
// stop at 100mm in a 30mm-indented paragraph stays 100mm in ODF and renders there), so
// neither side shifts them by the paragraph indent.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';
import { parseTabStops, formatTabStops, nextStopCm } from '../../src/lib/editor/extensions/tabStops';

type N = any;

const P = (text: string, attrs?: N): N =>
  ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content: [{ type: 'text', text }] });

const doc: N = {
  type: 'doc',
  content: [
    P('plain'),
    P('left\tcentred\tright\t12.34', { tabStops: '6c;12r;16d' }),
    P('indented\tright', { indent: 3, tabStops: '10r' }),
  ],
};

const margins = { top: 2, bottom: 2, left: 2, right: 2 };
const stopsOf = (d: N, i: number) => d.content[i].attrs?.tabStops ?? null;

describe('tab stops', () => {
  it('parses and formats the canonical attr form', () => {
    expect(parseTabStops('6c;12r;16d')).toEqual([
      { pos: 6, align: 'center', leader: null },
      { pos: 12, align: 'right', leader: null },
      { pos: 16, align: 'decimal', leader: null },
    ]);
    // Sorted, deduped by position, rounded to 0.01cm; empty becomes null.
    expect(formatTabStops([{ pos: 12, align: 'right' }, { pos: 1.004, align: 'left' }])).toBe('1l;12r');
    expect(formatTabStops([])).toBe(null);
    expect(parseTabStops(null)).toEqual([]);
  });

  it('advances to the next stop, else the next grid multiple', () => {
    // The rule a run of tabs is walked with: LibreOffice carries the run onto the next
    // line and restarts the grid there, which is what the break widget reproduces.
    expect(nextStopCm(0, [], 1.25)).toBeCloseTo(1.25, 3);
    expect(nextStopCm(1.25, [], 1.25)).toBeCloseTo(2.5, 3);
    expect(nextStopCm(1.65, [], 1.25)).toBeCloseTo(2.5, 3);
    // A custom stop right of the pen wins over the grid; past the last one the grid
    // takes over again, on its own absolute multiples rather than from that stop.
    expect(nextStopCm(1, [6, 12], 1.25)).toBeCloseTo(6, 3);
    expect(nextStopCm(6, [6, 12], 1.25)).toBeCloseTo(12, 3);
    expect(nextStopCm(12, [6, 12], 1.25)).toBeCloseTo(12.5, 3);
  });

  it('round-trips through ODF', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    expect(xml).toMatch(/<style:tab-stop style:position="6cm" style:type="center"\/>/);
    // ODF's decimal stop is style:type="char" plus the separator itself.
    expect(xml).toMatch(/style:position="16cm" style:type="char" style:char="\."/);

    const back = importOdt(bytes).content as N;
    expect(stopsOf(back, 0)).toBe(null);
    expect(stopsOf(back, 1)).toBe('6c;12r;16d');
    expect(stopsOf(back, 2)).toBe('10r');
  });

  it('round-trips through DOCX', async () => {
    const bytes = await buildDocx(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toMatch(/<w:tab w:val="center" w:pos="3402"\/>/);
    expect(xml).toMatch(/<w:tab w:val="decimal" w:pos="9071"\/>/);
    // The indented paragraph's stop keeps its margin-relative position.
    expect(xml).toMatch(/<w:tab w:val="right" w:pos="5669"\/>/);

    const back = importDocx(bytes).content as N;
    expect(stopsOf(back, 0)).toBe(null);
    expect(stopsOf(back, 1)).toBe('6c;12r;16d');
    expect(stopsOf(back, 2)).toBe('10r');
  });
});
