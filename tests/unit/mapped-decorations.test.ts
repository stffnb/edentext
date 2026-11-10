// Decorations a plugin carries through an edit, mapping what it did not recompute, must
// equal the ones it builds afresh for the document that edit left.
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import HardBreak from '@tiptap/extension-hard-break';
import { EditorState, type Transaction } from '@tiptap/pm/state';
import type { DecorationSet } from '@tiptap/pm/view';
import { Image } from '../../src/lib/editor/extensions/image';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNwaDgAAAKEAYEml6crAAAAAElFTkSuQmCC';
const img = (wrap = 'inline') => ({ type: 'image', attrs: { src: PNG, width: 100, height: 50, wrap } });
const text = (t: string) => ({ type: 'text', text: t });

function editor() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [Document, Paragraph, Text, HardBreak, Image],
    content: { type: 'doc', content: [
      { type: 'paragraph', content: [text('before')] },
      { type: 'paragraph', content: [img()] },
      { type: 'paragraph', content: [img(), { type: 'hardBreak' }, text('caption')] },
      { type: 'paragraph', content: [img('topBottom'), text('beside')] },
      { type: 'paragraph', content: [text('after')] },
    ] },
  });
}

const shape = (set: DecorationSet) => set.find()
  .map((d) => `${d.from}-${d.to} ${JSON.stringify((d as unknown as { type: { attrs: object } }).type.attrs)}`).sort();
// Every plugin's decorations, as the state holds them and as a fresh state builds them.
function compare(state: EditorState) {
  const fresh = EditorState.create({ doc: state.doc, plugins: state.plugins });
  for (const plugin of state.plugins) {
    const deco = plugin.props.decorations;
    if (!deco || !plugin.spec.state) continue;
    expect(shape(deco.call(plugin, state) as DecorationSet), plugin.key).toEqual(shape(deco.call(plugin, fresh) as DecorationSet));
  }
}

// Position of the first node of `type` at or after the start of block `n`.
const blockStart = (e: Editor, n: number) => { let pos = 0; for (let i = 0; i < n; i++) pos += e.state.doc.child(i).nodeSize; return pos; };

describe('decorations carried through an edit', () => {
  const edits: [string, (e: Editor) => Transaction][] = [
    ['text typed beside a lone image', (e) => e.state.tr.insertText('x', blockStart(e, 1) + 2)],
    ['the text before an image deleted', (e) => e.state.tr.delete(blockStart(e, 2) + 3, blockStart(e, 2) + 10)],
    ['a line break before the caption', (e) => e.state.tr.insert(blockStart(e, 2) + 2, e.schema.nodes.hardBreak.create())],
    ['a block split and two joined', (e) => e.state.tr.split(blockStart(e, 3) + 2).join(blockStart(e, 1))],
    ['a frame rewrapped in place', (e) => e.state.tr.setNodeAttribute(blockStart(e, 1) + 1, 'wrap', 'topBottom')],
    ['a frame rewrapped by markup', (e) => e.state.tr.setNodeMarkup(blockStart(e, 3) + 1, undefined, { ...e.state.doc.nodeAt(blockStart(e, 3) + 1)!.attrs, wrap: 'inline' })],
    ['a paragraph removed', (e) => e.state.tr.delete(blockStart(e, 2), blockStart(e, 3))],
  ];
  for (const [name, edit] of edits) {
    it(`match the ones built afresh: ${name}`, () => {
      const e = editor();
      e.view.dispatch(edit(e));
      compare(e.state);
      // And a second edit on top of the carried set.
      e.view.dispatch(e.state.tr.insertText('y', 1));
      compare(e.state);
      e.destroy();
    });
  }
});
