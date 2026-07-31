// The outer-edge drag math (tableColumnResize.ts): Word semantics — only the adjacent
// column gives up width, every other gridline stays put, and the edge stops at the
// text margin / the column minimum.
import { describe, it, expect } from 'vitest';
import { generateHTML } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { edgeResize, TableColumnResize } from '../../src/lib/editor/extensions/tableColumnResize';

type Result = { marginLeftPx: number; marginRightPx: number; percents: number[] };

// A 3-column table at 300/200/100 px.
const PERCENTS = [50, 100 / 3, 100 / 6];

// Resulting column widths in px: the table width changes by whatever the margins gave up.
const cols = (r: Result, tableWidth: number, ml = 0, mr = 0): number[] => {
  const width = tableWidth - (r.marginLeftPx - ml) - (r.marginRightPx - mr);
  return r.percents.map((p) => (p / 100) * width);
};

describe('edgeResize', () => {
  it('left edge: only column 1 shrinks, the others keep their width', () => {
    const r = edgeResize(PERCENTS, 600, 0, 0, 'left', 100);
    expect(r.marginLeftPx).toBe(100);
    expect(r.marginRightPx).toBe(0);
    const [a, b, c] = cols(r, 600);
    expect(a).toBeCloseTo(200);
    expect(b).toBeCloseTo(200);
    expect(c).toBeCloseTo(100);
  });

  it('right edge: only the last column grows, reclaiming its own margin', () => {
    const r = edgeResize(PERCENTS, 450, 0, 150, 'right', 100);
    expect(r.marginRightPx).toBe(50);
    const [a, b, c] = cols(r, 450, 0, 150);
    expect(a).toBeCloseTo(225);
    expect(b).toBeCloseTo(150);
    expect(c).toBeCloseTo(175);
  });

  it('stops at the text margin and never goes negative', () => {
    const r = edgeResize(PERCENTS, 600, 0, 0, 'right', 100); // no right margin to reclaim
    expect(r.marginRightPx).toBe(0);
    expect(r.percents).toEqual(PERCENTS);
  });

  it('keeps the adjacent column above the minimum width', () => {
    const r = edgeResize(PERCENTS, 600, 0, 0, 'left', 500); // column 1 is only 300px
    expect(r.marginLeftPx).toBe(270); // 300 - CELL_MIN_PX
    expect(cols(r, 600)[0]).toBeCloseTo(30);
  });
});

// The static HTML path (generateHTML) feeds the PDF export, which has no node view.
describe('table margins in rendered HTML', () => {
  const exts = [Document, Paragraph, Text, Table, TableRow, TableCell, TableHeader, TableColumnResize];
  const table = (attrs: Record<string, number>) => ({
    type: 'doc',
    content: [{ type: 'table', attrs, content: [
      { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] },
    ] }],
  });

  it('renders the margins and the matching width', () => {
    const html = generateHTML(table({ marginLeft: 2, marginRight: 3 }), exts);
    expect(html).toContain('margin-left: 2cm');
    expect(html).toContain('margin-right: 3cm');
    // jsdom's CSS parser normalizes absolute lengths in `width` to px (browsers don't).
    const [, value, unit] = html.match(/width: calc\(100% - ([\d.]+)(cm|px)\)/) ?? [];
    expect(unit).toBeTruthy();
    expect(unit === 'px' ? Number(value) / (96 / 2.54) : Number(value)).toBeCloseTo(5, 3);
  });

  it('leaves a full-width table unstyled', () => {
    expect(generateHTML(table({ marginLeft: 0, marginRight: 0 }), exts)).not.toContain('margin-left');
  });
});
