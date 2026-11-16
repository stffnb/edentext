import { describe, it, expect } from 'vitest';
// @ts-expect-error — the parity harness is plain .mjs, deliberately untyped
import { compare, compareImages, summarize, diffCauses } from '../render-parity/compare.mjs';

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
    expect(issues.filter((i: { kind: string }) => i.kind === 'pageBreak')).toEqual([]);
    expect(issues.some((i: { kind: string }) => i.kind.startsWith('line') || i.kind === 'position')).toBe(false);
    expect(summarize(issues, 2)).toMatchObject({ causes: 1, kinds: { pages: 1 } });
  });

  // Only causes count: what an earlier difference drags along with it is kept as an
  // issue for diagnosis but marked `follows`, however far the consequence reaches.
  const kinds = (issues: { kind: string; follows?: boolean }[]) => summarize(issues).kinds;
  it.each([
    ['one line overflowing every page after it',
      doc([[['A', 10], ['B', 20], ['C', 30]], [['D', 10], ['E', 20], ['F', 30]], [['G', 10], ['H', 20], ['I', 30]]]),
      doc([[['A', 10], ['B', 20]], [['C', 10], ['D', 20], ['E', 30]], [['F', 10], ['G', 20], ['H', 30]], [['I', 10]]]),
      { pages: 1, pageBreak: 1, vertical: 0 }],
    ['a gap pushing the rest of the page down',
      doc([[['A', 10], ['B', 20], ['C', 30], ['D', 40]]]),
      doc([[['A', 10], ['B', 25], ['C', 35], ['D', 45]]]),
      { vertical: 1 }],
    ['a line pitch adding up down the page',
      doc([Array.from({ length: 12 }, (_, k) => [`L${k}`, 10 + 6 * k] as [string, number])]),
      doc([Array.from({ length: 12 }, (_, k) => [`L${k}`, 10 + 6.4 * k] as [string, number])]),
      { vertical: 1 }],
    ['a running foot off on every page',
      doc([1, 2, 3].map((p) => [['Body', 10], [`Guide ${p}`, 280]] as [string, number][])),
      doc([1, 2, 3].map((p) => [['Body', 10], [`Guide ${p}`, 285]] as [string, number][])),
      { vertical: 1 }],
  ])('counts %s as its cause alone', (_, ref, ed, want) => {
    const issues = compare(ref, ed);
    expect(issues.length).toBeGreaterThanOrEqual(want.vertical ? 1 : 2);
    expect(kinds(issues)).toMatchObject(want);
    expect(summarize(issues).causes).toBe(Object.values(want).reduce((a, b) => a + b, 0));
  });

  it('names what a run gained and lost, wherever the cause moved to', () => {
    const before = summarize(compare(doc([[['A', 10], ['B', 20]]]), doc([[['A', 10], ['B', 23]]])));
    const after = summarize(compare(doc([[['X', 10], ['A', 20], ['B', 30]]]), doc([[['X', 14], ['A', 20], ['B', 30]]])));
    expect(diffCauses(after.keys, before.keys)).toEqual({ added: [after.keys[0]], gone: [before.keys[0]] });
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

  it('counts a picture that moved with the text around it as that text\'s consequence', () => {
    const page = (dy: number) => ({ ...doc([[['A', 10], ['B', 20 + dy], ['C', 90 + dy]]]),
      images: [{ page: 0, x: 20, y: 30 + dy, w: 50, h: 50 }] });
    const issues = compare(page(0), page(4));
    expect(issues.find((i: { kind: string }) => i.kind === 'image')).toMatchObject({ dyMm: 4, follows: true });
    expect(summarize(issues).causes).toBe(1);
  });

  it('pairs alike pictures by place and follows one pushed to the next page', () => {
    const icon = (page: number, y: number) => ({ page, x: 20, y, w: 15, h: 15 });
    const ref = [icon(0, 30), icon(0, 60), { page: 1, x: 0, y: 0, w: 210, h: 297 }];
    const ed = [icon(0, 60), icon(0, 30.5), { page: 2, x: 0, y: 0, w: 210, h: 297 }, icon(1, 10)];
    expect(compareImages(ref, ed)).toEqual([
      { kind: 'image', page: 2, wMm: 210, hMm: 297, edPage: 3, dxMm: 0, dyMm: 0, dwMm: 0, dhMm: 0 },
      { kind: 'imageCount', side: 'editor', page: 2, wMm: 15, hMm: 15 },
    ]);
  });

  it('leaves a picture unpaired rather than pair it with one of an implausible size', () => {
    const pic = (page: number, y: number, w: number, h: number) => ({ page, x: 20, y, w, h });
    const ref = [pic(0, 30, 92, 85), pic(0, 130, 7, 89), pic(1, 30, 60, 40)];
    const ed = [pic(0, 30, 148, 111), pic(1, 30, 66, 44), pic(2, 30, 7, 89)];
    expect(compareImages(ref, ed)).toEqual([
      { kind: 'imageCount', side: 'ref', page: 1, wMm: 92, hMm: 85 },
      { kind: 'image', page: 1, wMm: 7, hMm: 89, edPage: 3, dxMm: 0, dyMm: -100, dwMm: 0, dhMm: 0 },
      { kind: 'image', page: 2, wMm: 60, hMm: 40, edPage: 2, dxMm: 0, dyMm: 0, dwMm: 6, dhMm: 4 },
      { kind: 'imageCount', side: 'editor', page: 1, wMm: 148, hMm: 111 },
    ]);
  });
});
