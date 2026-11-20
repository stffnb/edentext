import { afterEach, describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import { buildSearchRegex, expandGroups, regexRanges, searchMatches, SearchReplace } from '../../src/lib/editor/extensions/searchReplace';

function ranges(text: string, term: string, matchCase = false, wholeWord = false, useRegex = false): [number, number][] {
  const re = buildSearchRegex(term, matchCase, wholeWord, useRegex);
  return re ? regexRanges(text, re).map(([a, b]) => [a, b] as [number, number]) : [];
}

describe('buildSearchRegex', () => {
  it('returns null for an empty term', () => {
    expect(buildSearchRegex('', false, false)).toBeNull();
  });

  it('escapes regex metacharacters (literal match)', () => {
    expect(ranges('a.b a_b', 'a.b')).toEqual([[0, 3]]); // the dot is literal, not "any char"
  });

  it('is case-insensitive by default, case-sensitive when asked', () => {
    expect(ranges('Foo foo FOO', 'foo')).toEqual([[0, 3], [4, 7], [8, 11]]);
    expect(ranges('Foo foo FOO', 'foo', true)).toEqual([[4, 7]]);
  });

  it('honours whole-word boundaries', () => {
    expect(ranges('cat category scat', 'cat')).toEqual([[0, 3], [4, 7], [14, 17]]);
    expect(ranges('cat category scat', 'cat', false, true)).toEqual([[0, 3]]);
  });

  it('bounds a word by Unicode, not by ASCII', () => {
    expect(ranges('это слово тут', 'слово', false, true)).toEqual([[4, 9]]);
    expect(ranges('этословотут', 'слово', false, true)).toEqual([]);
    expect(ranges('ein café hier', 'café', false, true)).toEqual([[4, 8]]);
    expect(ranges('cafés', 'café', false, true)).toEqual([]);
  });
});

describe('regexRanges', () => {
  it('finds all non-overlapping matches', () => {
    expect(ranges('abab', 'ab')).toEqual([[0, 2], [2, 4]]);
  });

  it('returns nothing when there is no match', () => {
    expect(ranges('hello', 'xyz')).toEqual([]);
  });

  it('does not loop on zero-width patterns', () => {
    // term is escaped so this can't actually be zero-width, but guard the helper directly
    const re = new RegExp('', 'g');
    expect(regexRanges('abc', re)).toEqual([]);
  });
});

describe('regular expressions', () => {
  it('takes the term as a pattern when asked', () => {
    expect(ranges('a.b a_b', 'a.b', false, false, true)).toEqual([[0, 3], [4, 7]]);
    expect(ranges('cat 12 dog 345', '\\d+', false, false, true)).toEqual([[4, 6], [11, 14]]);
  });

  it('still bounds a pattern by whole words', () => {
    expect(ranges('cat category', 'ca.', false, true, true)).toEqual([[0, 3]]);
  });

  it('returns null for a pattern that will not compile', () => {
    expect(buildSearchRegex('a(', false, false, true)).toBeNull();
  });

  it('carries each match\'s captures', () => {
    const re = buildSearchRegex('(\\w+)@(\\w+)', false, false, true)!;
    expect(regexRanges('mail a@b here', re)).toEqual([[5, 8, ['a@b', 'a', 'b']]]);
  });

  it('expands $1…$9 and $& in the replacement', () => {
    expect(expandGroups('$2, $1', ['a@b', 'a', 'b'])).toBe('b, a');
    expect(expandGroups('<$&>', ['a@b', 'a', 'b'])).toBe('<a@b>');
    expect(expandGroups('$3!', ['a@b', 'a', 'b'])).toBe('!');
  });
});

const editors: Editor[] = [];
afterEach(() => { while (editors.length) editors.pop()!.destroy(); });

// What the editor's own search finds in a paragraph, as the texts it would select.
function found(html: string, term: string, wholeWord = false, useRegex = false): { hits: string[]; editor: Editor } {
  const editor = new Editor({ extensions: [Document, Paragraph, Text, Bold, SearchReplace], content: html });
  editors.push(editor);
  editor.commands.setSearch({ term, matchCase: false, wholeWord, useRegex });
  const hits = searchMatches(editor.state).matches.map((m) => editor.state.doc.textBetween(m.from, m.to));
  return { hits, editor };
}

describe('Arabic text', () => {
  it('looks through harakat, tatweel and the alef forms on both sides, a pattern excepted', () => {
    expect(found('<p>قال مُحَمَّدٌ</p>', 'محمد').hits).toEqual(['مُحَمَّدٌ']);
    expect(found('<p>محمد</p>', 'مُحَمَّد').hits).toEqual(['محمد']);
    expect(found('<p>جميـــلًا جدا</p>', 'جميلا').hits).toEqual(['جميـــلًا']);
    expect(found('<p>الإسلام والاسلام</p>', 'الاسلام').hits).toEqual(['الإسلام', 'الاسلام']);
    expect(found('<p>مُحَمَّد</p>', 'محمد', false, true).hits).toEqual([]);
    // ta marbuta and alef maqsura stay letters of their own.
    expect(found('<p>مدرسه على</p>', 'مدرسة').hits).toEqual([]);
    expect(found('<p>على</p>', 'علي').hits).toEqual([]);
  });

  it('spans runs and replaces the whole word with its marks', () => {
    const { hits, editor } = found('<p>يا مُ<strong>حَمَّ</strong>دُ هنا</p>', 'محمد');
    expect(hits).toEqual(['مُحَمَّدُ']);
    editor.commands.replaceAll('علي');
    expect(editor.state.doc.textContent).toBe('يا علي هنا');
  });

  it('bounds a whole word by its marks: a mark continues the word', () => {
    expect(found('<p>كتابًا</p>', 'كتاب', true).hits).toEqual([]);
    expect(found('<p>قرأت كِتَابًا ثم كِتَاب</p>', 'كتاب', true).hits).toEqual(['كِتَاب']);
    expect(ranges('cafe\u0301 cafe', 'cafe', false, true)).toEqual([[6, 10]]);
  });

  it('leaves Latin text as it was, composed or decomposed', () => {
    expect(found('<p>café cafe\u0301</p>', 'café').hits).toEqual(['café']);
    expect(found('<p>café cafe\u0301</p>', 'cafe').hits).toEqual(['cafe']);
  });
});
