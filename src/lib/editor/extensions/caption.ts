import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { formatOrdinal } from '../../utils/orderedListTypes';
import type { NoteNumFormat } from '../../storage/noteSettings';

// A caption is an ordinary paragraph in the `Caption` style carrying one inline atom:
// its running number (LibreOffice's sequence variable, Word's SEQ field). One counter
// per category, in document order — the same rule both word processors apply, and the
// only thing an index needs to find its entries.

// LibreOffice's own paragraph style for a caption, and the parent of its per-category
// ones (Figure/Table/Illustration/Drawing) — 10pt italic, 0.212cm above and below.
export const CAPTION_STYLE = 'Caption';

export type SeqCategory = 'figure' | 'table';
export const SEQ_CATEGORIES: SeqCategory[] = ['figure', 'table'];

// The counter's name in each format. ODF keeps LibreOffice's own "Illustration"; Word
// names it after the label, and an index that asks for another name finds nothing.
export const ODF_SEQ_NAME: Record<SeqCategory, string> = { figure: 'Illustration', table: 'Table' };
export const DOCX_SEQ_NAME: Record<SeqCategory, string> = { figure: 'Figure', table: 'Table' };

// A file's counter name → the category the editor counts. Both spellings of the picture
// counter turn up: LibreOffice writes "Illustration", Word "Figure", and each keeps the
// other's name when it converts. A counter under any other name is not a caption.
export const ODF_SEQ_CATEGORY: Record<string, SeqCategory | undefined> = {
  Illustration: 'figure', Figure: 'figure', Table: 'table',
};

export function seqCategoryOf(value: string | null | undefined): SeqCategory {
  return value === 'table' ? 'table' : 'figure';
}

// Every sequence field in document order, per category — what the numbering and the
// indexes both read. The number is the field's 1-based rank within its own category.
export function sequenceFields(doc: PMNode): { pos: number; node: PMNode; number: number }[] {
  const out: { pos: number; node: PMNode; number: number }[] = [];
  const counts = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (node.type.name !== 'sequenceField') return true;
    const cat = seqCategoryOf(node.attrs.category as string);
    const number = (counts.get(cat) ?? 0) + 1;
    counts.set(cat, number);
    out.push({ pos, node, number });
    return false;
  });
  return out;
}

const key = new PluginKey('sequenceFieldNumbers');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    caption: {
      /** A caption paragraph above or below the block the caret is in. */
      insertCaption: (opts: {
        category: SeqCategory; label: string; separator: string; text: string; above: boolean;
      }) => ReturnType;
    };
  }
}

// Where a caption has to stand to be under the frame it belongs to. A frame carries its
// own place in the column, so the anchor paragraph's alignment says nothing about it: a
// `topBottom` one is centred unless it names a side or an offset (image.ts/textBox.ts).
// A side-wrapped frame has the caption flowing beside it, which is what a reader of the
// exported file sees too, so nothing here can put it underneath.
export function framePlacement(block: PMNode): { textAlign: string | null; indent: number | null } | null {
  let frame: PMNode | null = block.attrs.wrap ? block : null;
  if (!frame) {
    block.descendants((node) => {
      if (frame) return false;
      if (node.attrs.wrap) frame = node;
      return !frame;
    });
  }
  const attrs = (frame as PMNode | null)?.attrs;
  if (!attrs || attrs.wrap !== 'topBottom') return null;
  if (attrs.wrapAlign) return { textAlign: String(attrs.wrapAlign), indent: null };
  return typeof attrs.wrapOffset === 'number'
    ? { textAlign: null, indent: attrs.wrapOffset }
    : { textAlign: 'center', indent: null };
}

export const SequenceField = Node.create({
  name: 'sequenceField',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      category: {
        default: 'figure' as SeqCategory,
        parseHTML: (el: HTMLElement) => seqCategoryOf(el.getAttribute('data-seq')),
        renderHTML: (attrs) => ({ 'data-seq': String(attrs.category ?? 'figure') }),
      },
      format: {
        default: '1' as NoteNumFormat,
        parseHTML: (el: HTMLElement) => (el.getAttribute('data-seq-format') || '1') as NoteNumFormat,
        renderHTML: (attrs) => ({ 'data-seq-format': String(attrs.format ?? '1') }),
      },
      // The rank the field last resolved to. Both formats cache their field's result the
      // same way, so it is what an export writes and what a reader sees before the
      // numbering plugin has run.
      number: {
        default: 1,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-seq-number')) || 1,
        renderHTML: (attrs) => ({ 'data-seq-number': String(attrs.number ?? 1) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-seq]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), sequenceFieldText(node)];
  },

  renderText({ node }) {
    return sequenceFieldText(node);
  },

  addCommands() {
    return {
      insertCaption:
        ({ category, label, separator, text, above }) =>
        ({ state, chain }) => {
          const { $from } = state.selection;
          if ($from.depth < 1) return false;
          // The caption goes beside the whole top-level block — the picture's paragraph
          // or the table — never inside it.
          const at = above ? $from.before(1) : $from.after(1);
          const content: Record<string, unknown>[] = [];
          if (label) content.push({ type: 'text', text: `${label} ` });
          content.push({ type: this.name, attrs: { category, format: '1', number: 1 } });
          const tail = `${separator}${text}`;
          if (tail) content.push({ type: 'text', text: tail });
          // A caption stands under its picture, not at the margin: LibreOffice frames the
          // two together, and a loose paragraph carries that over as its own placement.
          const block = $from.node(1);
          const place = framePlacement(block) ?? { textAlign: block.attrs.textAlign ?? null, indent: null };
          return chain()
            .insertContentAt(at, {
              type: 'paragraph',
              attrs: { styleName: CAPTION_STYLE, textAlign: place.textAlign, indent: place.indent },
              content,
            })
            .focus()
            .run();
        },
    };
  },

  // Renumber whenever an edit moved the fields around. Off the undo stack: the numbers
  // are derived, so undoing an edit must not step back through their recount.
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        appendTransaction: (transactions, _oldState, newState) =>
          transactions.some((t) => t.docChanged) ? renumberTr(newState) : null,
      }),
    ];
  },

  // An opened file carries whatever numbers its producer cached — wrong wherever the
  // format is not arabic, since neither field reads its own letters back.
  onCreate() {
    const tr = renumberTr(this.editor.state);
    if (tr) this.editor.view.dispatch(tr);
  },
});

// The transaction that brings every field's cached rank up to date, or null when they
// all already agree.
function renumberTr(state: EditorState): Transaction | null {
  const stale = sequenceFields(state.doc).filter((f) => f.node.attrs.number !== f.number);
  if (!stale.length) return null;
  const tr = state.tr;
  for (const f of stale) tr.setNodeAttribute(f.pos, 'number', f.number);
  return tr.setMeta('addToHistory', false);
}

export function sequenceFieldText(node: PMNode): string {
  return formatOrdinal(Number(node.attrs.number) || 1, (node.attrs.format as NoteNumFormat) ?? '1');
}
