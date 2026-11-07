import { Extension } from '@tiptap/core';
import '@tiptap/extension-text-style';
import { normalizeColor } from '../../utils/color';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontColor: {
      setColor: (color: string) => ReturnType;
      unsetColor: () => ReturnType;
    };
  }
}

// Adds a `color` attr on the TextStyle mark, plus a `data-color` marker so
// theme CSS (e.g. allBlack) can target only color-bearing spans.
export const FontColor = Extension.create({
  name: 'fontColor',

  addOptions() {
    return { types: ['textStyle'] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          color: {
            default: null,
            parseHTML: element => element.style.color || null,
            renderHTML: attributes => {
              const color = normalizeColor(attributes.color);
              if (!color) return {};
              return {
                style: `--font-color: ${color}; color: ${color}`,
                'data-color': color,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setColor:
        (color: string) =>
        ({ chain }) =>
          chain().setMark('textStyle', { color }).run(),

      unsetColor:
        () =>
        ({ chain }) =>
          chain()
            .setMark('textStyle', { color: null })
            .removeEmptyTextStyle()
            .run(),
    };
  },
});
