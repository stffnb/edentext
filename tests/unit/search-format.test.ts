// Find & Replace by formatting and by paragraph style: a format narrows a text search,
// and with no term it is the search. A replacement with no text only reformats — which
// is how both dialogs restyle a document without retyping it.
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Heading from '@tiptap/extension-heading';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import { TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style';
import { FontColor } from '../../src/lib/editor/extensions/fontColor';
import { SearchReplace, getSearchState } from '../../src/lib/editor/extensions/searchReplace';
import { ParagraphStyle } from '../../src/lib/editor/extensions/paragraphStyle';
import { builtinStyleSheet } from '../../src/lib/styles/styleSheet';

type N = any;

const sheet = () => builtinStyleSheet();
const B = (text: string): N => ({ type: 'text', text, marks: [{ type: 'bold' }] });
const P = (styleName: string | null, ...content: N[]): N =>
  ({ type: 'paragraph', attrs: { styleName }, content });

function makeEditor(content: N) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [
      Document, Paragraph, Text, Heading, Bold, Italic, Underline,
      TextStyle, FontFamily, FontSize, FontColor,
      ParagraphStyle.configure({ sheet }), SearchReplace.configure({ sheet }),
    ],
    content,
  });
}

const doc: N = {
  type: 'doc',
  content: [
    P(null, { type: 'text', text: 'one ' }, B('two'), { type: 'text', text: ' three' }),
    P('Quotations', { type: 'text', text: 'two more' }),
    P('Quotations', B('two')),
  ],
};

const texts = (e: Editor): string[] => e.state.doc.children.map((n: N) => n.textContent);
const styles = (e: Editor): (string | null)[] =>
  e.state.doc.children.map((n: N) => n.attrs.styleName ?? null);

describe('search by formatting', () => {
  it('narrows a text search to the runs carrying the format', () => {
    const e = makeEditor(doc);
    e.commands.setSearch({ term: 'two', matchCase: false, wholeWord: false, useRegex: false });
    expect(getSearchState(e.state).count).toBe(3);
    e.commands.setSearch({ term: 'two', matchCase: false, wholeWord: false, useRegex: false, format: { bold: true } });
    expect(getSearchState(e.state).count).toBe(2);
    e.destroy();
  });

  it('makes the format the search where there is no term', () => {
    const e = makeEditor(doc);
    e.commands.setSearch({ term: '', matchCase: false, wholeWord: false, useRegex: false, format: { bold: true } });
    expect(getSearchState(e.state).count).toBe(2);
    // Nothing asked for is still no search at all.
    e.commands.setSearch({ term: '', matchCase: false, wholeWord: false, useRegex: false, format: {} });
    expect(getSearchState(e.state).count).toBe(0);
    e.destroy();
  });

  it('finds every paragraph in a style, the empty one included', () => {
    const e = makeEditor({ ...doc, content: [...doc.content, P('Quotations')] });
    e.commands.setSearch({ term: '', matchCase: false, wholeWord: false, useRegex: false, format: { style: 'Quotations' } });
    expect(getSearchState(e.state).count).toBe(3);
    e.destroy();
  });
});

describe('search by font, size and colour', () => {
  const styled = (text: string, attrs: N): N =>
    ({ type: 'text', text, marks: [{ type: 'textStyle', attrs }] });
  const mixed: N = {
    type: 'doc',
    content: [P(null,
      styled('one', { fontSize: '18pt' }),
      { type: 'text', text: ' two ' },
      styled('three', { color: '#FF0000', fontFamily: 'Arial' }),
    )],
  };

  it('finds the runs a size, a font or a colour names', () => {
    const e = makeEditor(mixed);
    const find = (format: N) =>
      (e.commands.setSearch({ term: '', matchCase: false, wholeWord: false, useRegex: false, format }),
        getSearchState(e.state).count);
    expect(find({ sizePt: 18 })).toBe(1);
    expect(find({ sizePt: 12 })).toBe(0);
    expect(find({ color: '#ff0000' })).toBe(1);
    expect(find({ font: 'arial' })).toBe(1);
    expect(find({ font: 'Arial', color: '#0000FF' })).toBe(0);
    e.destroy();
  });

  it('applies a colour and leaves the run\'s font alone', () => {
    const e = makeEditor(mixed);
    e.commands.setSearch({ term: 'three', matchCase: false, wholeWord: false, useRegex: false });
    e.commands.replaceAll('', { color: '#0000FF' });
    const attrs = e.state.doc.firstChild!.lastChild!.marks.find((m: N) => m.type.name === 'textStyle')?.attrs;
    expect(attrs.color).toBe('#0000FF');
    expect(attrs.fontFamily).toBe('Arial');
    e.destroy();
  });
});

describe('replace by formatting', () => {
  it('keeps the text and only applies the format when the replacement is empty', () => {
    const e = makeEditor(doc);
    e.commands.setSearch({ term: 'two', matchCase: false, wholeWord: false, useRegex: false });
    e.commands.replaceAll('', { italic: true });
    expect(texts(e)).toEqual(['one two three', 'two more', 'two']);
    const marks = e.state.doc.firstChild!.child(1).marks.map((m: N) => m.type.name).sort();
    expect(marks).toEqual(['bold', 'italic']);
    e.destroy();
  });

  it('restyles the paragraphs a style search found', () => {
    const e = makeEditor(doc);
    e.commands.setSearch({ term: '', matchCase: false, wholeWord: false, useRegex: false, format: { style: 'Quotations' } });
    e.commands.replaceAll('', { style: 'Standard' });
    expect(styles(e)).toEqual([null, 'Standard', 'Standard']);
    expect(texts(e)).toEqual(['one two three', 'two more', 'two']);
    e.destroy();
  });

  it('switches the node type where the new style is a heading', () => {
    const e = makeEditor(doc);
    e.commands.setSearch({ term: '', matchCase: false, wholeWord: false, useRegex: false, format: { style: 'Quotations' } });
    e.commands.replaceAll('', { style: 'Heading 2' });
    const kinds = e.state.doc.children.map((n: N) => `${n.type.name}${n.attrs.level ?? ''}`);
    expect(kinds).toEqual(['paragraph', 'heading2', 'heading2']);
    e.destroy();
  });

  it('still replaces the text where one is given', () => {
    const e = makeEditor(doc);
    e.commands.setSearch({ term: 'two', matchCase: false, wholeWord: false, useRegex: false, format: { bold: true } });
    e.commands.replaceAll('TWO', { underline: true });
    expect(texts(e)).toEqual(['one TWO three', 'two more', 'TWO']);
    const marks = e.state.doc.firstChild!.child(1).marks.map((m: N) => m.type.name).sort();
    expect(marks).toEqual(['bold', 'underline']);
    e.destroy();
  });
});
