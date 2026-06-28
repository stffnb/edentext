// Unit test for the custom splitCellInto command: drives it against a ProseMirror
// EditorState (no DOM/Editor needed) and inspects the rebuilt table. Covers the
// two Word/LibreOffice cases: splitting a plain cell (adds grid lines + bridges
// neighbours) and splitting a merged cell (un-merge).
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Table, TableHeader, TableCell } from '@tiptap/extension-table';
import { ResizableTableRow } from '../../src/lib/editor/extensions/tableRow';
import { splitCellInto } from '../../src/lib/editor/extensions/tableSplit';

type N = any;

const schema = getSchema([Document, Paragraph, Text, Table, ResizableTableRow, TableCell, TableHeader]);

const cell = (text: string, colspan = 1, rowspan = 1): N => ({
  type: 'tableCell',
  attrs: { colspan, rowspan, colwidth: null },
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
});
const row = (...cells: N[]): N => ({ type: 'tableRow', content: cells });
const docJSON = (...rows: N[]): N => ({ type: 'doc', content: [{ type: 'table', content: rows }] });

// Run splitCellInto(cols,rows) with the cursor in the cell containing `targetText`.
function runSplit(json: N, targetText: string, cols: number, rows: number): N {
  const doc = schema.nodeFromJSON(json);
  let textPos = -1;
  doc.descendants((node: PMNode, pos: number) => {
    if (node.isText && node.text === targetText) textPos = pos;
  });
  if (textPos < 0) throw new Error(`target text ${targetText} not found`);
  const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, textPos) });
  let next: EditorState | null = null;
  const ok = splitCellInto(cols, rows)({
    state,
    tr: state.tr,
    dispatch: (tr) => { next = state.apply(tr); },
  } as any);
  expect(ok).toBe(true);
  return next!.doc.toJSON().content[0]; // the table node
}

const cellText = (c: N): string | undefined => c?.content?.[0]?.content?.[0]?.text;

describe('splitCellInto', () => {
  it('splits a plain cell into 2×2, bridging the neighbouring cells', () => {
    // 2×2 grid; split the top-left cell ("A") into 2 cols × 2 rows.
    const table = runSplit(
      docJSON(row(cell('A'), cell('B')), row(cell('C'), cell('D'))),
      'A', 2, 2,
    );
    const rows = table.content;
    expect(rows.length).toBe(3);
    // row0: [A][new][B rowspan2]
    expect(rows[0].content.length).toBe(3);
    expect(cellText(rows[0].content[0])).toBe('A');
    expect(rows[0].content[2].attrs.rowspan).toBe(2); // top-right bridges down
    expect(cellText(rows[0].content[2])).toBe('B');
    // row1: the 2 new sub-cells (col2 covered by B's rowspan)
    expect(rows[1].content.length).toBe(2);
    // row2: [C colspan2][D]
    expect(rows[2].content.length).toBe(2);
    expect(rows[2].content[0].attrs.colspan).toBe(2); // bottom-left bridges right
    expect(cellText(rows[2].content[0])).toBe('C');
    expect(cellText(rows[2].content[1])).toBe('D');
  });

  it('un-merges a merged cell (colspan 2 → two cells)', () => {
    // Row0 is one merged cell spanning 2 cols; row1 has two cells.
    const table = runSplit(
      docJSON(row(cell('M', 2, 1)), row(cell('X'), cell('Y'))),
      'M', 2, 1,
    );
    const rows = table.content;
    expect(rows.length).toBe(2);
    expect(rows[0].content.length).toBe(2); // M split back into two
    expect(rows[0].content[0].attrs.colspan).toBe(1);
    expect(rows[0].content[1].attrs.colspan).toBe(1);
    expect(cellText(rows[0].content[0])).toBe('M'); // content kept in the first
  });

  it('splits a single cell into 3 columns', () => {
    const table = runSplit(docJSON(row(cell('A'), cell('B'))), 'A', 3, 1);
    const rows = table.content;
    expect(rows.length).toBe(1);
    // A → 3 sub-cells, plus B (now bridged): 4 cells across a 4-col grid.
    expect(rows[0].content.length).toBe(4);
    expect(cellText(rows[0].content[0])).toBe('A');
    expect(cellText(rows[0].content[3])).toBe('B');
  });
});
