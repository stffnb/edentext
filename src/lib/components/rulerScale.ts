import { PX_PER_CM } from '../storage/pageMargins';

// The cm scale both rulers draw: whole-cm marks across the page, quarter or half marks
// between them and numbers thinned to every 2nd/5th cm, as far as the zoom leaves room.

export const SNAP_CM = 0.05;
const SUB_TICK_GAP_PX = 8; // quarter/half marks need this spacing, which also clears a label
const LABEL_GAP_PX = 16; // a two-digit label plus air

export const snapCm = (cm: number): number => Math.round(cm / SNAP_CM) * SNAP_CM;

/** Marks for a page `pageCm` long whose origin lies `startCm` in from its edge; cm from the origin. */
export function scaleMarks(startCm: number, pageCm: number, scale: number) {
  const ticks = Array.from({ length: Math.ceil(pageCm) + 1 }, (_, i) => i - Math.floor(startCm));
  const subStep = [0.25, 0.5].find((step) => step * PX_PER_CM * scale >= SUB_TICK_GAP_PX) ?? 0;
  const subTicks = subStep ? ticks.flatMap((cm) =>
    Array.from({ length: 1 / subStep - 1 }, (_, i) => cm + (i + 1) * subStep)) : [];
  const labelEvery = [1, 2, 5].find((n) => n * PX_PER_CM * scale >= LABEL_GAP_PX) ?? 10;
  return { ticks, subTicks, labelEvery };
}
