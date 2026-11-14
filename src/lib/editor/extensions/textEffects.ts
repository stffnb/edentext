import Underline from '@tiptap/extension-underline';
import Strike from '@tiptap/extension-strike';
import { Extension } from '@tiptap/core';
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
export type TextEffectAttrs = {
  outline?: boolean | null; // false = a run switching its style's off
  shadow?: boolean | null;
  relief?: Relief | 'none' | null;
  color?: string | null;
};
export const isRelief = (v: unknown): v is Relief | 'none' => v === 'embossed' || v === 'engraved' || v === 'none';
const OFF = '0 0 transparent';
const RING = ['-1px -1px', '0 -1px', '1px -1px', '1px 0', '1px 1px', '0 1px', '-1px 1px', '-1px 0'].map((o) => `${o} currentcolor`).join(', ');
const PAPER = 'var(--color-page-bg, #fff)';

// LibreOffice's colour rules: relief whitens exactly black, a shadow is grey under any dark colour.
function rgb(color: string | null | undefined): [number, number, number] | null {
  const c = normalizeColor(color ?? null);
  const m = c && /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}
const isBlack = (color: string | null | undefined) => { const c = rgb(color); return !c || c.every((v) => v === 0); };
const isDark = (color: string | null | undefined) => { const c = rgb(color); return !c || (c[0] * 29 + c[1] * 151 + c[2] * 76) >> 8 < 8; };

/** CSS for the three effects. Each sets its own variable, so a run's outline and its style's shadow combine;
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
  if (a.outline === true) out.push(`--fx-outline: ${RING}`, `--fx-fill: ${PAPER}`);
  else if (a.outline === false) out.push(`--fx-outline: ${OFF}`, '--fx-fill: currentcolor');
  if (a.shadow === true) out.push(`--fx-shadow: 0.05em 0.05em ${isDark(a.color) ? '#c0c0c0' : '#000'}`);
  else if (a.shadow === false) out.push(`--fx-shadow: ${OFF}`);
  if (out.length || a.relief === 'none') {
    out.push(`--fx-text-shadow: var(--fx-outline, ${OFF}), var(--fx-shadow, ${OFF})`, 'text-shadow: var(--fx-text-shadow)',
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

// The style goes on the first effect attribute present, so it is written once per span.
function effectHTML(a: Record<string, unknown>, name: 'outline' | 'shadow' | 'relief'): Record<string, string> {
  const v = a[name];
  if (v == null || (name === 'relief' && !isRelief(v))) return {};
  const out: Record<string, string> = { [`data-${name}`]: String(v) };
  const first = (['outline', 'shadow', 'relief'] as const).find((k) => a[k] != null);
  if (first === name) out.style = effectCss(a as TextEffectAttrs);
  return out;
}

/** The three effects as <style:text-properties> attributes; off values switch a style's off. */
export function effectsToOdf(a: TextEffectAttrs): Record<string, string> {
  const out: Record<string, string> = {};
  if (a.outline != null) out['style:text-outline'] = String(a.outline);
  if (a.shadow != null) out['fo:text-shadow'] = a.shadow ? '1pt 1pt' : 'none';
  if (isRelief(a.relief)) out['style:font-relief'] = a.relief;
  return out;
}

/** The patch that sets one effect: relief excludes outline and shadow, as in both programs. */
export function textEffectPatch(name: 'outline' | 'shadow' | 'relief', value: boolean | Relief | null): TextEffectAttrs {
  if (name === 'relief') return value ? { relief: value as Relief, outline: null, shadow: null } : { relief: null };
  return value ? { [name]: true, relief: null } : { [name]: null };
}

/** The menu's entries (both chromes); `key` names the label in `ribbon.textEffects`. */
export const TEXT_EFFECT_ITEMS = [
  { key: 'outline', name: 'outline', value: true },
  { key: 'shadow', name: 'shadow', value: true },
  { key: 'embossed', name: 'relief', value: 'embossed' },
  { key: 'engraved', name: 'relief', value: 'engraved' },
] as const;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textEffects: {
      setTextEffect: (name: 'outline' | 'shadow' | 'relief', value: boolean | Relief | null) => ReturnType;
      unsetTextEffects: () => ReturnType;
    };
  }
}

// Letter case and vertical offset ride the TextStyle mark, like colour and size:
// they are properties of the run, not lines drawn over it.
export const TextEffects = Extension.create({
  name: 'textEffects',

  addOptions() {
    return { types: ['textStyle'] };
  },

  addCommands() {
    return {
      setTextEffect: (name, value) => ({ chain }) =>
        chain().setMark('textStyle', textEffectPatch(name, value)).removeEmptyTextStyle().run(),
      unsetTextEffects: () => ({ chain }) =>
        chain().setMark('textStyle', { outline: null, shadow: null, relief: null }).removeEmptyTextStyle().run(),
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
