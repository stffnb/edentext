// Unit test for the header-row styling toggle: drives toggleHeaderRowStyle against a
// ProseMirror EditorState and checks the first row gains/loses bold + the header fill.
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import { Table, TableHeader, TableCell } from '@tiptap/extension-table';
import { ResizableTableRow } from '../../src/lib/editor/extensions/tableRow';
import { TableCellBackground } from '../../src/lib/editor/extensions/tableCellBackground';
import {
  HEADER_SHADE,
  isHeaderRowStyled,
  toggleHeaderRowStyle,
} from '../../src/lib/editor/extensions/tableHeaderRow';

type N = any;

const schema = getSchema([
  Document, Paragraph, Text, Bold, Table, ResizableTableRow, TableCell, TableHeader,
  TableCellBackground,
]);

const cell = (text: string): N => ({
  type: 'tableCell',
  attrs: { colspan: 1, rowspan: 1, colwidth: null },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const row = (...cells: N[]): N => ({ type: 'tableRow', content: cells });

function makeState(): EditorState {
  const doc = schema.nodeFromJSON({
    type: 'doc',
    content: [{ type: 'table', content: [row(cell('A'), cell('B')), row(cell('c'), cell('d'))] }],
  });
  // Cursor in the first cell.
  let pos = -1;
  doc.descendants((n: PMNode, p: number) => { if (pos < 0 && n.isText) pos = p; });
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, pos) });
}

// Apply the command factory to a state, returning the next state.
function run(state: EditorState): EditorState {
  let next: EditorState | null = null;
  toggleHeaderRowStyle()({ state, tr: state.tr, dispatch: (tr: any) => { next = state.apply(tr); } } as any);
  return next ?? state;
}

const firstRow = (state: EditorState): N => state.doc.toJSON().content[0].content[0];
const boldMarks = (c: N): boolean => (c.content[0].content[0]?.marks ?? []).some((m: N) => m.type === 'bold');

describe('toggleHeaderRowStyle', () => {
  it('toggles the header fill on the first row (bold is presentational/CSS)', () => {
    let state = makeState();
    expect(isHeaderRowStyled(state)).toBe(false);

    // Toggle ON: only the fill marker is set (bold comes from the .cell-header CSS).
    state = run(state);
    expect(isHeaderRowStyled(state)).toBe(true);
    for (const c of firstRow(state).content) {
      expect(c.attrs.backgroundColor).toBe(HEADER_SHADE);
      expect(boldMarks(c)).toBe(false); // no stored bold mark — CSS handles it
    }
    // Second row untouched.
    expect(state.doc.toJSON().content[0].content[1].content[0].attrs.backgroundColor == null).toBe(true);

    // Toggle OFF: fill cleared.
    state = run(state);
    expect(isHeaderRowStyled(state)).toBe(false);
    for (const c of firstRow(state).content) {
      expect(c.attrs.backgroundColor == null).toBe(true);
    }
  });

  it('strips baked-in bold marks when turning the header off (import round-trip)', () => {
    // Simulate an imported header: first row has the fill + bold runs (export bakes bold).
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'table', content: [
        row(
          { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, backgroundColor: HEADER_SHADE },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'H', marks: [{ type: 'bold' }] }] }] },
        ),
        row(cell('x')),
      ] }],
    });
    let pos = -1;
    doc.descendants((n: PMNode, p: number) => { if (pos < 0 && n.isText) pos = p; });
    let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, pos) });
    expect(isHeaderRowStyled(state)).toBe(true);

    state = run(state); // toggle OFF
    expect(isHeaderRowStyled(state)).toBe(false);
    const c = firstRow(state).content[0];
    expect(c.attrs.backgroundColor == null).toBe(true);
    expect(boldMarks(c)).toBe(false); // baked bold removed
  });
});
