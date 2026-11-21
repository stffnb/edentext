// What the format painter promises: the target looks like the source, keeps what is
// content rather than format, and one stroke is one undo step and one recorded change.
import { afterEach, describe, it, expect } from 'vitest';
import type { Editor } from '@tiptap/core';
import { open, select } from '../trackChangesCases';
import { paintSelection } from '../../src/lib/editor/extensions/formatPainter';
import { painting, startPainting, stopPainting } from '../../src/lib/editor/formatPainter.svelte';
import { setRecordChanges } from '../../src/lib/storage/trackChanges.svelte';
import { UNFORMATTED_ATTRS, UNFORMATTED_MARKS, revisions } from '../../src/lib/editor/extensions/trackChanges';

const TARGET = '<p><u><span style="color: #ff0000">target</span></u> text</p><p>tail</p>';
// Source paragraphs, each painted onto TARGET, which follows it in the document.
const SOURCES: [string, string][] = [
  ['bold italic', '<p><strong><em>source</em></strong></p>'],
  ['font, size and colour', '<p><span style="font-family: Arial; font-size: 18pt; color: #0000ff">source</span></p>'],
  ['highlight and superscript', '<p><mark data-color="#ffff00" style="background-color: #ffff00"><sup>source</sup></mark></p>'],
  ['plain text', '<p>source</p>'],
  ['a centred paragraph with spacing', '<p style="text-align: center; line-height: 1.5"><s>source</s></p>'],
  ['a heading', '<h2><em>source</em></h2>'],
];

const editors: Editor[] = [];
const doc = (html: string) => { const e = open(html); editors.push(e); return e; };
afterEach(() => { stopPainting(); setRecordChanges(false); editors.splice(0).forEach((e) => e.destroy()); });

const find = (e: Editor, text: string) => {
  let at = -1;
  e.state.doc.descendants((node, pos) => { if (at < 0 && node.isText && node.text!.includes(text)) at = pos + node.text!.indexOf(text); });
  return at;
};
const formatMarks = (e: Editor, pos: number) =>
  e.state.doc.resolve(pos + 1).marks().filter((m) => !UNFORMATTED_MARKS.has(m.type.name)).map((m) => m.toJSON());
const allMarks = (e: Editor, pos: number) => e.state.doc.resolve(pos + 1).marks().map((m) => m.type.name);
const block = (e: Editor, pos: number) => {
  const { type, attrs } = e.state.doc.resolve(pos).parent;
  return { type: type.name, attrs: Object.fromEntries(Object.entries(attrs).filter(([k, v]) => !UNFORMATTED_ATTRS.has(k) && v != null)) };
};
// Picks at the caret in `from` and paints at `to`: that text, a bare caret in it, or its whole paragraph.
function paint(e: Editor, from: string, to: string, how: 'text' | 'click' | 'whole' = 'text') {
  select(e, find(e, from) + 1);
  startPainting(e.state);
  const at = find(e, to), $at = e.state.doc.resolve(at);
  if (how === 'whole') select(e, $at.start(), $at.end());
  else select(e, how === 'click' ? at + 1 : at, how === 'click' ? at + 1 : at + to.length);
  paintSelection(e.view);
}

describe('format painter', () => {
  it.each(SOURCES)('%s replaces the character format of a part selection only', (_name, source) => {
    const e = doc(source + TARGET);
    const before = block(e, find(e, 'target'));
    paint(e, 'source', 'targ');
    expect(formatMarks(e, find(e, 'targ'))).toEqual(formatMarks(e, find(e, 'source')));
    expect(allMarks(e, find(e, 'et'))).toContain('underline');
    expect(block(e, find(e, 'targ'))).toEqual(before);
    expect(painting()).toBe(false);
  });

  it.each(SOURCES)('%s also formats a paragraph selected whole, or clicked', (_name, source) => {
    for (const how of ['whole', 'click'] as const) {
      const e = doc(source + TARGET);
      paint(e, 'source', 'target', how);
      const want = block(e, find(e, 'source'));
      expect(block(e, find(e, 'target'))).toEqual(want);
      expect(formatMarks(e, find(e, 'target'))).toEqual(formatMarks(e, find(e, 'source')));
      expect(block(e, find(e, 'tail')).type).toBe('paragraph');
      // A click reaches the word under it and no further.
      if (how === 'click') expect(formatMarks(e, find(e, 'text'))).toEqual([]);
    }
  });

  it('paints the paragraphs a selection only reaches into where asked to, or nothing else', () => {
    for (const chars of [true, false]) {
      const e = doc(SOURCES[4][1] + TARGET);
      select(e, find(e, 'source') + 1);
      startPainting(e.state);
      select(e, find(e, 'targ'), find(e, 'targ') + 4);
      paintSelection(e.view, { chars, touched: true });
      expect(block(e, find(e, 'targ'))).toEqual(block(e, find(e, 'source')));
      expect(allMarks(e, find(e, 'targ')).includes('strike')).toBe(chars);
    }
  });

  it('leaves links and comments where they are and brings none along', () => {
    const e = doc('<p><a href="https://example.org/"><strong>source</strong></a></p><p><a href="https://example.com/">target</a> text</p>');
    const at = find(e, 'target');
    e.view.dispatch(e.state.tr.addMark(at, at + 6, e.schema.marks.comment.create({ id: 'c1', author: 'A', text: 'note' })));
    paint(e, 'source', 'target');
    const marks = e.state.doc.resolve(find(e, 'target') + 1).marks();
    expect(marks.map((m) => m.type.name).sort()).toEqual(['bold', 'comment', 'link']);
    expect(marks.find((m) => m.type.name === 'link')!.attrs.href).toBe('https://example.com/');
  });

  it('keeps a list as it is', () => {
    const e = doc('<ul><li><p><strong>source</strong></p></li></ul><p>target</p><ol><li><p>item</p></li></ol>');
    paint(e, 'source', 'target');
    paint(e, 'target', 'item');
    const parents = (text: string) => { const $p = e.state.doc.resolve(find(e, text)); return $p.node($p.depth - 2)?.type.name; };
    expect([parents('source'), e.state.doc.resolve(find(e, 'target')).depth, parents('item')]).toEqual(['bulletList', 1, 'orderedList']);
  });

  it('is one undo step', () => {
    const e = doc(SOURCES[5][1] + TARGET);
    const before = e.state.doc.toJSON();
    paint(e, 'source', 'target', 'whole');
    expect(e.state.doc.toJSON()).not.toEqual(before);
    e.commands.undo();
    expect(e.state.doc.toJSON()).toEqual(before);
  });

  it('is recorded as a format change', () => {
    const e = doc(SOURCES[4][1] + TARGET);
    setRecordChanges(true);
    paint(e, 'source', 'target', 'whole');
    expect(revisions(e.state.doc).length).toBeGreaterThan(0);
    expect(allMarks(e, find(e, 'target'))).toContain('formatChange');
    expect(e.state.doc.resolve(find(e, 'target')).parent.attrs.revFormat).toBeTruthy();
  });

  it('stays on until put down when kept, and another edit puts it down', () => {
    const e = doc(SOURCES[0][1] + TARGET);
    select(e, find(e, 'source') + 1);
    startPainting(e.state, true);
    for (const word of ['targ', 'tail']) {
      select(e, find(e, word), find(e, word) + 4);
      paintSelection(e.view);
      expect(allMarks(e, find(e, word))).toContain('bold');
      expect(painting()).toBe(true);
    }
    e.commands.insertContent('x');
    expect(painting()).toBe(false);
  });
});
