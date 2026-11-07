// Named styles with inheritance, modelled on LibreOffice: a name, a parent, a follow-on
// style and two property groups. Resolution walks the parent chain (nearer wins); direct
// formatting on the block or run still overrides the result.

import { builtinTableStyles, tableStyleCss, type TableStyle } from './tableStyles';
import { outlineCss, type OutlineNumbering } from './outlineNumbering';
import { builtinListStyles, type ListStyle } from './listStyles';
import type { CapsMode } from '../editor/extensions/textEffects';
import { normalizeColor } from '../utils/color';
import { parseBorderAttr } from '../editor/extensions/tableCellBorders';

const MAX_STYLE_NAME_LENGTH = 256;

// A style's values reach a <style> in the page, so each passes a shape check first:
// a stored or imported sheet must not end a rule or load a URL.
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const LINE_SPACING = /^\d+(\.\d+)?(pt)?$/;
const ALIGNS = new Set(['left', 'center', 'right', 'justify']);
const CAPS = new Set(['uppercase', 'lowercase', 'capitalize', 'smallCaps']);

export function cssString(value: string): string {
  return Array.from(value.slice(0, MAX_STYLE_NAME_LENGTH), char => {
    const code = char.codePointAt(0)!;
    return code < 0x20 || code > 0x7e || char === '"' || char === '\\'
      ? `\\${code.toString(16)} `
      : char;
  }).join('');
}

export type ParaProps = {
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: string;
  spaceBefore?: number; // pt
  spaceAfter?: number;  // pt
  indent?: number;      // cm
  indentFirst?: number; // cm the first line starts right of the others; negative hangs
  backgroundColor?: string;
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
  // pt between the text and its own rule lines (Word's w:pBdr w:space, ODF fo:padding).
  // Only the sides that draw a border take it.
  borderPadding?: number;
};

export type TextProps = {
  fontFamily?: string;
  // The font for Chinese, Japanese and Korean text (ODF font-name-asian, Word w:eastAsia).
  fontFamilyAsian?: string;
  fontSizePt?: number;
  letterSpacingPt?: number; // character spacing (Word's w:spacing, ODF fo:letter-spacing)
  // Pair kerning. Both states are stored: a style inherits its parent's, so a heading
  // whose file kerns needs an explicit `true` to overrule a document that does not.
  kerning?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  caps?: CapsMode; // all caps / small caps (Word w:caps + w:smallCaps, ODF fo:text-transform)
  // Language tags ('en-US'), western and asian. Carried here so a paragraph's languages
  // can be baked onto its runs, which is the only place Word reads one from.
  lang?: string;
  langAsian?: string;
};

export type Style = {
  name: string;
  parent: string | null;
  // Style applied to the paragraph created by Enter at its end (ODF next-style-name,
  // DOCX w:next). Not honored yet — stored so it round-trips.
  next: string | null;
  // 1–5 makes it a heading style: assigning it switches the node type (ODF outline level).
  outlineLevel?: number;
  builtin?: boolean;
  para: ParaProps;
  text: TextProps;
};

// Four families, as in LibreOffice/Word: paragraph styles govern whole blocks, character
// styles a run of text inside one (same Style shape; a character style only uses `text`),
// table and list styles their own whole node (own shapes, no inheritance).
export type StyleFamily = 'paragraph' | 'character' | 'table' | 'list';
export type StyleSheet = {
  paragraph: Record<string, Style>;
  character: Record<string, Style>;
  table: Record<string, TableStyle>;
  list: Record<string, ListStyle>;
  // Chapter numbering, one entry per heading level. null = the headings are unnumbered,
  // which is what a document that declares none has.
  outline?: OutlineNumbering | null;
};

export const DEFAULT_STYLE = 'Standard';
export const HEADING_PARENT = 'Heading';

