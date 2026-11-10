import { AddMarkStep, RemoveMarkStep } from '@tiptap/pm/transform';
import type { Transaction } from '@tiptap/pm/state';

export type Range = { from: number; to: number };

// What a transaction touched, in its final document's positions: one span around all of
// it, carried through the maps once, since mapping each change through every later map is
// quadratic in steps (seconds for a format change across a long document).
export function changedRanges(tr: Transaction): Range[] {
  let lo = Infinity, hi = -Infinity;
  tr.mapping.maps.forEach((map, i) => {
    if (lo <= hi) { lo = map.map(lo, -1); hi = map.map(hi, 1); }
    map.forEach((_oldFrom, _oldTo, from, to) => { lo = Math.min(lo, from); hi = Math.max(hi, to); });
    // A mark step moves nothing, so its map is empty, yet a run's language may have changed.
    const step = tr.steps[i];
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) { lo = Math.min(lo, step.from); hi = Math.max(hi, step.to); }
  });
  return lo <= hi ? [{ from: lo, to: hi }] : [];
}
