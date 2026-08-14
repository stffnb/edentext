// The line kinds: geometry across the frame, and which kind a file's arrow heads make.
import { describe, it, expect } from 'vitest';
import { linePaths, lineKindFor, isLineKind, arrowHeadPx, arrowHeadCm, LINE_KINDS, shapeFromPrst, shapeFromOdfType } from '../../src/lib/utils/shapes';

describe('line shapes', () => {
  it('runs across the frame, and flips to the other diagonal', () => {
    expect(linePaths('line', 200, 60, false, 10)?.line).toBe('M 0,0 L 200,60');
    expect(linePaths('line', 200, 60, true, 10)?.line).toBe('M 0,60 L 200,0');
    expect(linePaths('textbox', 200, 60, false, 10)).toBeNull();
  });

  it('gives a head to the ends the kind names', () => {
    expect(linePaths('line', 100, 0, false, 10)?.heads).toHaveLength(0);
    expect(linePaths('lineArrow', 100, 0, false, 10)?.heads).toHaveLength(1);
    expect(linePaths('lineDoubleArrow', 100, 0, false, 10)?.heads).toHaveLength(2);
  });

  it('keeps the head inside a line shorter than it', () => {
    const short = linePaths('lineArrow', 10, 0, false, 40)?.heads[0] ?? '';
    // Capped at half the line, so the head never reaches past the far end.
    expect(short).toContain('M 10,0');
    expect(short).toContain('5,');
  });

  it('reads a file\'s heads back as the kind they make', () => {
    expect(lineKindFor(false, false)).toBe('line');
    expect(lineKindFor(false, true)).toBe('lineArrow');
    expect(lineKindFor(true, false)).toBe('lineArrow');
    expect(lineKindFor(true, true)).toBe('lineDoubleArrow');
    expect(LINE_KINDS.every(isLineKind)).toBe(true);
  });

  it('resolves both formats\' names to the bare line, the heads deciding the rest', () => {
    expect(shapeFromPrst('line')).toBe('line');
    expect(shapeFromPrst('straightConnector1')).toBe('line');
    expect(shapeFromOdfType('line')).toBe('line');
  });

  it('scales the head with the pen, with a floor', () => {
    expect(arrowHeadPx(0.25)).toBe(8);
    expect(arrowHeadPx(3)).toBeCloseTo(20, 5);
    expect(arrowHeadCm(3)).toBeCloseTo(0.37, 2);
  });
});
