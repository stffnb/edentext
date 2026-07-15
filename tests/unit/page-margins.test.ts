import { describe, it, expect } from 'vitest';
import { PX_PER_CM, cmToPx, DEFAULT_MARGINS } from '../../src/lib/storage/pageMargins';

describe('pageMargins units', () => {
  it('PX_PER_CM is A4 @96dpi (96 / 2.54)', () => {
    expect(PX_PER_CM).toBeCloseTo(96 / 2.54, 10);
  });

  it('cmToPx(1) equals PX_PER_CM', () => {
    expect(cmToPx(1)).toBeCloseTo(PX_PER_CM, 10);
  });

  it('cmToPx(2.54) ≈ 96px', () => {
    expect(cmToPx(2.54)).toBeCloseTo(96, 6);
  });

  it('cmToPx(0) is 0', () => {
    expect(cmToPx(0)).toBe(0);
  });

  it("default margins are LibreOffice's 2cm all round", () => {
    expect(DEFAULT_MARGINS).toEqual({ top: 2, bottom: 2, left: 2, right: 2 });
  });
});
