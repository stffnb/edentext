// Ordered-list numbering styles — single source of truth for orderedList.ts (the
// `listStyleType` attr), Toolbar.svelte, editor.css, and export/odt.ts. `decimal`
// is the default and maps to odf-kit's own output, so the export rewrite skips it.

export type OrderedListType =
  | 'decimal'      | 'decimal-paren'
  | 'lower-alpha'  | 'lower-alpha-paren'
  | 'upper-alpha'  | 'upper-alpha-paren'
  | 'lower-roman'  | 'lower-roman-paren'
  | 'upper-roman'  | 'upper-roman-paren'
  | 'lower-alpha-sync'    | 'lower-alpha-sync-paren'
  | 'upper-alpha-sync'    | 'upper-alpha-sync-paren'
  | 'lower-cyrillic'      | 'lower-cyrillic-paren'
  | 'upper-cyrillic'      | 'upper-cyrillic-paren'
  | 'lower-cyrillic-sync' | 'lower-cyrillic-sync-paren'
  | 'upper-cyrillic-sync' | 'upper-cyrillic-sync-paren'
  | 'cjk-counting' | 'cjk-legal' | 'cjk-stem' | 'circled-decimal'
  | 'katakana'     | 'katakana-iroha'
  | 'arabic-indic' | 'arabic-indic-paren' | 'arabic-alpha' | 'arabic-alpha-paren'
  | 'arabic-abjad' | 'arabic-abjad-paren'
  | 'hangul' | 'hangul-paren' | 'hangul-consonant' | 'hangul-consonant-paren'
  | 'korean-counting' | 'korean-legal'
  | 'multilevel';

export const DEFAULT_ORDERED_TYPE: OrderedListType = 'decimal';

// Numbering when the attr is null, keyed by 0-based nesting depth (Word's default
// multilevel template: 1. → a. → i., repeating).
export const DEFAULT_ORDERED_CYCLE: OrderedListType[] = ['decimal', 'lower-alpha', 'lower-roman'];

export function defaultOrderedType(depth0: number): OrderedListType {
  return DEFAULT_ORDERED_CYCLE[depth0 % DEFAULT_ORDERED_CYCLE.length];
}

// The ODF spellings LibreOffice writes for CJK numbering, verbatim.
export type CjkNumFormat = '一, 二, 三, ...' | '壹, 贰, 叁, ...' | '甲, 乙, 丙, ...' | '①, ②, ③, ...'
  | 'ア, イ, ウ, ...' | 'イ, ロ, ハ, ...';

// The Arabic formats: the letters in alphabetical and in the older abjad order, spelled as
// LibreOffice writes them (probed), and Word's Arabic-Indic digits (hindiNumbers), which
// LibreOffice has no numbering for and counts 1, 2, 3.
export type ArabicNumFormat = '١, ٢, ٣, ...' | 'أ, ب, ت, ...' | 'ا, ب, ج, ...';

// The Korean formats as LibreOffice spells them (probed): the 14 syllables and consonants,
// then the Sino-Korean (일, 이, 삼) and native (하나, 둘, 셋) number words.
export type KoreanNumFormat = '가, 나, 다, ...' | 'ㄱ, ㄴ, ㄷ, ...' | '일, 이, 삼, ...' | '하나, 둘, 셋, ...';

// LibreOffice's Russian letter formats, verbatim: the "аа, аб" ones count on like a, b, c,
// the "аа, бб" ones repeat the letter, as `a` with style:num-letter-sync does.
export type CyrillicNumFormat = 'а, б, .., аа, аб, ... (ru)' | 'А, Б, .., Аа, Аб, ... (ru)'
  | 'а, б, .., аа, бб, ... (ru)' | 'А, Б, .., Аа, Бб, ... (ru)';

// 'aa'/'AA' stand for ODF's `a`/`A` with style:num-letter-sync="true" (a … z, aa, bb).
export type LetterSyncFormat = 'aa' | 'AA';

