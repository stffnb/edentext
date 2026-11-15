import Underline from '@tiptap/extension-underline';
import Strike from '@tiptap/extension-strike';
import { Extension, type ChainedCommands, type Command } from '@tiptap/core';
import '@tiptap/extension-text-style';
import { normalizeColor } from '../../utils/color';

// The character effects beyond bold/italic that both Word and LibreOffice carry and
// CSS can draw: letter case, a raised or lowered run, emphasis marks, outline, shadow,
// relief, and the line styles of the underline and strikethrough marks.

export type CapsMode = 'uppercase' | 'lowercase' | 'capitalize' | 'smallCaps';
// ODF style:text-underline-style / Word w:u w:val, in the CSS spelling.
export type LineStyle = 'solid' | 'double' | 'dotted' | 'dashed' | 'wavy';

const CAPS_CSS: Record<CapsMode, string> = {
  uppercase: 'text-transform: uppercase',
  lowercase: 'text-transform: lowercase',
  capitalize: 'text-transform: capitalize',
  smallCaps: 'font-variant-caps: small-caps',
};

const isCaps = (v: unknown): v is CapsMode => typeof v === 'string' && v in CAPS_CSS;
const isLineStyle = (v: unknown): v is LineStyle =>
  v === 'solid' || v === 'double' || v === 'dotted' || v === 'dashed' || v === 'wavy';

// Emphasis marks (着重号) in ODF's style:text-emphasize spelling, "<shape> <position>".
export type Emphasis = `${'dot' | 'circle' | 'disc' | 'accent'} ${'above' | 'below'}`;
const EMPHASIS_CSS: Record<string, string> = { dot: 'filled dot', circle: 'open circle', disc: 'filled circle', accent: 'filled sesame' };
export const isEmphasis = (v: unknown): v is Emphasis =>
  typeof v === 'string' && /^(dot|circle|disc|accent) (above|below)$/.test(v);

export function emphasisCss(e: Emphasis): string {
  const [shape, pos] = e.split(' ');
  return `text-emphasis: ${EMPHASIS_CSS[shape]}; text-emphasis-position: ${pos === 'below' ? 'under' : 'over'} right`;
}

// Word's w:em as LibreOffice maps it: below is only ever a dot there, and a disc has no
// counterpart, so it goes out as a dot.
const WORD_EMPHASIS: Record<string, Emphasis> = { dot: 'dot above', underDot: 'dot below', circle: 'circle above', comma: 'accent above' };
export const emphasisFromWord = (v: string | null): Emphasis | null => (v && WORD_EMPHASIS[v]) || null;
export function emphasisToWord(e: Emphasis): string {
  if (e.endsWith('below')) return 'underDot';
  return Object.keys(WORD_EMPHASIS).find((k) => WORD_EMPHASIS[k] === e) ?? 'dot';
}

function emphasisFromStyle(el: HTMLElement): Emphasis | null {
  const style = el.style.getPropertyValue('text-emphasis-style') || el.style.getPropertyValue('text-emphasis');
  const shape = Object.keys(EMPHASIS_CSS).find((k) => EMPHASIS_CSS[k] === style.trim());
  if (!shape) return null;
  return `${shape} ${el.style.getPropertyValue('text-emphasis-position').startsWith('under') ? 'below' : 'above'}` as Emphasis;
}

// Outline, shadow and relief as LibreOffice paints them: a hairline in the text colour
// around a paper-coloured fill; a shadow 1/24 of the line height down-right, light grey
// under black text and black under any other; a 1px edge, which turns black text white.
export type Relief = 'embossed' | 'engraved';

// The parametrised effects (DOCX w14): a coloured outline around the filled letter, a
// shadow with offset, blur and opacity, and a glow. alpha is opacity, 0–1.
export type TextOutline = { color: string; widthPt: number };
export const OUTLINE_WIDTH_PT = { min: 0.1, max: 20 };
export type TextShadow = { color: string; alpha: number; dxPt: number; dyPt: number; blurPt: number };
export type TextGlow = { color: string; alpha: number; radiusPt: number };
// A w14 element the editor does not draw (reflection, 3D, a gradient fill, a shadow it
// can only approximate), kept as a tree that the DOCX export serializes again.
export type W14El = { n: string; a?: Record<string, string>; c?: W14El[] };

