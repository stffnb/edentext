import { describe, it, expect } from 'vitest';
import { buildSearchRegex, regexRanges } from '../../src/lib/editor/extensions/searchReplace';

function ranges(text: string, term: string, matchCase = false, wholeWord = false): [number, number][] {
  const re = buildSearchRegex(term, matchCase, wholeWord);
  return re ? regexRanges(text, re) : [];
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
