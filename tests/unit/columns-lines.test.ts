import { describe, expect, it } from 'vitest';
import { groupLines, linesWithin, type LineRect } from '../../src/lib/editor/extensions/columnsFlow';

const HEIGHT = 24;
const ADVANCE = 22.1;
const RAISE = 8.5;

// A two-column Hebrew page as measured: 24px runs on a 22.1px advance, a verse
// number 8.5px above the line it opens (which makes that line 8.5px taller), and
// the tops resetting at the column break.
function pageRects(lines: number, raisedEvery: number, breakAt = Infinity): LineRect[] {
  const out: LineRect[] = [];
  let top = 180;
  for (let i = 0; i < lines; i++) {
    if (i === breakAt) top = 180;
    const raised = i % raisedEvery === 0;
    if (raised) out.push({ left: 600, right: 620, top: top - RAISE, height: HEIGHT });
    for (let r = 0; r < 6; r++) out.push({ left: 340 + r * 40, right: 375 + r * 40, top, height: HEIGHT });
    top += ADVANCE + (raised ? RAISE : 0);
  }
  return out;
}

describe('groupLines', () => {
  it('counts a raised run with its line, not as one of its own', () => {
    expect(groupLines(pageRects(40, 3)).length).toBe(40);
  });

  it('starts a line where the tops reset at a column break', () => {
    expect(groupLines(pageRects(40, 3, 20)).length).toBe(40);
  });

  it('lets no outsized rect swallow the line below it', () => {
    const tall: LineRect[] = [
      { left: 0, right: 10, top: 100, height: 53 },
      { left: 0, right: 10, top: 122, height: 24 },
      { left: 0, right: 10, top: 144, height: 24 },
    ];
    expect(groupLines(tall).length).toBe(3);
  });
});

describe('linesWithin', () => {
  const lines = groupLines(pageRects(40, 3));

  it('measures the budget against the real advances', () => {
    const tenLines = lines[10].top - lines[0].top + 1;
    expect(linesWithin(lines, tenLines, ADVANCE, 1)).toBe(10);
    // What a single median advance for every line would have claimed instead.
    expect(Math.floor(tenLines / ADVANCE)).toBeGreaterThan(10);
  });

  it('stands the median advance in at a column break', () => {
    const broken = groupLines(pageRects(40, 3, 20));
    const budget = ADVANCE * 25 + RAISE * 9;
    expect(linesWithin(broken, budget, ADVANCE, 1)).toBeGreaterThan(20);
  });

  it('scales viewport tops back to document px', () => {
    const tenLines = lines[10].top - lines[0].top + 1;
    const zoomed = lines.map((l) => ({ ...l, top: l.top * 1.5 }));
    expect(linesWithin(zoomed, tenLines, ADVANCE, 1.5)).toBe(10);
  });
});