// LibreOffice's defaults. Heading sizes/margins mirror HEADING_STYLE_OVERRIDES in
// export/odt.ts, which still drives the ODF/DOCX side (tests/unit/style-resolve.test.ts
// asserts the two agree).
const BUILTINS: Style[] = [
  { name: DEFAULT_STYLE, parent: null, next: null, builtin: true,
    para: { spaceBefore: 0, spaceAfter: 0 }, text: { fontFamily: 'Liberation Serif', fontSizePt: 12 } },
  { name: HEADING_PARENT, parent: DEFAULT_STYLE, next: DEFAULT_STYLE, builtin: true,
    para: { spaceBefore: 12, spaceAfter: 6 }, text: { fontFamily: 'Liberation Sans', bold: true } },
  // Sizes and the italic on 4 and 6 are LibreOffice's; the margins come from the Heading
  // parent. 7–10 continue level 6 (HEADING_STYLE_OVERRIDES says why).
  ...([[18], [16], [14], [13, true], [12], [12, true], [12], [12, true], [12], [12, true]] as [number, boolean?][]).map(([size, italic], i) => ({
    name: `Heading ${i + 1}`, parent: HEADING_PARENT, next: DEFAULT_STYLE,
    outlineLevel: i + 1, builtin: true,
    para: {}, text: italic ? { fontSizePt: size, italic: true } : { fontSizePt: size },
  })),
  { name: 'Title', parent: HEADING_PARENT, next: DEFAULT_STYLE, builtin: true,
    para: { textAlign: 'center' }, text: { fontSizePt: 28 } },
  { name: 'Subtitle', parent: HEADING_PARENT, next: DEFAULT_STYLE, builtin: true,
    para: { textAlign: 'center' }, text: { fontSizePt: 18 } },
  { name: 'Quotations', parent: DEFAULT_STYLE, next: DEFAULT_STYLE, builtin: true,
    para: { indent: 1, spaceAfter: 14 }, text: {} },
  // LibreOffice's caption style (probed): 10pt italic, 0.212cm above and below, and it
  // follows itself. Its per-category children (Figure, Table, …) only rename it.
  { name: 'Caption', parent: DEFAULT_STYLE, next: 'Caption', builtin: true,
    para: { spaceBefore: 6, spaceAfter: 6 }, text: { fontSizePt: 10, italic: true } },
];

// LibreOffice's character styles (its "Emphasis"/"Strong Emphasis"/"Source Text").
const CHAR_BUILTINS: Style[] = [
  { name: 'Emphasis', parent: null, next: null, builtin: true, para: {}, text: { italic: true } },
  { name: 'Strong Emphasis', parent: null, next: null, builtin: true, para: {}, text: { bold: true } },
  { name: 'Source Text', parent: null, next: null, builtin: true, para: {}, text: { fontFamily: 'Courier New' } },
];

// Bumped whenever the built-in definitions change: a stored sheet from an older version
// keeps its user styles but takes the new factory built-ins (see mergeStoredSheet).
export const STYLE_SHEET_VERSION = 12;

// A persisted sheet merged onto the current built-ins. Same version: stored entries win
// (a document's own styles, and edits to built-ins). Older: only user styles survive.
export function mergeStoredSheet(stored: unknown): StyleSheet {
  const sheet = builtinStyleSheet();
  const data = stored as
    | { v?: number; paragraph?: Record<string, Style>; character?: Record<string, Style>;
        table?: Record<string, TableStyle>; list?: Record<string, ListStyle>;
        outline?: OutlineNumbering | null }
    | null;
  if (!data?.paragraph || typeof data.paragraph !== 'object') return sheet;
  const current = data.v === STYLE_SHEET_VERSION;
  for (const family of ['paragraph', 'character'] as const) {
    for (const [name, style] of Object.entries(data[family] ?? {})) {
      if (!style || typeof style !== 'object') continue;
      if (!current && style.builtin) continue;
      sheet[family][name] = style;
    }
  }
  // Table and list styles have their own shapes, so they merge separately.
  for (const family of ['table', 'list'] as const) {
    for (const [name, style] of Object.entries(data[family] ?? {})) {
      if (!style || typeof style !== 'object') continue;
      if (!current && style.builtin) continue;
      (sheet[family] as Record<string, TableStyle | ListStyle>)[name] = style;
    }
  }
  if (Array.isArray(data.outline)) sheet.outline = data.outline;
  return sheet;
}

