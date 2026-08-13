import { describe, it, expect } from 'vitest';
import { autoCorrectFix } from '../../src/lib/editor/extensions/autoCorrect';
import { DEFAULT_AUTOCORRECT, type AutoCorrectOptions } from '../../src/lib/storage/autoCorrect';

// `before` is the block text up to and including the character just typed; the fix is
// applied to it, so a case reads as "type this, get that".
function typed(before: string, lang = 'en', opts: AutoCorrectOptions = DEFAULT_AUTOCORRECT): string {
  const fix = autoCorrectFix(before, opts, lang);
  if (!fix) return before;
  return before.slice(0, fix.offset) + fix.text + before.slice(fix.offset + fix.length);
}

describe('autoCorrectFix', () => {
  it('replaces LibreOffice\'s default table entries', () => {
    expect(typed('a --> ')).toBe('a --> '); // only on the closing character
    expect(typed('a -->')).toBe('a →');
    expect(typed('a <--')).toBe('a ←');
    expect(typed('a <-->')).toBe('a ↔');
    expect(typed('a ==>')).toBe('a ⇒');
    expect(typed('a <==>')).toBe('a ⇔');
    expect(typed('(C)')).toBe('©');
    expect(typed('x (tm)')).toBe('x ™');
    expect(typed('and...')).toBe('and…');
    expect(typed('+/-')).toBe('±');
  });

  it('replaces dashes the way LibreOffice does', () => {
    expect(typed('A - B ')).toBe('A – B ');
    expect(typed('A -- B ')).toBe('A – B ');
    expect(typed('A--B ')).toBe('A—B ');
    expect(typed('A-B ')).toBe('A-B ');
    expect(typed('A - B')).toBe('A - B'); // not until the word is finished
  });

  it('opens and closes quotes per language', () => {
    expect(typed('"')).toBe('“');
    expect(typed('say "')).toBe('say “');
    expect(typed('say “word"')).toBe('say “word”');
    expect(typed('"', 'de')).toBe('„');
    expect(typed('sag „Wort"', 'de')).toBe('sag „Wort“');
    expect(typed("don'")).toBe('don’'); // an apostrophe mid-word closes, as in LibreOffice
    expect(typed("'")).toBe('‘');
  });

  it('capitalizes the first letter of a sentence', () => {
    expect(typed('hello ')).toBe('Hello ');
    expect(typed('Done. now ')).toBe('Done. Now ');
    expect(typed('Really? yes ')).toBe('Really? Yes ');
    expect(typed('Hello ')).toBe('Hello ');
  });

  it('leaves an abbreviation and an initial alone', () => {
    expect(typed('z.B. der ', 'de')).toBe('z.B. der ');
    expect(typed('etc. and ')).toBe('etc. and ');
    expect(typed('A. muster ')).toBe('A. muster ');
  });

  it('fixes TWo INitial CApitals', () => {
    expect(typed('WOrd ')).toBe('Word ');
    expect(typed('the WOrd.')).toBe('the Word.');
    expect(typed('ABC ')).toBe('ABC ');
    expect(typed('Word ')).toBe('Word ');
  });

  it('honours the switches', () => {
    const off = { ...DEFAULT_AUTOCORRECT, quotes: false, dashes: false, replacements: false, capitalize: false, twoInitials: false };
    expect(typed('"', 'en', off)).toBe('"');
    expect(typed('A - B ', 'en', off)).toBe('A - B ');
    expect(typed('a -->', 'en', off)).toBe('a -->');
    expect(typed('hello ', 'en', off)).toBe('hello ');
    expect(typed('WOrd ', 'en', off)).toBe('WOrd ');
  });
});
