import { Extension } from '@tiptap/core';
import { DEFAULT_SHORTCUTS } from '../shortcuts';

// The text-flow attrs of a paragraph/heading. breakBefore: 'page' round-trips to ODF
// fo:break-before and DOCX w:pageBreakBefore; widowControl: false turns off the
// widow-orphan minimum (w:widowControl, fo:widows/fo:orphans); keepNext keeps the block
// on the page its successor starts on (w:keepNext, fo:keep-with-next) — headings do
// that anyway in both, so the attr only marks the other blocks; keepLines holds all of
// a block's lines on one page (w:keepLines, fo:keep-together). null = default.

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
          widowControl: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute('data-widow-control') === 'false' ? false : null,
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.widowControl !== false) return {};
              return { 'data-widow-control': 'false' };
            },
          },
          keepNext: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute('data-keep-next') === 'true' ? true : null,
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.keepNext !== true) return {};
              return { 'data-keep-next': 'true' };
            },
          },
          keepLines: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute('data-keep-lines') === 'true' ? true : null,
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.keepLines !== true) return {};
              return { 'data-keep-lines': 'true' };
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
      [DEFAULT_SHORTCUTS.pageBreak]: () => this.editor.commands.insertPageBreak(),
    };
  },
});
