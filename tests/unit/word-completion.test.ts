// LibreOffice's Word Completion: the words typed once are offered back. The list rules
// and the suggestion are pure; the plugin leg checks that the offer is only made at the
// end of a word being typed, and that Enter takes it.
import { describe, it, expect, beforeEach } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { collectWord, suggestCompletion, wordBefore } from '../../src/lib/utils/wordCompletion';
import { WordCompletion, currentCompletion } from '../../src/lib/editor/extensions/wordCompletion';
import { setWordCompletion } from '../../src/lib/storage/wordCompletion.svelte';
import { DEFAULT_WORD_COMPLETION } from '../../src/lib/storage/wordCompletion';

describe('the collected list', () => {
  it('keeps only words at least as long as the minimum', () => {
    expect(collectWord([], 'short', 8, 100)).toEqual([]);
    expect(collectWord([], 'Bibliothek', 8, 100)).toEqual(['Bibliothek']);
    // A number or a stray mark is not a word to complete.
    expect(collectWord([], '12345678', 8, 100)).toEqual([]);
  });

  it('moves a word already in it back to the front', () => {
    expect(collectWord(['alpha', 'bravo'], 'bravo', 5, 100)).toEqual(['bravo', 'alpha']);
    // Already newest: the same array back, so nothing is written.
    const list = ['bravo', 'alpha'];
    expect(collectWord(list, 'bravo', 5, 100)).toBe(list);
  });

  it('drops the word used longest ago once it is full', () => {
    expect(collectWord(['alpha', 'bravo'], 'delta', 5, 2)).toEqual(['delta', 'alpha']);
  });
});

describe('the suggestion', () => {
  const list = ['Bibliotheksverwaltung', 'Bibliothek', 'Bahnhof'];

  it('completes case-insensitively, shortest match first', () => {
    expect(suggestCompletion(list, 'Bibl')).toBe('iothek');
    expect(suggestCompletion(list, 'bibl')).toBe('iothek');
    expect(suggestCompletion(list, 'Bibliotheksv')).toBe('erwaltung');
  });

  it('says nothing before three letters, or for a word already whole', () => {
    expect(suggestCompletion(list, 'Bi')).toBeNull();
    expect(suggestCompletion(list, 'Bibliothek')).toBe('sverwaltung');
    expect(suggestCompletion(list, 'Bahnhof')).toBeNull();
    expect(suggestCompletion(list, 'Zeppelin')).toBeNull();
  });

  it('reads the word at the caret out of the line before it', () => {
    expect(wordBefore('one two thr')).toBe('thr');
    expect(wordBefore('one two ')).toBe('');
    expect(wordBefore('l’Étoile')).toBe('l’Étoile');
  });
});

describe('the offer in the editor', () => {
  beforeEach(() => setWordCompletion({ ...DEFAULT_WORD_COMPLETION, words: ['Bibliothek'] }));

  function makeEditor(content = '<p></p>') {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return new Editor({ element: el, extensions: [Document, Paragraph, Text, WordCompletion], content });
  }

  it('offers the rest of the word while it is being typed', () => {
    const e = makeEditor();
    e.commands.insertContent('Bibl');
    expect(currentCompletion(e.state)).toBe('iothek');
    e.destroy();
  });

  it('offers nothing in the middle of a word', () => {
    const e = makeEditor('<p>Bibend</p>');
    e.commands.setTextSelection(4); // between "Bib" and "end"
    e.commands.insertContent('l');
    expect(e.state.doc.textContent).toBe('Biblend');
    expect(currentCompletion(e.state)).toBeNull();
    e.destroy();
  });

  it('offers nothing where the caret only moved', () => {
    const e = makeEditor('<p>Bibl</p>');
    e.commands.setTextSelection(5);
    expect(currentCompletion(e.state)).toBeNull();
    e.destroy();
  });

  it('takes the offer on Enter, and leaves the paragraph whole', () => {
    const e = makeEditor();
    e.commands.insertContent('Bibl');
    e.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(e.state.doc.textContent).toBe('Bibliothek');
    expect(e.state.doc.childCount).toBe(1);
    expect(currentCompletion(e.state)).toBeNull();
    e.destroy();
  });
});
