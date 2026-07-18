// The header/footer schema holds exactly one paragraph, so Enter can't split a block.
// It must instead insert a line break (Word: Enter in a footer adds a blank line that
// grows the zone), while the doc stays a single paragraph. Drives a real HF editor.
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { hfExtensions } from '../../src/lib/editor/extensions/headerFooter';

type N = any;

function makeEditor(content: N) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: hfExtensions(), content });
}
const pressEnter = (editor: Editor) =>
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

describe('header/footer Enter inserts a line break', () => {
  it('adds a hardBreak and keeps one paragraph', () => {
    const editor = makeEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Seite 1' }] }] });
    editor.commands.focus('end');
    pressEnter(editor);
    const json = editor.getJSON();
    expect(json.content!.length).toBe(1);
    expect((json.content![0].content as N[]).filter((n) => n.type === 'hardBreak').length).toBe(1);
    editor.destroy();
  });

  it('adds one line break per Enter, growing the content', () => {
    const editor = makeEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] });
    editor.commands.focus('end');
    pressEnter(editor);
    pressEnter(editor);
    const inline = editor.getJSON().content![0].content as N[];
    expect(inline.filter((n) => n.type === 'hardBreak').length).toBe(2);
    editor.destroy();
  });
});
