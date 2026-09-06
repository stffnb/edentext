// A cell rebuilt by a replace loses its column weight; the plugin reads it back from
// the column's other rows, so undo/redo and the saved widths stay put.
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Table, TableCell, TableHeader } from '@tiptap/extension-table';
import { ResizableTableRow } from '../../src/lib/editor/extensions/tableRow';
import { TableColumnResize } from '../../src/lib/editor/extensions/tableColumnResize';

type N = any;
const schema = getSchema([Document, Paragraph, Text, Table, ResizableTableRow, TableCell, TableHeader, TableColumnResize]);
const cell = (w: number[] | null, t: string): N => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: w },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const row = (...cells: N[]): N => ({ type: 'tableRow', content: cells });

const widths = (doc: N): unknown[] => {
  const out: unknown[] = [];
  doc.descendants((n: N) => { if (n.type.name === 'tableCell') { out.push(n.attrs.colwidth); return false; } });
  return out;
};

describe('column weight refill', () => {
  it('fills a lost weight from the column and leaves a new column alone', () => {
    const doc = schema.nodeFromJSON({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
      { type: 'table', content: [
        row(cell(null, 'a'), cell([20000], 'b'), cell(null, 'c')),
        row(cell([30000], 'd'), cell([20000], 'e'), cell(null, 'f'))] }] });
    const plugins = (TableColumnResize as N).config.addProseMirrorPlugins.call({ options: {} });
    let state = EditorState.create({ schema, doc, plugins });
    state = state.apply(state.tr.insertText('!', 1));
    // The first column's weight comes back from row two; the third has none anywhere.
    expect(widths(state.doc)).toEqual([[30000], [20000], null, [30000], [20000], null]);
  });
});
