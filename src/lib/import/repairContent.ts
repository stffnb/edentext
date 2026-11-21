import { Fragment, type Node, type Schema } from '@tiptap/pm/model';
import { getSchema, type JSONContent } from '@tiptap/core';
import { zoneExtensions } from '../editor/extensions';
import { HF_ZONE_KEYS, type HfSet } from '../storage/headerFooter';
import { withoutPictureSquares } from '../editor/paste';

// An importer that misreads a file must cost the reader one spot, not the document:
// content the schema rejects is refitted child by child, and the first error is returned
// for the warning. Valid content comes back untouched.
export function repairContent(json: JSONContent, schema: Schema): { content: JSONContent; error: string | null } {
  const doc = schema.nodeFromJSON(json);
  try {
    doc.check();
    return { content: json, error: null };
  } catch (err) {
    return { content: fix(doc).toJSON(), error: err instanceof Error ? err.message : String(err) };
  }
}

// Each child is kept, given the filler its parent needs before it, wrapped, unpacked into
// its own children, or dropped — the first that fits.
function fix(node: Node): Node {
  if (node.isLeaf) return node;
  let match = node.type.contentMatch;
  const out: Node[] = [];
  const place = (raw: Node): void => {
    const child = raw.mark(node.type.allowedMarks(raw.marks));
    let next = match.matchType(child.type);
    if (!next) {
      const fill = match.fillBefore(Fragment.from(child));
      if (fill) {
        fill.forEach(f => out.push(f));
        next = match.matchFragment(fill)?.matchType(child.type) ?? null;
      }
    }
    if (next) { out.push(child); match = next; return; }
    const wrap = match.findWrapping(child.type);
    let wrapped: Node | null = child;
    for (let i = (wrap?.length ?? 0) - 1; wrapped && i >= 0; i--) wrapped = wrap![i].createAndFill(null, wrapped);
    if (wrap?.length && wrapped) { out.push(wrapped); match = match.matchType(wrapped.type)!; return; }
    if (!child.isLeaf) child.content.forEach(place);
  };
  node.content.forEach(c => place(fix(c)));
  const tail = match.fillBefore(Fragment.empty, true);
  return node.type.create(node.attrs, tail ? Fragment.fromArray(out).append(tail) : Fragment.fromArray(out), node.marks);
}

let zoneSchema: Schema | undefined;

// A section's zones, each refitted to the zone schema, without the grey squares of a paste
// nobody present will fill; errors collects what was rejected.
export function repairZones<T extends Partial<HfSet>>(set: T, errors: string[] = []): T {
  zoneSchema ??= getSchema(zoneExtensions());
  const out = { ...set };
  for (const k of HF_ZONE_KEYS) {
    const doc = set[k];
    if (!doc) continue;
    const r = repairContent(withoutPictureSquares(doc as JSONContent, zoneSchema, true), zoneSchema);
    if (r.error) errors.push(r.error);
    out[k] = r.content as T[typeof k];
  }
  return out;
}