export type TextEffectAttrs = {
  outline?: boolean | null; // false = a run switching its style's off
  shadow?: boolean | null;
  relief?: Relief | 'none' | null;
  color?: string | null;
  textOutline?: TextOutline | null;
  textShadow?: TextShadow | null;
  textGlow?: TextGlow | null;
  textFxRaw?: W14El[] | null;
};
export const isRelief = (v: unknown): v is Relief | 'none' => v === 'embossed' || v === 'engraved' || v === 'none';

const hex6 = (v: unknown): string | null => {
  const c = normalizeColor(v);
  return c && /^#[0-9A-F]{6}$/.test(c) ? c : null;
};
const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 100) / 100)) : null;
const obj = (v: unknown): Record<string, unknown> | null => {
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
};

export function normalizeTextOutline(v: unknown): TextOutline | null {
  const o = obj(v); if (!o) return null;
  const color = hex6(o.color), widthPt = num(o.widthPt, OUTLINE_WIDTH_PT.min, OUTLINE_WIDTH_PT.max);
  return color && widthPt != null ? { color, widthPt } : null;
}
export function normalizeTextShadow(v: unknown): TextShadow | null {
  const o = obj(v); if (!o) return null;
  const color = hex6(o.color), alpha = num(o.alpha ?? 1, 0, 1);
  const dxPt = num(o.dxPt ?? 0, -100, 100), dyPt = num(o.dyPt ?? 0, -100, 100), blurPt = num(o.blurPt ?? 0, 0, 100);
  return color && alpha != null && dxPt != null && dyPt != null && blurPt != null ? { color, alpha, dxPt, dyPt, blurPt } : null;
}
export function normalizeTextGlow(v: unknown): TextGlow | null {
  const o = obj(v); if (!o) return null;
  const color = hex6(o.color), alpha = num(o.alpha ?? 1, 0, 1), radiusPt = num(o.radiusPt, 0.1, 150);
  return color && alpha != null && radiusPt != null ? { color, alpha, radiusPt } : null;
}

// Names, size and depth are bounded, so a pasted or stored tree only ever becomes w14 markup.
const XML_NAME = /^[A-Za-z][A-Za-z0-9]{0,40}$/;
function normalizeEl(v: unknown, depth: number, budget: { n: number }): W14El | null {
  const o = obj(v);
  if (!o || typeof o.n !== 'string' || !XML_NAME.test(o.n) || depth > 8 || --budget.n < 0) return null;
  const out: W14El = { n: o.n };
  const attrs = Object.entries(obj(o.a) ?? {}).filter(([k, val]) => XML_NAME.test(k) && typeof val === 'string' && val.length < 200);
  if (attrs.length) out.a = Object.fromEntries(attrs) as Record<string, string>;
  const kids = Array.isArray(o.c) ? o.c.map((k) => normalizeEl(k, depth + 1, budget)).filter((k): k is W14El => !!k) : [];
  if (kids.length) out.c = kids;
  return out;
}
export function normalizeTextFxRaw(v: unknown): W14El[] | null {
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  if (!Array.isArray(v)) return null;
  const budget = { n: 400 };
  const out = v.map((e) => normalizeEl(e, 0, budget)).filter((e): e is W14El => !!e);
  return out.length ? out : null;
}

// The kept element each parametrised effect stands for, dropped when the editor sets it.
export const RAW_OF = { textOutline: 'textOutline', textShadow: 'shadow', textGlow: 'glow' } as const;

const OFF = '0 0 transparent';
const RING = ['-1px -1px', '0 -1px', '1px -1px', '1px 0', '1px 1px', '0 1px', '-1px 1px', '-1px 0'].map((o) => `${o} currentcolor`).join(', ');
const PAPER = 'var(--color-page-bg, #fff)';

/** How the w14 parameters become CSS: read off the [MS-DOCX] definitions, not measured
 *  against Word yet (docs/architecture/formatting.md lists what to recheck). */
export const FX_CSS = {
  // w14:algn="ctr": half the line lies outside the letter, the inner half covers the fill.
  outlineOutside: 0.5,
  outlineMinPt: 0.375, // 0.5px, so a hairline still shows
  // Copies this far apart, along and across the band: a thin stroke or serif shifted further
  // than its own width shows as a comb. Past the caps the inner rings thin out first.
  outlineStepPt: 0.35,
  outlineOuterCopies: 160,
  outlineMaxCopies: 200,
  shadowBlur: 1, // text-shadow blur per pt of w14:blurRad
  glowLayers: [0.25, 0.5, 1], // stacked blurs per pt of w14:rad: dense near the letter, fading out to it
};

