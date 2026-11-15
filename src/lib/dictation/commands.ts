// What a recognized phrase becomes in the text: spoken commands per recognition language,
// then spacing and capitals against the text before the caret. Text the recognizer wrote
// keeps its own capitals; only a mark a command set starts a sentence inside a phrase.

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
    // With the comma before and the marks after it, which a recognizer adds to a spoken command.
    re = new RegExp(`(?:,\\s*)?(?<![\\p{L}\\p{N}])(${phrases.join('|')})(?![\\p{L}\\p{N}])(?:\\s*[.,;:!?…]+)?`, 'giu');
    patterns.set(lang, re);
  }
  return re;
}

// Follows a sentence mark a command set, until the capital after it is written.
const SPOKEN = '\uE000';

// The phrase with its spoken commands replaced by their marks; `breaksOnly` leaves the
// punctuation words alone, for a recognizer that punctuates itself.
function applyCommands(text: string, lang: string, breaksOnly: boolean): string {
  const key = primary(lang);
  const table = COMMANDS[key];
  if (!table) return text;
  return text.replace(commandPattern(table, key), (m, phrase: string) => {
    const mark = table[phrase.toLowerCase().replace(/\s+/g, ' ')];
    if (!mark || (breaksOnly && mark !== PARAGRAPH && mark !== LINE)) return m;
    return '.!?\u2029'.includes(mark) ? mark + SPOKEN : mark;
  });
}

const SENTENCE_END = /[.!?…]["'’”»)]*\s*$/u;
// A stop after a single letter ends an abbreviation ("e.g.", "z. B."), not a sentence.
const LETTER_STOP = /(?:^|[^\p{L}\p{N}])\p{L}\.\s*$/u;

/**
 * The text to insert for a recognized phrase between `before` and `after`, the paragraph's
 * text around the selection: one space to a word on either side, none before punctuation
 * (French keeps it before ; : ! ?), a capital at a sentence start; breaks as PARAGRAPH / LINE.
 * `breaksOnly` takes only the spoken breaks for commands.
 */
export function compose(before: string, text: string, lang: string, after = '', breaksOnly = false): string {
  const key = primary(lang);
  const spaced = key !== 'ja' && key !== 'zh';
  const tight = key === 'fr' ? ',.…)\\]}' : ',.;:!?…)\\]}';
  // JavaScript's \s and trim() take the two break marks for whitespace, so spaces are named.
  let s = applyCommands(text.replace(/\s+/g, ' '), lang, breaksOnly);
  s = s.replace(/ *([\u2028\u2029]\uE000?) */g, '$1').replace(/^ +| +$/g, '');
  s = s.replace(new RegExp(` +([${tight}])`, 'gu'), '$1');
  s = s.replace(/\uE000(["'’”»)]*[ \u2028]*)(\p{Ll})/gu, (_, p: string, c: string) => p + c.toUpperCase()).replaceAll(SPOKEN, '');
  if (!s) return '';
  const opens = !before.trim() || (SENTENCE_END.test(before) && !LETTER_STOP.test(before));
  if (opens) s = s.replace(/^(["'„“«‘(\[]*)(\p{Ll})/u, (_, p: string, c: string) => p + c.toUpperCase());
  const joins = spaced && /[^\s([{„“«‘"'\u2028/-]$/u.test(before) && !new RegExp(`^[${tight}\\u2028\\u2029]`, 'u').test(s);
  if (spaced && /^[\p{L}\p{N}]/u.test(after) && !/\s$/u.test(s)) s += ' ';
  return joins ? ` ${s}` : s;
}
