import { AUTHOR_COLORS } from '../editor/authorColors';
import { t } from '../i18n/i18n.svelte';

// Names and colours of the people in a session (docs/architecture/collab.md). A name is
// someone else's input: cut, without control characters, and only ever shown as text.

export const MAX_NAME = 40;

const graphemes = (s: string): string[] => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((g) => g.segment);
// Control characters and the bidi overrides that could turn the text around them.
const CONTROLS = /[\p{Cc}‎‏‪-‮⁦-⁩]/gu;

/** A name as sent, made safe to show: one line, MAX_NAME graphemes at most. */
export function cleanName(raw: unknown): string {
  const flat = String(raw ?? '').slice(0, MAX_NAME * 8).replace(CONTROLS, ' ').replace(/\s+/g, ' ').trim();
  return graphemes(flat).slice(0, MAX_NAME).join('').trim();
}

/** The guest number of someone without a name: from their relay id, so every client agrees. */
export function guestTag(peer: number): number {
  return 100 + (peer >>> 0) % 900;
}

/** The name others see: the given one, else a numbered guest. */
export function shownName(raw: unknown, peer: number): string {
  return cleanName(raw) || t().collab.guest(guestTag(peer));
}

// One character stands for a whole name in these scripts, as does an emoji.
const WHOLE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}]/u;
const LETTER = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;

/** One or two initials by grapheme: first and last word, or one sign for CJK and emoji. */
export function initials(name: string): string {
  const firsts = name.split(/\s+/).map((w) => graphemes(w).find((g) => LETTER.test(g))).filter((g): g is string => !!g);
  if (!firsts.length) return '?';
  if (WHOLE.test(firsts[0])) return firsts[0];
  const last = firsts.length > 1 && !WHOLE.test(firsts.at(-1)!) ? firsts.at(-1)! : '';
  return (firsts[0] + last).toLocaleUpperCase();
}

const HEX = /^#[0-9a-f]{6}$/i;
/** A colour as sent, or null when it is not a plain `#rrggbb`. */
export function cleanColor(raw: unknown): string | null {
  return typeof raw === 'string' && HEX.test(raw) ? raw : null;
}

/** The first colour of `prefer`, then of the palette, that nobody in `taken` has. */
export function pickColor(prefer: string[], taken: Set<string>): string {
  return [...prefer, ...AUTHOR_COLORS].find((c) => !taken.has(c)) ?? prefer[0] ?? AUTHOR_COLORS[0];
}
