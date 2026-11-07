import Underline from '@tiptap/extension-underline';
import Strike from '@tiptap/extension-strike';
import { Extension } from '@tiptap/core';
import '@tiptap/extension-text-style';
import { normalizeColor } from '../../utils/color';

// The character effects beyond bold/italic that both Word and LibreOffice carry and
// CSS can draw: letter case, a raised or lowered run, emphasis marks, and the line
// styles of the underline and strikethrough marks.

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

function capsFromStyle(el: HTMLElement): CapsMode | null {
  if (el.style.fontVariantCaps === 'small-caps' || el.style.fontVariant === 'small-caps') return 'smallCaps';
  const t = el.style.textTransform;
  return isCaps(t) ? t : null;
}

// Letter case and vertical offset ride the TextStyle mark, like colour and size:
// they are properties of the run, not lines drawn over it.
export const TextEffects = Extension.create({
  name: 'textEffects',

  addOptions() {
    return { types: ['textStyle'] };
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