const rgba = (hex: string, alpha: number) =>
  alpha >= 1 ? hex : `${hex}${Math.round(Math.max(0, alpha) * 255).toString(16).padStart(2, '0')}`;
// The outline as concentric rings of copies: the outer one dense enough that no serif's
// tip shows through its gaps, inner ones filling the band as densely as the cap allows.
function outlineOffsets(r: number): [number, number][] {
  const ring = (rho: number, n: number, turn: number) => Array.from({ length: n }, (_, i): [number, number] => {
    const a = ((i + turn) * 2 * Math.PI) / n;
    return [Math.cos(a) * rho, Math.sin(a) * rho];
  });
  const { outlineStepPt: fine, outlineOuterCopies, outlineMaxCopies } = FX_CSS;
  const outer = ring(r, Math.min(outlineOuterCopies, Math.max(8, Math.ceil((2 * Math.PI * r) / fine))), 0);
  for (let step = fine; ; step *= 1.1) {
    const inner: [number, number][] = [];
    for (let k = 1; r - k * step > step / 2; k++) inner.push(...ring(r - k * step, Math.max(8, Math.ceil((2 * Math.PI * (r - k * step)) / step)), (k % 2) / 2));
    if (outer.length + inner.length <= outlineMaxCopies) return outer.concat(inner);
  }
}
function outlineRing(o: TextOutline): string {
  const r = Math.max(o.widthPt * FX_CSS.outlineOutside, FX_CSS.outlineMinPt);
  return outlineOffsets(r).map(([x, y]) => `${+x.toFixed(2)}pt ${+y.toFixed(2)}pt ${o.color}`).join(', ');
}
const shadowCss = (s: TextShadow) => `${s.dxPt}pt ${s.dyPt}pt ${+(s.blurPt * FX_CSS.shadowBlur).toFixed(2)}pt ${rgba(s.color, s.alpha)}`;
const glowCss = (g: TextGlow) => FX_CSS.glowLayers.map((f) => `0 0 ${+(g.radiusPt * f).toFixed(2)}pt ${rgba(g.color, g.alpha)}`).join(', ');

// LibreOffice's colour rules: relief whitens exactly black, a shadow is grey under any dark colour.
function rgb(color: string | null | undefined): [number, number, number] | null {
  const c = normalizeColor(color ?? null);
  const m = c && /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}
const isBlack = (color: string | null | undefined) => { const c = rgb(color); return !c || c.every((v) => v === 0); };
const isDark = (color: string | null | undefined) => { const c = rgb(color); return !c || (c[0] * 29 + c[1] * 151 + c[2] * 76) >> 8 < 8; };

/** CSS for the effects. Each sets its own variable, so a run's outline and its style's shadow combine;
 *  fill and shadows also ride --fx-fill/--fx-text-shadow, with which editor.css's highlights repaint the text. */
export function effectCss(a: TextEffectAttrs): string {
  const out: string[] = [];
  if (a.relief === 'embossed' || a.relief === 'engraved') {
    const off = a.relief === 'embossed' ? '1px 1px' : '-1px -1px';
    if (isBlack(a.color)) out.push(`--fx-text-shadow: ${off} var(--color-page-text, #000)`, `--fx-fill: ${PAPER}`);
    else out.push(`--fx-text-shadow: ${off} #c0c0c0`, '--fx-fill: currentcolor');
    out.push('text-shadow: var(--fx-text-shadow)', '-webkit-text-fill-color: var(--fx-fill)');
    return out.join('; ');
  }
  const outline = normalizeTextOutline(a.textOutline), shadow = normalizeTextShadow(a.textShadow), glow = normalizeTextGlow(a.textGlow);
  if (outline) out.push(`--fx-outline: ${outlineRing(outline)}`, '--fx-fill: currentcolor');
  else if (a.outline === true) out.push(`--fx-outline: ${RING}`, `--fx-fill: ${PAPER}`);
  else if (a.outline === false) out.push(`--fx-outline: ${OFF}`, '--fx-fill: currentcolor');
  if (shadow) out.push(`--fx-shadow: ${shadowCss(shadow)}`);
  else if (a.shadow === true) out.push(`--fx-shadow: 0.05em 0.05em ${isDark(a.color) ? '#c0c0c0' : '#000'}`);
  else if (a.shadow === false) out.push(`--fx-shadow: ${OFF}`);
  if (glow) out.push(`--fx-glow: ${glowCss(glow)}`);
  if (out.length || a.relief === 'none') {
    out.push(`--fx-text-shadow: var(--fx-outline, ${OFF}), var(--fx-shadow, ${OFF}), var(--fx-glow, ${OFF})`, 'text-shadow: var(--fx-text-shadow)',
      '-webkit-text-fill-color: var(--fx-fill, currentcolor)');
  }
  return out.join('; ');
}

