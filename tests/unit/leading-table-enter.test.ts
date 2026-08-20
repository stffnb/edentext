// Enter at the very first position of a table with nothing before it inserts a
// paragraph above the table and moves the caret there — the only way to get text
// before such a table. Anywhere else in the table Enter stays a normal split.
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { TrailingNode } from '../../src/lib/editor/extensions/trailingNode';

type N = any;

const cell = (text: string): N => ({
  type: 'tableCell',
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
});
const table = (...rows: N[][]): N => ({
  type: 'table',
  content: rows.map((cells) => ({ type: 'tableRow', content: cells })),
});

function makeEditor(...content: N[]) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [Document, Paragraph, Text, Table, TableRow, TableHeader, TableCell, TrailingNode],
    content: { type: 'doc', content },
  });
}
const pressEnter = (editor: Editor) =>
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

describe('Enter before a leading table', () => {
  it('inserts a paragraph above and moves the caret into it', () => {
    const editor = makeEditor(table([cell('a'), cell('b')]));
    editor.commands.setTextSelection(4); // start of the first cell's text
    pressEnter(editor);
    const json = editor.getJSON().content as N[];
    expect(json[0].type).toBe('paragraph');
    expect(json[1].type).toBe('table');
    expect(editor.state.selection.from).toBe(1);
    editor.destroy();
  });

  it('stays a normal split when a paragraph already precedes the table', () => {
    const editor = makeEditor({ type: 'paragraph' }, table([cell('a')]));
    editor.commands.setTextSelection(6); // start of the first cell's text
    pressEnter(editor);
    const json = editor.getJSON().content as N[];
    expect(json.filter((n) => n.type === 'paragraph' && json.indexOf(n) === 0).length).toBe(1);
    expect(json[1].content[0].content[0].content.length).toBe(2); // the cell split instead
    editor.destroy();
  });

  it('stays a normal split away from the first position', () => {
    const editor = makeEditor(table([cell('a'), cell('b')]));
    editor.commands.setTextSelection(9); // second cell
    pressEnter(editor);
    const json = editor.getJSON().content as N[];
    expect(json[0].type).toBe('table');
    editor.destroy();
  });
});
