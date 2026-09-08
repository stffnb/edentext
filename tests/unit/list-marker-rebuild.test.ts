// Which transactions the list-marker decorations are rebuilt for: a marker takes its
// format from the item's first text portion, so an edit inside an item counts, and a
// mark step counts by its own range — its position map is empty.
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { extensions } from '../../src/lib/editor/extensions';
import { touchesList } from '../../src/lib/editor/extensions/listMarker';

const text = (t: string) => ({ type: 'text', text: t });
const para = (t: string) => ({ type: 'paragraph', content: [text(t)] });
const item = (t: string) => ({ type: 'listItem', content: [para(t)] });

// "outside" fills 1..8; the list starts at 9, its first item's text at 12.
const content = {
  type: 'doc',
  content: [para('outside'), { type: 'bulletList', content: [item('alpha'), item('beta')] }, para('tail')],
};

function makeEditor() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({ element: el, extensions, content });
}

describe('touchesList', () => {
  it('sees an edit in a list item and ignores one outside every list', () => {
    const editor = makeEditor();
    const { doc } = editor.state;
    const at = doc.resolve(1).after(1); // after the first paragraph = the list's position
    const inItem = at + 3; // inside the first item's paragraph

    expect(touchesList(editor.state.tr.insertText('x', inItem))).toBe(true);
    expect(touchesList(editor.state.tr.insertText('x', 2))).toBe(false);
    editor.destroy();
  });

  it('sees a mark applied inside an item, whose position map is empty', () => {
    const editor = makeEditor();
    const bold = editor.state.schema.marks.bold;
    const at = editor.state.doc.resolve(1).after(1);
    const inItem = at + 3;

    const marked = editor.state.tr.addMark(inItem, inItem + 4, bold.create());
    expect(marked.steps[0].getMap().ranges.length).toBe(0);
    expect(touchesList(marked)).toBe(true);

    expect(touchesList(editor.state.tr.addMark(2, 6, bold.create()))).toBe(false);
    editor.destroy();
  });

  it('sees the list node itself change, and a list inserted where there was none', () => {
    const editor = makeEditor();
    const at = editor.state.doc.resolve(1).after(1);

    expect(touchesList(editor.state.tr.setNodeAttribute(at, 'markerAlign', 'right'))).toBe(true);

    const list = editor.state.schema.nodeFromJSON({ type: 'bulletList', content: [item('new')] });
    expect(touchesList(editor.state.tr.insert(1, list))).toBe(true);
    editor.destroy();
  });
});
