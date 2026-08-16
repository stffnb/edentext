// Shared round-trip comparison: reduce editor JSON to a canonical shape (defaults
// dropped, marks sorted, adjacent identical runs merged) and report the first diff.
type N = any;

const ORDERED_DEFAULTS: Record<string, unknown> = {
  textAlign: 'left', lineHeight: null, spaceBefore: null, spaceAfter: null,
  listStyleType: 'decimal', start: 1, rowHeight: null, colspan: 1, rowspan: 1,
  type: null, level: undefined, rotation: 0, wrap: 'inline',
  shapeKind: 'textbox', fillColor: '#FFFFFF', strokeColor: '#000000', strokeWidthPt: 1,
};

// Mark-attr defaults dropped like ORDERED_DEFAULTS is for node attrs.
const MARK_DEFAULTS: Record<string, unknown> = {
  plain: false, // link.ts default; the DOCX importer writes it out explicitly
};

// Note ids are importer-generated (ftn1/footnote1/…); remap them to their order of
// appearance so only the ref↔note pairing is compared, not the naming scheme.
function canonNoteIds(doc: N): void {
  const map = new Map<string, string>();
  (function walk(n: N) {
    if ((n.type === 'noteRef' || n.type === 'note') && n.attrs?.id != null) {
      if (!map.has(n.attrs.id)) map.set(n.attrs.id, `n${map.size + 1}`);
      n.attrs = { ...n.attrs, id: map.get(n.attrs.id) };
    }
    for (const c of n.content ?? []) walk(c);
  })(doc);
}

export function normalize(node: N): N {
  if (node.type === 'doc') canonNoteIds(node);
  const out: N = { type: node.type };
  if (node.text != null) out.text = node.text;
  if (node.marks?.length) {
    out.marks = node.marks
      .map((m: N) => {
        const mm: N = { type: m.type };
        const attrs = Object.fromEntries(Object.entries(m.attrs ?? {})
          .filter(([k, v]) => v != null && MARK_DEFAULTS[k] !== v));
        if (Object.keys(attrs).length) mm.attrs = attrs;
        return mm;
      })
      .sort((a: N, b: N) => a.type.localeCompare(b.type));
  }
  const attrs: N = {};
  for (const [k, v] of Object.entries(node.attrs ?? {})) {
    if (v == null) continue;
    if (k in ORDERED_DEFAULTS && ORDERED_DEFAULTS[k] === v) continue;
    if (k === 'colwidth') { attrs.colwidth = 'CW'; continue; } // ratios compared separately
    attrs[k] = v;
  }
  if (node.attrs?.level != null) attrs.level = node.attrs.level;
  if (Object.keys(attrs).length) out.attrs = attrs;
  if (node.content?.length) {
    // merge adjacent identical text nodes so run-splitting differences don't matter
    const kids: N[] = [];
    for (const c of node.content.map(normalize)) {
      const prev = kids[kids.length - 1];
      if (prev && prev.type === 'text' && c.type === 'text' &&
          JSON.stringify(prev.marks ?? null) === JSON.stringify(c.marks ?? null)) {
        prev.text += c.text;
      } else kids.push(c);
    }
    out.content = kids;
  }
  return out;
}

export function firstDiff(a: N, b: N, path = '$'): string | null {
  if (typeof a !== typeof b) return `${path}: type ${typeof a} vs ${typeof b}`;
  if (typeof a !== 'object' || a === null || b === null) {
    return Object.is(a, b) ? null : `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = firstDiff(a[k], b[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}
