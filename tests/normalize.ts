// Shared round-trip comparison: reduce editor JSON to a canonical shape (defaults
// dropped, marks sorted, adjacent identical runs merged) and report the first diff.
import { MAX_HEADING_LEVEL } from '../src/lib/styles/headings';
import { wrapGap } from '../src/lib/editor/extensions/image';

type N = any;

const ORDERED_DEFAULTS: Record<string, unknown> = {
  textAlign: 'left', lineHeight: null, spaceBefore: null, spaceAfter: null,
  listStyleType: 'decimal', start: 1, rowHeight: null, colspan: 1, rowspan: 1,
  type: null, level: undefined, rotation: 0, wrap: 'inline',
  shapeKind: 'textbox', fillColor: '#FFFFFF', strokeColor: '#000000', strokeWidthPt: 1,
  fixed: false, key1: '',
  joinPrev: false, // pageBreaks.ts's split marker; the export merges the halves
  marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, // a table's, once a command has touched them
  alt: '', inFront: false, paddingCm: 0.15, flipV: false, flipH: false, textVertical: false, textVAlign: 'top', // the editor's own picture and box defaults
  wrapFromPage: false,
  cantSplit: false, fixedHeight: false, // tableRow.ts and textBox.ts defaults
  continueNumbering: false, // orderedList.ts
  wrapFromBody: false,
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

// A frame's stacking rank compares as its place in the stack: LibreOffice numbers every
// object afresh on save, ties in document order, which is how the editor breaks them.
// An inline frame overlaps nothing, and DOCX gives it no rank at all.
let frameRanks = new WeakMap<object, number>();
function canonFrameOrder(doc: N): void {
  const frames: N[] = [];
  (function walk(n: N) {
    if ((n.type === 'image' || n.type === 'textBox') && (n.attrs?.wrap ?? 'inline') !== 'inline') frames.push(n);
    for (const c of n.content ?? []) walk(c);
  })(doc);
  const z = (n: N) => Number(n.attrs?.zIndex) || 0;
  frameRanks = new WeakMap(frames.map((n, i) => ({ n, i })).sort((a, b) => z(a.n) - z(b.n) || a.i - b.i)
    .map(({ n }, k) => [n, k]));
}

export function normalize(node: N): N {
  if (node.type === 'doc') { canonNoteIds(node); canonFrameOrder(node); }
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
  // its cached value is presentational; a citation's text label is derived the same way,
  // as a preset box's outline and text area are, from its preset and size.
  const volatileKey = (k: string) =>
    (node.type === 'dateTimeField' && k === 'value' && node.attrs?.fixed !== true)
    || (node.type === 'bibliographyEntry' && k === 'text')
    || (node.type === 'textBox' && node.attrs?.shapePreset && (k === 'shapePath' || k === 'shapeTextArea'));
  for (const [k, v] of Object.entries(node.attrs ?? {})) {
    if (v == null) continue;
    if (k in ORDERED_DEFAULTS && ORDERED_DEFAULTS[k] === v) continue;
    if (volatileKey(k)) continue;
    if (k === 'zIndex') continue;
    // A list starting at 1 has nothing to count on from, and no style means no space to undo.
    if (k === 'continueNumbering' && (node.attrs?.start ?? 1) === 1) continue;
    if ((k === 'spaceBefore' || k === 'spaceAfter') && v === 0 && node.type === 'paragraph' && !node.attrs?.styleName) continue;
    // An index with no cached row and one never generated both generate on mount.
    if (node.type === 'tableOfContents' && k === 'entries' && Array.isArray(v) && !v.length) continue;
    // What a block does anyway: a heading keeps with the next one, a paragraph needs not.
    if (k === 'keepNext' && v === (node.type === 'heading')) continue;
    if (k === 'colwidth') { attrs.colwidth = 'CW'; continue; } // ratios compared separately
    // A frame's gap as drawn: the text's side beside a side wrap, above and below for
    // every mode that wraps; zero is no gap at all.
    if (k === 'wrapDist') {
      const g = wrapGap(v), w = node.attrs?.wrap;
      const sides = w === 'left' ? [g.top, g.bottom, g.right] : w === 'right' ? [g.top, g.bottom, g.left] : w === 'topBottom' ? [g.top, g.bottom] : [];
      if (sides.some((x) => x > 0)) attrs.wrapDist = sides.join('/');
      continue;
    }
    // The DOCX importer keeps the OMML serializer's trailing space on purpose
    // (re-serialize-to-itself); the ODT annotation is the authored string. Same formula.
    if (k === 'latex') { attrs.latex = String(v).trim(); continue; }
    attrs[k] = v;
  }
  if (node.attrs?.level != null) attrs.level = node.attrs.level;
  if (frameRanks.get(node)) attrs.zIndex = frameRanks.get(node);
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
    // Its page fields and other atoms too, which render in the block's font as well.
    for (const c of node.content) {
      const ts = (c.marks ??= []).find((m: any) => m.type === 'textStyle')
        ?? (c.marks.push({ type: 'textStyle', attrs: {} }), c.marks[c.marks.length - 1]);
      ts.attrs = { ...(fontSize ? { fontSize } : {}), ...(fontFamily ? { fontFamily } : {}), ...ts.attrs };
    }
  }
  for (const c of node.content ?? []) unhoist(c);
  return node;
}

