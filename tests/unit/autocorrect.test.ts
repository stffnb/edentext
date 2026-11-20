import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { UndoRedo } from '@tiptap/extensions';
import { AutoCorrect, autoCorrectFix, quoteLang } from '../../src/lib/editor/extensions/autoCorrect';
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
    expect(typed('"', 'fr')).toBe('«\u00A0');
    expect(typed('dit «\u00A0mot"', 'fr')).toBe('dit «\u00A0mot\u00A0»');
    expect(typed("l'", 'fr')).toBe('l’');
    expect(typed('"', 'ru')).toBe('«');
    expect(typed('он сказал «слово"', 'ru')).toBe('он сказал «слово»');
    expect(typed('"', 'uk')).toBe('«');
    expect(typed("м'", 'uk')).toBe('м’'); // after a letter, an apostrophe as in LibreOffice
    expect(typed("„слово'", 'uk')).toBe('„слово“'); // unless it closes an open quote
    expect(typed("geht'", 'de')).toBe('geht’');
    expect(typed("don'")).toBe('don’'); // an apostrophe mid-word closes, as in LibreOffice
    expect(typed("'")).toBe('‘');
    // LibreOffice's locale data: Arabic keeps the straight double quote, Persian takes guillemets.
    expect(typed('قال "كلمة"', 'ar-SA')).toBe('قال "كلمة"');
    expect(typed("'", 'ar-SA')).toBe('‘');
    expect(typed('"', 'fa-IR')).toBe('«');
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

// Traditional Chinese takes the corner brackets; Simplified keeps the English pair, which
// is the convention there.
describe('Chinese quotes', () => {
  it('opens and closes with corner brackets in Traditional Chinese', () => {
    expect(typed('他說："', 'zh-TW')).toBe('他說：「');
    expect(typed('他說：「中文"', 'zh-TW')).toBe('他說：「中文」');
    expect(typed('答え："', 'ja-JP')).toBe('答え：「');
    expect(typed('彼は「日本"', 'ja-JP')).toBe('彼は「日本」');
    expect(typed("他說：'", 'zh-TW')).toBe('他說：『');
  });

  it('keeps the English pair in Simplified Chinese', () => {
    expect(typed('他说："', 'zh-CN')).toBe('他说：“');
    expect(typed('他说：“中文"', 'zh-CN')).toBe('他说：“中文”');
  });

  // A quote after a Han character with no space before it still opens where the
  // punctuation says so — and a western sentence is unaffected.
  it('leaves the western rule alone', () => {
    expect(typed('he said "')).toBe('he said “');
    expect(typed('he said “word"')).toBe('he said “word”');
  });
});

// A quote takes the language at the caret, not the document's.
describe('quote language', () => {
  const de = { main: 'de-DE', west: 'de-DE', asian: null };
  const block = { langAsian: 'zh-TW' };
  it('follows the script before it, then the block, then the document', () => {
    expect(quoteLang('他說："', '', undefined, block, de)).toBe('zh-TW');
    expect(quoteLang('Er sagt "', '', undefined, block, de)).toBe('de-DE');
    expect(quoteLang('"', '', undefined, block, de)).toBe('zh-TW');
    expect(quoteLang('"', '中文', undefined, { lang: 'de-DE', langAsian: 'zh-TW' }, de)).toBe('zh-TW');
    expect(quoteLang('"', '', undefined, undefined, de)).toBe('de-DE');
    expect(quoteLang('中"', '', { langAsian: 'ja-JP' }, block, de)).toBe('ja-JP');
    expect(quoteLang('中"', '', undefined, undefined, de)).toBe('en');
  });
});

describe('AutoCorrect', () => {
  it('takes back only the correction on the first undo', () => {
    const ed = new Editor({ extensions: [Document, Paragraph, Text, UndoRedo, AutoCorrect], content: '<p>a --</p>' });
    const at = ed.state.doc.content.size - 1;
    ed.view.someProp('handleTextInput', (f) => f(ed.view, at, at, '>', () => ed.state.tr));
    expect(ed.getText()).toBe('a →');
    ed.commands.undo();
    expect(ed.getText()).toBe('a -->');
    ed.commands.undo();
    expect(ed.getText()).toBe('a --');
    ed.destroy();
  });
});
