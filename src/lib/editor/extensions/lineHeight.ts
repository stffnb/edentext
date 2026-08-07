import { Extension } from '@tiptap/core';
import { DEFAULT_SINGLE_LINE_HEIGHT } from '../../styles/styleSheet';

// ODF line spacing multiplies the font's natural line height, CSS unitless
// line-height the font size. A node attr knows no family, so it takes the default.
const LINE_HEIGHT_RATIO = DEFAULT_SINGLE_LINE_HEIGHT;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    lineHeight: {
      setLineHeight: (lineHeight: string) => ReturnType;
      unsetLineHeight: () => ReturnType;
    };
  }
}

export const LineHeight = Extension.create({
  name: 'lineHeight',

  addOptions() {
    return {
      types: ['paragraph', 'heading'] as string[],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute('data-line-height') || null,
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.lineHeight) return {};
              const raw = String(attributes.lineHeight);
              const num = parseFloat(raw);
              const rendered = isNaN(num) ? raw : `${num * LINE_HEIGHT_RATIO}`;
              return {
                'data-line-height': raw,
                style: `line-height: ${rendered}`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineHeight: (lineHeight: string) => ({ commands }) => {
        return this.options.types
          .map((type) => commands.updateAttributes(type, { lineHeight }))
          .some((r) => r);
      },
      unsetLineHeight: () => ({ commands }) => {
        return this.options.types
          .map((type) => commands.resetAttributes(type, 'lineHeight'))
          .some((r) => r);
      },
    };
  },
});
