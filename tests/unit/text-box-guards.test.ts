// A text box is an inline node with block content, so two things the schema alone
// cannot say have to be enforced: a box never nests in another, and a selection never
// ends inside a box it did not start in (deleting one would dissolve the frame and
// spill its text into the body).
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Heading from '@tiptap/extension-heading';
import { BulletList } from '../../src/lib/editor/extensions/bulletList';
import { OrderedList } from '../../src/lib/editor/extensions/orderedList';
import ListItem from '@tiptap/extension-list-item';
import { TextBox, TextAlignInFrames } from '../../src/lib/editor/extensions/textBox';

type N = any;

// jsdom has none, and the node view refits its wrapper through one.
(globalThis as N).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const box = (text: string): N => ({
  type: 'textBox',
  attrs: { width: 160, height: 60 },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

function makeEditor(...content: N[]) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [Document, Paragraph, Text, Heading, BulletList, OrderedList, ListItem, TextBox,
      TextAlignInFrames.configure({ types: ['paragraph', 'heading'] })],
    content: { type: 'doc', content },
  });
}

const boxCount = (ed: Editor): number => {
  let n = 0;
  ed.state.doc.descendants((node) => { if (node.type.name === 'textBox') n += 1; });
  return n;
};
// The depth the caret sits at inside a box, 0 when it is not in one.
const boxDepth = (ed: Editor): number => {
  const $p = ed.state.selection.$from;
  for (let d = 1; d <= $p.depth; d++) if ($p.node(d).type.name === 'textBox') return d;
  return 0;
};
const boxPos = (ed: Editor): number => {
  let pos = -1;
  ed.state.doc.descendants((node, p) => { if (pos < 0 && node.type.name === 'textBox') pos = p; });
  return pos;
};

const doc = (): N[] => [
  { type: 'paragraph', content: [{ type: 'text', text: 'vor AAA ' }, box('KASTEN'), { type: 'text', text: ' nach BBB' }] },
];

describe('a text box in the line', () => {
  it('lives in the paragraph, not beside it', () => {
    const ed = makeEditor(...doc());
    const para = ed.state.doc.child(0);
    expect(para.type.name).toBe('paragraph');
    expect(para.content.child(1).type.name).toBe('textBox');
    expect(ed.state.schema.nodes.textBox.isInline).toBe(true);
    ed.destroy();
  });

  it('refuses a box inside a box', () => {
    const ed = makeEditor(...doc());
    const s = ed.state.schema;
    const nested = s.nodes.textBox.create({ width: 60, height: 30 }, s.nodes.paragraph.create(null, s.text('INNEN')));
    // Position 2 inside the box's own first paragraph.
    ed.view.dispatch(ed.state.tr.insert(boxPos(ed) + 2, nested));
    expect(boxCount(ed)).toBe(1);
    ed.destroy();
  });

  it('grows a selection that reaches into the box to the whole box', () => {
    const ed = makeEditor(...doc());
    const pos = boxPos(ed);
    ed.commands.setTextSelection({ from: pos - 4, to: pos + 4 });
    const sel = ed.state.selection;
    expect(sel.from).toBe(pos - 4);
    expect(sel.to).toBe(pos + ed.state.doc.nodeAt(pos)!.nodeSize);
    ed.destroy();
  });

  it('deletes such a selection whole instead of spilling the box text', () => {
    const ed = makeEditor(...doc());
    const pos = boxPos(ed);
    ed.commands.setTextSelection({ from: pos - 4, to: pos + 4 });
    ed.commands.deleteSelection();
    expect(boxCount(ed)).toBe(0);
    expect(ed.state.doc.textBetween(0, ed.state.doc.content.size)).toBe('vor  nach BBB');
    ed.destroy();
  });

  it('leaves a selection inside one box alone', () => {
    const ed = makeEditor(...doc());
    const pos = boxPos(ed);
    ed.commands.setTextSelection({ from: pos + 2, to: pos + 5 });
    expect(ed.state.selection.from).toBe(pos + 2);
    expect(ed.state.selection.to).toBe(pos + 5);
    ed.destroy();
  });
});