// A .docx box keeps its extent: Word's one growing frame (a:spAutoFit) is drawn detached
// by LibreOffice, so the export writes a box as tall as it renders and the import reads it
// back fixed (textBox.ts withRenderedBoxHeights). DOCX legs compare without the flag.
export function stripBoxGrowth(node: any): any {
  if (node?.type === 'textBox' && node.attrs?.fixedHeight) {
    delete node.attrs.fixedHeight;
    if (!Object.keys(node.attrs).length) delete node.attrs;
  }
  for (const c of node?.content ?? []) stripBoxGrowth(c);
  return node;
}

// The editor writes Word's 2013 layout, which opens a page a paragraph breaks itself onto
// without its space above; the import reads that back as a 0. DOCX legs compare without it.
export function stripBreakSpace(node: any): any {
  if (node?.attrs?.breakBefore === 'page' && !node.attrs.sectionBreak && 'spaceBefore' in node.attrs) {
    delete node.attrs.spaceBefore;
  }
  for (const c of node?.content ?? []) stripBreakSpace(c);
  return node;
}

// A paragraph whose runs share one font legitimately comes back with that font also
// on its attrs (the empty-line-height feature hoists it); ignore it on both sides.
export function stripFontHoist(node: any): any {
  if (node.content?.length && node.attrs) {
    const { fontSize, fontFamily, ...rest } = node.attrs;
    node.attrs = Object.keys(rest).length ? rest : undefined;
    if (!node.attrs) delete node.attrs;
    // A field keeps the style's font against a hoist as a mark of its own (applyUniformRunFont).
    for (const c of node.content) {
      const ts = c.type !== 'text' && c.marks?.find((m: any) => m.type === 'textStyle');
      if (!ts?.attrs) continue;
      if (fontSize) delete ts.attrs.fontSize;
      if (fontFamily) delete ts.attrs.fontFamily;
      if (!Object.keys(ts.attrs).length) c.marks = c.marks.filter((m: any) => m !== ts);
      if (!c.marks.length) delete c.marks;
    }
  }
  for (const c of node.content ?? []) stripFontHoist(c);
  return node;
}

// ODF has no coloured outline, shadow or glow: the export falls back to the plain shadow
// and drops the rest (textEffects.ts effectsToOdf). ODT legs compare through the fallback;
// LibreOffice writes a DOCX's w14 effects into no ODT at all (plainShadow false).
export function odtEffectFallback(node: any, plainShadow = true): any {
  for (const c of node?.content ?? []) odtEffectFallback(c, plainShadow);
  // Runs left alike by it read back as one.
  if (node?.content) {
    node.content = node.content.reduce((out: any[], c: any) => {
      const prev = out[out.length - 1];
      if (prev?.type === 'text' && c.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(c.marks ?? [])) prev.text += c.text;
      else out.push(c);
      return out;
    }, []);
  }
  if (!node?.marks) return node;
  for (const m of node.marks) {
    if (m.type !== 'textStyle' || !m.attrs) continue;
    if (m.attrs.textShadow && plainShadow) m.attrs.shadow = true;
    for (const k of ['textShadow', 'textOutline', 'textGlow', 'textFxRaw']) delete m.attrs[k];
  }
  node.marks = node.marks.filter((m: any) => m.type !== 'textStyle' || Object.values(m.attrs ?? {}).some((v) => v != null));
  if (!node.marks.length) delete node.marks;
  return node;
}
