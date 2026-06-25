import { Extension } from '@tiptap/core';

// Manual page break before a paragraph/heading, stored as breakBefore: 'page' | null and
// rendered as data-page-break-before. Round-trips to ODF fo:break-before="page" (import
// blockAttrs, export replace/applyPageBreaks); pageBreaks.ts forces it to the next page.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      setPageBreakBefore: () => ReturnType;
      unsetPageBreakBefore: () => ReturnType;
      togglePageBreakBefore: () => ReturnType;
    };
  }
}

export const PageBreak = Extension.create({
  name: 'pageBreak',

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
          breakBefore: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute('data-page-break-before') === 'page' ? 'page' : null,
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.breakBefore !== 'page') return {};
              return { 'data-page-break-before': 'page' };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setPageBreakBefore: () => ({ commands }) =>
        this.options.types
          .map((type) => commands.updateAttributes(type, { breakBefore: 'page' }))
          .some((r) => r),
      unsetPageBreakBefore: () => ({ commands }) =>
        this.options.types
          .map((type) => commands.updateAttributes(type, { breakBefore: null }))
          .some((r) => r),
      togglePageBreakBefore: () => ({ editor, commands }) => {
        const current =
          editor.getAttributes('paragraph').breakBefore ?? editor.getAttributes('heading').breakBefore;
        const next = current === 'page' ? null : 'page';
        return this.options.types
          .map((type) => commands.updateAttributes(type, { breakBefore: next }))
          .some((r) => r);
      },
    };
  },
});
