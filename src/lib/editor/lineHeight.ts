import { Extension } from '@tiptap/core';

// ODF/LibreOffice line spacing is a multiple of the font's NATURAL line height
// (Liberation Serif ≈ 1.15× em), not of the font size. CSS unitless line-height
// multiplies the font size, so to make the on-screen box match what LibreOffice
// renders for the same "Single"/"1.5"/"Double" value, we scale by this ratio.
// Keep in sync with the base line-height in editor.css (.paper .tiptap).
const LINE_HEIGHT_RATIO = 1.15;

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