export function builtinStyleSheet(): StyleSheet {
  const paragraph: Record<string, Style> = {};
  for (const s of BUILTINS) paragraph[s.name] = structuredClone(s);
  const character: Record<string, Style> = {};
  for (const s of CHAR_BUILTINS) character[s.name] = structuredClone(s);
  return { paragraph, character, table: builtinTableStyles(), list: builtinListStyles(), outline: null };
}

// Inheritance order: every style directly followed by its own children, so the manager's
// indent matches the tree. Siblings sort built-ins first (as listed above), then by name.
// `Heading` is abstract (never assignable), so only withAbstract callers see it.
export function styleOrder(sheet: StyleSheet, withAbstract = false, family: StyleFamily = 'paragraph'): Style[] {
  if (family === 'table' || family === 'list') return []; // no inheritance — listed flat
  const styles = family === 'character' ? sheet.character : sheet.paragraph;
  const rank = new Map((family === 'character' ? CHAR_BUILTINS : BUILTINS).map((b, i) => [b.name, i]));
  const order = (a: string, b: string) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9) || a.localeCompare(b);
  // A style whose parent is missing from the sheet hangs at the root.
  const parentOf = (n: string) => (styles[n].parent && styles[styles[n].parent!] ? styles[n].parent : null);
  const out: Style[] = [];
  const seen = new Set<string>();
  const emit = (parent: string | null) => {
    for (const name of Object.keys(styles).filter(n => parentOf(n) === parent).sort(order)) {
      if (seen.has(name)) continue;
      seen.add(name);
      if (withAbstract || name !== HEADING_PARENT) out.push(styles[name]);
      emit(name);
    }
  };
  emit(null);
  // A parent cycle reaches no root; list its members anyway.
  for (const name of Object.keys(styles).sort(order)) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(styles[name]);
    emit(name);
  }
  return out;
}

// Both reference products define ten heading levels but list only the first five in
// their gallery; the rest wait behind "show all styles" (the manager always has them).
export const GALLERY_HEADING_LEVELS = 5;

// The gallery's slice of styleOrder. A deeper heading the document already uses stays
// listed, or the block under the caret would show no active style.
export function visibleStyles(sheet: StyleSheet, showAll = false, current?: string): Style[] {
  return styleOrder(sheet).filter(
    (s) => showAll || !s.outlineLevel || s.outlineLevel <= GALLERY_HEADING_LEVELS || s.name === current,
  );
}

// Styles that exist only to be inherited from.
export function isAbstractStyle(name: string): boolean {
  return name === HEADING_PARENT;
}

export function headingStyleName(level: number): string {
  return `Heading ${level}`;
}

export type ResolvedStyle = { para: ParaProps; text: TextProps };

// Flattened props of a style: the parent chain applied root-first, so the nearest
// definition wins. Cycles and missing parents end the walk.
export function resolveStyle(sheet: StyleSheet, name: string | null | undefined, family: StyleFamily = 'paragraph'): ResolvedStyle {
  const styles = family === 'character' ? sheet.character : sheet.paragraph;
  const chain: Style[] = [];
  const seen = new Set<string>();
  // A character style with no definition contributes nothing; a paragraph always has Standard.
  let cur = name && styles[name] ? name : family === 'character' ? '' : DEFAULT_STYLE;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const style = styles[cur];
    if (!style) break;
    chain.push(style);
    cur = style.parent ?? '';
  }
  const out: ResolvedStyle = { para: {}, text: {} };
  // Only defined values layer: a key present as undefined means "not set here", so it
  // must not wipe what the parent provides.
  const layer = <T extends object>(target: T, source: T) => {
    for (const key of Object.keys(source) as (keyof T)[]) {
      if (source[key] !== undefined) target[key] = source[key];
    }
  };
  for (const style of chain.reverse()) {
    layer(out.para, style.para);
    layer(out.text, style.text);
  }
  return out;
}

