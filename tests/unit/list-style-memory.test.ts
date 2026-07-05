import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import ListItem from '@tiptap/extension-list-item';
import type { Node as PmNode } from '@tiptap/pm/model';
import { OrderedList } from '../../src/lib/editor/extensions/orderedList';
import { BulletList } from '../../src/lib/editor/extensions/bulletList';
import { Indent } from '../../src/lib/editor/extensions/indent';

const extensions = [Document, Paragraph, Text, ListItem, OrderedList, BulletList, Indent];

let editor: Editor;
afterEach(() => editor?.destroy());

const li = (...blocks: unknown[]) => ({ type: 'listItem', content: blocks });
const p = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });

function posOf(doc: PmNode, text: string): number {
  let pos = 0;
  doc.descendants((node, p) => { if (node.isText && node.text === text) pos = p + 1; });
  return pos;
}

// The listStyleType of the nearest ordered-list ancestor of the given text.
function styleAround(doc: PmNode, text: string): string | null {
  const $p = doc.resolve(posOf(doc, text));
  for (let d = $p.depth; d > 0; d--) {
    if ($p.node(d).type.name === 'orderedList') return ($p.node(d).attrs.listStyleType as string | null) ?? null;
  }
  return null;
}

// A 3-item level-1 list; the first item already holds an explicit `style` sublist.
function docWith(style: string | null) {
  const sub = style
    ? { type: 'orderedList', attrs: { listStyleType: style }, content: [li(p('styled sub'))] }
    : { type: 'orderedList', content: [li(p('plain sub'))] };
  return {
    type: 'doc',
    content: [{ type: 'orderedList', content: [li(p('a'), sub), li(p('b')), li(p('c'))] }],
  };
}

describe('list-style memory (Tab into a new level reuses the level style)', () => {
  it('stamps a newly nested list with a sibling level-2 explicit style', () => {
    editor = new Editor({ extensions, content: docWith('lower-alpha-paren') });
    editor.commands.setTextSelection(posOf(editor.state.doc, 'c'));
    editor.commands.indentListForward();
    // 'c' is now a level-2 item; its list should have adopted the remembered style.
    expect(styleAround(editor.state.doc, 'c')).toBe('lower-alpha-paren');
    // The original sibling is untouched.
    expect(styleAround(editor.state.doc, 'styled sub')).toBe('lower-alpha-paren');
  });

  it('leaves the new list attr-less when no sibling level carries an explicit style', () => {
    editor = new Editor({ extensions, content: docWith(null) });
    editor.commands.setTextSelection(posOf(editor.state.doc, 'c'));
    editor.commands.indentListForward();
    expect(styleAround(editor.state.doc, 'c')).toBeNull();
  });
});
