// LibreOffice's AutoText: a stored block of text, inserted by name or by typing its
// shortcut and pressing F3. The entries belong to the app, not to a document.
import { describe, it, expect, beforeEach } from 'vitest';
import { Editor, getHTMLFromFragment } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Heading from '@tiptap/extension-heading';
import ListItem from '@tiptap/extension-list-item';
import { BulletList } from '../../src/lib/editor/extensions/bulletList';
import { OrderedList } from '../../src/lib/editor/extensions/orderedList';
import { TextBox } from '../../src/lib/editor/extensions/textBox';
// A box's content takes a table (a floating table rides one), so the schema needs it.
import { Table, TableHeader, TableCell } from '@tiptap/extension-table';
import { ResizableTableRow } from '../../src/lib/editor/extensions/tableRow';
import { AutoText } from '../../src/lib/editor/extensions/autoText';
import { entryForShortcut, loadAutoText } from '../../src/lib/storage/autoText';
import { setAutoTextEntries } from '../../src/lib/storage/autoText.svelte';

const entry = { name: 'Greeting', shortcut: 'mfg', content: '<p>Yours, <strong>Ada</strong></p>' };

describe('the shortcut', () => {
  it('matches ignoring case, and only whole', () => {
    expect(entryForShortcut([entry], 'MFG')?.name).toBe('Greeting');
    expect(entryForShortcut([entry], 'mf')).toBeNull();
    expect(entryForShortcut([entry], '')).toBeNull();
  });
});

describe('expanding in the editor', () => {
  beforeEach(() => setAutoTextEntries([entry]));

  function makeEditor(content: string) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return new Editor({ element: el, extensions: [Document, Paragraph, Text, Bold, AutoText], content });
  }

  it('replaces the typed shortcut with the entry, marks and all', () => {
    const e = makeEditor('<p>Bye. mfg</p>');
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    expect(e.commands.expandAutoText()).toBe(true);
    expect(e.state.doc.textContent).toBe('Bye. Yours, Ada');
    expect(e.state.doc.lastChild!.lastChild!.marks[0]?.type.name).toBe('bold');
    e.destroy();
  });

  it('does nothing where the word at the caret names no entry', () => {
    const e = makeEditor('<p>Bye. mfx</p>');
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    expect(e.commands.expandAutoText()).toBe(false);
    expect(e.state.doc.textContent).toBe('Bye. mfx');
    e.destroy();
  });

  it('inserts an entry the library names, wherever the caret is', () => {
    const e = makeEditor('<p>Bye.</p>');
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    expect(e.commands.insertAutoText(entry)).toBe(true);
    expect(e.state.doc.textContent).toBe('Bye.Yours, Ada');
    e.destroy();
  });
});

// An entry keeps the nodes themselves. Serialized to an HTML string a text box loses
// its place in the line: any block tag inside a <p> closes it, and the box holds blocks.
describe('an entry holding a text box', () => {
  const box = {
    type: 'textBox',
    attrs: { width: 160, height: 60 },
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'KASTEN' }] }],
  };
  const line = [{ type: 'paragraph', content: [{ type: 'text', text: 'vor ' }, box, { type: 'text', text: ' nach' }] }];

  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  function boxEditor(content: any[]) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return new Editor({
      element: el,
      extensions: [Document, Paragraph, Text, Bold, Heading, BulletList, OrderedList, ListItem, TextBox,
        Table, ResizableTableRow, TableHeader, TableCell, AutoText],
      content: { type: 'doc', content },
    });
  }

  it('puts the box back where it stood in the line', () => {
    const src = boxEditor(line);
    const stored = src.state.doc.slice(0, src.state.doc.content.size).content.toJSON() as any[];
    const dst = boxEditor([{ type: 'paragraph' }]);
    dst.commands.insertAutoText({ name: 'Box', shortcut: '', content: stored });
    const para = dst.state.doc.child(0);
    expect(dst.state.doc.childCount).toBe(1);
    expect(para.content.child(1).type.name).toBe('textBox');
    src.destroy();
    dst.destroy();
  });

  it('would not, as an HTML string', () => {
    const src = boxEditor(line);
    const html = getHTMLFromFragment(src.state.doc.content, src.schema);
    const dst = boxEditor([{ type: 'paragraph' }]);
    dst.commands.insertAutoText({ name: 'Box', shortcut: '', content: html });
    expect(dst.state.doc.childCount).toBeGreaterThan(1);
    src.destroy();
    dst.destroy();
  });
});

describe('an entry stored before the nodes were kept', () => {
  it('loads with its HTML as the content', () => {
    localStorage.setItem('edentext-autotext', JSON.stringify([{ name: 'Old', shortcut: 'o', html: '<p>hi</p>' }]));
    expect(loadAutoText()).toEqual([{ name: 'Old', shortcut: 'o', content: '<p>hi</p>' }]);
    localStorage.removeItem('edentext-autotext');
  });
});
