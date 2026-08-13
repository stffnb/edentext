import { Extension } from '@tiptap/core';
import { DEFAULT_SHORTCUTS } from '../shortcuts';

// The text-flow attrs of a paragraph/heading, null = default: breakBefore 'page', widow
// control, keepNext (a heading has it anyway, so the attr marks the other blocks),
// keepLines, and sectionBreak — which opens a section (storage/headerFooter.ts).

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
          // First block of a new section (w:sectPr, ODF style:master-page-name): what
          // gives it its own header/footer. Ordinal, so editing can't desync an index.
          sectionBreak: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute('data-section-break') === 'true' ? true : null,
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.sectionBreak !== true) return {};
              return { 'data-section-break': 'true' };
            },
          },
        },
      },
      {
        types: ['table'],
        attributes: {
          // ODF style:may-break-between-rows="false": no page break falls between two
          // of the table's rows, so one too tall for the space left moves whole. A
          // table taller than a page still breaks — the rule is then unsatisfiable.
          keepRows: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute('data-keep-rows') === 'true' ? true : null,
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.keepRows === true ? { 'data-keep-rows': 'true' } : {},
          },
          // ODF <table:table-header-rows>, Word w:trPr/w:tblHeader: the first row is
          // repeated at the top of every page the table continues on. The structural
          // header, as against the styling one in tableHeaderRow.ts.
          repeatHeader: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute('data-repeat-header') === 'true' ? true : null,
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.repeatHeader === true ? { 'data-repeat-header': 'true' } : {},
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