export interface OrderedTypeDef {
  key: OrderedListType;
  label: string;   // human-readable description for the menu
  preview: string; // a single marker shown in the dropdown, e.g. "1." or "a)"
  // ODF style:num-format. LibreOffice spells the CJK formats as the whole sequence,
  // not as one character — probed, it drops a bare '一' back to decimal.
  numFormat: '1' | 'a' | 'A' | 'i' | 'I' | LetterSyncFormat | CyrillicNumFormat | CjkNumFormat | ArabicNumFormat | KoreanNumFormat;
  numSuffix: '.' | ')' | '、' | ''; // ODF style:num-suffix
  // Legal/outline numbering (1., 1.1., 1.2.1. …): each level shows the parent chain.
  // ODF text:display-levels, DOCX "%1.%2." lvlText, CSS counters() markers.
  multilevel?: boolean;
  // The menus offer it only where the UI or the document is in that script.
  script?: 'cjk' | 'cyrillic' | 'arabic' | 'korean';
  // Differs from its plain row only past the last letter: the list style dialog offers it,
  // the quick menus do not.
  rare?: true;
}

// In menu order. Keep aligned with the @counter-style / ol[data-list-style] rules
// in editor.css.
export const ORDERED_LIST_TYPES: OrderedTypeDef[] = [
  { key: 'decimal',           label: '1, 2, 3',        preview: '1.',   numFormat: '1', numSuffix: '.' },
  { key: 'decimal-paren',     label: '1), 2), 3)',     preview: '1)',   numFormat: '1', numSuffix: ')' },
  { key: 'multilevel',        label: '1, 1.1, 1.2.1',  preview: '1.1.', numFormat: '1', numSuffix: '.', multilevel: true },
  { key: 'lower-alpha',       label: 'a, b, c',        preview: 'a.',   numFormat: 'a', numSuffix: '.' },
  { key: 'lower-alpha-paren', label: 'a), b), c)',     preview: 'a)',   numFormat: 'a', numSuffix: ')' },
  { key: 'upper-alpha',       label: 'A, B, C',        preview: 'A.',   numFormat: 'A', numSuffix: '.' },
  { key: 'upper-alpha-paren', label: 'A), B), C)',     preview: 'A)',   numFormat: 'A', numSuffix: ')' },
  { key: 'lower-alpha-sync',       label: 'a, …, aa, bb',     preview: 'aa.', numFormat: 'aa', numSuffix: '.', rare: true },
  { key: 'lower-alpha-sync-paren', label: 'a), …, aa), bb)',  preview: 'aa)', numFormat: 'aa', numSuffix: ')', rare: true },
  { key: 'upper-alpha-sync',       label: 'A, …, AA, BB',     preview: 'AA.', numFormat: 'AA', numSuffix: '.', rare: true },
  { key: 'upper-alpha-sync-paren', label: 'A), …, AA), BB)',  preview: 'AA)', numFormat: 'AA', numSuffix: ')', rare: true },
  { key: 'lower-roman',       label: 'i, ii, iii',     preview: 'i.',   numFormat: 'i', numSuffix: '.' },
  { key: 'lower-roman-paren', label: 'i), ii), iii)',  preview: 'i)',   numFormat: 'i', numSuffix: ')' },
  { key: 'upper-roman',       label: 'I, II, III',     preview: 'I.',   numFormat: 'I', numSuffix: '.' },
  { key: 'upper-roman-paren', label: 'I), II), III)',  preview: 'I)',   numFormat: 'I', numSuffix: ')' },
  { key: 'lower-cyrillic',            label: 'а, б, …, аа, аб',     preview: 'а.', numFormat: 'а, б, .., аа, аб, ... (ru)', numSuffix: '.', script: 'cyrillic' },
  { key: 'lower-cyrillic-paren',      label: 'а), б), …, аа), аб)', preview: 'а)', numFormat: 'а, б, .., аа, аб, ... (ru)', numSuffix: ')', script: 'cyrillic' },
  { key: 'upper-cyrillic',            label: 'А, Б, …, Аа, Аб',     preview: 'А.', numFormat: 'А, Б, .., Аа, Аб, ... (ru)', numSuffix: '.', script: 'cyrillic' },
  { key: 'upper-cyrillic-paren',      label: 'А), Б), …, Аа), Аб)', preview: 'А)', numFormat: 'А, Б, .., Аа, Аб, ... (ru)', numSuffix: ')', script: 'cyrillic' },
  { key: 'lower-cyrillic-sync',       label: 'а, б, …, аа, бб',     preview: 'аа.', numFormat: 'а, б, .., аа, бб, ... (ru)', numSuffix: '.', script: 'cyrillic', rare: true },
  { key: 'lower-cyrillic-sync-paren', label: 'а), б), …, аа), бб)', preview: 'аа)', numFormat: 'а, б, .., аа, бб, ... (ru)', numSuffix: ')', script: 'cyrillic', rare: true },
  { key: 'upper-cyrillic-sync',       label: 'А, Б, …, Аа, Бб',     preview: 'Аа.', numFormat: 'А, Б, .., Аа, Бб, ... (ru)', numSuffix: '.', script: 'cyrillic', rare: true },
  { key: 'upper-cyrillic-sync-paren', label: 'А), Б), …, Аа), Бб)', preview: 'Аа)', numFormat: 'А, Б, .., Аа, Бб, ... (ru)', numSuffix: ')', script: 'cyrillic', rare: true },
  { key: 'cjk-counting',      label: '一, 二, 三',      preview: '一、',  numFormat: '一, 二, 三, ...', numSuffix: '、', script: 'cjk' },
  { key: 'cjk-legal',         label: '壹, 贰, 叁',      preview: '壹、',  numFormat: '壹, 贰, 叁, ...', numSuffix: '、', script: 'cjk' },
  { key: 'cjk-stem',          label: '甲, 乙, 丙',      preview: '甲、',  numFormat: '甲, 乙, 丙, ...', numSuffix: '、', script: 'cjk' },
  { key: 'circled-decimal',   label: '①, ②, ③',      preview: '①',    numFormat: '①, ②, ③, ...', numSuffix: '', script: 'cjk' },
  { key: 'katakana',          label: 'ア, イ, ウ',      preview: 'ア.',   numFormat: 'ア, イ, ウ, ...', numSuffix: '.', script: 'cjk' },
  { key: 'katakana-iroha',    label: 'イ, ロ, ハ',      preview: 'イ.',   numFormat: 'イ, ロ, ハ, ...', numSuffix: '.', script: 'cjk' },
  { key: 'hangul',                 label: '가, 나, 다',     preview: '가.',   numFormat: '가, 나, 다, ...', numSuffix: '.', script: 'korean' },
  { key: 'hangul-paren',           label: '가), 나), 다)',  preview: '가)',   numFormat: '가, 나, 다, ...', numSuffix: ')', script: 'korean' },
  { key: 'hangul-consonant',       label: 'ㄱ, ㄴ, ㄷ',     preview: 'ㄱ.',   numFormat: 'ㄱ, ㄴ, ㄷ, ...', numSuffix: '.', script: 'korean' },
  { key: 'hangul-consonant-paren', label: 'ㄱ), ㄴ), ㄷ)',  preview: 'ㄱ)',   numFormat: 'ㄱ, ㄴ, ㄷ, ...', numSuffix: ')', script: 'korean' },
  { key: 'korean-counting',        label: '일, 이, 삼',     preview: '일.',   numFormat: '일, 이, 삼, ...', numSuffix: '.', script: 'korean' },
  { key: 'korean-legal',           label: '하나, 둘, 셋',   preview: '하나.', numFormat: '하나, 둘, 셋, ...', numSuffix: '.', script: 'korean' },
  { key: 'arabic-indic',       label: '١, ٢, ٣',  preview: '١.', numFormat: '١, ٢, ٣, ...', numSuffix: '.', script: 'arabic' },
  { key: 'arabic-indic-paren', label: '١), ٢), ٣)', preview: '١)', numFormat: '١, ٢, ٣, ...', numSuffix: ')', script: 'arabic' },
  { key: 'arabic-alpha',       label: 'أ, ب, ت',  preview: 'أ.', numFormat: 'أ, ب, ت, ...', numSuffix: '.', script: 'arabic' },
  { key: 'arabic-alpha-paren', label: 'أ), ب), ت)', preview: 'أ)', numFormat: 'أ, ب, ت, ...', numSuffix: ')', script: 'arabic' },
  { key: 'arabic-abjad',       label: 'ا, ب, ج',  preview: 'ا.', numFormat: 'ا, ب, ج, ...', numSuffix: '.', script: 'arabic' },
  { key: 'arabic-abjad-paren', label: 'ا), ب), ج)', preview: 'ا)', numFormat: 'ا, ب, ج, ...', numSuffix: ')', script: 'arabic' },
];

