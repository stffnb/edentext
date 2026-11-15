// What a recognized phrase becomes in the text: spoken commands per recognition language,
// then spacing and capitals against the text before the caret. Every rule only adds what
// is missing, so a recognizer that punctuates and capitalizes itself passes unchanged.

/** A new paragraph and a line break inside the composed text. */
export const PARAGRAPH = '\u2029';
export const LINE = '\u2028';

// One row per recognition language, keyed by its primary subtag; a phrase is matched as
// whole words, case-insensitively, and spaces in it match any run of whitespace.
const COMMANDS: Record<string, Record<string, string>> = {
  de: {
    'neuer absatz': PARAGRAPH, 'neue zeile': LINE, komma: ',', punkt: '.', fragezeichen: '?',
    ausrufezeichen: '!', doppelpunkt: ':', semikolon: ';',
  },
  en: {
    'new paragraph': PARAGRAPH, 'new line': LINE, comma: ',', period: '.', 'full stop': '.',
    'question mark': '?', 'exclamation mark': '!', 'exclamation point': '!', colon: ':', semicolon: ';',
  },
};

const primary = (lang: string) => lang.toLowerCase().split(/[-_]/)[0];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const patterns = new Map<string, RegExp>();
function commandPattern(table: Record<string, string>, lang: string): RegExp {
  let re = patterns.get(lang);
  if (!re) {
    const phrases = Object.keys(table).sort((a, b) => b.length - a.length).map((p) => p.split(' ').map(escape).join('\\s+'));
    re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${phrases.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
    patterns.set(lang, re);
  }
  return re;
}

/** The phrase with its spoken commands replaced by the marks they stand for. */
export function applyCommands(text: string, lang: string): string {
  const key = primary(lang);
  const table = COMMANDS[key];
  return table ? text.replace(commandPattern(table, key), (m) => table[m.toLowerCase().replace(/\s+/g, ' ')] ?? m) : text;
}

const SENTENCE_END = /[.!?…]["'’”»)]*\s*$/u;

/**
 * The text to insert for a recognized phrase between `before` and `after`, the paragraph's
 * text around the selection: one space to a word on either side, none before punctuation
 * (French keeps it before ; : ! ?), a capital at a sentence start; breaks as PARAGRAPH / LINE.
 */
export function compose(before: string, text: string, lang: string, after = ''): string {
  const key = primary(lang);
  const spaced = key !== 'ja' && key !== 'zh';
  const tight = key === 'fr' ? ',.…)\\]}' : ',.;:!?…)\\]}';
  // JavaScript's \s and trim() take the two break marks for whitespace, so spaces are named.
  let s = applyCommands(text.replace(/\s+/g, ' '), lang);
  s = s.replace(/ *([\u2028\u2029]) */g, '$1').replace(/^ +| +$/g, '');
  s = s.replace(new RegExp(` +([${tight}])`, 'gu'), '$1');
  if (!s) return '';
  s = s.replace(/([.!?…]["'’”»)]*(?: +|\u2028)|\u2029)(\p{Ll})/gu, (_, p: string, c: string) => p + c.toUpperCase());
  if (!before.trim() || SENTENCE_END.test(before)) s = s.replace(/^([^\p{L}]*)(\p{Ll})/u, (_, p: string, c: string) => p + c.toUpperCase());
  const joins = spaced && /[^\s([{„“«‘"'\u2028/-]$/u.test(before) && !new RegExp(`^[${tight}\\u2028\\u2029]`, 'u').test(s);
  if (spaced && /^[\p{L}\p{N}]/u.test(after) && !/\s$/u.test(s)) s += ' ';
  return joins ? ` ${s}` : s;
}
