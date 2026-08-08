import Underline from '@tiptap/extension-underline';
import Strike from '@tiptap/extension-strike';
import { Extension } from '@tiptap/core';
import '@tiptap/extension-text-style';

// The character effects beyond bold/italic that both Word and LibreOffice carry and
// CSS can draw: letter case, a raised or lowered run, and the line styles of the
// underline and strikethrough marks.

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
        renderHTML: attrs => (attrs.lineColor ? { style: `text-decoration-color: ${attrs.lineColor}` } : {}),
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