const BY_KEY = new Map<string, OrderedTypeDef>(ORDERED_LIST_TYPES.map(t => [t.key, t]));

export function orderedTypeDef(key: string | null | undefined): OrderedTypeDef {
  return BY_KEY.get(key ?? DEFAULT_ORDERED_TYPE) ?? BY_KEY.get(DEFAULT_ORDERED_TYPE)!;
}

// A menu's sample of a numbering ("1, 2, 3", "a)") reads in its own script's direction,
// so a right-to-left interface does not reorder its digits and brackets.
export function sampleDir(type: Pick<OrderedTypeDef, 'script'>): 'ltr' | 'rtl' {
  return type.script === 'arabic' ? 'rtl' : 'ltr';
}

// The def a list with this attr renders at this 0-based depth (null = depth cycle).
export function effectiveOrderedDef(key: string | null | undefined, depth0: number): OrderedTypeDef {
  return orderedTypeDef(key ?? defaultOrderedType(depth0));
}

// Attr helper: null when the key equals the depth default, so round trips don't
// accrete explicit attrs. Callers inside a multilevel chain skip this — there the
// chain itself is the default, so an explicit key must stay explicit.
export function orderedTypeAttr(key: OrderedListType, depth0: number): OrderedListType | null {
  return key === defaultOrderedType(depth0) ? null : key;
}

