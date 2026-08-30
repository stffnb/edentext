// A page break may not fall between rows a cell spans: the cell is one DOM box and
// would stretch across the gap. LibreOffice keeps such rows together too (probed).
import { describe, it, expect } from 'vitest';
import { rowSpanGroups } from '../../src/lib/editor/extensions/pageBreaks';

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
});
