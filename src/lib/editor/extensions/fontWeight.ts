import { Extension } from '@tiptap/core';
import '@tiptap/extension-text-style';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontWeight: {
      setFontWeight: (weight: string) => ReturnType;
      unsetFontWeight: () => ReturnType;
    };
  }
}

// Adds a `fontWeight` attr on the TextStyle mark, settable as an inline style
// (e.g. 'normal' to un-bold a heading without changing the node type).
export const FontWeight = Extension.create({
  name: 'fontWeight',

  addOptions() {
    return { types: ['textStyle'] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontWeight: {
            default: null,
            parseHTML: element =>
              element.style.fontWeight?.replace(/['"]+/g, '') || null,
            renderHTML: attributes => {
              if (!attributes.fontWeight) return {};
              return { style: `font-weight: ${attributes.fontWeight}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontWeight:
        (fontWeight: string) =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontWeight }).run(),

      unsetFontWeight:
        () =>
        ({ chain }) =>
          chain()
            .setMark('textStyle', { fontWeight: null })
            .removeEmptyTextStyle()
            .run(),
    };
  },
});
