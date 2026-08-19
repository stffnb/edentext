// A heading is a named style plus the node type, and the two must never drift apart:
// a paragraph carrying "Heading 2" looks like a heading, is none, and drops out of the
// navigator's outline. Drives a real body editor.
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { extensions } from '../../src/lib/editor/extensions';
import { outline } from '../../src/lib/editor/extensions/outline';

type N = any;

function makeEditor(content: N) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({ element: el, extensions, content });
}
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const blocks = (editor: Editor) =>
  (editor.getJSON().content as N[]).map((n) => `${n.type}:${n.attrs?.level ?? ''}:${n.attrs?.styleName ?? ''}`);

// Ctrl+Alt+N runs off event.code, not the keymap — so does this.
const press = (editor: Editor, code: string, init: KeyboardEventInit = {}) =>
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init }));

describe('heading style name', () => {
  it('Ctrl+Alt+N applies the level and its style, 1 through 6', () => {
    const editor = makeEditor({ type: 'doc', content: [p('x')] });
    for (const level of [1, 2, 3, 4, 5, 6]) {
      editor.commands.focus('end');
      press(editor, `Digit${level}`, { ctrlKey: true, altKey: true });
      expect(blocks(editor)).toEqual([`heading:${level}:Heading ${level}`]);
    }
    press(editor, 'Digit0', { ctrlKey: true, altKey: true });
    expect(blocks(editor)).toEqual(['paragraph::Standard']);
    editor.destroy();
  });

  it('Enter at the end of a heading starts a body paragraph', () => {
    const editor = makeEditor({ type: 'doc', content: [{ type: 'heading', attrs: { level: 2, styleName: 'Heading 2' }, content: [{ type: 'text', text: 'A' }] }] });
    editor.commands.focus('end');
    editor.commands.splitBlock();
    expect(blocks(editor)).toEqual(['heading:2:Heading 2', 'paragraph::']);
    editor.destroy();
  });

  it('lists two consecutive headings of one level', () => {
    const editor = makeEditor({ type: 'doc', content: [p('x')] });
    editor.commands.focus('end');
    press(editor, 'Digit2', { ctrlKey: true, altKey: true });
    editor.commands.insertContent('A');
    editor.commands.splitBlock();
    press(editor, 'Digit2', { ctrlKey: true, altKey: true });
    editor.commands.insertContent('B');
    expect(outline(editor.state.doc).map((e) => `${e.level}:${e.text}`)).toEqual(['2:xA', '2:B']);
    editor.destroy();
  });
});
