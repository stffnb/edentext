import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';

// Fitting foreign HTML into this schema. ProseMirror's own fitting reaches for a text box
// wherever blocks don't fit — it is the one inline node that holds them — and drops what
// it cannot place at all; both are wrong for a paste from a web page.

/**
 * Spill the blocks of the boxes the paste invented (one per block that didn't fit the
 * caret's line). Every real box carries a size — the insert command and both importers
 * set one — so a bare one is that wrapper. Left in, a paste into a box would be dropped
 * whole: a box inside a box never enters the document.
 */
export function unwrapPastedBoxes(slice: Slice): Slice {
  const out: PMNode[] = [];
  let wrapped = false;
  slice.content.forEach(node => {
    const bare = node.type.name === 'textBox' && node.attrs.width === null && node.attrs.height === null;
    wrapped ||= bare;
    if (bare) node.content.forEach(child => out.push(child));
    else out.push(node);
  });
  return wrapped ? Slice.maxOpen(Fragment.fromArray(out)) : slice;
}

/**
 * Everything the slice says, as inline content with a line break per block — for the
 * targets that hold no blocks at all: a header/footer zone and a note body. Pasted blocks
 * would otherwise be wrapped in a box neither file keeps, or be dropped from the second
 * block on. Both importers write a zone's paragraphs as the same breaks.
 */
export function flattenToInline(slice: Slice, schema: Schema): Slice {
  const br = schema.nodes.hardBreak;
  const out: PMNode[] = [];
  const walk = (frag: Fragment) => frag.forEach(node => {
    // A box holds blocks itself, so it is walked into rather than kept.
    if (node.isInline && node.type.name !== 'textBox') return void out.push(node);
    // One break per text block, empty ones included — the blank line they are; a list, a
    // table or a box only holds those blocks and adds no break of its own.
    if (node.isTextblock && out.length && br) out.push(br.create());
    walk(node.content);
  });
  walk(slice.content);
  return new Slice(Fragment.fromArray(out), 0, 0);
}
