import { Extension } from '@tiptap/core';
import '@tiptap/extension-text-style';

// The language of a paragraph and of a run, the two levels LibreOffice and Word both
// carry (ODF fo:language/fo:country, Word w:lang). The value is the full tag ('en-US'),
// not one of our dictionary codes: a document in a language we have no dictionary for
// must still save the language it came with.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    language: {
      /** The paragraph's language; null falls back to the document's. */
      setBlockLanguage: (tag: string | null) => ReturnType;
      /** The selection's language, as a run. */
      setRunLanguage: (tag: string | null) => ReturnType;
    };
  }
}

// A real `lang` attribute, not a data-*: CSS hyphenation and the browser's own spell
// check both read it.
const blockAttr = {
  lang: {
    default: null as string | null,
    parseHTML: (element: HTMLElement) => element.getAttribute('lang') || null,
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.lang ? { lang: String(attributes.lang) } : {},
  },
};

export const Language = Extension.create({
  name: 'language',

  addOptions() {
    return {
      types: ['paragraph', 'heading'] as string[],
    };
  },

  addGlobalAttributes() {
    return [
      { types: this.options.types, attributes: blockAttr },
      { types: ['textStyle'], attributes: blockAttr },
    ];
  },

  addCommands() {
    return {
      setBlockLanguage: (tag) => ({ commands }) =>
        this.options.types.map((type) => commands.updateAttributes(type, { lang: tag })).some((r) => r),

      setRunLanguage: (tag) => ({ chain }) =>
        chain().setMark('textStyle', { lang: tag }).removeEmptyTextStyle().run(),
    };
  },
});