// The cycle slot (0=decimal, 1=alpha, 2=roman) a numbering type renders as, keyed
// by its num-format so paren/upper variants share their base slot. A nested list
// advances one slot past its parent's *effective* type, so it never repeats it.
export function cycleSlotOf(key: string | null | undefined): number {
  switch (orderedTypeDef(key).numFormat) {
    case 'a': case 'A': case 'aa': case 'AA':
    case 'а, б, .., аа, аб, ... (ru)': case 'А, Б, .., Аа, Аб, ... (ru)':
    case 'а, б, .., аа, бб, ... (ru)': case 'А, Б, .., Аа, Бб, ... (ru)':
      return 1;
    case 'i': case 'I': return 2;
    default: return 0;
  }
}

// A list's position in the default cycle: its base slot plus the suffix inherited down
// the chain (so "a)" at one level makes deeper defaults keep the ")" suffix).
export type OrderedCycle = { slot: number; suffix: '.' | ')' };
export const ROOT_ORDERED_CYCLE: OrderedCycle = { slot: 0, suffix: '.' };

const DOT_SLOTS: OrderedListType[] = ['decimal', 'lower-alpha', 'lower-roman'];
const PAREN_SLOTS: OrderedListType[] = ['decimal-paren', 'lower-alpha-paren', 'lower-roman-paren'];