function capsFromStyle(el: HTMLElement): CapsMode | null {
  if (el.style.fontVariantCaps === 'small-caps' || el.style.fontVariant === 'small-caps') return 'smallCaps';
  const t = el.style.textTransform;
  return isCaps(t) ? t : null;
}

const toggleFrom = (v: string | null) => (v === 'true' ? true : v === 'false' ? false : null);

const DRAWN = ['outline', 'shadow', 'relief', 'textOutline', 'textShadow', 'textGlow'] as const;
type Drawn = typeof DRAWN[number];
const PARAM_NORMALIZE = { textOutline: normalizeTextOutline, textShadow: normalizeTextShadow, textGlow: normalizeTextGlow };
const dataName = (name: string) => `data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

// The style goes on the first effect attribute present, so it is written once per span.
function effectHTML(a: Record<string, unknown>, name: Drawn): Record<string, string> {
  const v = a[name];
  if (v == null || (name === 'relief' && !isRelief(v))) return {};
  const value = name in PARAM_NORMALIZE ? PARAM_NORMALIZE[name as keyof typeof PARAM_NORMALIZE](v) : v;
  if (value == null) return {};
  const out: Record<string, string> = { [dataName(name)]: typeof value === 'object' ? JSON.stringify(value) : String(value) };
  const first = DRAWN.find((k) => a[k] != null);
  if (first === name) out.style = effectCss(a as TextEffectAttrs);
  return out;
}

/** The effects as <style:text-properties> attributes; off values switch a style's off. ODF has
 *  none of the parametrised ones: a shadow falls back to the plain one, outline and glow go. */
export function effectsToOdf(a: TextEffectAttrs): Record<string, string> {
  const out: Record<string, string> = {};
  if (a.outline != null) out['style:text-outline'] = String(a.outline);
  if (normalizeTextShadow(a.textShadow)) out['fo:text-shadow'] = '1pt 1pt';
  else if (a.shadow != null) out['fo:text-shadow'] = a.shadow ? '1pt 1pt' : 'none';
  if (isRelief(a.relief)) out['style:font-relief'] = a.relief;
  return out;
}

/** The attrs a change of effects leaves on a run. Relief excludes everything else, plain and
 *  parametrised outline (and shadow) exclude each other, and an effect set or cleared here
 *  drops the w14 element kept for it. A change naming `textFxRaw` sets it outright. */
export function effectUpdate(cur: TextEffectAttrs, change: TextEffectAttrs): TextEffectAttrs {
  const next: TextEffectAttrs = { ...change };
  if (change.relief && change.relief !== 'none') {
    return { ...next, outline: null, shadow: null, textOutline: null, textShadow: null, textGlow: null, textFxRaw: null };
  }
  const drop = new Set<string>();
  for (const [plain, param] of [['outline', 'textOutline'], ['shadow', 'textShadow']] as const) {
    if (change[plain]) { next[param] = null; drop.add(RAW_OF[param]); }
    if (param in change) { drop.add(RAW_OF[param]); if (change[param]) next[plain] = null; }
  }
  if ('textGlow' in change) drop.add(RAW_OF.textGlow);
  if (DRAWN.some((k) => k !== 'relief' && change[k])) next.relief = null;
  if (!('textFxRaw' in change) && drop.size) {
    const kept = (normalizeTextFxRaw(cur.textFxRaw) ?? []).filter((e) => !drop.has(e.n));
    next.textFxRaw = kept.length ? kept : null;
  }
  return next;
}

/** Whether a run draws any effect: the menu button's active state in both chromes. */
export const hasTextEffect = (a: TextEffectAttrs) => !!(a.outline || a.shadow || a.relief === 'embossed' || a.relief === 'engraved'
  || a.textOutline || a.textShadow || a.textGlow);

// The gallery: combinations the editor draws exactly. A tile is direct formatting.
export type TextEffectPreset = { color: string; textOutline?: TextOutline; textShadow?: TextShadow; textGlow?: TextGlow };
const SOFT: TextShadow = { color: '#000000', alpha: 0.4, dxPt: 2.12, dyPt: 2.12, blurPt: 4 };
export const TEXT_EFFECT_PRESETS: TextEffectPreset[] = [
  { color: '#000000', textShadow: SOFT },
  { color: '#4472C4', textShadow: SOFT },
  { color: '#C00000', textShadow: { color: '#000000', alpha: 0.6, dxPt: 0, dyPt: 2, blurPt: 1 } },
  { color: '#404040', textShadow: { color: '#000000', alpha: 0.35, dxPt: 0, dyPt: 0, blurPt: 5 } },
  { color: '#FFFFFF', textOutline: { color: '#4472C4', widthPt: 1 } },
  { color: '#FFFFFF', textOutline: { color: '#000000', widthPt: 1 }, textShadow: SOFT },
  { color: '#ED7D31', textOutline: { color: '#843C0C', widthPt: 0.75 } },
  { color: '#1F3864', textOutline: { color: '#9DC3E6', widthPt: 1.5 } },
  { color: '#000000', textGlow: { color: '#FFC000', alpha: 0.6, radiusPt: 8 } },
  { color: '#4472C4', textGlow: { color: '#4472C4', alpha: 0.4, radiusPt: 5 } },
  { color: '#70AD47', textGlow: { color: '#A9D18E', alpha: 0.6, radiusPt: 8 } },
  { color: '#FFFFFF', textOutline: { color: '#2F5597', widthPt: 0.5 }, textGlow: { color: '#2F5597', alpha: 0.6, radiusPt: 5 } },
];
export const presetAttrs = (p: TextEffectPreset): TextEffectAttrs & { color: string } => ({
  color: p.color, outline: null, shadow: null, relief: null, textFxRaw: null,
  textOutline: p.textOutline ?? null, textShadow: p.textShadow ?? null, textGlow: p.textGlow ?? null,
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textEffects: {
      setTextEffect: (name: 'outline' | 'shadow' | 'relief', value: boolean | Relief | null) => ReturnType;
      setTextOutline: (value: TextOutline | null) => ReturnType;
      setTextShadow: (value: TextShadow | null) => ReturnType;
      setTextGlow: (value: TextGlow | null) => ReturnType;
      applyTextEffectPreset: (preset: TextEffectPreset) => ReturnType;
      unsetTextEffects: () => ReturnType;
    };
  }
}

// Each run gets its own update, since what it keeps of its w14 elements is its own.
const updateEffects = (change: TextEffectAttrs): Command => ({ tr, state, dispatch }) => {
  const type = state.schema.marks.textStyle;
  if (!type) return false;
  if (!dispatch) return true;
  const { selection } = state;
  if (selection.empty) {
    const cur = type.isInSet(state.storedMarks ?? selection.$from.marks());
    tr.addStoredMark(type.create({ ...cur?.attrs, ...effectUpdate(cur?.attrs ?? {}, change) }));
    return true;
  }
  for (const { $from, $to } of selection.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (!node.isText) return;
      const cur = type.isInSet(node.marks);
      tr.addMark(Math.max(pos, $from.pos), Math.min(pos + node.nodeSize, $to.pos),
        type.create({ ...cur?.attrs, ...effectUpdate(cur?.attrs ?? {}, change) }));
    });
  }
  return true;
};

// Letter case and vertical offset ride the TextStyle mark, like colour and size:
// they are properties of the run, not lines drawn over it.
export const TextEffects = Extension.create({
  name: 'textEffects',

  addOptions() {
    return { types: ['textStyle'] };
  },

  addCommands() {
    const run = (change: TextEffectAttrs) => ({ chain }: { chain: () => ChainedCommands }) =>
      chain().command(updateEffects(change)).removeEmptyTextStyle().run();
    return {
      setTextEffect: (name, value) => run({ [name]: value || null }),
      setTextOutline: (value) => run({ textOutline: value }),
      setTextShadow: (value) => run({ textShadow: value }),
      setTextGlow: (value) => run({ textGlow: value }),
      applyTextEffectPreset: (preset) => run(presetAttrs(preset)),
      unsetTextEffects: () => run({ outline: null, shadow: null, relief: null, textOutline: null, textShadow: null, textGlow: null, textFxRaw: null }),
    };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          caps: {
            default: null,
            parseHTML: element => capsFromStyle(element as HTMLElement),
            renderHTML: attributes =>
              isCaps(attributes.caps) ? { style: CAPS_CSS[attributes.caps] } : {},
          },
          // pt above the baseline (negative = below), independent of sub/superscript.
          textPosition: {
            default: null,
            parseHTML: element => {
              const v = parseFloat((element as HTMLElement).style.verticalAlign);
              return Number.isFinite(v) && v !== 0 ? v : null;
            },
            renderHTML: attributes =>
              typeof attributes.textPosition === 'number' && attributes.textPosition
                ? { style: `vertical-align: ${attributes.textPosition}pt` }
                : {},
          },
          emphasis: {
            default: null,
            parseHTML: element => emphasisFromStyle(element as HTMLElement),
            renderHTML: attributes => (isEmphasis(attributes.emphasis) ? { style: emphasisCss(attributes.emphasis) } : {}),
          },
          // The CSS is drawn once from all three plus the colour (effectCss); each keeps a
          // data attribute so pasted HTML reads back what it was.
          outline: {
            default: null,
            parseHTML: element => toggleFrom(element.getAttribute('data-outline')),
            renderHTML: attributes => effectHTML(attributes, 'outline'),
          },
          shadow: {
            default: null,
            parseHTML: element => toggleFrom(element.getAttribute('data-shadow')),
            renderHTML: attributes => effectHTML(attributes, 'shadow'),
          },
          relief: {
            default: null,
            parseHTML: element => {
              const v = element.getAttribute('data-relief');
              return isRelief(v) ? v : null;
            },
            renderHTML: attributes => effectHTML(attributes, 'relief'),
          },
          ...Object.fromEntries((['textOutline', 'textShadow', 'textGlow'] as const).map((name) => [name, {
            default: null,
            parseHTML: (element: HTMLElement) => PARAM_NORMALIZE[name](element.getAttribute(dataName(name))),
            renderHTML: (attributes: Record<string, unknown>) => effectHTML(attributes, name),
          }])),
          // Drawn by nobody, carried for the DOCX export.
          textFxRaw: {
            default: null,
            parseHTML: element => normalizeTextFxRaw(element.getAttribute('data-text-fx-raw')),
            renderHTML: attributes => {
              const raw = normalizeTextFxRaw(attributes.textFxRaw);
              return raw ? { 'data-text-fx-raw': JSON.stringify(raw) } : {};
            },
          },
        },
      },
    ];
  },
});

// The <u> element draws the line, so its style and colour belong on that mark.
export const UnderlineStyled = Underline.extend({
  addAttributes() {
    return {
      lineStyle: {
        default: null,
        parseHTML: el => {
          const s = (el as HTMLElement).style.textDecorationStyle;
          return isLineStyle(s) && s !== 'solid' ? s : null;
        },
        renderHTML: attrs => (isLineStyle(attrs.lineStyle) ? { style: `text-decoration-style: ${attrs.lineStyle}` } : {}),
      },
      lineColor: {
        default: null,
        parseHTML: el => (el as HTMLElement).style.textDecorationColor || null,
        renderHTML: attrs => {
          const color = normalizeColor(attrs.lineColor);
          return color ? { style: `text-decoration-color: ${color}` } : {};
        },
      },
    };
  },
});

export const StrikeStyled = Strike.extend({
  addAttributes() {
    return {
      lineStyle: {
        default: null,
        parseHTML: el => {
          const s = (el as HTMLElement).style.textDecorationStyle;
          return isLineStyle(s) && s !== 'solid' ? s : null;
        },
        renderHTML: attrs => (isLineStyle(attrs.lineStyle) ? { style: `text-decoration-style: ${attrs.lineStyle}` } : {}),
      },
    };
  },
});
