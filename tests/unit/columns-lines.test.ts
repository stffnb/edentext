import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { extensions } from '../../src/lib/editor/extensions';
import { linesWithin, rowsWithin } from '../../src/lib/editor/extensions/columnsFlow';
import { groupLines, type LineRect } from '../../src/lib/editor/extensions/columns';
import { roundTrips } from '../docxFixture';

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

describe('rowsWithin', () => {
  it('opens the next column for a row that does not fit, and stops after the last', () => {
    // Two columns of 100: 30+30+30 fill the first (10 wasted), the fourth row opens the second.
    expect(rowsWithin([30, 30, 30, 30, 30, 30, 30], 0, 100, 2)).toBe(6);
    // Starting 50 into the flow, one row fits the first column and three the second.
    expect(rowsWithin([30, 30, 30, 30, 30], 50, 100, 2)).toBe(4);
    // A row taller than a column still takes an empty one.
    expect(rowsWithin([150, 30], 0, 100, 2)).toBe(2);
  });
});

describe('setColumns', () => {
  // "2[a b] c": a two-column section holding a and b, then c in one column.
  const shape = (doc: PMNode) => {
    const out: string[] = [];
    doc.forEach((n) => {
      if (n.type.name !== 'columns') { if (n.textContent) out.push(n.textContent); return; }
      const inner: string[] = [];
      n.forEach((c) => inner.push(c.textContent));
      out.push(`${n.attrs.count}[${inner.join(' ')}]`);
    });
    return out.join(' ');
  };
  const run = (html: string, select: string, count: number) => {
    const editor = new Editor({ element: document.createElement('div'), extensions, content: html });
    let from = 0;
    let to = 0;
    editor.state.doc.descendants((n, pos) => {
      if (n.isText && select.includes(n.text!)) { from ||= pos; to = pos + n.nodeSize; }
    });
    const ok = editor.chain().setTextSelection({ from, to }).setColumns(count).run();
    const out = ok ? shape(editor.state.doc) : 'refused';
    editor.destroy();
    return out;
  };
  const section = '<div data-columns="2"><p>a</p><p>b</p><p>c</p></div>';

  it.each([
    ['takes a selection inside a section out of it', section, 'b', 1, '2[a] b 2[c]'],
    ['gives a selection inside a section its own count', section, 'b', 3, '2[a] 3[b] 2[c]'],
    ['takes a whole section out', section, 'a b c', 1, 'a b c'],
    ['puts a selection between plain paragraphs in columns', '<p>a</p><p>b</p><p>c</p>', 'b', 2, 'a 2[b] c'],
    ['joins a paragraph back into the sections around it',
      '<div data-columns="2"><p>a</p></div><p>b</p><div data-columns="2"><p>c</p></div>', 'b', 2, '2[a b c]'],
    ['changes nothing that has no columns to remove', '<p>a</p><p>b</p>', 'b', 1, 'refused'],
  ])('%s', (_, html, select, count, want) => {
    expect(run(html, select, count)).toBe(want);
  });
});

// A table the columns flow cut at a page holds together only while both parts are in one
// section: an edit giving the second part's fragment other columns leaves two tables, as
// the editor shows them and both files hold them.
describe('a table cut by the columns flow', () => {
  const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const table = (text: string, joinPrev = false) => ({ type: 'table', attrs: { joinPrev }, content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p(text)] }] }] });
  const cut = { type: 'doc', content: [
    { type: 'columns', attrs: { count: 2, gapCm: 0.5 }, content: [p('a'), table('row one')] },
    { type: 'columns', attrs: { count: 2, gapCm: 0.5 }, content: [table('row two', true), p('b')] },
    p('tail'),
  ] };
  const tables = (doc: any): string[] => (doc.content ?? []).flatMap((n: any) =>
    n.type === 'table' ? [`${n.attrs?.joinPrev ? '+' : ''}${n.content.length}`] : tables(n));
  it.each<[string, (e: Editor) => void, string[], string[]]>([
    ['stays one when the whole section changes', (e) => { e.commands.setTextSelection(3); e.commands.setColumnGap(1.5); }, ['1', '+1'], ['2']],
    ['parts when only the second fragment does', (e) => {
      const at = e.state.doc.child(0).nodeSize;
      e.view.dispatch(e.state.tr.setNodeMarkup(at, undefined, { count: 2, gapCm: 1.5 }));
    }, ['1', '1'], ['1', '1']],
  ])('%s', async (_, edit, held, read) => {
    const editor = new Editor({ element: document.createElement('div'), extensions, content: cut });
    edit(editor);
    const doc = editor.getJSON();
    editor.destroy();
    expect(tables(doc)).toEqual(held);
    for (const back of await roundTrips(doc)) expect(tables(back)).toEqual(read);
  });
});
