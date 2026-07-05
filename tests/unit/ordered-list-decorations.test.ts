import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import ListItem from '@tiptap/extension-list-item';
import { OrderedList, orderedListStyleDecos } from '../../src/lib/editor/extensions/orderedList';
import { BulletList } from '../../src/lib/editor/extensions/bulletList';

const schema = getSchema([Document, Paragraph, Text, ListItem, OrderedList, BulletList]);

const p = (t: string) => schema.nodes.paragraph.create(null, schema.text(t));
const li = (...content: PmNode[]) => schema.nodes.listItem.create(null, content);
const ol = (attrs: Record<string, unknown> | null, ...items: PmNode[]) => schema.nodes.orderedList.create(attrs, items);
const ul = (...items: PmNode[]) => schema.nodes.bulletList.create(null, items);
const doc = (...content: PmNode[]) => schema.nodes.doc.create(null, content);

// The effective data-eff-list-style the plugin tags each <ol> with, in document order.
function effStyles(d: PmNode): (string | null)[] {
  const set = orderedListStyleDecos(d);
  const out: (string | null)[] = [];
  d.descendants((node, pos) => {
    if (node.type.name !== 'orderedList') return;
    const deco = set.find(pos, pos + 1).find((x) => x.from === pos) as { type?: { attrs?: Record<string, string> } } | undefined;
    out.push(deco?.type?.attrs?.['data-eff-list-style'] ?? null);
  });
  return out;
}

describe('orderedListStyleDecos (effective numbering per <ol>)', () => {
  it('advances the default cycle 1. → a. → i. with plain nesting', () => {
    const d = doc(ol(null, li(p('one'), ol(null, li(p('two'), ol(null, li(p('three'))))))));
    expect(effStyles(d)).toEqual(['decimal', 'lower-alpha', 'lower-roman']);
  });

  it('re-anchors: an explicit "a., b." parent makes its child default to i.', () => {
    const d = doc(ol({ listStyleType: 'lower-alpha' }, li(p('a'), ol(null, li(p('i'))))));
    expect(effStyles(d)).toEqual(['lower-alpha', 'lower-roman']);
  });

  it('inherits the paren suffix: an explicit "a)" parent makes its child default to i)', () => {
    const d = doc(ol({ listStyleType: 'lower-alpha-paren' },
      li(p('a'), ol(null, li(p('i'), ol(null, li(p('1'))))))));
    expect(effStyles(d)).toEqual(['lower-alpha-paren', 'lower-roman-paren', 'decimal-paren']);
  });

  it('propagates multilevel to attr-less chain members', () => {
    const d = doc(ol({ listStyleType: 'multilevel' }, li(p('1'), ol(null, li(p('1.1'))))));
    expect(effStyles(d)).toEqual(['multilevel', 'multilevel']);
  });

  it('counts a bullet ancestor: an ol one level inside a ul defaults to a.', () => {
    const d = doc(ul(li(p('x'), ol(null, li(p('y'))))));
    expect(effStyles(d)).toEqual(['lower-alpha']);
  });
});
