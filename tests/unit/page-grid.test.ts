import { describe, it, expect } from 'vitest';
import { PageGrid, gridFromRuns, rowSpanGroups, type Band } from '../../src/lib/editor/extensions/pageBreaks';

// A4 portrait / landscape at 96dpi, plus the 20px gap between two pages.
const P = 1123;
const L = 794;
const GAP = 20;

describe('PageGrid', () => {
  it('is uniform until a section says otherwise', () => {
    const g = new PageGrid(P);
    expect(g.topOf(1)).toBe(0);
    expect(g.topOf(3)).toBe(2 * (P + GAP));
    expect(g.pageAt(0)).toBe(1);
    expect(g.pageAt(P + GAP)).toBe(2);
    expect(g.pageAt(2 * (P + GAP) + 10)).toBe(3);
  });

  it('moves every page below a section on its own paper', () => {
    const g = new PageGrid(P);
    g.setFrom(2, L);
    g.setFrom(3, P);
    expect(g.heightOf(2)).toBe(L);
    expect(g.heightOf(3)).toBe(P);
    expect(g.topOf(2)).toBe(P + GAP);
    expect(g.topOf(3)).toBe(P + GAP + L + GAP);
    expect(g.pageAt(P + GAP)).toBe(2);
    expect(g.pageAt(P + GAP + L + GAP)).toBe(3);
    expect(g.bottomOf(3)).toBe(P + GAP + L + GAP + P);
  });

  it('lets a later run replace one it starts on', () => {
    const g = new PageGrid(P);
    g.setFrom(4, L);
    g.setFrom(4, P);
    expect(g.heightOf(4)).toBe(P);
    expect(g.topOf(5)).toBe(4 * (P + GAP));
  });

  it('boxes every page for the layers that paint them', () => {
    const g = new PageGrid(P);
    g.setFrom(2, L);
    expect(g.boxes(3)).toEqual([
      { top: 0, height: P },
      { top: P + GAP, height: L },
      { top: P + GAP + L + GAP, height: L },
    ]);
  });

  it('reads back the runs it publishes', () => {
    const g = gridFromRuns(`2|${L},3|${P}`, P);
    expect(g.heightOf(1)).toBe(P);
    expect(g.heightOf(2)).toBe(L);
    expect(g.heightOf(3)).toBe(P);
    // A document with no sections writes no runs at all.
    expect(gridFromRuns('', P).heightOf(9)).toBe(P);
  });

  // [topFirst, topRest, bottomFirst, bottomRest] — a page's own header and footer reach.
  const BASE: Band = [76, 76, 76, 76];

  it('gives a section its own content band', () => {
    // A section whose footer stands in the text area ends its pages higher than the
    // document's do — the reach the index and the column flow place against.
    const g = gridFromRuns(`1|${P}|0|76|76|76|76,3|${P}|0|76|76|131|131`, P, BASE);
    expect(g.contentBottomOf(2)).toBe(P + GAP + P - 76);
    expect(g.contentBottomOf(3)).toBe(2 * (P + GAP) + P - 131);
    expect(g.contentBottomOf(4)).toBe(3 * (P + GAP) + P - 131);
  });

  it("keeps a section's first page on its own reach", () => {
    const g = new PageGrid(P, 0, BASE);
    g.setFrom(2, P, 0, [200, 76, 300, 131]);
    expect(g.contentTopOf(2)).toBe(P + GAP + 200);
    expect(g.contentTopOf(3)).toBe(2 * (P + GAP) + 76);
    expect(g.contentBottomOf(2)).toBe(P + GAP + P - 300);
    expect(g.contentBottomOf(3)).toBe(2 * (P + GAP) + P - 131);
  });

  it("lets a page's own reach win over its section's", () => {
    // A page number a digit longer wraps the footer on that page alone.
    const g = gridFromRuns(`1|${P}|0|76|76|76|76`, P, BASE, '3|90|131');
    expect(g.contentBottomOf(2)).toBe(P + GAP + P - 76);
    expect(g.contentTopOf(3)).toBe(2 * (P + GAP) + 90);
    expect(g.contentBottomOf(3)).toBe(2 * (P + GAP) + P - 131);
    expect(g.contentBottomOf(4)).toBe(3 * (P + GAP) + P - 76);
  });

  it('falls back to the document band where a run carries none', () => {
    // An older run string, and the uniform document that writes no runs at all.
    expect(gridFromRuns(`2|${L}`, P, BASE).contentBottomOf(2)).toBe(P + GAP + L - 76);
    expect(gridFromRuns('', P, BASE).contentTopOf(3)).toBe(2 * (P + GAP) + 76);
  });
});

// A page break may not fall between rows a cell spans: the cell is one DOM box and would
// stretch across the gap. LibreOffice keeps such rows together too.
const ROW = (spans: number[], i: number, height = 20) => ({ spans, top: i * height, height });
const rows = (spansPerRow: number[][], height = 20) =>
  spansPerRow.map((spans, i) => ROW(spans, i, height));

describe('rowSpanGroups', () => {
  it('leaves plain rows to break on their own', () => {
    expect(rowSpanGroups(rows([[1, 1], [1, 1], [1, 1]]), 1000)).toEqual([0, 1, 2]);
  });

  it('joins the rows a cell spans to their leader', () => {
    expect(rowSpanGroups(rows([[1, 2], [1], [1, 1]]), 1000)).toEqual([0, 0, 2]);
  });

  it('follows a span that reaches past the group it started', () => {
    // Row 1's own span extends the group row 0 opened.
    expect(rowSpanGroups(rows([[1, 2], [3], [1], [1], [1]]), 1000)).toEqual([0, 0, 0, 0, 4]);
  });

  it('never runs past the last row', () => {
    expect(rowSpanGroups(rows([[1, 9]]), 1000)).toEqual([0]);
  });

  it('gives up on a group taller than the page: it breaks per row', () => {
    // Three 20px rows = 60px of group against a 50px page.
    expect(rowSpanGroups(rows([[3], [1], [1]]), 50)).toEqual([0, 1, 2]);
    expect(rowSpanGroups(rows([[3], [1], [1]]), 60)).toEqual([0, 0, 0]);
  });

  it('keeps a later group when an earlier one is too tall', () => {
    const r = [
      { spans: [2], top: 0, height: 40 }, { spans: [1], top: 40, height: 40 },
      { spans: [2], top: 80, height: 10 }, { spans: [1], top: 90, height: 10 },
    ];
    expect(rowSpanGroups(r, 50)).toEqual([0, 1, 2, 2]);
  });

  it('keeps a repeated header row with the row after it', () => {
    expect(rowSpanGroups(rows([[1], [1], [1]]), 1000, 1)).toEqual([0, 0, 2]);
    expect(rowSpanGroups(rows([[1]]), 1000, 1)).toEqual([0]);
    // Header and first row together taller than a page: each breaks on its own.
    expect(rowSpanGroups(rows([[1], [1]], 40), 60, 1)).toEqual([0, 1]);
  });
});
