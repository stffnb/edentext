import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import ListItem from '@tiptap/extension-list-item';
import { OrderedList } from '../../src/lib/editor/extensions/orderedList';
import { listMarkerDecos } from '../../src/lib/editor/extensions/listMarker';

const schema = getSchema([Document, Paragraph, Text, Bold, ListItem, OrderedList]);

const bold = (t: string) => schema.text(t, [schema.marks.bold.create()]);
const item = (...inline: PmNode[]) =>
  schema.nodes.listItem.create(null, schema.nodes.paragraph.create(null, inline));
const doc = (...items: PmNode[]) =>
  schema.nodes.doc.create(null, schema.nodes.orderedList.create(null, items));

// Which items the plugin marks as bold-markered, in document order.
function marked(d: PmNode): boolean[] {
  const set = listMarkerDecos(d);
  const out: boolean[] = [];
  d.descendants((node, pos) => {
    if (node.type.name !== 'listItem') return;
    out.push(set.find(pos, pos + 1).some((x) => x.from === pos));
  });
  return out;
}

describe('listMarkerDecos (marker weight from the first text portion)', () => {
  // The four cases LibreOffice renders as I. bold, II. plain, III. bold, IV. plain.
  it('follows the first portion, not the rest of the line', () => {
    const d = doc(
      item(bold('all bold')),
      item(schema.text('all plain')),
      item(bold('bold'), schema.text(' then plain')),
      item(schema.text('plain then '), bold('bold')),
    );
    expect(marked(d)).toEqual([true, false, true, false]);
  });

  it('leaves an item that starts with no text alone', () => {
    expect(marked(doc(schema.nodes.listItem.create(null, schema.nodes.paragraph.create())))).toEqual([false]);
  });
});
