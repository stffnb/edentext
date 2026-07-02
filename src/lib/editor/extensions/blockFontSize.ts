import { Extension } from '@tiptap/core';

// Font size of the paragraph mark (Word's w:pPr/w:rPr sz, ODF paragraph
// fo:font-size): governs an empty line's height and the size of text typed into it.
// A CSS length (e.g. "22pt") rendered as font-size on the block; null = style default.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockFontSize: {
      setBlockFontSize: (size: string | null) => ReturnType;
    };
  }
}

export const BlockFontSize = Extension.create({
  name: 'blockFontSize',

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
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute('data-block-font-size') || null,
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.fontSize) return {};
              const size = String(attributes.fontSize);
              return {
                'data-block-font-size': size,
                style: `font-size: ${size}`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setBlockFontSize: (size: string | null) => ({ commands }) => {
        return this.options.types
          .map((type) => commands.updateAttributes(type, { fontSize: size }))
          .some((r) => r);
      },
    };
  },
});
