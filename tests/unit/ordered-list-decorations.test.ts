import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import ListItem from '@tiptap/extension-list-item';
import { OrderedList } from '../../src/lib/editor/extensions/orderedList';
import { BulletList } from '../../src/lib/editor/extensions/bulletList';
import { ListStyle, listStyleDecos } from '../../src/lib/editor/extensions/listStyle';
import { builtinStyleSheet, type StyleSheet } from '../../src/lib/styles/styleSheet';

const schema = getSchema([Document, Paragraph, Text, ListItem, OrderedList, BulletList, ListStyle]);

const p = (t: string) => schema.nodes.paragraph.create(null, schema.text(t));
const li = (...content: PmNode[]) => schema.nodes.listItem.create(null, content);
const ol = (attrs: Record<string, unknown> | null, ...items: PmNode[]) => schema.nodes.orderedList.create(attrs, items);
const ul = (...items: PmNode[]) => schema.nodes.bulletList.create(null, items);
const doc = (...content: PmNode[]) => schema.nodes.doc.create(null, content);

// The effective data-eff-list-style the plugin tags each <ol> with, in document order.
function effStyles(d: PmNode): (string | null)[] {
  const set = listStyleDecos(d, builtinStyleSheet());
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

describe('named list styles decide each depth\'s kind', () => {
  const uls = (attrs: Record<string, unknown> | null, ...items: PmNode[]) => schema.nodes.bulletList.create(attrs, items);
  const sheet = (): StyleSheet => {
    const s = builtinStyleSheet();
    s.list['Mixed'] = { name: 'Mixed', levels: [
      { kind: 'bullet', bulletChar: '–' },
      { kind: 'number', numType: 'decimal' },
      { kind: 'number', numType: 'decimal', startAt: 4 },
    ] };
    return s;
  };
  // Every list node's decoration attrs, in document order.
  function decoAttrs(d: PmNode): Record<string, string | undefined>[] {
    const set = listStyleDecos(d, sheet());
    const out: Record<string, string | undefined>[] = [];
    d.descendants((node, pos) => {
      if (node.type.name !== 'orderedList' && node.type.name !== 'bulletList') return;
      const deco = set.find(pos, pos + 1).find((x) => x.from === pos) as { type?: { attrs?: Record<string, string> } } | undefined;
      out.push(deco?.type?.attrs ?? {});
    });
    return out;
  }

  it('a number level numbers a nested <ul>; the start rides the counter', () => {
    const d = doc(uls({ listStyleName: 'Mixed' },
      li(p('a'), uls(null, li(p('b'), uls(null, li(p('c'))))))));
    const [l1, l2, l3] = decoAttrs(d);
    expect(l1['data-bullet']).toBe('–');
    expect(l1['data-eff-list-style']).toBeUndefined();
    expect(l2['data-eff-list-style']).toBe('decimal');
    expect(l3['data-eff-list-style']).toBe('decimal');
    expect(l3.style).toContain('counter-reset: list-item 3');
  });

  it('a bullet level bullets a nested <ol>', () => {
    const s = sheet();
    s.list['Rev'] = { name: 'Rev', levels: [{ kind: 'number', numType: 'decimal' }, { kind: 'bullet', bulletChar: '✓' }] };
    const d = doc(ol({ listStyleName: 'Rev' }, li(p('1'), ol(null, li(p('x'))))));
    const set = listStyleDecos(d, s);
    const out: Record<string, string | undefined>[] = [];
    d.descendants((node, pos) => {
      if (node.type.name !== 'orderedList') return;
      const deco = set.find(pos, pos + 1).find((x) => x.from === pos) as { type?: { attrs?: Record<string, string> } } | undefined;
      out.push(deco?.type?.attrs ?? {});
    });
    expect(out[0]['data-eff-list-style']).toBe('decimal');
    expect(out[1]['data-bullet']).toBe('✓');
    expect(out[1]['data-eff-list-style']).toBeUndefined();
  });
});
