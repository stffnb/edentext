// The break attr survives only where a file can hold it: a body block or a list item.
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { BulletList, ListItem } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader } from '@tiptap/extension-table';
import { ResizableTableRow } from '../../src/lib/editor/extensions/tableRow';
import { PageBreak } from '../../src/lib/editor/extensions/pageBreak';

type N = any;
const exts = [Document, Paragraph, Text, BulletList, ListItem, Table, ResizableTableRow, TableCell, TableHeader, PageBreak];
const schema = getSchema(exts);
const P = (text: string): N => ({ type: 'paragraph', attrs: { breakBefore: 'page' }, content: [{ type: 'text', text }] });

const doc = schema.nodeFromJSON({
  type: 'doc',
  content: [
    P('body'),
    { type: 'bulletList', content: [{ type: 'listItem', content: [P('item')] }] },
    { type: 'table', content: [{ type: 'tableRow', content: [
      { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [P('cell')] }] }] },
  ],
});

describe('page break carriers', () => {
  it('clears the break in a table cell and keeps the body ones', () => {
    const plugins = (PageBreak as N).config.addProseMirrorPlugins.call({ options: { types: [] } });
    const state = EditorState.create({ schema, doc, plugins });
    // Any doc change runs the sweep; the insert itself carries no break.
    const after = state.apply(state.tr.insertText('!', 1));
    const kept: string[] = [];
    after.doc.descendants((n) => { if (n.attrs.breakBefore === 'page') kept.push(n.textContent); });
    expect(kept).toEqual(['!body', 'item']);
  });
});