// The default numbering at a cycle position: the slot's base form (1./a./i.) carrying
// the inherited suffix, so a level-1 "a)" makes level 2 default to i), not i.
export function defaultOrderedTypeAt(cycle: OrderedCycle): OrderedListType {
  return (cycle.suffix === ')' ? PAREN_SLOTS : DOT_SLOTS)[cycle.slot % DOT_SLOTS.length];
}

// Cycle position of a list nested under a parent: advance one slot; an explicit ordered
// parent re-anchors both slot and suffix to its own, so a level-1 "a., b." makes level 2
// default to i. and a level-1 "a)" makes it i) — others pass the context through.
export function childCycle(parent: OrderedCycle, parentKey: string | null | undefined, parentOrdered: boolean): OrderedCycle {
  if (parentOrdered && parentKey && parentKey !== 'multilevel') {
    // The cycle only knows the two western suffixes; a CJK parent hands its children
    // the default one rather than its own 、.
    const suffix = orderedTypeDef(parentKey).numSuffix;
    return { slot: cycleSlotOf(parentKey) + 1, suffix: suffix === ')' ? ')' : '.' };
  }
  return { slot: parent.slot + 1, suffix: parent.suffix };
}

// Cycle-aware variants of orderedTypeAttr/effectiveOrderedDef (null = matches the
// cycle default, so round trips don't accrete explicit attrs).
export function orderedTypeAttrAt(key: OrderedListType, cycle: OrderedCycle): OrderedListType | null {
  return key === defaultOrderedTypeAt(cycle) ? null : key;
}

export function effectiveOrderedDefAt(key: string | null | undefined, cycle: OrderedCycle): OrderedTypeDef {
  return orderedTypeDef(key ?? defaultOrderedTypeAt(cycle));
}

function toRoman(n: number): string {
  const map: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = '';
  for (const [v, sym] of map) while (n >= v) { s += sym; n -= v; }
  return s;
}

const LATIN = [...'abcdefghijklmnopqrstuvwxyz'];
// LibreOffice's Russian alphabet (probed): ы is in, ё, й, ъ and ь are not.
const RUSSIAN = [...'абвгдежзиклмнопрстуфхцчшщыэюя'];

// Bijective letters (z, aa, ab) or, with `sync`, the letter repeated (z, aa, bb).
function toLetters(n: number, letters: string[], sync = false): string {
  if (n < 1) return String(n);
  if (sync) return letters[(n - 1) % letters.length].repeat(Math.ceil(n / letters.length));
  let s = '';
  while (n > 0) { n--; s = letters[n % letters.length] + s; n = Math.floor(n / letters.length); }
  return s;
}

// LibreOffice capitalises only the first Cyrillic letter: Аа, Аб, Бб.
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Chinese numerals, informal (一二三) or formal (壹贰叁). Probed against LibreOffice: the
// informal set drops the leading 一 in 十…十九, the formal one keeps it (壹拾壹).
function toChinese(n: number, formal: boolean): string {
  if (n < 1 || n > 9999) return String(n);
  const d = formal ? '零壹贰叁肆伍陆柒捌玖' : '〇一二三四五六七八九';
  const u = formal ? ['', '拾', '佰', '仟'] : ['', '十', '百', '千'];
  const digits = [...String(n)].map(Number);
  let out = '';
  let gap = false;
  digits.forEach((digit, i) => {
    const unit = digits.length - 1 - i;
    if (digit === 0) { gap = true; return; }
    if (gap && out) out += d[0];
    gap = false;
    if (!(!formal && digit === 1 && unit === 1 && i === 0)) out += d[digit];
    out += u[unit];
  });
  return out;
}

// The ten heavenly stems; past them LibreOffice numbers on in decimal (probed).
const HEAVENLY_STEMS = [...'甲乙丙丁戊己庚辛壬癸'];

