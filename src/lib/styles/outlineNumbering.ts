// Chapter numbering: the automatic label in front of every heading, LibreOffice's
// Tools ▸ Heading Numbering and Word's multilevel list bound to the heading styles.
// One definition per document, level 1 first (ODF text:outline-style).

import type { NoteNumFormat } from '../storage/noteSettings';
import type { TextProps } from './styleSheet';

export type OutlineLevel = {
  // 'none' = this level is unnumbered, which is how both products switch a level off.
  format: NoteNumFormat | 'none';
  prefix: string;
  suffix: string;
  // How many levels the label shows: 1 → "2", 3 → "2.1.4" (ODF text:display-levels).
  displayLevels: number;
  start: number;
  // The character style the label takes, where the file names one.
  charStyle?: string | null;
  // That style resolved, plus Word's w:lvl/w:rPr, which names no style: a chapter
  // number is often set in a size and colour of its own.
  labelText?: TextProps | null;
  // Where the two products put label and title, cm from the text margin: the
  // paragraph's indent, its first line relative to that (negative hangs the label
  // out of it) and the stop the label's tab runs to.
  indentCm?: number;
  firstIndentCm?: number;
  tabCm?: number | null;
};

export type OutlineNumbering = OutlineLevel[];

export const MAX_OUTLINE_LEVELS = 10;

export const DEFAULT_OUTLINE_LEVEL: OutlineLevel = {
  format: 'none', prefix: '', suffix: '', displayLevels: 1, start: 1,
};

export function outlineLevelAt(outline: OutlineNumbering | null | undefined, level: number): OutlineLevel | null {
  const l = outline?.[level - 1];
  return l && l.format !== 'none' ? l : null;
}

export function outlineIsEmpty(outline: OutlineNumbering | null | undefined): boolean {
  return !outline?.some((l) => l.format !== 'none');
}

const CSS_STYLE: Record<NoteNumFormat, string> = {
  '1': 'decimal', a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman',
};

const COUNTER = (level: number) => `edt-outline-${level}`;
const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// A heading in a cell, a list item or a frame is not part of the chapter count —
// neither product numbers one, so no rule below reaches it.
const LOOSE = ':not(:is(td, th, li, .frame-node) *)';

// The label a heading shows, as the parts of a CSS `content` value. The parent levels a
// display-levels chain shows are joined by '.', the way both products render one.
function labelContent(outline: OutlineNumbering, level: number): string | null {
  const own = outlineLevelAt(outline, level);
  if (!own) return null;
  const from = Math.max(1, level - Math.max(1, own.displayLevels) + 1);
  const parts: string[] = [];
  for (let l = from; l <= level; l++) {
    const at = outline[l - 1];
    // A level switched off in the middle of a chain contributes nothing, as in both
    // products — "1..3" is never rendered.
    if (!at || at.format === 'none') continue;
    if (parts.length) parts.push(quote('.'));
    parts.push(`counter(${COUNTER(l)}, ${CSS_STYLE[at.format]})`);
  }
  if (!parts.length) return null;
  // No-break spaces: a trailing one hangs at the end of the label's box and would take
  // the gap the file puts between label and title out of the measurement.
  const gap = (s: string) => quote(s.replace(/ /g, '\u00a0'));
  return [own.prefix ? gap(own.prefix) : '', ...parts, gap(own.suffix || ' ')]
    .filter(Boolean).join(' ');
}

// The plain-text label — what the contents entry and the chapter field show, where the
// browser's counters are not available. `counts` holds the number in force per level.
export function outlineLabel(
  outline: OutlineNumbering | null | undefined, level: number, counts: readonly number[],
  ordinal: (n: number, format: NoteNumFormat) => string,
): string {
  if (!outline) return '';
  const own = outlineLevelAt(outline, level);
  if (!own) return '';
  const from = Math.max(1, level - Math.max(1, own.displayLevels) + 1);
  const parts: string[] = [];
  for (let l = from; l <= level; l++) {
    const at = outline[l - 1];
    if (!at || at.format === 'none') continue;
    parts.push(ordinal(counts[l - 1] ?? at.start, at.format));
  }
  if (!parts.length) return '';
  return `${own.prefix}${parts.join('.')}${own.suffix || ' '}`;
}

const cm = (v: number) => `${Math.round(v * 1000) / 1000}cm`;

// The counters that draw the labels. A heading increments its own level and resets every
// deeper one, which is what makes 2.1.4 restart at every new chapter.
export function outlineCss(
  outline: OutlineNumbering | null | undefined,
  labelDecls: (t: TextProps) => string[] = () => [],
): string {
  if (outlineIsEmpty(outline)) return '';
  const levels = outline!;
  const rules: string[] = [];
  const resets = levels
    .map((l, i) => (l.format === 'none' ? '' : `${COUNTER(i + 1)} ${Math.max(0, (l.start ?? 1) - 1)}`))
    .filter(Boolean).join(' ');
  rules.push(`.paper .tiptap {\n  counter-reset: ${resets};\n}`);
  for (let level = 1; level <= Math.min(MAX_OUTLINE_LEVELS, levels.length); level++) {
    const own = levels[level - 1];
    if (!own || own.format === 'none') continue;
    const head = `.paper .tiptap h${level}${LOOSE}`;
    const deeper = levels
      .map((l, i) => (i + 1 > level && l.format !== 'none' ? `${COUNTER(i + 1)} ${Math.max(0, (l.start ?? 1) - 1)}` : ''))
      .filter(Boolean).join(' ');
    const block = [`counter-increment: ${COUNTER(level)}`];
    if (deeper) block.push(`counter-reset: ${deeper}`);
    // The label hangs out of the paragraph's indent, so a title that wraps lines up
    // under itself — plus the section inset, which .tiptap's padding can't draw.
    const indent = own.indentCm ?? 0;
    const first = own.firstIndentCm ?? 0;
    if (indent) block.push(`margin-left: calc(var(--sec-inset-left, 0px) + ${cm(indent)})`);
    if (first) block.push(`text-indent: ${cm(first)}`);
    rules.push(`${head} {\n  ${block.join(';\n  ')};\n}`);

    const content = labelContent(levels, level);
    if (!content) continue;
    // An inline block, so a label set larger than its heading grows the line the way
    // both products grow it; its min width is the tab the label is followed by, which
    // a label wider than the stop simply overruns.
    // text-indent inherits, and an inline block applies it to its own first line: the
    // hanging indent below would shrink the label's box by exactly what it hangs it out.
    const label = [`content: ${content}`, 'white-space: pre', 'display: inline-block', 'text-indent: 0'];
    const gap = (own.tabCm ?? 0) - (indent + first);
    if (gap > 0) label.push(`min-width: ${cm(gap)}`);
    label.push(...labelDecls(own.labelText ?? {}));
    rules.push(`${head}::before {\n  ${label.join(';\n  ')};\n}`);
  }
  return rules.join('\n\n');
}
