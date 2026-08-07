import { Extension } from '@tiptap/core';
import { singleLineHeight } from '../../styles/styleSheet';

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
            // A proportional spacing multiplies the font's natural line height, CSS the
            // font size — so it is scaled by the paragraph mark's family (blockFontSize).
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.lineHeight) return {};
              const raw = String(attributes.lineHeight);
              const num = parseFloat(raw);
              const family = attributes.fontFamily ? String(attributes.fontFamily) : undefined;
              const rendered = isNaN(num) ? raw : `${Math.round(num * singleLineHeight(family) * 1000) / 1000}`;
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