// ①–⑳, ㉑–㉟, ㊱–㊿ — three separate Unicode runs, decimal past the last.
function toCircled(n: number): string {
  if (n >= 1 && n <= 20) return String.fromCodePoint(0x2460 + n - 1);
  if (n <= 35) return String.fromCodePoint(0x3251 + n - 21);
  if (n <= 50) return String.fromCodePoint(0x32b1 + n - 36);
  return String(n);
}

// The Japanese syllabaries, full width. LibreOffice starts either over from its first
// sign once it runs out (probed), rather than doubling up as CSS's katakana does.
const AIUEO = [...'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン'];
const IROHA = [...'イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセスン'];
const cyclic = (signs: string[], n: number) => (n < 1 ? String(n) : signs[(n - 1) % signs.length]);

const ARABIC_INDIC = [...'٠١٢٣٤٥٦٧٨٩'];
const ARABIC_ALPHA = [...'أبتثجحخدذرزسشصضطظعغفقكلمنهوي'];
const ARABIC_ABJAD = [...'ابجدهوزحطيكلمنسعفصقرشتثخذضظغ'];

// The 14 basic consonants and their syllables with ㅏ; LibreOffice starts over after ㅎ/하.
const HANGUL = [...'가나다라마바사아자차카타파하'];
const HANGUL_CONSONANT = [...'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ'];

// Sino-Korean numerals as LibreOffice counts them (probed): no 일 before 십, 백, 천 or 만
// (십일, 만일), decimal past 99999 as the lists' counter style does.
function toKoreanCounting(n: number): string {
  if (n < 1 || n > 99999) return String(n);
  const d = '영일이삼사오육칠팔구';
  const u = ['', '십', '백', '천', '만'];
  return [...String(n)].map(Number).map((digit, i, all) => {
    const unit = all.length - 1 - i;
    return digit === 0 ? '' : (digit === 1 && unit > 0 ? '' : d[digit]) + u[unit];
  }).join('');
}

// Native Korean numbers up to 99 (열하나, 아흔아홉); from 100 LibreOffice counts on in
// Sino-Korean (백일), probed.
const NATIVE_ONES = ['', '하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉'];
const NATIVE_TENS = ['', '열', '스물', '서른', '마흔', '쉰', '예순', '일흔', '여든', '아흔'];
function toKoreanLegal(n: number): string {
  return n >= 1 && n < 100 ? NATIVE_TENS[Math.floor(n / 10)] + NATIVE_ONES[n % 10] : toKoreanCounting(n);
}

// The ordinal body an item renders for a num-format (no suffix): 3/'a' → "c".
// A list's `start` attr as a number: absent is 1, but 0 is a real start (both formats).
export function listStart(start: unknown): number {
  const n = Number(start);
  return start == null || start === '' || !Number.isFinite(n) ? 1 : n;
}

export function formatOrdinal(n: number, numFormat: OrderedTypeDef['numFormat']): string {
  switch (numFormat) {
    case 'a': return toLetters(n, LATIN);
    case 'A': return toLetters(n, LATIN).toUpperCase();
    case 'i': return toRoman(n);
    case 'I': return toRoman(n).toUpperCase();
    case 'aa': return toLetters(n, LATIN, true);
    case 'AA': return toLetters(n, LATIN, true).toUpperCase();
    case 'а, б, .., аа, аб, ... (ru)': return toLetters(n, RUSSIAN);
    case 'А, Б, .., Аа, Аб, ... (ru)': return capitalise(toLetters(n, RUSSIAN));
    case 'а, б, .., аа, бб, ... (ru)': return toLetters(n, RUSSIAN, true);
    case 'А, Б, .., Аа, Бб, ... (ru)': return capitalise(toLetters(n, RUSSIAN, true));
    case '١, ٢, ٣, ...': return [...String(n)].map((c) => ARABIC_INDIC[Number(c)] ?? c).join('');
    case 'أ, ب, ت, ...': return toLetters(n, ARABIC_ALPHA);
    case 'ا, ب, ج, ...': return toLetters(n, ARABIC_ABJAD);
    case '一, 二, 三, ...': return toChinese(n, false);
    case '壹, 贰, 叁, ...': return toChinese(n, true);
    case '甲, 乙, 丙, ...': return HEAVENLY_STEMS[n - 1] ?? String(n);
    case '①, ②, ③, ...': return toCircled(n);
    case 'ア, イ, ウ, ...': return cyclic(AIUEO, n);
    case 'イ, ロ, ハ, ...': return cyclic(IROHA, n);
    case '가, 나, 다, ...': return cyclic(HANGUL, n);
    case 'ㄱ, ㄴ, ㄷ, ...': return cyclic(HANGUL_CONSONANT, n);
    case '일, 이, 삼, ...': return toKoreanCounting(n);
    case '하나, 둘, 셋, ...': return toKoreanLegal(n);
    default: return String(n);
  }
}

