// The empty-document hint rides the one empty block the caret is in and leaves with
// the first character. A small schema, so the decoration reaches the DOM in jsdom.
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Placeholder } from '../../src/lib/editor/extensions/placeholder';

function makeEditor(content?: object) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [Document, Paragraph, Text, Placeholder.configure({ placeholder: () => 'Start typing…' })],
    content,
  });
}

const hint = (editor: Editor, nth = 0) => {
  const p = editor.view.dom.querySelectorAll('p')[nth];
  return p.classList.contains('is-editor-empty') ? p.getAttribute('data-placeholder') : null;
};

describe('the placeholder', () => {
  it('shows on the empty document and leaves with the first character', () => {
    const editor = makeEditor();
    expect(hint(editor)).toBe('Start typing…');
    editor.view.dispatch(editor.state.tr.insertText('a', 1));
    expect(hint(editor)).toBeNull();
    editor.view.dispatch(editor.state.tr.delete(1, 2));
    expect(hint(editor)).toBe('Start typing…');
    editor.destroy();
  });

  it('follows the caret between empty blocks, and stays off a document with text', () => {
    const editor = makeEditor({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph' }] });
    editor.commands.focus(3);
    expect([hint(editor, 0), hint(editor, 1)]).toEqual([null, 'Start typing…']);
    editor.commands.focus(1);
    expect([hint(editor, 0), hint(editor, 1)]).toEqual(['Start typing…', null]);
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }, { type: 'paragraph' }] });
    editor.commands.focus(4);
    expect([hint(editor, 0), hint(editor, 1)]).toEqual([null, null]);
    editor.destroy();
  });
});
