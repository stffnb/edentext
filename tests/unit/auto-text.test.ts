// LibreOffice's AutoText: a stored block of text, inserted by name or by typing its
// shortcut and pressing F3. The entries belong to the app, not to a document.
import { describe, it, expect, beforeEach } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import { AutoText } from '../../src/lib/editor/extensions/autoText';
import { entryForShortcut } from '../../src/lib/storage/autoText';
import { setAutoTextEntries } from '../../src/lib/storage/autoText.svelte';

const entry = { name: 'Greeting', shortcut: 'mfg', html: '<p>Yours, <strong>Ada</strong></p>' };

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
