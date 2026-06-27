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
      insertPageBreak: () => ReturnType;
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
      // Ctrl+Enter: start a new page at the cursor. Splits the block (unless already at its
      // start) and marks the following block. Top-level blocks only — breakBefore is ignored
      // inside lists/table cells, so there it does nothing.
      insertPageBreak: () => ({ state, chain }) => {
        const { $from, empty } = state.selection;
        if ($from.depth !== 1) return false;
        const atBlockStart = empty && $from.parentOffset === 0;
        const c = chain();
        if (!atBlockStart) c.splitBlock();
        return c.setPageBreakBefore().run();
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.insertPageBreak(),
    };
  },
});
