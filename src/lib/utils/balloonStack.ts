// Where the margin balloons end up (ReviewMarginLayer.svelte). Each one wants to sit at
// its anchor's line; two anchors a line apart carry balloons far taller than a line, so
// a balloon that would overlap its predecessor is pushed down, as in both word processors.

/** Tops for balloons in document order: none closer than `gap`, all inside the band. */
export function stackTops(
  desired: number[],
  heights: number[],
  gap: number,
  bandTop = -Infinity,
  bandBottom = Infinity,
): number[] {
  const out: number[] = [];
  let floor = bandTop;
  for (const [i, want] of desired.entries()) {
    const top = Math.max(want, floor);
    out.push(top);
    floor = top + (heights[i] ?? 0) + gap;
  }
  // More cards than the band holds: they keep their distance and run past its end —
  // overlapping them would hide the ones underneath. The caller caps heights so this
  // stays the rare case.
  const total = heights.slice(0, out.length).reduce((s, h) => s + (h ?? 0), 0) + Math.max(0, out.length - 1) * gap;
  if (total > bandBottom - bandTop) return out;
  // Back up again: the column may not hang past the band, and pulling the last card up
  // pulls its predecessors with it.
  let ceiling = bandBottom;
  for (let i = out.length - 1; i >= 0; i--) {
    out[i] = Math.min(out[i], ceiling - (heights[i] ?? 0));
    ceiling = out[i] - gap;
  }
  return out;
}
