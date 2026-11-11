import { Fragment, type Mark, type Node as PMNode, type Schema } from '@tiptap/pm/model';

// y-tiptap keeps a text run's marks as formatting but drops a node's (a formula's font
// size): they ride a reserved attribute of the node's element, as one JSON string, so
// concurrent changes resolve last-writer-wins like any attribute and undo restores them.
export const MARKS_ATTR = '_marks';

const shared = new WeakMap<PMNode, PMNode>();

/** `doc` as the binding writes it: every marked non-text node carries its marks as an attribute. */
export function withMarks(doc: PMNode): PMNode {
  if (doc.isText) return doc;
  const known = shared.get(doc);
  if (known) return known;
  const kids: PMNode[] = [];
  let changed = false;
  doc.content.forEach((c) => { const s = withMarks(c); changed ||= s !== c; kids.push(s); });
  let out = changed ? doc.copy(Fragment.fromArray(kids)) : doc;
  if (doc.marks.length) {
    // A copy of its own: the attribute must never reach the editor's node.
    if (out === doc) out = doc.mark([...doc.marks]);
    (out as { attrs: PMNode['attrs'] }).attrs = { ...doc.attrs, [MARKS_ATTR]: JSON.stringify(doc.marks.map((m) => m.toJSON())) };
  }
  shared.set(doc, out);
  return out;
}

/** The attributes and marks of a node the binding draws from an element. */
export function fromShared(schema: Schema, attrs: Record<string, unknown> | null | undefined, marks?: readonly Mark[]) {
  const json = attrs?.[MARKS_ATTR];
  if (typeof json !== 'string') return { attrs, marks };
  const { [MARKS_ATTR]: _, ...rest } = attrs!;
  return { attrs: rest, marks: (JSON.parse(json) as unknown[]).map((m) => schema.markFromJSON(m)) };
}