describe('inserting a text box', () => {
  it('puts it at the caret, cursor inside', () => {
    const ed = makeEditor({ type: 'paragraph', content: [{ type: 'text', text: 'abcd' }] });
    ed.commands.setTextSelection(3);
    ed.commands.insertTextBox();
    const para = ed.state.doc.child(0);
    expect(para.content.child(1).type.name).toBe('textBox');
    expect(ed.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(boxDepth(ed)).toBeGreaterThan(0);
    ed.destroy();
  });

  it('puts a second one after the block when the caret is inside one', () => {
    const ed = makeEditor(...doc());
    ed.commands.setTextSelection(boxPos(ed) + 2);
    ed.commands.insertTextBox();
    expect(boxCount(ed)).toBe(2);
    // The new box rides a paragraph of its own, next to the one holding the first.
    expect(ed.state.doc.childCount).toBe(2);
    expect(ed.state.doc.child(1).content.child(0).type.name).toBe('textBox');
    ed.destroy();
  });
});

describe('aligning a selected box', () => {
  it('moves the block it sits in, not the text inside it', () => {
    const ed = makeEditor(...doc());
    ed.commands.setNodeSelection(boxPos(ed));
    ed.commands.setTextAlign('right');
    const outer = ed.state.doc.child(0);
    const inner = outer.content.child(1).content.child(0);
    expect(outer.attrs.textAlign).toBe('right');
    expect(inner.attrs.textAlign).toBeNull();
    ed.destroy();
  });

  it('aligns the text inside when the caret is in the box', () => {
    const ed = makeEditor(...doc());
    ed.commands.setTextSelection(boxPos(ed) + 2);
    ed.commands.setTextAlign('center');
    const outer = ed.state.doc.child(0);
    expect(outer.attrs.textAlign).toBeNull();
    expect(outer.content.child(1).content.child(0).attrs.textAlign).toBe('center');
    ed.destroy();
  });
});

// The frame holds editable blocks, so at its own first and last text position the
// browser has no neighbouring one to walk to; without a step out the caret is stuck.
describe('leaving a box that is alone in its paragraph', () => {
  const press = (ed: Editor, key: string): void => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true });
    ed.view.someProp('handleKeyDown', f => f(ed.view, ev));
  };
  const alone = (): N[] => [{ type: 'paragraph', content: [box('KASTEN')] }];

  it('steps before the box on ArrowLeft at its start', () => {
    const ed = makeEditor(...alone());
    ed.commands.setTextSelection(boxPos(ed) + 2);
    press(ed, 'ArrowLeft');
    expect(ed.state.selection.from).toBe(boxPos(ed));
    expect(boxDepth(ed)).toBe(0);
    ed.destroy();
  });

  it('steps after the box on ArrowRight at its end', () => {
    const ed = makeEditor(...alone());
    const pos = boxPos(ed);
    ed.commands.setTextSelection(pos + 2 + 'KASTEN'.length);
    press(ed, 'ArrowRight');
    expect(ed.state.selection.from).toBe(pos + ed.state.doc.nodeAt(pos)!.nodeSize);
    expect(boxDepth(ed)).toBe(0);
    ed.destroy();
  });

  it('leaves the caret alone inside the text', () => {
    const ed = makeEditor(...alone());
    ed.commands.setTextSelection(boxPos(ed) + 4);
    press(ed, 'ArrowLeft');
    expect(ed.state.selection.from).toBe(boxPos(ed) + 4);
    ed.destroy();
  });
});

// A box that starts its paragraph has no text position beside it, so an editable frame
// swallows the caret meant for the box's own place in the line.
describe('the frame as an atom', () => {
  const frame = (ed: Editor): HTMLElement => ed.view.dom.querySelector('.textbox-node')!;

  it('is not editable while nobody edits it', () => {
    const ed = makeEditor(...doc());
    ed.commands.setTextSelection(1);
    expect(frame(ed).getAttribute('contenteditable')).toBe('false');
    ed.destroy();
  });

  it('turns editable, and shows its frame, with the caret in its text', () => {
    const ed = makeEditor(...doc());
    ed.commands.setTextSelection(boxPos(ed) + 2);
    expect(frame(ed).getAttribute('contenteditable')).toBeNull();
    expect(frame(ed).classList.contains('textbox-active')).toBe(true);
    ed.destroy();
  });
});