// The half-width kana lists number in the same order, so they are read as the full-width
// ones rather than dropped to decimal.
const HALF_WIDTH_KANA: Record<string, CjkNumFormat> = {
  'ｱ, ｲ, ｳ, ...': 'ア, イ, ウ, ...',
  'ｲ, ﾛ, ﾊ, ...': 'イ, ロ, ハ, ...',
};

// An ODF style:num-format the lists render, else null (a bullet, 'none', an unknown one).
export function knownNumFormat(numFormat: string | null): OrderedTypeDef['numFormat'] | null {
  const f = HALF_WIDTH_KANA[numFormat ?? ''] ?? numFormat;
  return ORDERED_LIST_TYPES.find(t => t.numFormat === f)?.numFormat ?? null;
}

// Reverse lookup for the ODT importer: ODF numbering attrs → listStyleType key.
// Unknown formats (e.g. figure numbering) fall back to decimal.
export function orderedTypeFromFormat(numFormat: string | null, numSuffix: string | null): OrderedListType {
  numFormat = HALF_WIDTH_KANA[numFormat ?? ''] ?? numFormat;
  const byFormat = ORDERED_LIST_TYPES.filter(t => !t.multilevel && t.numFormat === numFormat);
  // Each CJK format has exactly one entry, so its own suffix stands whatever the file
  // writes around the marker; the western ones come in a dot and a paren variant.
  if (byFormat.length === 1) return byFormat[0].key;
  return byFormat.find(t => t.numSuffix === (numSuffix ?? '.'))?.key ?? DEFAULT_ORDERED_TYPE;
}

const STYLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
const LETTER_SYNC: Record<string, LetterSyncFormat> = { a: 'aa', A: 'AA' };

// An ODF level's style:num-format, with `a`/`A` plus style:num-letter-sync read as 'aa'/'AA'.
export function odfNumFormatOf(el: Element): string | null {
  const f = el.getAttributeNS(STYLE_NS, 'num-format');
  return f && el.getAttributeNS(STYLE_NS, 'num-letter-sync') === 'true' ? LETTER_SYNC[f] ?? f : f;
}

// The ODF attributes a num-format writes: 'aa'/'AA' become `a`/`A` with letter-sync.
export function odfNumFormatAttrs(numFormat: string): string {
  const sync = numFormat === 'aa' || numFormat === 'AA';
  return sync ? `style:num-format="${numFormat[0]}" style:num-letter-sync="true"` : `style:num-format="${numFormat}"`;
}

// The menu rows for the scripts the UI or the document is in, the rare ones only with
// `rare`; the list's own always stays.
export function orderedTypesFor(show: { cjk: boolean; cyrillic: boolean; arabic?: boolean; korean?: boolean }, current?: string | null, rare = false): OrderedTypeDef[] {
  return ORDERED_LIST_TYPES.filter(t => t.key === current || ((!t.script || show[t.script]) && (rare || !t.rare)));
}
