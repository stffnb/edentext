// Resolved embedding levels of one paragraph, after the Unicode bidirectional algorithm
// (UAX #9) without explicit embeddings: what a browser shows for unmarked text. The
// DOCX export reads them, since Word orders a paragraph by its runs' direction flags.

type T = 'L' | 'R' | 'AL' | 'EN' | 'AN' | 'ES' | 'ET' | 'CS' | 'NSM' | 'BN' | 'S' | 'WS' | 'ON';

const STRONG_RTL_RE = /[֐-ࣿיִ-﷿ﹰ-ﻼ‏]/;
const NSM_RE = /[̀-֑ͯ-ׇֽֿׁׂׅׄؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۤۧۨ-ܑۭܰ-݊ަ-ް࣓-ࣣ࣡-ࣿ⃐-⃰︀-️︠-︯]/;
const AN_RE = /[؀-؅٠-٩٫٬۝]/;
const EN_RE = /[0-9²³¹۰-۹⁰-⁹₀-₉０-９]/;
const ET_RE = /[#$%¢-¥°±٪‰-‴₠-⃏−∓]/;
const CS_RE = /[,./: ، ⁄]/;
const BN_RE = /[­​-‍⁠-⁤﻿]/;
const HEBREW_RE = /[֐-׿߀-࡟יִ-ﭏ‏]/;
const LETTER_RE = /[\p{L}\p{Nl}‎]/u;
const OPEN = '([{', CLOSE = ')]}';

function classOf(ch: string): T {
  if (ch === '\t' || ch === '\n') return 'S';
  if (ch === ' ' || ch === ' ' || /[ - 　]/.test(ch)) return 'WS';
  if (EN_RE.test(ch)) return 'EN';
  if (ch === '+' || ch === '-') return 'ES';
  if (ET_RE.test(ch)) return 'ET';
  if (CS_RE.test(ch)) return 'CS';
  if (BN_RE.test(ch)) return 'BN';
  if (NSM_RE.test(ch)) return 'NSM';
  if (AN_RE.test(ch)) return 'AN';
  if (/[؆؇؉؊؎؏۞۩﴾﴿]/.test(ch)) return 'ON';
  if (STRONG_RTL_RE.test(ch)) return HEBREW_RE.test(ch) ? 'R' : 'AL';
  return LETTER_RE.test(ch) ? 'L' : 'ON';
}

export const hasRtlText = (text: string): boolean => STRONG_RTL_RE.test(text);

const isNeutral = (t: T) => t === 'ON' || t === 'WS' || t === 'S' || t === 'BN';
// Numbers count as right-to-left where neutrals take their neighbours' direction.
const strongOf = (t: T): 'L' | 'R' | null => (t === 'L' ? 'L' : t === 'R' || t === 'EN' || t === 'AN' ? 'R' : null);

/** One level per UTF-16 unit of `text`; `rtl` is the paragraph's direction. */
export function bidiLevels(text: string, rtl: boolean): number[] {
  const n = text.length, base = rtl ? 1 : 0, e: 'L' | 'R' = rtl ? 'R' : 'L';
  const orig: T[] = Array.from({ length: n }, (_, i) => classOf(text[i]));
  const t = orig.slice();
  // W1–W3: marks join their base, digits after Arabic letters are Arabic numbers.
  let prev: T = e, strong: T = e;
  for (let i = 0; i < n; i++) {
    if (t[i] === 'NSM') t[i] = prev;
    if (t[i] === 'L' || t[i] === 'R' || t[i] === 'AL') strong = t[i];
    else if (t[i] === 'EN' && strong === 'AL') t[i] = 'AN';
    if (t[i] !== 'BN') prev = t[i];
  }
  for (let i = 0; i < n; i++) if (t[i] === 'AL') t[i] = 'R';
  // W4–W6: separators and terminators inside or beside a number belong to it.
  for (let i = 1; i < n - 1; i++) {
    if (t[i] === 'ES' && t[i - 1] === 'EN' && t[i + 1] === 'EN') t[i] = 'EN';
    else if (t[i] === 'CS' && t[i - 1] === t[i + 1] && (t[i - 1] === 'EN' || t[i - 1] === 'AN')) t[i] = t[i - 1];
  }
  for (let i = 0; i < n; i++) {
    if (t[i] !== 'ET') continue;
    let j = i;
    while (j < n && t[j] === 'ET') j++;
    if ((i > 0 && t[i - 1] === 'EN') || (j < n && t[j] === 'EN')) for (let k = i; k < j; k++) t[k] = 'EN';
    i = j - 1;
  }
  for (let i = 0; i < n; i++) if (t[i] === 'ES' || t[i] === 'ET' || t[i] === 'CS') t[i] = 'ON';
  // W7: a European number after left-to-right text is part of it.
  strong = e;
  for (let i = 0; i < n; i++) {
    if (t[i] === 'L' || t[i] === 'R') strong = t[i];
    else if (t[i] === 'EN' && strong === 'L') t[i] = 'L';
  }
  // N0: a bracket pair takes the paragraph's direction where it encloses such text, else
  // the direction of what it encloses if the text before it runs that way too.
  const stack: number[] = [];
  const pairs: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (t[i] !== 'ON') continue;
    if (OPEN.includes(text[i])) stack.push(i);
    else if (CLOSE.includes(text[i])) {
      const want = OPEN[CLOSE.indexOf(text[i])];
      for (let s = stack.length - 1; s >= 0; s--) {
        if (text[stack[s]] === want) { pairs.push([stack[s], i]); stack.length = s; break; }
      }
    }
  }
  pairs.sort((a, b) => a[0] - b[0]);
  for (const [a, b] of pairs) {
    let same = false, other = false;
    for (let i = a + 1; i < b; i++) {
      const s = strongOf(t[i]);
      if (s === e) same = true; else if (s) other = true;
    }
    if (!same && !other) continue;
    let dir: 'L' | 'R' = e;
    if (!same) {
      let before: 'L' | 'R' = e;
      for (let i = a - 1; i >= 0; i--) { const s = strongOf(t[i]); if (s) { before = s; break; } }
      if (before !== e) dir = before;
    }
    t[a] = t[b] = dir;
  }
  // N1/N2: neutrals between text of one direction join it, the others the paragraph.
  for (let i = 0; i < n; i++) {
    if (!isNeutral(t[i])) continue;
    let j = i;
    while (j < n && isNeutral(t[j])) j++;
    const before = i > 0 ? strongOf(t[i - 1])! : e, after = j < n ? strongOf(t[j])! : e;
    for (let k = i; k < j; k++) t[k] = before === after ? before : e;
    i = j - 1;
  }
  const levels = t.map((c) => (base === 0 ? (c === 'R' ? 1 : c === 'L' ? 0 : 2) : c === 'R' ? 1 : 2));
  // L1: separators, the white space before them and at the end sit at the paragraph's level.
  let reset = true;
  for (let i = n - 1; i >= 0; i--) {
    if (orig[i] === 'S') reset = true;
    else if (orig[i] !== 'WS' && orig[i] !== 'BN') reset = false;
    if (reset) levels[i] = base;
  }
  return levels;
}

/**
 * Which characters a word processor's run flag marks right-to-left: those at the level of a
 * right-to-left paragraph, and whole right-to-left stretches, numbers included, in a
 * left-to-right one. Each stretch then resolves inside itself as a browser does.
 */
export function rtlRunFlags(text: string, rtl: boolean): boolean[] | null {
  if (!rtl && !hasRtlText(text)) return null;
  const levels = bidiLevels(text, rtl);
  return levels.map((l) => (rtl ? l === 1 : l >= 1));
}
