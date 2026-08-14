import { Extension } from '@tiptap/core';

// A block's own base direction (ODF style:writing-mode, Word w:bidi), overriding the
// page's (storage/writingMode.ts) — what a quoted Hebrew or Arabic paragraph in a
// left-to-right document needs. `dir` on the element is the whole rendering: it resolves
// the bidi run order and `text-align: start` follows it, so an unaligned block flips.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textDirection: {
      /** 'ltr'/'rtl' pin the direction; null falls back to the page's. */
      setTextDirection: (dir: 'ltr' | 'rtl' | null) => ReturnType;
    };
  }
}

export const TextDirection = Extension.create({
  name: 'textDirection',

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
          dir: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const d = element.getAttribute('dir');
              return d === 'rtl' || d === 'ltr' ? d : null;
            },
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.dir === 'rtl' || attributes.dir === 'ltr' ? { dir: String(attributes.dir) } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setTextDirection: (dir) => ({ commands }) =>
        this.options.types
          .map((type) => commands.updateAttributes(type, { dir }))
          .some((r) => r),
    };
  },
});
