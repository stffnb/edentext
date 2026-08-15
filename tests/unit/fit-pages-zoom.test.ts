// The zoom the page grid fits itself to: one whole row of pages, gaps included, has to
// fit the window, or the reader is left scrolling a row sideways (Editor.svelte).
import { describe, it, expect } from 'vitest';
import { fitPagesZoom, MIN_ZOOM, MAX_ZOOM } from '../../src/lib/utils/zoom';

// A4 across (page + the gap beside it) and down (page + the gap below it), document px.
const A4 = { width: 794 + 20, cycle: 1123 + 20 };

describe('fitPagesZoom', () => {
  it('fits a whole row into the window', () => {
    for (const box of [{ width: 1400, height: 900 }, { width: 900, height: 1400 }, { width: 640, height: 480 }]) {
      for (const n of [1, 2, 3, 4]) {
        const percent = fitPagesZoom(box, A4, n);
        if (percent === MIN_ZOOM) continue; // a window too small for the count: the floor wins
        const z = percent / 100;
        expect(A4.cycle * z).toBeLessThanOrEqual(box.height);
        expect(A4.width * z * n).toBeLessThanOrEqual(box.width);
      }
    }
  });

  it('takes whichever of the two the row runs out of first', () => {
    // Wide and short: the height binds and the column count changes nothing.
    expect(fitPagesZoom({ width: 4000, height: 600 }, A4, 2)).toBe(fitPagesZoom({ width: 4000, height: 600 }, A4, 3));
    // Narrow and tall: the width binds, so a column more is a zoom step down.
    expect(fitPagesZoom({ width: 1200, height: 4000 }, A4, 3))
      .toBeLessThan(fitPagesZoom({ width: 1200, height: 4000 }, A4, 2));
  });

  it('stays inside the zoom range', () => {
    expect(fitPagesZoom({ width: 40, height: 40 }, A4, 4)).toBe(MIN_ZOOM);
    expect(fitPagesZoom({ width: 40000, height: 40000 }, A4, 1)).toBe(MAX_ZOOM);
  });
});
