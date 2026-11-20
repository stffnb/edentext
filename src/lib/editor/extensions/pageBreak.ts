import { Extension, commands as core } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { AddMarkStep, RemoveMarkStep, ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform';
import { DEFAULT_SHORTCUTS } from '../shortcuts';
import { changedRanges } from '../changedRanges';

const RANGED = [ReplaceStep, ReplaceAroundStep, AddMarkStep, RemoveMarkStep];

// The text-flow attrs of a paragraph/heading, null = default: breakBefore 'page', widow
// control, keepNext (a heading has it anyway, so true marks the other blocks and false
// the heading whose file style drops it),
// keepLines, and sectionBreak — which opens a section (storage/headerFooter.ts).
// A table carries the last two as well: a section may open with one.

// The two attrs a table shares with a paragraph, so a section opening with a table is
// one — ODF puts both on its table style, Word ends the section above it either way.
const breakBefore = {
  default: null,
  parseHTML: (element: HTMLElement) =>
    element.getAttribute('data-page-break-before') === 'page' ? 'page' : null,
  renderHTML: (attributes: Record<string, unknown>) =>
    attributes.breakBefore === 'page' ? { 'data-page-break-before': 'page' } : {},
};
const sectionBreak = {
  default: null,
  keepOnSplit: false,
  parseHTML: (element: HTMLElement) =>
    element.getAttribute('data-section-break') === 'true' ? true : null,
  renderHTML: (attributes: Record<string, unknown>) =>
    attributes.sectionBreak === true ? { 'data-section-break': 'true' } : {},
};

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

// TipTap checks the split before it deletes the selection, whose delete takes a block the
// selection only enters whole, and the split then lands between blocks. A plain delete
// keeps the selection's start where the split goes.
type SplitProps = Parameters<ReturnType<typeof core.splitBlock>>[0];
function splitOverSelection(options: Parameters<typeof core.splitBlock>[0], props: SplitProps): boolean {
  const sel = props.tr.selection;
  if (props.dispatch && sel instanceof TextSelection && !sel.empty) {
    props.tr.delete(sel.from, sel.to);
    props.tr.setSelection(TextSelection.near(props.tr.doc.resolve(sel.from)));
  }
  return core.splitBlock(options)(props);
}

/** The split a zone has of what `PageBreak` does for the body. */
export const ZoneSplit = Extension.create({
  name: 'zoneSplit',
  addCommands() {
    return { splitBlock: (options) => (props) => splitOverSelection(options, props) };
  },
});

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
          breakBefore,
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
              ({ true: true, false: false } as Record<string, boolean>)[element.getAttribute('data-keep-next') ?? ''] ?? null,
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.keepNext === 'boolean' ? { 'data-keep-next': String(attributes.keepNext) } : {},
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
          // LibreOffice's Text Flow ▸ Hyphenation off for this paragraph, Word's
          // w:suppressAutoHyphens. Only "off" travels: Word cannot turn hyphenation
          // *on* for one paragraph, so the document switch is the only way in.
          noHyphenation: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute('data-no-hyphenation') === 'true' ? true : null,
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.noHyphenation === true ? { 'data-no-hyphenation': 'true' } : {},
          },
          // First block of a new section (w:sectPr, ODF style:master-page-name): what
          // gives it its own header/footer. Ordinal, so editing can't desync an index.
          sectionBreak,
        },
      },
      {
        // An index is a block atom, so a section can open with one exactly as it can
        // with a table; ODF keeps both on the index's own first body paragraph.
        types: ['tableOfContents'],
        attributes: { breakBefore, sectionBreak },
      },
      {
        types: ['table'],
        attributes: {
          breakBefore,
          sectionBreak,
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
          // ODF fo:keep-with-next on the table; a DOCX table whose every paragraph keeps
          // with the next reads as one (LibreOffice's import). It then moves whole with
          // the block after it, as LibreOffice lays it out (pageBreaks.ts).
          keepNext: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute('data-keep-next') === 'true' ? true : null,
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.keepNext === true ? { 'data-keep-next': 'true' } : {},
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
      // Enter hands a block's attributes to the one it opens, and splits the attrs of a
      // block it cuts in two across both halves. A break is the break itself, not
      // formatting a successor inherits, so the block below the cut gives it up again.
      splitBlock: (options) => (props) => {
        const carried = props.state.selection.$from.parent.attrs?.breakBefore === 'page';
        const split = splitOverSelection(options, props);
        if (carried && split) props.commands.unsetPageBreakBefore();
        return split;
      },
      // Ctrl+Enter: start a new page at the cursor. Splits the block (unless already at its
      // start) and marks the following block. Top-level blocks only.
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

  addProseMirrorPlugins() {
    // A break only reaches the file from a body block or a list item: inside a table cell,
    // a frame or a note body both formats drop it, so the editor holds none there either.
    const carriers = ['doc', 'columns', 'bulletList', 'orderedList', 'listItem'];
    return [new Plugin({
      appendTransaction: (trs, _old, state) => {
        if (!trs.some((t) => t.docChanged)) return null;
        const tr = state.tr;
        // A block gains an ancestor only inside what the edit changed; a step without a
        // range (an attribute set in place) leaves the whole document to look at.
        let from = 0, to = state.doc.content.size;
        if (trs.every((t) => t.steps.every((st) => RANGED.some((type) => st instanceof type)))) {
          let lo = Infinity, hi = -Infinity;
          for (const t of trs) {
            if (lo <= hi) { lo = t.mapping.map(lo, -1); hi = t.mapping.map(hi, 1); }
            for (const r of changedRanges(t)) { lo = Math.min(lo, r.from); hi = Math.max(hi, r.to); }
          }
          if (lo > hi) return null;
          from = Math.max(0, lo - 1); to = Math.min(to, hi + 1);
        }
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.isText) return false; // a text box holds blocks, so only a run is a dead end
          if (node.attrs.breakBefore !== 'page') return;
          const $pos = state.doc.resolve(pos);
          for (let d = $pos.depth; d >= 0; d--) {
            if (carriers.includes($pos.node(d).type.name)) continue;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, breakBefore: null });
            break;
          }
        });
        return tr.steps.length ? tr : null;
      },
    })];
  },
});
