import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import ListItem from '@tiptap/extension-list-item';
import type { Node as PmNode } from '@tiptap/pm/model';
import { OrderedList } from '../../src/lib/editor/extensions/orderedList';
import { extensions as fullExtensions } from '../../src/lib/editor/extensions';
import { listNumberAt } from '../../src/lib/editor/extensions/listStyle';
import { builtinStyleSheet } from '../../src/lib/styles/styleSheet';
import { BulletList } from '../../src/lib/editor/extensions/bulletList';
import { Indent } from '../../src/lib/editor/extensions/indent';
import {
  builtinListStyles, effectiveListLevel, listStyleMarginCm, listStyleOverridden,
  MAX_LIST_LEVELS, type ListStyle,
} from '../../src/lib/styles/listStyles';

const style: ListStyle = {
  name: 'Test',
  levels: [
    { kind: 'number', numType: 'upper-roman-paren', markerAlign: 'right', indentCm: 0.5 },
    { kind: 'bullet', bulletChar: '✓' },
    { kind: 'number', numType: 'lower-alpha', startAt: 3 },
  ],
};

describe('effectiveListLevel (attr ?? style level ?? cycle default)', () => {
  it('takes the style level where the node has no attr', () => {
    const eff = effectiveListLevel({}, true, style, 1);
    expect(eff.listStyleType).toBe('upper-roman-paren');
    expect(eff.markerAlign).toBe('right');
    expect(eff.indent).toBe(0.5);
  });

  it('lets a node attr override its level', () => {
    const eff = effectiveListLevel({ listStyleType: 'decimal', indent: 1 }, true, style, 1);
    expect(eff.listStyleType).toBe('decimal');
    expect(eff.indent).toBe(1);
    expect(eff.markerAlign).toBe('right'); // untouched channel still comes from the style
  });

  it('the level kind wins over the node species (a number level numbers a <ul>)', () => {
    expect(effectiveListLevel({}, false, style, 2).bulletChar).toBe('✓');
    // An ordered node over the bullet level renders that bullet, not a numbering.
    const overBullet = effectiveListLevel({}, true, style, 2);
    expect(overBullet.kind).toBe('bullet');
    expect(overBullet.bulletChar).toBe('✓');
    expect(overBullet.listStyleType).toBeNull();
    // A bullet node over a number level renders the numbering — start value included.
    const overNumber = effectiveListLevel({}, false, style, 1);
    expect(overNumber.kind).toBe('number');
    expect(overNumber.listStyleType).toBe('upper-roman-paren');
    expect(overNumber.bulletChar).toBeNull();
    expect(effectiveListLevel({}, false, style, 3).startAt).toBe(3);
  });

  it('a sparse level still names its marker, as the manager preview shows it', () => {
    const sparse: ListStyle = { name: 'S', levels: [{ kind: 'bullet' }, { kind: 'number' }] };
    expect(effectiveListLevel({}, false, sparse, 1).bulletChar).toBe('•');
    expect(effectiveListLevel({}, true, sparse, 2).listStyleType).toBe('decimal');
  });

  it('a node marker attr keeps its own species over the level', () => {
    expect(effectiveListLevel({ bulletChar: '❖' }, false, style, 1)).toMatchObject({ kind: 'bullet', bulletChar: '❖' });
    expect(effectiveListLevel({ listStyleType: 'decimal' }, true, style, 2)).toMatchObject({ kind: 'number', listStyleType: 'decimal' });
  });

  it('falls back to the cycle default past the defined levels and without a style', () => {
    expect(effectiveListLevel({}, true, style, 5).listStyleType).toBeNull();
    expect(effectiveListLevel({}, true, null, 1).listStyleType).toBeNull();
  });

  it('a multilevel style renders the chain on every ordered level', () => {
    const ml: ListStyle = { name: 'ML', multilevel: true, levels: [{ kind: 'number', numType: 'decimal' }] };
    expect(effectiveListLevel({}, true, ml, 1).listStyleType).toBe('multilevel');
    expect(effectiveListLevel({}, true, ml, 3).listStyleType).toBe('multilevel');
  });

  it('carries the level start value for the matching kind', () => {
    expect(effectiveListLevel({}, true, style, 3).startAt).toBe(3);
    expect(effectiveListLevel({}, false, style, 2).startAt).toBeNull();
  });
});

