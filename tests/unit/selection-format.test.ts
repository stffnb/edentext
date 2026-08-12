// What a toolbar shows for the selection. Drives a real body editor, so the
// readers see the same state the ribbon does.
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { extensions } from '../../src/lib/editor/extensions';
import {
  DEFAULT_EDITOR_FONT, uniformFont, uniformFontSize, uniformMarkColor, uniformBlockAttr,
} from '../../src/lib/utils/selectionFormat';

type N = any;

function makeEditor(content: N) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({ element: el, extensions, content });
}

const run = (text: string, attrs?: N): N => ({
  type: 'text', text, ...(attrs ? { marks: [{ type: 'textStyle', attrs }] } : {}),
});

const doc = (...paras: N[]): N => ({ type: 'doc', content: paras });
const para = (attrs: N, ...content: N[]): N => ({ type: 'paragraph', attrs, content });

describe('uniformFont', () => {
  it('falls back to the editor default where no run sets one', () => {
    const editor = makeEditor(doc(para({}, run('plain'))));
    editor.commands.selectAll();
    expect(uniformFont(editor.state)).toBe(DEFAULT_EDITOR_FONT);
    editor.destroy();
  });

  it('reports one font across a selection and blanks a mixed one', () => {
    const editor = makeEditor(doc(para({}, run('aa', { fontFamily: 'Arial' }), run('bb', { fontFamily: 'Arial' }))));
    editor.commands.selectAll();
    expect(uniformFont(editor.state)).toBe('Arial');

    const mixed = makeEditor(doc(para({}, run('aa', { fontFamily: 'Arial' }), run('bb', { fontFamily: 'Georgia' }))));
    mixed.commands.selectAll();
    expect(uniformFont(mixed.state)).toBe('');
    editor.destroy();
    mixed.destroy();
  });
});

describe('uniformFontSize', () => {
  it('prefers a run size over the block size', () => {
    const editor = makeEditor(doc(para({ fontSize: '20pt' }, run('big', { fontSize: '9pt' }))));
    editor.commands.selectAll();
    expect(uniformFontSize(editor.state)).toBe('9pt');
    editor.destroy();
  });

  it('reads the block size for a run that carries none', () => {
    const editor = makeEditor(doc(para({ fontSize: '20pt' }, run('plain'))));
    editor.commands.selectAll();
    expect(uniformFontSize(editor.state)).toBe('20pt');
    editor.destroy();
  });
});

describe('uniformMarkColor', () => {
  it('is null without a colour, the colour with one, blank when mixed', () => {
    const none = makeEditor(doc(para({}, run('plain'))));
    none.commands.selectAll();
    expect(uniformMarkColor(none.state, 'textStyle')).toBeNull();

    const one = makeEditor(doc(para({}, run('red', { color: '#ff0000' }))));
    one.commands.selectAll();
    expect(uniformMarkColor(one.state, 'textStyle')).toBe('#ff0000');

    const two = makeEditor(doc(para({}, run('r', { color: '#ff0000' }), run('b', { color: '#0000ff' }))));
    two.commands.selectAll();
    expect(uniformMarkColor(two.state, 'textStyle')).toBe('');
    none.destroy(); one.destroy(); two.destroy();
  });
});

describe('uniformBlockAttr', () => {
  it('agrees across blocks and blanks when they differ', () => {
    const same = makeEditor(doc(para({ lineHeight: '1.5' }, run('a')), para({ lineHeight: '1.5' }, run('b'))));
    same.commands.selectAll();
    expect(uniformBlockAttr(same.state, 'lineHeight', '1')).toBe('1.5');

    const differ = makeEditor(doc(para({ lineHeight: '1.5' }, run('a')), para({ lineHeight: '2' }, run('b'))));
    differ.commands.selectAll();
    expect(uniformBlockAttr(differ.state, 'lineHeight', '1')).toBe('');
    same.destroy(); differ.destroy();
  });

  it('reports the fallback for a block that never sets the attribute', () => {
    const editor = makeEditor(doc(para({}, run('a'))));
    editor.commands.selectAll();
    expect(uniformBlockAttr(editor.state, 'lineHeight', '1')).toBe('1');
    editor.destroy();
  });
});
