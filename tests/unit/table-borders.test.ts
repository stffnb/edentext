// Unit tests for the table border feature: the setTableBorders preset command
// (driven against a ProseMirror EditorState, like table-split.test.ts) and the
// attr-value parse/normalize helpers used by export and import.
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import type { Node as PMNode } from '@tiptap/pm/model';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Table, TableHeader, TableCell } from '@tiptap/extension-table';
import { ResizableTableRow } from '../../src/lib/editor/extensions/tableRow';
import {
  TableCellBorders, setTableBorders, activeBorderPresets, borderAttrValue, parseBorderAttr,
  type BorderPreset, type BorderSpec,
} from '../../src/lib/editor/extensions/tableCellBorders';
import { borderAttrFromOdf } from '../../src/lib/import/odt';

type N = any;

const schema = getSchema([
  Document, Paragraph, Text, Table, ResizableTableRow, TableCell, TableHeader, TableCellBorders,
]);

const cell = (text: string): N => ({
  type: 'tableCell',
  attrs: { colspan: 1, rowspan: 1, colwidth: null },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const row = (...cells: N[]): N => ({ type: 'tableRow', content: cells });
// 3×3 grid: [A B C] / [D E F] / [G H I]
const grid3 = (): N => ({
  type: 'doc',
  content: [{ type: 'table', content: [
    row(cell('A'), cell('B'), cell('C')),
    row(cell('D'), cell('E'), cell('F')),
    row(cell('G'), cell('H'), cell('I')),
  ] }],
});

function textPos(doc: PMNode, text: string): number {
  let pos = -1;
  doc.descendants((node: PMNode, p: number) => {
    if (node.isText && node.text === text) pos = p;
  });
  if (pos < 0) throw new Error(`text ${text} not found`);
  return pos;
}

function cellPos(doc: PMNode, text: string): number {
  const $pos = doc.resolve(textPos(doc, text));
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.spec.tableRole === 'cell') return $pos.before(d);
  }
  throw new Error(`no cell around ${text}`);
}

// Run the command with the cursor in `target` (string) or a CellSelection over
// [anchor, head] cells; returns cellText → border attrs for the whole table.
function run(json: N, target: string | [string, string], preset: BorderPreset, spec: BorderSpec): Record<string, N> {
  const doc = schema.nodeFromJSON(json);
  const selection = typeof target === 'string'
    ? TextSelection.create(doc, textPos(doc, target))
    : new CellSelection(doc.resolve(cellPos(doc, target[0])), doc.resolve(cellPos(doc, target[1])));
  const state = EditorState.create({ schema, doc, selection });
  let next: EditorState | null = null;
  const ok = setTableBorders(preset, spec)({
    state,
    tr: state.tr,
    dispatch: (tr: any) => { next = state.apply(tr); },
  } as any);
  expect(ok).toBe(true);
  const out: Record<string, N> = {};
  next!.doc.descendants((node: PMNode) => {
    if (node.type.spec.tableRole === 'cell') {
      const { borderTop, borderRight, borderBottom, borderLeft } = node.attrs;
      out[node.textContent] = { borderTop, borderRight, borderBottom, borderLeft };
    }
  });
  return out;
}

const RED = { widthPt: 1, color: '#FF0000' };
const V = '1pt solid #FF0000';

