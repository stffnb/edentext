import { describe, it, expect } from 'vitest';
// @ts-expect-error — the parity harness is plain .mjs, deliberately untyped
import { compare } from '../render-parity/compare.mjs';

// The comparison aligns the two documents as a whole, so one dropped or displaced
// line costs one report instead of every line after it.
const doc = (pages: [string, number][][]) => ({
  pages: pages.map((lines) => ({
    words: lines.map(([text, y]) => ({ text, x: 20, y, w: 50, h: 4 })),
    width: 210, height: 297,
  })),
});

describe('render-parity comparison', () => {
  it('reports a line the editor drops once, then resyncs', () => {
    const ref = doc([[['A', 10], ['B', 20], ['C', 30], ['D', 40]]]);
    const ed = doc([[['A', 10], ['C', 30], ['D', 40]]]);
    const issues = compare(ref, ed);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'lineCount', refLines: 1, edLines: 0, ref: 'B' });
  });

  it('reports a page the content slipped onto once, not once per line', () => {
    const ref = doc([[['A', 10], ['B', 30]], [['C', 10], ['D', 30]]]);
    const ed = doc([[['A', 10], ['B', 30]], [], [['C', 10], ['D', 30]]]);
    const issues = compare(ref, ed);
    const shifts = issues.filter((i: { kind: string }) => i.kind === 'pageShift');
    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({ by: 1, page: 2, edPage: 3, text: 'C' });
    expect(issues.some((i: { kind: string }) => i.kind.startsWith('line'))).toBe(false);
  });

  it('keeps going where no resync is in reach, and folds the region into one report', () => {
    const ref = doc([[['A', 10], ['X1', 20], ['X2', 30]]]);
    const ed = doc([[['A', 10], ['Y1', 20], ['Y2', 30]]]);
    const issues = compare(ref, ed);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'lineBreak', refLines: 2, edLines: 2, ref: 'X1' });
  });

  // Two matching lines, not one: a resync is only trusted where two consecutive lines
  // match again, so a single agreeing line between two divergences is part of the region.
  it('leaves two divergences with matching text between them apart', () => {
    const ref = doc([[['A', 10], ['X', 20], ['B', 30], ['C', 40], ['Y', 50], ['D', 60]]]);
    const ed = doc([[['A', 10], ['P', 20], ['B', 30], ['C', 40], ['Q', 50], ['D', 60]]]);
    expect(compare(ref, ed)).toHaveLength(2);
  });

  it('folds a run of lines off by the same amount into one report', () => {
    const ref = doc([[['A', 10], ['B', 20], ['C', 30]]]);
    const ed = doc([[['A', 12], ['B', 22], ['C', 32]]]);
    const issues = compare(ref, ed);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'position', dyMm: 2, lines: 3 });
  });
});
