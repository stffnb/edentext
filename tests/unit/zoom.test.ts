import { describe, it, expect } from 'vitest';
import { clampZoom, wheelZoomFactor, MIN_ZOOM, MAX_ZOOM } from '../../src/lib/utils/zoom';

// Ctrl+wheel / touchpad two-finger zoom feeds wheelZoomFactor. The deltas differ wildly
// per device and browser, so the conversion has to stay bounded and correctly signed.
describe('wheelZoomFactor', () => {
  it('zooms in on a negative delta, out on a positive one', () => {
    expect(wheelZoomFactor(-10)).toBeGreaterThan(1);
    expect(wheelZoomFactor(10)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
  });

  it('keeps one mouse notch to a moderate step', () => {
    const step = wheelZoomFactor(-100); // Chrome, deltaMode 0
    expect(step).toBeGreaterThan(1.05);
    expect(step).toBeLessThan(1.5);
  });

  it("lands Firefox's line-mode notch in the same range", () => {
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(wheelZoomFactor(-100), 5);
  });

  it('scales small touchpad deltas finely', () => {
    expect(wheelZoomFactor(-2)).toBeLessThan(wheelZoomFactor(-20));
    expect(wheelZoomFactor(-2)).toBeGreaterThan(1);
  });
});

describe('clampZoom', () => {
  it('clamps to the slider range and rounds to whole percent', () => {
    expect(clampZoom(5)).toBe(MIN_ZOOM);
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(104.4)).toBe(104);
  });
});
