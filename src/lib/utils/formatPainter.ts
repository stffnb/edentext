// The format painter's two halves: read the format at the selection, write it onto
// another. What counts as format comes from the schema, less what is content or review.

import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { UNFORMATTED_ATTRS, UNFORMATTED_MARKS } from '../editor/extensions/trackChanges';
import { wordRangeAt } from '../editor/extensions/spellCheck';

export type PaintedFormat = {
  marks: { type: string; attrs: Record<string, unknown> }[];
  block: { type: string; attrs: Record<string, unknown> } | null;
};

// A page break belongs to the place, not to the paragraph's look.
const keptAttr = (key: string) => UNFORMATTED_ATTRS.has(key) || key === 'breakBefore';
// Only these two swap for each other; a note keeps its node and takes the attrs it shares.
const PARAGRAPHS = new Set(['paragraph', 'heading']);

/** The format at the caret, or where the selection starts. */
export function pickFormat(state: EditorState): PaintedFormat {
  const { selection, doc } = state;
  let marks: readonly Mark[] = state.storedMarks ?? selection.$from.marks();
  let parent: PMNode = selection.$from.parent;
  if (!selection.empty) {
    let found = false;
    doc.nodesBetween(selection.from, selection.to, (node, pos) => {
      if (found) return false;
      if (!node.isInline) return true;
      found = true;
      marks = node.marks;
      parent = doc.resolve(pos).parent;
      return false;
    });
  }
  return {
    marks: marks.filter((m) => !UNFORMATTED_MARKS.has(m.type.name)).map((m) => ({ type: m.type.name, attrs: { ...m.attrs } })),
    block: parent.isTextblock
      ? { type: parent.type.name, attrs: Object.fromEntries(Object.entries(parent.attrs).filter(([k]) => !keptAttr(k))) }
      : null,
  };
}

// The block at `pos` in the picked paragraph format: its place, its review record and
// every attr the source's node type does not have stay the block's own.
function paintBlock(tr: Transaction, pos: number, block: NonNullable<PaintedFormat['block']>): void {
  const node = tr.doc.nodeAt(pos);
  if (!node?.isTextblock) return;
  const { nodes } = tr.doc.type.schema;
  const $pos = tr.doc.resolve(pos);
  let type = node.type;
  if (PARAGRAPHS.has(block.type) && PARAGRAPHS.has(type.name) && nodes[block.type]
    && $pos.parent.canReplaceWith($pos.index(), $pos.index() + 1, nodes[block.type])) type = nodes[block.type];
  const attrs: Record<string, unknown> = {};
  for (const key of Object.keys(type.spec.attrs ?? {})) {
    attrs[key] = !keptAttr(key) && key in block.attrs ? block.attrs[key] : node.attrs[key];
  }
  const same = type === node.type && Object.keys(attrs).every((k) => JSON.stringify(attrs[k] ?? null) === JSON.stringify(node.attrs[k] ?? null));
  if (!same) tr.setNodeMarkup(pos, type, attrs, node.marks);
}

/** `chars: false` leaves the character format out; `touched` paints every paragraph the selection reaches into. */
export type PaintOptions = { chars?: boolean; touched?: boolean };

/**
 * The transaction that puts `format` on the selection, or null where nothing changes.
 * Selected text takes the character format in place of its own, and each paragraph the
 * selection covers whole the paragraph format; a bare caret paints its word and paragraph.
 */
export function paintFormat(state: EditorState, format: PaintedFormat, opts: PaintOptions = {}): Transaction | null {
  const { chars = true, touched = false } = opts;
  const { selection, doc, schema } = state;
  const tr = state.tr;
  const word = selection.empty ? wordRangeAt(state, selection.from) : null;
  const ranges = selection.empty
    ? (word ? [{ from: word.from, to: word.to }] : [])
    : selection.ranges.map((r) => ({ from: r.$from.pos, to: r.$to.pos }));

  if (chars) {
    const marks = format.marks.flatMap((m) => (schema.marks[m.type] ? [schema.marks[m.type].create(m.attrs)] : []));
    for (const { from, to } of ranges) {
      for (const type of Object.values(schema.marks)) if (!UNFORMATTED_MARKS.has(type.name)) tr.removeMark(from, to, type);
      for (const mark of marks) tr.addMark(from, to, mark);
    }
  }

  if (format.block) {
    const blocks: number[] = [];
    if (selection.empty) {
      if (selection.$from.parent.isTextblock) blocks.push(selection.$from.before());
    } else {
      for (const { from, to } of selection.ranges.map((r) => ({ from: r.$from.pos, to: r.$to.pos }))) {
        doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isTextblock) return true;
          const whole = from <= pos + 1 && to >= pos + node.nodeSize - 1;
          if (whole || touched) blocks.push(pos);
          return false;
        });
      }
    }
    // Mark steps move nothing, and a block's new markup keeps its size.
    for (const pos of blocks) paintBlock(tr, pos, format.block);
  }
  return tr.docChanged ? tr : null;
}
