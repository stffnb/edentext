import { Extension } from '@tiptap/core';
import { cssFontFamily, singleLineHeight } from '../../styles/styleSheet';

// Font of the paragraph mark (Word's w:pPr/w:rPr, ODF the paragraph's own text
// properties): the block's CSS strut, so it sets every line's minimum height and what
// text typed into an empty one looks like. Size is a CSS length; null = style default.

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
          fontFamily: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute('data-block-font-family') || null,
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.fontFamily) return {};
              const family = String(attributes.fontFamily);
              // Single spacing is this family's natural line height. An explicit line
              // spacing already scales by it (lineHeight.ts), so it wins outright.
              const lh = attributes.lineHeight ? '' : `; line-height: ${singleLineHeight(family)}`;
              return {
                'data-block-font-family': family,
                style: `font-family: ${cssFontFamily(family)}${lh}`,
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
