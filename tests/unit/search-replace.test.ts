import { describe, it, expect } from 'vitest';
import { buildSearchRegex, expandGroups, regexRanges } from '../../src/lib/editor/extensions/searchReplace';

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