describe('setTableBorders', () => {
  it('"all" on a single cell sets its four sides and mirrors the facing neighbour sides', () => {
    const t = run(grid3(), 'E', 'all', RED);
    expect(t.E).toEqual({ borderTop: V, borderRight: V, borderBottom: V, borderLeft: V });
    expect(t.B.borderBottom).toBe(V); // above
    expect(t.H.borderTop).toBe(V);    // below
    expect(t.D.borderRight).toBe(V);  // left
    expect(t.F.borderLeft).toBe(V);   // right
    // Corners untouched.
    expect(t.A).toEqual({ borderTop: null, borderRight: null, borderBottom: null, borderLeft: null });
    // Neighbours' other sides untouched.
    expect(t.B.borderTop).toBe(null);
    expect(t.D.borderLeft).toBe(null);
  });

  it('"all" with the default 0.5pt black spec normalizes to null (table default)', () => {
    const t = run(grid3(), 'E', 'all', { widthPt: 0.5, color: '#000000' });
    expect(t.E).toEqual({ borderTop: null, borderRight: null, borderBottom: null, borderLeft: null });
  });

  it('a null spec removes borders ("no border"), both sides of each boundary', () => {
    const t = run(grid3(), 'E', 'all', null);
    expect(t.E).toEqual({ borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none' });
    expect(t.B.borderBottom).toBe('none');
    expect(t.F.borderLeft).toBe('none');
  });

  it('"outer" on a 2×2 region sets only the region edges (+ outside mirrors)', () => {
    const t = run(grid3(), ['A', 'E'], 'outer', RED); // region = A B / D E
    expect(t.A.borderTop).toBe(V);
    expect(t.A.borderLeft).toBe(V);
    expect(t.B.borderTop).toBe(V);
    expect(t.B.borderRight).toBe(V);
    expect(t.E.borderRight).toBe(V);
    expect(t.E.borderBottom).toBe(V);
    // Inner boundaries untouched.
    expect(t.A.borderRight).toBe(null);
    expect(t.A.borderBottom).toBe(null);
    expect(t.E.borderTop).toBe(null);
    expect(t.E.borderLeft).toBe(null);
    // Outside neighbours mirror the shared edge.
    expect(t.C.borderLeft).toBe(V);
    expect(t.F.borderLeft).toBe(V);
    expect(t.G.borderTop).toBe(V);
    expect(t.H.borderTop).toBe(V);
    expect(t.I).toEqual({ borderTop: null, borderRight: null, borderBottom: null, borderLeft: null });
  });

  it('"inner" on a 2×2 region sets only the boundaries between region cells', () => {
    const t = run(grid3(), ['A', 'E'], 'inner', RED);
    expect(t.A.borderRight).toBe(V);
    expect(t.B.borderLeft).toBe(V);
    expect(t.A.borderBottom).toBe(V);
    expect(t.D.borderTop).toBe(V);
    expect(t.E.borderTop).toBe(V);
    expect(t.E.borderLeft).toBe(V);
    // Region edges untouched.
    expect(t.A.borderTop).toBe(null);
    expect(t.A.borderLeft).toBe(null);
    expect(t.E.borderRight).toBe(null);
    expect(t.E.borderBottom).toBe(null);
    expect(t.C.borderLeft).toBe(null);
  });

  it('"top" sets only the region top edge', () => {
    const t = run(grid3(), ['D', 'E'], 'top', RED); // region = D E (row 1)
    expect(t.D.borderTop).toBe(V);
    expect(t.E.borderTop).toBe(V);
    expect(t.A.borderBottom).toBe(V); // mirror above
    expect(t.B.borderBottom).toBe(V);
    expect(t.D.borderBottom).toBe(null);
    expect(t.D.borderLeft).toBe(null);
    expect(t.F.borderTop).toBe(null);
  });
});

describe('activeBorderPresets', () => {
  function stateFor(json: N, target: string | [string, string]): EditorState {
    const doc = schema.nodeFromJSON(json);
    const selection = typeof target === 'string'
      ? TextSelection.create(doc, textPos(doc, target))
      : new CellSelection(doc.resolve(cellPos(doc, target[0])), doc.resolve(cellPos(doc, target[1])));
    return EditorState.create({ schema, doc, selection });
  }
  const THIN = { widthPt: 0.5, color: '#000000' };

  it('fresh table (default borders) + default pen → every preset active except none', () => {
    const a = activeBorderPresets(stateFor(grid3(), ['A', 'I']), THIN)!;
    expect(a.all && a.outer && a.inner && a.innerH && a.innerV && a.top && a.bottom && a.left && a.right).toBe(true);
    expect(a.none).toBe(false);
  });

  it('active state follows the pen width: thicker pen → default borders no longer match', () => {
    const a = activeBorderPresets(stateFor(grid3(), ['A', 'I']), { widthPt: 2.25, color: '#000000' })!;
    expect(a.all).toBe(false);
    expect(a.outer).toBe(false);
    expect(a.none).toBe(false);
  });

  it('borderless region → only none active', () => {
    // Remove all borders of the whole table first.
    const st = stateFor(grid3(), ['A', 'I']);
    let next: EditorState | null = null;
    setTableBorders('all', null)({ state: st, tr: st.tr, dispatch: (tr: any) => { next = st.apply(tr); } } as any);
    const a = activeBorderPresets(next!, THIN)!;
    expect(a.none).toBe(true);
    expect(a.all).toBe(false);
    expect(a.top).toBe(false);
  });

  it('single cell: inner presets have no boundaries → inactive; edges active', () => {
    const a = activeBorderPresets(stateFor(grid3(), 'E'), THIN)!;
    expect(a.inner).toBe(false);
    expect(a.innerH).toBe(false);
    expect(a.all && a.outer && a.top && a.bottom && a.left && a.right).toBe(true);
  });

  it('a boundary with a mismatched color breaks the match for presets that cover it', () => {
    const st = stateFor(grid3(), 'E');
    let next: EditorState | null = null;
    setTableBorders('top', { widthPt: 0.5, color: '#FF0000' })({ state: st, tr: st.tr, dispatch: (tr: any) => { next = st.apply(tr); } } as any);
    const withSel = EditorState.create({ schema, doc: next!.doc, selection: TextSelection.create(next!.doc, textPos(next!.doc, 'E')) });
    const a = activeBorderPresets(withSel, THIN)!;
    expect(a.top).toBe(false);   // now red, pen is black
    expect(a.all).toBe(false);
    expect(a.bottom).toBe(true); // untouched sides still match
    const red = activeBorderPresets(withSel, { widthPt: 0.5, color: '#FF0000' })!;
    expect(red.top).toBe(true);
  });

  it('returns null outside a table', () => {
    const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] });
    const st = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 1) });
    expect(activeBorderPresets(st, THIN)).toBe(null);
  });
});

describe('border attr helpers', () => {
  it('borderAttrValue: default collapses to null, none to "none", custom to canonical', () => {
    expect(borderAttrValue({ widthPt: 0.5, color: '#000000' })).toBe(null);
    expect(borderAttrValue(null)).toBe('none');
    expect(borderAttrValue({ widthPt: 2.25, color: '#ff0000' })).toBe('2.25pt solid #FF0000');
  });

  it('parseBorderAttr inverts borderAttrValue', () => {
    expect(parseBorderAttr(null)).toBe(null);
    expect(parseBorderAttr('none')).toBe('none');
    expect(parseBorderAttr('2.25pt solid #FF0000')).toEqual({ widthPt: 2.25, color: '#FF0000' });
  });

  it('borderAttrFromOdf: absent/none → "none", the 0.5pt-black default → null (unit tolerance)', () => {
    expect(borderAttrFromOdf(undefined)).toBe('none');
    expect(borderAttrFromOdf('none')).toBe('none');
    expect(borderAttrFromOdf('0.5pt solid #000000')).toBe(null);
    expect(borderAttrFromOdf('0.018cm solid #000000')).toBe(null); // LibreOffice cm form
    expect(borderAttrFromOdf('2.25pt solid #ff0000')).toBe('2.25pt solid #FF0000');
    expect(borderAttrFromOdf('0.06pt double #808080')).toBe('0.06pt solid #808080'); // style coerced
  });
});
