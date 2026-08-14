import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { formatOrdinal } from '../../utils/orderedListTypes';
import { PX_PER_CM } from '../../storage/pageMargins';
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

export type CaptionPlacement = { textAlign: string | null; indent: number | null; indentRight: number | null };

// LibreOffice frames picture and caption together, so the caption is exactly as wide as
// the picture and sits under it whatever the frame's wrap. A loose paragraph carries
// that over as its own box: indented to the frame's span, which also lifts it clear of a
// side-wrapped frame — a line with no room beside a float drops below it.
export function captionPlacement(leftCm: number, rightCm: number): CaptionPlacement {
  const gap = (v: number) => (v > 0.05 ? Math.round(v * 100) / 100 : null);
  return {
    indent: gap(leftCm),
    indentRight: gap(rightCm),
    // Centred in its box under a frame that is itself centred, left-flush under one set
    // against an edge — which is how LibreOffice's own frame reads.
    textAlign: gap(leftCm) && Math.abs(leftCm - rightCm) < 0.05 ? 'center' : null,
  };
}

// The frame's span in the text column, in cm from each edge — measured, since a frame's
// place comes from its wrap, its offset and the column it is in, not from one attr.
function frameSpanCm(view: EditorView, block: PMNode, blockPos: number): { left: number; right: number } | null {
  const host = view.dom as HTMLElement;
  if (typeof getComputedStyle !== 'function' || !host.offsetWidth) return null;
  let framePos: number | null = null;
  if (block.attrs.wrap) framePos = blockPos;
  else if (block.inlineContent) {
    block.descendants((node, pos) => {
      if (framePos === null && node.attrs.wrap) framePos = blockPos + 1 + pos;
      return framePos === null;
    });
  }
  if (framePos === null) return null;
  const dom = view.nodeDOM(framePos);
  const frame = dom instanceof HTMLElement ? dom.querySelector('.image-rotor, .textbox-rotor') ?? dom : null;
  if (!frame) return null;
  const cs = getComputedStyle(host);
  const padLeft = parseFloat(cs.paddingLeft) || 0;
  const hostRect = host.getBoundingClientRect();
  // The zoom transform scales the rects but not the layout, so take it back out.
  const scale = hostRect.width / host.offsetWidth;
  const columnLeft = hostRect.left + padLeft * scale;
  const columnWidth = host.clientWidth - padLeft - (parseFloat(cs.paddingRight) || 0);
  const rect = frame.getBoundingClientRect();
  const left = (rect.left - columnLeft) / scale;
  const right = columnWidth - (rect.right - columnLeft) / scale;
  return { left: left / PX_PER_CM, right: right / PX_PER_CM };
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
          // A caption stands under its picture, not at the margin. A frame's own span in
          // the column is the caption's box; a block without one only has its alignment.
          const block = $from.node(1);
          const span = frameSpanCm(this.editor.view, block, $from.before(1));
          const place: CaptionPlacement = span
            ? captionPlacement(span.left, span.right)
            : { textAlign: block.attrs.textAlign ?? null, indent: null, indentRight: null };
          return chain()
            .insertContentAt(at, {
              type: 'paragraph',
              attrs: {
                styleName: CAPTION_STYLE,
                textAlign: place.textAlign,
                indent: place.indent,
                indentRight: place.indentRight,
              },
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


export type FrameDebugEntry = {
  pos: number;
  /** Every attr but `src` — a data URI is the whole file. */
  attrs: Record<string, unknown>;
  /** Doc px from the text column's left edge, so the two spans compare directly. */
  columnWidth: number;
  frame: [number, number] | null;
  caption: { text: string; span: [number, number]; textAlign: string; indent: unknown; indentRight: unknown } | null;
};

// A frame's place in the column beside the caption's — "the caption is not under the
// picture" is a horizontal question, and every other section of the dump is vertical.
export function getFrameDebug(view: EditorView): FrameDebugEntry[] {
  const host = view.dom as HTMLElement;
  if (typeof getComputedStyle !== 'function' || !host.offsetWidth) return [];
  const cs = getComputedStyle(host);
  const padLeft = parseFloat(cs.paddingLeft) || 0;
  const scale = host.getBoundingClientRect().width / host.offsetWidth;
  const originX = host.getBoundingClientRect().left + padLeft * scale;
  const span = (r: DOMRect): [number, number] =>
    [Math.round((r.left - originX) / scale), Math.round((r.right - originX) / scale)];
  const textSpan = (el: HTMLElement): DOMRect => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect();
  };

  const out: FrameDebugEntry[] = [];
  view.state.doc.descendants((node, pos) => {
    if (!node.attrs.wrap && node.type.name !== 'image') return true;
    const dom = view.nodeDOM(pos);
    const rotor = dom instanceof HTMLElement ? dom.querySelector('.image-rotor, .textbox-rotor') : null;
    const { src: _src, ...attrs } = node.attrs as Record<string, unknown>;
    // The block after the picture's own, which is where a caption below it lands.
    const after = view.state.doc.resolve(pos).after(1);
    const next = after <= view.state.doc.content.size ? view.state.doc.nodeAt(after) : null;
    const nextDOM = next ? view.nodeDOM(after) : null;
    out.push({
      pos,
      attrs,
      columnWidth: Math.round(host.clientWidth - padLeft - (parseFloat(cs.paddingRight) || 0)),
      frame: rotor ? span(rotor.getBoundingClientRect()) : null,
      caption: next && nextDOM instanceof HTMLElement && next.attrs.styleName === CAPTION_STYLE
        ? {
            // The running number is an atom, so plain textContent leaves a gap where
            // the reader sees "Figure 1".
            text: next.textBetween(0, next.content.size, '', (leaf) =>
              leaf.type.name === 'sequenceField' ? sequenceFieldText(leaf) : '').slice(0, 80),
            span: span(textSpan(nextDOM)),
            textAlign: getComputedStyle(nextDOM).textAlign,
            indent: next.attrs.indent,
            indentRight: next.attrs.indentRight,
          }
        : null,
    });
    return false;
  });
  return out;
}