describe('listStyleOverridden', () => {
  const li = (...c: unknown[]) => ({ type: 'listItem', content: [{ type: 'paragraph' }, ...c] });
  it('a clean subtree is not overridden; `start` is content, not formatting', () => {
    expect(listStyleOverridden({ type: 'orderedList', attrs: { listStyleName: 'Test', start: 4 }, content: [li()] })).toBe(false);
  });
  it('any marker/indent attr anywhere in the subtree overrides', () => {
    expect(listStyleOverridden({ type: 'orderedList', attrs: { listStyleType: 'decimal' }, content: [li()] })).toBe(true);
    expect(listStyleOverridden({
      type: 'orderedList', content: [li({ type: 'bulletList', attrs: { bulletChar: '❖' }, content: [li()] })],
    })).toBe(true);
    expect(listStyleOverridden({ type: 'bulletList', attrs: { indent: 1.5 }, content: [li()] })).toBe(true);
  });
});

describe('the built-ins (the preset gallery)', () => {
  const builtins = builtinListStyles();
  it('ship six presets, ten levels each, none uniform across its levels', () => {
    expect(Object.keys(builtins).sort()).toEqual(
      ['Checklist', 'Diamond Bullets', 'Numbering 1.a.i', 'Numbering with Bullets', 'Outline A.I.1', 'Outline I.A.1']);
    for (const s of Object.values(builtins)) {
      expect(s.levels).toHaveLength(MAX_LIST_LEVELS);
      const markers = new Set(s.levels.map((l) => `${l.kind}:${l.bulletChar ?? l.numType}`));
      expect(markers.size, `${s.name} must differ across levels`).toBeGreaterThan(1);
    }
  });
  it('keep the plain 1.27cm step per level', () => {
    expect(listStyleMarginCm(builtins['Outline I.A.1'], 1)).toBeCloseTo(1.27, 3);
    expect(listStyleMarginCm(builtins['Diamond Bullets'], 3)).toBeCloseTo(3.81, 3);
  });
  it('Outline I.A.1 runs I. A. 1. a) i) with the wide roman labels right-set', () => {
    expect(builtins['Outline I.A.1'].levels.slice(0, 5).map((l) => l.numType)).toEqual(
      ['upper-roman', 'upper-alpha', 'decimal', 'lower-alpha-paren', 'lower-roman-paren']);
    expect(builtins['Outline I.A.1'].levels[0].markerAlign).toBe('right');
  });
  it('Numbering 1.a.i captures the default cycle, so a style switch can lead back', () => {
    expect(builtins['Numbering 1.a.i'].levels.slice(0, 4).map((l) => l.numType)).toEqual(
      ['decimal', 'lower-alpha', 'lower-roman', 'decimal']);
  });
  it('Numbering with Bullets numbers level 1 and dashes the levels below', () => {
    expect(builtins['Numbering with Bullets'].levels[0]).toMatchObject({ kind: 'number', numType: 'decimal' });
    expect(builtins['Numbering with Bullets'].levels[1]).toMatchObject({ kind: 'bullet', bulletChar: '–' });
    expect(builtins['Checklist'].levels[0]).toMatchObject({ kind: 'bullet', bulletChar: '✓' });
  });
});

// Tab into a new level reuses the style a sibling list on that level already carries.
describe('list-style memory', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());
  const li = (...blocks: unknown[]) => ({ type: 'listItem', content: blocks });
  const p = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  const posOf = (doc: PmNode, text: string) => {
    let pos = 0;
    doc.descendants((node, at) => { if (node.isText && node.text === text) pos = at + 1; });
    return pos;
  };
  // The listStyleType of the nearest ordered-list ancestor of the given text.
  const styleAround = (doc: PmNode, text: string): string | null => {
    const $p = doc.resolve(posOf(doc, text));
    for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === 'orderedList') return ($p.node(d).attrs.listStyleType as string | null) ?? null;
    return null;
  };
  // A 3-item level-1 list whose first item holds a sublist, then 'c' indented a level.
  const indentC = (style: string | null) => {
    const sub = { type: 'orderedList', ...(style ? { attrs: { listStyleType: style } } : {}), content: [li(p('sub'))] };
    editor = new Editor({ extensions: [Document, Paragraph, Text, ListItem, OrderedList, BulletList, Indent],
      content: { type: 'doc', content: [{ type: 'orderedList', content: [li(p('a'), sub), li(p('b')), li(p('c'))] }] } });
    editor.commands.setTextSelection(posOf(editor.state.doc, 'c'));
    editor.commands.indentListForward();
    return editor.state.doc;
  };
  it('stamps a newly nested list with a sibling level-2 explicit style', () => {
    const doc = indentC('lower-alpha-paren');
    expect(styleAround(doc, 'c')).toBe('lower-alpha-paren');
    expect(styleAround(doc, 'sub')).toBe('lower-alpha-paren');
  });
  it('leaves the new list attr-less when no sibling level carries an explicit style', () => {
    expect(styleAround(indentC(null), 'c')).toBeNull();
  });
});

