// Shared round-trip comparison: reduce editor JSON to a canonical shape (defaults
// dropped, marks sorted, adjacent identical runs merged) and report the first diff.
import { MAX_HEADING_LEVEL } from '../src/lib/styles/headings';

type N = any;

const ORDERED_DEFAULTS: Record<string, unknown> = {
  textAlign: 'left', lineHeight: null, spaceBefore: null, spaceAfter: null,
  listStyleType: 'decimal', start: 1, rowHeight: null, colspan: 1, rowspan: 1,
  type: null, level: undefined, rotation: 0, wrap: 'inline',
  shapeKind: 'textbox', fillColor: '#FFFFFF', strokeColor: '#000000', strokeWidthPt: 1,
  fixed: false, key1: '',
  joinPrev: false, // pageBreaks.ts's split marker; the export merges the halves
  marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, // a table's, once a command has touched them
  alt: '', inFront: false, paddingCm: 0.15, flipV: false, textVertical: false, textVAlign: 'top', // the editor's own picture and box defaults
  wrapFromPage: false,
  // index attrs the DOCX TOC field has no switch for come back at their defaults
  maxLevel: MAX_HEADING_LEVEL, leader: '.', citationStyle: 'key',
};

// Inline atoms that carry no mark into either file (see normalize below).
const MARKLESS_ATOMS = new Set(['formula', 'image', 'hardBreak']);

// Mark-attr defaults dropped like ORDERED_DEFAULTS is for node attrs.
const MARK_DEFAULTS: Record<string, unknown> = {
  plain: false, // link.ts default; the DOCX importer writes it out explicitly
};

// Note, comment and revision ids are importer-generated (ftn1/footnote1/…, c1 vs w0,
// Word's numeric w:id); remap them to their order of appearance so only the pairing is
// compared, not the naming scheme. Sequence numbers are recounted the way the editor
// does on load (per category, document order) — the DOCX field carries no cached rank.
function canonNoteIds(doc: N): void {
  const map = new Map<string, string>();
  const comments = new Map<string, string>();
  const revs = new Map<string, string>();
  const seq: Record<string, number> = {};
  (function walk(n: N) {
    if ((n.type === 'noteRef' || n.type === 'note') && n.attrs?.id != null) {
      if (!map.has(n.attrs.id)) map.set(n.attrs.id, `n${map.size + 1}`);
      n.attrs = { ...n.attrs, id: map.get(n.attrs.id) };
    }
    if (n.type === 'sequenceField' && n.attrs) {
      const c = String(n.attrs.category ?? 'figure');
      seq[c] = (seq[c] ?? 0) + 1;
      n.attrs = { ...n.attrs, number: seq[c] };
    }
    for (const m of n.marks ?? []) {
      if (m.type === 'comment' && m.attrs?.id != null) {
        if (!comments.has(m.attrs.id)) comments.set(m.attrs.id, `c${comments.size + 1}`);
        m.attrs = { ...m.attrs, id: comments.get(m.attrs.id) };
      }
      if ((m.type === 'insertion' || m.type === 'deletion') && m.attrs?.id != null) {
        if (!revs.has(m.attrs.id)) revs.set(m.attrs.id, `rv${revs.size + 1}`);
        m.attrs = { ...m.attrs, id: revs.get(m.attrs.id) };
      }
    }
    for (const c of n.content ?? []) walk(c);
  })(doc);
}

export function normalize(node: N): N {
  if (node.type === 'doc') canonNoteIds(node);
  const out: N = { type: node.type };
  if (node.text != null) out.text = node.text;
  // An inline atom wears the marks of the run around it — a formula's font, a picture's
  // or a line break's inherited comment. None of them paints, and no file carries them.
  if (node.marks?.length && !MARKLESS_ATOMS.has(node.type)) {
    const marks = node.marks
      .map((m: N) => {
        const mm: N = { type: m.type };
        // An empty string is the picker's "unset" (a font family, say) — no value at all,
        // and an empty list (a comment with no replies) is the same nothing.
        const attrs = Object.fromEntries(Object.entries(m.attrs ?? {})
          .filter(([k, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length) && MARK_DEFAULTS[k] !== v)
          .map(([k, v]) => [k, typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : v]));
        // ODF keeps the authored (naive local) comment/revision date, DOCX re-serializes
        // the same instant as UTC — compare the instant.
        if ((m.type === 'comment' || m.type === 'insertion' || m.type === 'deletion')
            && typeof attrs.date === 'string') {
          const t = Date.parse(attrs.date);
          if (!Number.isNaN(t)) attrs.date = t;
        }
        if (Object.keys(attrs).length) mm.attrs = attrs;
        return mm;
      })
      .filter((m: N) => m.type !== 'textStyle' || m.attrs) // a textStyle with nothing left says nothing
      .sort((a: N, b: N) => a.type.localeCompare(b.type));
    if (marks.length) out.marks = marks;
  }
  const attrs: N = {};
  // An auto date/time field re-evaluates on load (the DOCX importer stamps "now"), so
  // its cached value is presentational; a citation's text label is derived the same way.
  const volatileKey = (k: string) =>
    (node.type === 'dateTimeField' && k === 'value' && node.attrs?.fixed !== true)
    || (node.type === 'bibliographyEntry' && k === 'text');
  for (const [k, v] of Object.entries(node.attrs ?? {})) {
    if (v == null) continue;
    if (k in ORDERED_DEFAULTS && ORDERED_DEFAULTS[k] === v) continue;
    if (volatileKey(k)) continue;
    if (k === 'colwidth') { attrs.colwidth = 'CW'; continue; } // ratios compared separately
    // The gap beside a frame is drawn on a side wrap only, and zero is no gap at all.
    if (k === 'wrapDist' && !(Number(v) > 0 && (node.attrs?.wrap === 'left' || node.attrs?.wrap === 'right'))) continue;
    // The DOCX importer keeps the OMML serializer's trailing space on purpose
    // (re-serialize-to-itself); the ODT annotation is the authored string. Same formula.
    if (k === 'latex') { attrs.latex = String(v).trim(); continue; }
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

// A block's own font pushed down onto its runs, so a hoisted font and a run-level one
// compare as the same document.
export function unhoist(node: any): any {
  const { fontSize, fontFamily } = node.attrs ?? {};
  if ((fontSize || fontFamily) && node.content) {
    for (const c of node.content) {
      if (c.type !== 'text') continue;
      const ts = (c.marks ??= []).find((m: any) => m.type === 'textStyle')
        ?? (c.marks.push({ type: 'textStyle', attrs: {} }), c.marks[c.marks.length - 1]);
      ts.attrs = { ...(fontSize ? { fontSize } : {}), ...(fontFamily ? { fontFamily } : {}), ...ts.attrs };
    }
  }
  for (const c of node.content ?? []) unhoist(c);
  return node;
}

// A paragraph whose runs share one font legitimately comes back with that font also
// on its attrs (the empty-line-height feature hoists it); ignore it on both sides.
export function stripFontHoist(node: any): any {
  if (node.content?.length && node.attrs) {
    const { fontSize, fontFamily, ...rest } = node.attrs;
    node.attrs = Object.keys(rest).length ? rest : undefined;
    if (!node.attrs) delete node.attrs;
  }
  for (const c of node.content ?? []) stripFontHoist(c);
  return node;
}
