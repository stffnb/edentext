// The western/asian language pair: a run and a paragraph carry both, the picker's tag
// goes to the slot of its script, and the document keeps a main language plus the
// other slot's.
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { TextStyle } from '@tiptap/extension-text-style';
import { TextSelection } from '@tiptap/pm/state';
import { Language } from '../../src/lib/editor/extensions/language';
import { uniformLanguage } from '../../src/lib/utils/selectionFormat';
import { documentLangs, pickDocumentLanguage, spellAltCode, westernCode } from '../../src/lib/storage/documentLanguage';

type N = any;

// Destroyed after each test, or the DOM observer fires after jsdom is gone.
const editors: Editor[] = [];
afterEach(() => { while (editors.length) editors.pop()!.destroy(); });

function makeEditor(content: N) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const editor = new Editor({ element: el, extensions: [Document, Paragraph, Text, TextStyle, Language], content });
  editors.push(editor);
  return editor;
}
const select = (ed: Editor, from: number, to = from) =>
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, to)));
const runAttrs = (ed: Editor, i = 0) => ed.getJSON().content![0].content![i].marks?.[0]?.attrs;

describe('language pair in the editor', () => {
  it('sets the slot of the tag\'s script', () => {
    const ed = makeEditor('<p>Word 中文</p>');
    select(ed, 1, 8);
    ed.commands.setRunLanguage('zh-TW');
    ed.commands.setRunLanguage('en-GB');
    expect(runAttrs(ed)).toMatchObject({ lang: 'en-GB', langAsian: 'zh-TW' });
    ed.commands.setRunLanguage(null);
    expect(runAttrs(ed)).toBeUndefined();
  });

  it('clears the overrides and leaves text without any untouched', () => {
    const ed = makeEditor('<p lang="de-DE">eins</p><p>zwei <span lang="fr-FR">trois</span></p><p>vier</p>');
    const clear = () => ed.chain().selectAll().setBlockLanguage(null).setRunLanguage(null).run();
    clear();
    expect(ed.getHTML()).toBe('<p>eins</p><p>zwei trois</p><p>vier</p>');
    const doc = ed.state.doc;
    clear();
    expect(ed.state.doc).toBe(doc);
  });

  it('renders the western tag as lang, the asian one only alone', () => {
    const ed = makeEditor({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'a', marks: [{ type: 'textStyle', attrs: { lang: 'en-GB', langAsian: 'ja-JP' } }] },
      { type: 'text', text: '漢', marks: [{ type: 'textStyle', attrs: { langAsian: 'ja-JP' } }] },
    ] }] });
    const spans = ed.view.dom.querySelectorAll('span');
    expect(spans[0].getAttribute('lang')).toBe('en-GB');
    expect(spans[1].getAttribute('lang')).toBe('ja-JP');
  });

  it('parses both back, and a pasted asian lang into its own slot', () => {
    const ed = makeEditor({ type: 'doc', content: [{ type: 'paragraph', attrs: { lang: 'en-GB', langAsian: 'ja-JP' }, content: [{ type: 'text', text: 'a' }] }] });
    expect(makeEditor(ed.getHTML()).getJSON().content![0].attrs).toMatchObject({ lang: 'en-GB', langAsian: 'ja-JP' });
    expect(makeEditor('<p lang="zh-CN">中文</p>').getJSON().content![0].attrs).toMatchObject({ lang: null, langAsian: 'zh-CN' });
  });

  it('shows the asian language on East Asian text, the western one elsewhere', () => {
    const ed = makeEditor('<p>Word 中文</p>');
    const doc = { west: 'en-US', asian: 'zh-CN' };
    select(ed, 1, 5);
    expect(uniformLanguage(ed.state, doc)).toBe('en-US');
    select(ed, 6, 8);
    expect(uniformLanguage(ed.state, doc)).toBe('zh-CN');
    select(ed, 1, 8);
    expect(uniformLanguage(ed.state, doc)).toBe('');
    select(ed, 8);
    expect(uniformLanguage(ed.state, doc)).toBe('zh-CN');
  });
});

describe('the document pair', () => {
  it('moves a main language of the other script to the other slot', () => {
    expect(pickDocumentLanguage('de', null, 'zh-CN')).toEqual({ main: 'zh-CN', other: 'de-DE' });
    expect(pickDocumentLanguage('zh-CN', 'de-DE', 'zh-TW')).toEqual({ main: 'zh-TW', other: 'de-DE' });
    expect(pickDocumentLanguage('zh-CN', 'de-DE', 'en')).toEqual({ main: 'en', other: 'zh-CN' });
    expect(pickDocumentLanguage('zh-CN', 'en-US', 'none')).toEqual({ main: 'none', other: null });
  });

  it('checks an East Asian document in its western language', () => {
    expect(westernCode('zh-CN', 'en-GB')).toBe('en-GB');
    expect(westernCode('zh-CN', null)).toBe('zh-CN');
    expect(westernCode('de', 'zh-CN')).toBe('de');
    expect(documentLangs('zh-CN', 'en-US')).toEqual({ west: 'en-US', asian: 'zh-CN' });
  });

  it('checks the Latin words of an Arabic document in a western language, the file left alone', () => {
    expect(spellAltCode('ar', 'de-DE', 'ar')).toBe('de');
    expect(spellAltCode('ar', null, 'fr')).toBe('fr');
    expect(spellAltCode('ar', null, 'ar')).toBe('en');
    expect(spellAltCode('ar', 'zh-CN', 'zh-Hans')).toBe('en');
    expect(spellAltCode('de', 'ar-SA', 'de')).toBe('ar');
    expect(spellAltCode('de', null, 'de')).toBeNull();
  });
});