// The inverse of export/odt.ts twinFontName: a declared metric twin reads as the bundled
// family the editor renders.
export function screenFontName(family: string): string {
  if (family === 'Times New Roman') return 'Liberation Serif';
  if (family === 'Arial') return 'Liberation Sans';
  return family;
}

// The bundled fonts are exposed as CSS variables; anything else renders by name.
export function cssFontFamily(name: string): string {
  if (name === 'Liberation Serif') return 'var(--font-serif)';
  if (name === 'Liberation Sans' || name === 'Arial') return 'var(--font-heading)';
  return `"${cssString(name)}", var(--font-serif)`;
}

// What a family's substitute does differently, one row per family. `stack`: the names it
// renders under; `sans`: Arial's generic tail; `singleLine`: its natural line height (1.15
// is Liberation Serif's, editor.css), measured against LibreOffice at 12pt.
// `noBold`: Word has no bold face and strokes the regular outline 0.025em (read from its PDF),
// heavier than a substitute's own bold. `wideQuotes`: full-width quotation marks, as the
// Chinese face sets them, from `EdenText Quotes` where the face is missing.
interface FontProfile {
  stack?: string;
  sans?: boolean;
  singleLine?: number;
  noBold?: boolean;
  wideQuotes?: boolean;
}
const SANS = { stack: "'Arial', 'Liberation Sans'", sans: true };
// Measured in Word: 22pt SimSun at 1.15 sets 32.9pt lines. It sets FangSong_GB2312 in
// SimSun where the font is missing, and LibreOffice's fallback measures 1.34.
const SONG = { singleLine: 1.3, noBold: true, wideQuotes: true };
const CJK_NO_BOLD = { noBold: true, wideQuotes: true };
const SEGOE = { singleLine: 1.33 };
const line = (singleLine: number) => ({ singleLine });
const FONT_PROFILES: Record<string, FontProfile> = {
  'Liberation Serif': { stack: "'Liberation Serif', 'Times New Roman'" },
  'Liberation Sans': SANS,
  Arial: SANS,
  Calibri: { singleLine: 1.2208 },
  'Calibri Light': { singleLine: 1.2208 },
  Carlito: { singleLine: 1.2208 },
  // Word sets Segoe UI's win metrics, (2210 + 514) / 2048; Selawik, its open stand-in, shares them.
  'Segoe UI': SEGOE, 'Segoe UI Semibold': SEGOE, 'Segoe UI Semilight': SEGOE, 'Segoe UI Light': SEGOE,
  'Segoe UI Black': SEGOE, Selawik: SEGOE,
  // Office faces often missing where the file is opened, as Word sets them: win ascent +
  // descent + the hhea gap they leave out, read from the fonts Word ships.
  Cambria: line(1.1724), Caladea: line(1.1724), Aptos: line(1.2847), Consolas: line(1.1709),
  Candara: line(1.2207), Constantia: line(1.2207), Corbel: line(1.2207), Tahoma: line(1.207),
  Verdana: line(1.2153), Georgia: line(1.1362), 'Trebuchet MS': line(1.1611),
  'Century Gothic': line(1.2261), Garamond: line(1.125), 'Book Antiqua': line(1.2427),
  'Palatino Linotype': line(1.3491), 'Lucida Sans Unicode': line(1.5366),
  'Microsoft YaHei': line(1.3198), 'Malgun Gothic': line(1.3301),
  'Courier New': { singleLine: 1.1333 },
  'Liberation Mono': { singleLine: 1.1333 },
  SimSun: SONG, 宋体: SONG, NSimSun: SONG, 新宋体: SONG, FangSong: SONG, 仿宋: SONG, 仿宋_GB2312: SONG,
  FangSong_GB2312: CJK_NO_BOLD, SimHei: CJK_NO_BOLD, 黑体: CJK_NO_BOLD, KaiTi: CJK_NO_BOLD,
  KaiTi_GB2312: CJK_NO_BOLD, 楷体: CJK_NO_BOLD, 楷体_GB2312: CJK_NO_BOLD, MingLiU: CJK_NO_BOLD,
  PMingLiU: CJK_NO_BOLD, 細明體: CJK_NO_BOLD, 新細明體: CJK_NO_BOLD, 'MS Mincho': CJK_NO_BOLD,
  'MS PMincho': CJK_NO_BOLD, 'MS Gothic': CJK_NO_BOLD, 'MS PGothic': CJK_NO_BOLD,
};

