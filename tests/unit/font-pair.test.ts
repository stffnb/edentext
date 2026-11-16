// The western/asian font pair: a run, a paragraph and a style each carry both fonts,
// rendered as two variables that inherit on their own, so a run naming one keeps the
// other from its paragraph.
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { TextStyle } from '@tiptap/extension-text-style';
import { FontFamily } from '../../src/lib/editor/extensions/fontFamily';
import { BlockFontSize } from '../../src/lib/editor/extensions/blockFontSize';
import { textDeclarations } from '../../src/lib/styles/styleSheet';
import { uniformFont } from '../../src/lib/utils/selectionFormat';
import { isAsianFont } from '../../src/lib/components/ribbon/fontList.svelte';
import { TextSelection } from '@tiptap/pm/state';

type N = any;

// Destroyed after each test, or the DOM observer fires after jsdom is gone.
const editors: Editor[] = [];
afterEach(() => { while (editors.length) editors.pop()!.destroy(); });

function makeEditor(content: N) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const editor = new Editor({ element: el, extensions: [Document, Paragraph, Text, TextStyle, FontFamily, BlockFontSize], content });
  editors.push(editor);
  return editor;
}

const run = (text: string, attrs: Record<string, string>): N =>
  ({ type: 'text', text, marks: [{ type: 'textStyle', attrs }] });
const doc = (...content: N[]): N => ({ type: 'doc', content: [{ type: 'paragraph', content }] });

describe('font pair rendering', () => {
  it('sets only the variable a run names', () => {
    const ed = makeEditor(doc(run('漢字', { fontFamilyAsian: 'Yu Mincho' })));
    const style = ed.view.dom.querySelector('span')!.getAttribute('style')!;
    expect(style).toContain('--font-asian: "Yu Mincho"');
    expect(style).not.toContain('--font-west:');
    expect(style).toContain('font-family: var(--font-space,) var(--font-west), "Yu Mincho", var(--font-tail)');
  });

  it('gives a run in a face off the default its own natural line', () => {
    const ed = makeEditor(doc(run('tall', { fontFamily: 'Verdana' }), run('plain', { fontFamily: 'Times New Roman' })));
    const [tall, plain] = [...ed.view.dom.querySelectorAll('span')].map((s) => s.getAttribute('style')!);
    expect(tall).toContain('--natural-line: 1.2153');
    expect(plain).not.toContain('--natural-line');
  });

  it('parses its own spans back into both attrs', () => {
    const ed = makeEditor(doc(run('mixed 漢字', { fontFamily: 'Arial', fontFamilyAsian: 'SimSun' })));
    const html = ed.getHTML();
    const back = makeEditor(html).getJSON().content![0].content![0].marks[0].attrs;
    expect(back).toMatchObject({ fontFamily: 'Arial', fontFamilyAsian: 'SimSun' });
  });

  it('reads a foreign font-family as the western font', () => {
    const ed = makeEditor('<p><span style="font-family: Georgia, serif">x</span></p>');
    expect(ed.getJSON().content![0].content![0].marks[0].attrs).toMatchObject({ fontFamily: 'Georgia', fontFamilyAsian: null });
  });

  it('carries the paragraph mark pair', () => {
    const ed = makeEditor({ type: 'doc', content: [{ type: 'paragraph', attrs: { fontFamilyAsian: 'SimHei' }, content: [{ type: 'text', text: 'x' }] }] });
    const p = ed.view.dom.querySelector('p')!;
    expect(p.getAttribute('data-block-font-family-asian')).toBe('SimHei');
    expect(makeEditor(ed.getHTML()).getJSON().content![0].attrs!.fontFamilyAsian).toBe('SimHei');
  });

  it('names a run\'s own fonts first in its font-family, for HTML copied out', () => {
    const ed = makeEditor(doc(run('mixed 漢字', { fontFamily: 'Georgia', fontFamilyAsian: 'SimSun' })));
    expect(ed.view.dom.querySelector('span')!.getAttribute('style')).toContain('font-family: var(--font-space,) "Georgia", "SimSun", var(--font-serif)');
  });

  it('gives a style both variables and a sans tail for the heading font', () => {
    const decls = textDeclarations({ fontFamily: 'Arial', fontFamilyAsian: 'SimHei' });
    expect(decls).toContain("--font-west: 'Arial', 'Liberation Sans'");
    expect(decls).toContain('--font-tail: var(--font-heading)');
    expect(decls).toContain('--font-asian: "SimHei"');
  });

  it('gives a fixed-pitch family a fixed-pitch tail', () => {
    for (const f of ['Liberation Mono', 'DejaVu Sans Mono', 'Courier New', 'Consolas', 'Lucida Console']) {
      expect(textDeclarations({ fontFamily: f }), f).toContain('--font-tail: var(--font-mono)');
    }
    expect(textDeclarations({ fontFamily: 'Liberation Mono' })).toContain("--font-west: 'Liberation Mono', 'Courier New'");
    expect(textDeclarations({ fontFamily: 'Monotype Corsiva' })).toContain('--font-tail: var(--font-serif)');
  });

  it('strokes bold in a face without one and sets a Chinese face\'s quotes full width', () => {
    const song = textDeclarations({ fontFamily: 'FangSong', fontFamilyAsian: '宋体', bold: true });
    expect(song).toContain('--bold-stroke: 0.025em');
    expect(song).toContain('font-weight: var(--bold-weight, 700)');
    expect(song).toContain(`--font-west: "FangSong", 'EdenText Quotes'`);
    const yahei = textDeclarations({ fontFamily: 'Arial', fontFamilyAsian: 'Microsoft YaHei' });
    expect(yahei).toContain('--bold-stroke: 0');
    expect(yahei).toContain("--font-west: 'Arial', 'Liberation Sans'");
  });
});

describe('font box', () => {
  it('knows the asian faces by name, script or region tag', () => {
    for (const f of ['SimSun', 'Yu Mincho', 'Malgun Gothic', '游明朝', 'Noto Sans CJK SC', 'Source Han Serif JP']) expect(isAsianFont(f), f).toBe(true);
    for (const f of ['Arial', 'Liberation Serif', 'Century Gothic', 'Franklin Gothic Medium']) expect(isAsianFont(f), f).toBe(false);
  });

  const select = (ed: Editor, from: number, to = from) =>
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, to)));

  it('shows the asian half for CJK text, the western one otherwise', () => {
    const ed = makeEditor(doc(run('Word', { fontFamily: 'Arial', fontFamilyAsian: 'SimHei' }), run('中文', { fontFamily: 'Arial', fontFamilyAsian: 'SimHei' })));
    select(ed, 1, 5);
    expect(uniformFont(ed.state)).toBe('Arial');
    select(ed, 5, 7);
    expect(uniformFont(ed.state)).toBe('SimHei');
    select(ed, 1, 7);
    expect(uniformFont(ed.state)).toBe('');
    select(ed, 7);
    expect(uniformFont(ed.state)).toBe('SimHei');
  });
});