describe('a table inserted in a list', () => {
  const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const li = (...content: object[]) => ({ type: 'listItem', content });
  const ol = (...items: object[]) => ({ type: 'orderedList', content: items });
  let editor: Editor | null = null;
  afterEach(() => { editor?.destroy(); editor = null; });
  const open = (content: object[]) => {
    editor = new Editor({ element: document.createElement('div'), extensions: fullExtensions, content: { type: 'doc', content } });
    return editor;
  };
  const caretIn = (ed: Editor, text: string) => {
    let at = -1;
    ed.state.doc.descendants((n, pos) => { if (n.isText && n.text === text) at = pos + text.length; });
    ed.commands.setTextSelection(at);
  };
  const numberOf = (ed: Editor, text: string) => {
    let at = -1;
    ed.state.doc.descendants((n, pos) => { if (n.isText && n.text === text) at = pos; });
    return listNumberAt(ed.state.doc, at, builtinStyleSheet())?.parts.join('.');
  };

  it('goes between the list\'s two parts, and the second counts on as the first grows', () => {
    const ed = open([ol(li(p('one')), li(p('two')), li(p('three')))]);
    caretIn(ed, 'two');
    expect(ed.commands.insertTable({ rows: 1, cols: 1, withHeaderRow: false })).toBe(true);
    expect(ed.state.doc.content.content.map((n) => n.type.name).slice(0, 3)).toEqual(['orderedList', 'table', 'orderedList']);
    expect(numberOf(ed, 'three')).toBe('3');
    caretIn(ed, 'one');
    ed.commands.splitListItem('listItem');
    ed.commands.insertContent('one and a half');
    expect(numberOf(ed, 'three')).toBe('4');
    ed.commands.undo();
    expect(numberOf(ed, 'three')).toBe('3');
  });

  it('cut below the first level, counts both levels on through an item without a label', () => {
    const ed = open([ol(li(p('A'), ol(li(p('a1')), li(p('a2')))), li(p('B')))]);
    caretIn(ed, 'a1');
    expect(ed.commands.insertTable({ rows: 1, cols: 1, withHeaderRow: false })).toBe(true);
    expect(ed.state.doc.child(1).type.name).toBe('table');
    expect(numberOf(ed, 'a2')).toBe('1.b');
    expect(numberOf(ed, 'B')).toBe('2');
    expect(() => ed.state.doc.check()).not.toThrow();
  });
});

// Nine levels, the deepest a .docx numbers: indenting further does nothing, as at any limit.
describe('indenting a list item', () => {
  const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  // `n` levels down to `last`, with `extra` items of their own below it.
  const chain = (n: number, extra = 0): object => ({ type: 'bulletList', content: n > 1
    ? [{ type: 'listItem', content: [p(`L${n}`), chain(n - 1, extra)] }]
    : [{ type: 'listItem', content: [p('first')] }, { type: 'listItem', content: [p('last'), ...(extra ? [chain(extra)] : [])] }] });
  const sinks = (n: number, extra = 0) => {
    const editor = new Editor({ element: document.createElement('div'), extensions: fullExtensions, content: { type: 'doc', content: [chain(n, extra)] } });
    let at = -1;
    editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'last') at = pos + 1; });
    editor.commands.setTextSelection(at);
    const can = editor.can().sinkListItem('listItem');
    const did = editor.commands.indentListForward();
    editor.destroy();
    expect(did).toBe(can);
    return did;
  };
  it.each([[8, 0, true], [9, 0, false], [7, 1, true], [8, 1, false]])('%i levels, %i below the item: %s', (n, extra, ok) => {
    expect(sinks(n, extra)).toBe(ok);
  });
  // Nesting indents a list, so an item's paragraph loses a left indent; its right indent
  // is its own, in both formats.
  it('keeps an item paragraph its right indent, not its left one', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: fullExtensions, content: { type: 'doc', content: [chain(1)] } });
    editor.commands.command(({ tr }) => {
      editor.state.doc.descendants((node, pos) => { if (node.type.name === 'paragraph') tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: 1, indentRight: -0.33 }); });
      return true;
    });
    const attrs: Record<string, unknown>[] = [];
    editor.state.doc.descendants((node) => { if (node.type.name === 'paragraph') attrs.push(node.attrs); });
    editor.destroy();
    expect(attrs.map((a) => [a.indent, a.indentRight])).toEqual([[null, -0.33], [null, -0.33]]);
  });
});