// A family named in Han is a Chinese face all the same.
function fontProfile(name: string): FontProfile {
  return FONT_PROFILES[name] ?? (/\p{sc=Han}/u.test(name) ? { wideQuotes: true } : {});
}

export function fauxBold(asian: string): boolean {
  return !!fontProfile(asian).noBold;
}

function westNames(name: string): string {
  const p = fontProfile(name);
  return (p.stack ?? `"${cssString(name)}"`) + (p.wideQuotes ? ", 'EdenText Quotes'" : '');
}

// Text takes the western font, then the asian one, then the western family's generic tail
// (last, so `serif` cannot catch Han text first), each a variable inheriting on its own, and
// a balanced document's --font-space before all three. Named halves are spelled out too.
export function fontPairDeclarations(west?: string | null, asian?: string | null): string[] {
  if (!west && !asian) return [];
  const out: string[] = [];
  const tail = `var(${west && fontProfile(west).sans ? '--font-heading' : '--font-serif'})`;
  if (west) out.push(`--font-west: ${westNames(west)}`, `--font-tail: ${tail}`);
  if (asian) {
    out.push(`--font-asian: "${cssString(asian)}"`);
    out.push(...(fauxBold(asian) ? ['--bold-weight: 400', '--bold-stroke: 0.025em'] : ['--bold-weight: 700', '--bold-stroke: 0']));
  }
  out.push(`font-family: var(--font-space,) ${[
    west ? westNames(west) : 'var(--font-west)',
    asian ? `"${cssString(asian)}"` : 'var(--font-asian, var(--font-tail))',
    west ? tail : 'var(--font-tail)',
  ].join(', ')}`);
  return out;
}

// A proportional line spacing multiplies the font's natural line height, while CSS
// multiplies the font size — so the stored factor is scaled by the family's own.
export function singleLineHeight(fontFamily?: string): number {
  return (fontFamily && (FONT_PROFILES[fontFamily]?.singleLine ?? measuredLine(fontFamily))) || 1.15;
}

