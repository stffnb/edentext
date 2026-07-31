// Document zoom (the CSS scale on .paper, Editor.svelte) — bounds and the
// wheel-gesture → scale-factor conversion.

export const MIN_ZOOM = 20;
export const MAX_ZOOM = 300;

export function clampZoom(value: number): number {
  return Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value)));
}

// Gesture feel, tune here: sensitivity per wheel unit and the per-event cap that
// keeps one mouse notch (deltaY ±100) from jumping several hundred percent.
const SENSITIVITY = 1 / 200;
const DELTA_CAP = 30;
const LINE_HEIGHT_PX = 16; // Firefox reports wheel deltas in lines (deltaMode 1)

// Multiplicative, so a step feels the same at 30% as at 250% — a touchpad
// two-finger zoom is a scale gesture, and the browser derives deltaY from it.
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * LINE_HEIGHT_PX : deltaY;
  const capped = Math.max(-DELTA_CAP, Math.min(DELTA_CAP, px));
  return Math.exp(-capped * SENSITIVITY);
}
