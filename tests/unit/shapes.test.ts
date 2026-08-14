import { describe, it, expect } from 'vitest';
import {
  SHAPES, POLYGON_KINDS, shapePath, odfEnhancedGeometry, shapeFromOdfType, shapeFromPrst, isLineKind,
  type ShapeKind,
} from '../../src/lib/utils/shapes';

describe('shape presets', () => {
  // The three line kinds share their names on purpose — the arrow heads a file
  // declares are what tells them apart (lineKindFor) — so the box shapes are the
  // ones a name has to identify on its own.
  it('names every box kind once per format', () => {
    const kinds = (Object.keys(SHAPES) as ShapeKind[]).filter((k) => !isLineKind(k));
    expect(new Set(kinds.map((k) => SHAPES[k].odf)).size).toBe(kinds.length);
    expect(new Set(kinds.map((k) => SHAPES[k].prst)).size).toBe(kinds.length);
  });

  it('round-trips a kind through both formats', () => {
    for (const k of Object.keys(SHAPES) as ShapeKind[]) {
      const same = isLineKind(k) ? 'line' : k;
      expect(shapeFromOdfType(SHAPES[k].odf)).toBe(same);
      expect(shapeFromPrst(SHAPES[k].prst)).toBe(same);
    }
    // A preset we can't draw stays unknown rather than flattening to a rectangle.
    expect(shapeFromOdfType('bent-connector')).toBeNull();
    expect(shapeFromPrst('bentConnector3')).toBeNull();
    expect(shapeFromOdfType('circle')).toBe('ellipse');
  });

  it('keeps every polygon inside its box', () => {
    for (const k of POLYGON_KINDS) {
      const pts = SHAPES[k].points!;
      expect(pts.length).toBeGreaterThanOrEqual(3);
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(100);
      }
      // The outline has to touch all four edges, or the shape doesn't fill its frame.
      expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(0, 1);
      expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(100, 1);
      expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(0, 1);
      expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(100, 1);
    }
  });

  it('keeps every text area inside its outline box', () => {
    for (const k of POLYGON_KINDS) {
      const [x0, y0, x1, y1] = SHAPES[k].textArea!;
      expect(x0).toBeLessThan(x1);
      expect(y0).toBeLessThan(y1);
      expect(x0).toBeGreaterThanOrEqual(0);
      expect(y1).toBeLessThanOrEqual(100);
    }
  });

  it('derives the ODF geometry from the same points', () => {
    expect(shapePath('diamond')).toBe('M 50,0 L 100,50 L 50,100 L 0,50 Z');
    expect(odfEnhancedGeometry('diamond')).toBe(
      '<draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="diamond"' +
      ' draw:text-areas="5400 5400 16200 16200"' +
      ' draw:enhanced-path="M 10800 0 L 21600 10800 10800 21600 0 10800 Z N"/>',
    );
    // The two rectangular kinds keep LibreOffice's own geometry, curves and all.
    expect(odfEnhancedGeometry('ellipse')).toContain('U 10800 10800 10800 10800 0 360 Z N');
    expect(odfEnhancedGeometry('textbox')).toBeNull();
    expect(shapePath('textbox')).toBeNull();
  });
});