// Any other installed family: Chromium's `line-height: normal` (hhea), Word's win line where
// they agree; a missing family measures as its fallback and keeps the default.
// ponytail: cached once, so a face registered later (embedded, on reload) keeps the fallback's.
const measured = new Map<string, number>();
function measuredLine(name: string): number {
  if (typeof document === 'undefined' || !document.body) return 0;
  let v = measured.get(name);
  if (v == null) {
    const probe = (family: string) => {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;visibility:hidden;font:1000px ${family};line-height:normal`;
      el.textContent = 'x';
      document.body.append(el);
      const h = el.getBoundingClientRect().height;
      el.remove();
      return h;
    };
    const own = probe(`"${cssString(name)}", serif`);
    v = own > 0 && own !== probe('serif') && Math.abs(own - 1150) > 1 ? Math.round(own * 10) / 10000 : 0;
    measured.set(name, v);
  }
  return v;
}

// A line spacing as editor.css reads it: a factor of the font's natural line, or a fixed
// height in pt (Word's "exactly", ODF's fo:line-height length). Each clears the other,
// so a paragraph's own spacing beats its style's of either kind.
export function lineSpacingDeclarations(value: string): string[] {
  return /pt$/.test(value) ? [`--line-fixed: ${value}`, '--line-factor: 1'] : [`--line-factor: ${value}`, '--line-fixed: initial'];
}

// The text half of a rule, shared with the table-style family (tableStyles.ts). A block
// takes the family's natural line height as the variable editor.css multiplies by the
// paragraph's spacing factor; a run box sets its line height outright.
export function textDeclarations(t: TextProps, asBlock = false): string[] {
  const out: string[] = [];
  out.push(...fontPairDeclarations(t.fontFamily, t.fontFamilyAsian));
  if (t.fontFamily) {
    const lh = singleLineHeight(t.fontFamily);
    if (lh !== 1.15) out.push(`${asBlock ? '--natural-line' : 'line-height'}: ${lh}`);
  }
  if (finite(t.fontSizePt)) out.push(`font-size: ${t.fontSizePt}pt`);
  if (finite(t.letterSpacingPt) && t.letterSpacingPt) out.push(`letter-spacing: ${t.letterSpacingPt}pt`);
  if (t.kerning != null) out.push(`font-kerning: ${t.kerning ? 'normal' : 'none'}`);
  if (t.bold != null) {
    out.push(`font-weight: ${t.bold ? 'var(--bold-weight, 700)' : 400}`, `-webkit-text-stroke-width: ${t.bold ? 'var(--bold-stroke, 0)' : 0}`);
  }
  if (t.italic != null) out.push(`font-style: ${t.italic ? 'italic' : 'normal'}`);
  if (t.underline || t.strike) {
    out.push(`text-decoration: ${[t.underline && 'underline', t.strike && 'line-through'].filter(Boolean).join(' ')}`);
  }
  const color = normalizeColor(t.color);
  if (color) out.push(`color: ${color}`);
  if (t.caps && CAPS.has(t.caps)) out.push(t.caps === 'smallCaps' ? 'font-variant-caps: small-caps' : `text-transform: ${t.caps}`);
  return out;
}

function declarations(r: ResolvedStyle): string[] {
  const { para: p } = r;
  const out = textDeclarations(r.text, true);
  if (p.textAlign && ALIGNS.has(p.textAlign)) out.push(`text-align: ${p.textAlign}`);
  if (typeof p.lineHeight === 'string' && LINE_SPACING.test(p.lineHeight)) out.push(...lineSpacingDeclarations(p.lineHeight));
  // Padding or margin per the document's spacing model — editor.css resolves it.
  if (finite(p.spaceBefore)) out.push(`--space-before: ${p.spaceBefore}pt`);
  // The property beside it is what the multi-column rule turns the space below into.
  if (finite(p.spaceAfter)) out.push(`margin-bottom: ${p.spaceAfter}pt`, `--space-after: ${p.spaceAfter}pt`);
  if (finite(p.indent)) out.push(`--ind: ${p.indent}cm`);
  if (finite(p.indentFirst)) out.push(`text-indent: ${p.indentFirst}cm`, `--indent-first: ${p.indentFirst}cm`);
  const background = normalizeColor(p.backgroundColor);
  if (background) out.push(`background-color: ${background}`);
  const drawn: Record<string, boolean> = {};
  for (const [key, side] of [['borderTop', 'top'], ['borderRight', 'right'], ['borderBottom', 'bottom'], ['borderLeft', 'left']] as const) {
    const b = parseBorderAttr(p[key]);
    drawn[side] = !!b && b !== 'none';
    if (b && b !== 'none') out.push(`border-${side}: ${b.widthPt}pt solid ${b.color}`);
  }
  const boxed = !!background || Object.values(drawn).some(Boolean);
  // The rule and shading start where a hanging first line does (editor.css --box-hang).
  if (boxed) out.push('--box-hang: min(0px, var(--indent-first, 0px))');
  // Plus the section inset, which .tiptap's own padding can't draw (editor.css).
  if (p.indent != null || boxed) out.push('margin-left: calc(var(--sec-inset-left, 0px) + var(--ind, 0px) + var(--box-hang, 0px))');
  // The gap the file puts between the text and its rule, on the ruled sides only —
  // a bottom rule must not indent the paragraph or push its first line down.
  const left = 'calc(var(--pad-left, 0px) - var(--box-hang, 0px))';
  if (finite(p.borderPadding)) {
    const pad = (side: string) => (drawn[side] ? `${p.borderPadding}pt` : '0px');
    out.push(`--pad-left: ${pad('left')}`, `padding: ${pad('top')} ${pad('right')} ${pad('bottom')} ${left}`);
  } else if (boxed) out.push(`padding-left: ${left}`);
  return out;
}

// The document stylesheet: one rule per style, keyed by the block's data-style attr,
// plus per-level fallbacks for headings that carry no style name (imported documents).
// Specificity beats editor.css's `.paper .tiptap hN`; inline attrs/marks still win.
export function styleCss(sheet: StyleSheet): string {
  const rules: string[] = [];
  for (const style of Object.values(sheet.character ?? {})) {
    const decls = declarations(resolveStyle(sheet, style.name, 'character'));
    if (!decls.length) continue;
    const attr = `[data-char-style="${cssString(style.name)}"]`;
    rules.push(`.paper .tiptap ${attr} {\n  ${decls.join(';\n  ')};\n}`);
  }
  for (const style of Object.values(sheet.paragraph)) {
    const resolved = resolveStyle(sheet, style.name);
    const decls = declarations(resolved);
    // A character indent counts in the style's size, whatever the block's own mark or
    // runs say (probed in LibreOffice); indent.ts reads it.
    if (finite(resolved.text.fontSizePt)) decls.push(`--char-unit: ${resolved.text.fontSizePt}pt`);
    if (!decls.length) continue;
    const attr = `[data-style="${cssString(style.name)}"]`;
    const selectors = [`.paper .tiptap ${attr}`];
    if (style.outlineLevel) selectors.push(`.paper .tiptap h${style.outlineLevel}:not([data-style])`);
    if (style.outlineLevel === 1) selectors.push('.paper .tiptap .toc-title'); // the index heads its list like any chapter
    // The generated index carries no style name, and a word processor bases its own
    // index styles on the default one — so it follows the document's body text. A
    // header/footer zone takes the style's text half alone (below), as its importers bake
    // the rest in; :where keeps the selector's weight what it was.
    if (style.name === DEFAULT_STYLE) selectors.push('.paper .tiptap p:not([data-style]):where(:not(.hf-zone *))', '.paper .tiptap .toc');
    rules.push(`${selectors.join(',\n')} {\n  ${decls.join(';\n  ')};\n}`);

    // A list marker inherits the item's own font, never its paragraph's, so the item
    // carries the style's text half too — else the number renders in the editor
    // default while the text it labels follows the style.
    const text = textDeclarations(resolveStyle(sheet, style.name).text);
    if (!text.length) continue;
    const items = [`.paper .tiptap li:has(> ${attr})`];
    if (style.name === DEFAULT_STYLE) {
      items.push('.paper .tiptap li:has(> p:not([data-style]))');
      // A header/footer zone is a paragraph of the file too, and both formats base its
      // style on the default one — without this it renders in the editor's own font.
      // The off-screen editor the band is measured from gets it too.
      // On the zone's editor itself, over the font `.paper .tiptap` sets there.
      items.push('.paper .hf-zone .tiptap.ProseMirror');
    }
    rules.push(`${items.join(',\n')} {\n  ${text.join(';\n  ')};\n}`);
  }
  // Table styles last: their cell selectors must outrank the paragraph rules above.
  const table = tableStyleCss(sheet.table ?? {});
  if (table) rules.push(table);
  const outline = outlineCss(sheet.outline, (t) => textDeclarations(t));
  if (outline) rules.push(outline);
  return rules.join('\n\n');
}

// ---- block ⇄ style ------------------------------------------------------------------

type BlockNode = { type?: { name: string }; attrs?: Record<string, unknown> };
type BlockMark = { type: { name: string } | string; attrs?: Record<string, unknown> };

// The formatting a block currently shows, read off its attrs and the marks of its text —
// the raw material for "new style from selection".
export function propsFromBlock(node: BlockNode, marks: BlockMark[] = []): ResolvedStyle {
  const a = node.attrs ?? {};
  const para: ParaProps = {};
  // Every block carries textAlign:'left' (the TextAlign extension's default), so only a
  // real choice counts as the block's own alignment.
  const ta = a.textAlign;
  if (ta === 'center' || ta === 'right' || ta === 'justify') para.textAlign = ta;
  if (typeof a.lineHeight === 'string' && a.lineHeight) para.lineHeight = a.lineHeight;
  if (typeof a.spaceBefore === 'number') para.spaceBefore = a.spaceBefore;
  if (typeof a.spaceAfter === 'number') para.spaceAfter = a.spaceAfter;
  if (typeof a.indent === 'number' && a.indent > 0) para.indent = a.indent;
  if (typeof a.indentFirst === 'number' && a.indentFirst !== 0) para.indentFirst = a.indentFirst;
  if (typeof a.backgroundColor === 'string' && a.backgroundColor) para.backgroundColor = a.backgroundColor;
  for (const side of ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'] as const) {
    const v = a[side];
    if (typeof v === 'string' && v && v !== 'none') para[side] = v;
  }

  const text: TextProps = {};
  // The paragraph-mark size sizes the block itself; a run's own size wins below.
  if (typeof a.fontSize === 'string' && a.fontSize) text.fontSizePt = parseFloat(a.fontSize);
  const nameOf = (m: BlockMark) => (typeof m.type === 'string' ? m.type : m.type.name);
  for (const mark of marks) {
    const name = nameOf(mark);
    if (name === 'bold') text.bold = true;
    else if (name === 'italic') text.italic = true;
    else if (name === 'underline') text.underline = true;
    else if (name === 'strike') text.strike = true;
    else if (name === 'textStyle') {
      const attrs = mark.attrs ?? {};
      if (typeof attrs.fontFamily === 'string' && attrs.fontFamily) text.fontFamily = attrs.fontFamily;
      if (typeof attrs.fontFamilyAsian === 'string' && attrs.fontFamilyAsian) text.fontFamilyAsian = attrs.fontFamilyAsian;
      if (typeof attrs.fontSize === 'string' && attrs.fontSize) text.fontSizePt = parseFloat(attrs.fontSize);
      if (typeof attrs.color === 'string' && attrs.color) text.color = attrs.color;
      if (attrs.fontWeight === 'normal') text.bold = false;
    }
  }
  return { para, text };
}

// What `shown` declares beyond `base` — a style's own properties (LibreOffice's
// "new style from selection" stores exactly this against the parent).
export function styleDelta(shown: ResolvedStyle, base: ResolvedStyle): ResolvedStyle {
  const pick = <T extends object>(a: T, b: T): T => {
    const out = {} as T;
    for (const key of Object.keys(a) as (keyof T)[]) {
      if (a[key] !== undefined && a[key] !== b[key]) out[key] = a[key];
    }
    return out;
  };
  return { para: pick(shown.para, base.para), text: pick(shown.text, base.text) };
}

// A name that isn't taken yet ("Style", "Style 2", …).
export function uniqueStyleName(sheet: StyleSheet, base: string, family: StyleFamily = 'paragraph'): string {
  const styles: Record<string, unknown> = sheet[family] ?? sheet.paragraph;
  if (!styles[base]) return base;
  for (let i = 2; ; i++) if (!styles[`${base} ${i}`]) return `${base} ${i}`;
}
