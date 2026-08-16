// Seeded random-document generator for the fuzz round-trip leg (fuzz-roundtrip.test.ts).
// ponytail: no boxes/images/formulas yet; widen when the current pool holds.
type N = any;
type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: Rng, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
const int = (r: Rng, min: number, max: number) => min + Math.floor(r() * (max - min + 1));
const maybe = (r: Rng, p: number) => r() < p;

// XML-hostile characters, umlauts, an astral-plane glyph and a tab on purpose.
const WORDS = ['Lorem', 'ipsum', 'Größe', 'fünf', 'a&b', '<tag>', '"quote"', "it's",
  '€42', '🙂ok', 'x\ty', 'dolor', 'sit'] as const;

// A heading run must not carry marks equal to the heading defaults (bold, italic on
// levels 4/6, Arial, the level's size) — both importers suppress default-equal values,
// so those are lossy by design. Headings get the marks with no heading default.
function marks(r: Rng, heading = false): N[] | undefined {
  const out: N[] = [];
  if (!heading && maybe(r, 0.25)) out.push({ type: 'bold' });
  if (!heading && maybe(r, 0.2)) out.push({ type: 'italic' });
  // A link excludes color/underline effects: the DOCX importer tells an editor link from
  // a styled foreign one by exactly that styling (link.ts `plain`), so it can't survive.
  if (maybe(r, 0.08)) {
    out.push({ type: 'link', attrs: { href: 'https://example.com/x?a=1&b=2' } });
    return out;
  }
  if (maybe(r, 0.1)) {
    const attrs: N = {};
    if (maybe(r, 0.3)) attrs.lineStyle = pick(r, ['dotted', 'double', 'dashed']);
    if (maybe(r, 0.2)) attrs.lineColor = '#FF0000';
    out.push({ type: 'underline', ...(Object.keys(attrs).length ? { attrs } : {}) });
  }
  if (maybe(r, 0.1)) {
    out.push(maybe(r, 0.25) ? { type: 'strike', attrs: { lineStyle: 'double' } } : { type: 'strike' });
  }
  const shifted = maybe(r, 0.08);
  if (shifted) out.push({ type: pick(r, ['superscript', 'subscript']) });
  if (maybe(r, 0.1)) out.push({ type: 'highlight', attrs: { color: pick(r, ['#FFFF00', '#00FF00']) } });
  if (maybe(r, 0.25)) {
    const attrs: N = {};
    if (maybe(r, 0.5)) attrs.color = pick(r, ['#C00000', '#0070C0']);
    if (!heading && maybe(r, 0.4)) attrs.fontFamily = 'Arial';
    if (!heading && maybe(r, 0.4)) attrs.fontSize = pick(r, ['10pt', '14pt', '18pt']);
    if (maybe(r, 0.2)) attrs.caps = pick(r, ['uppercase', 'smallCaps']);
    // sub/superscript and a free raise share ODF's one text-position attribute
    if (!shifted && maybe(r, 0.15)) attrs.textPosition = pick(r, [3, -2]);
    if (Object.keys(attrs).length) out.push({ type: 'textStyle', attrs });
  }
  return out.length ? out : undefined;
}

function runs(r: Rng, heading = false): N[] {
  const n = int(r, 1, 4);
  return Array.from({ length: n }, (_, i) => {
    const text = Array.from({ length: int(r, 1, 5) }, () => pick(r, WORDS)).join(' ')
      + (i < n - 1 ? ' ' : '');
    const m = marks(r, heading);
    return { type: 'text', text, ...(m ? { marks: m } : {}) };
  });
}

// indents=false inside list items: a list paragraph's indent lives in the list style
// and does not round-trip as direct formatting (import/odt.ts skips it there).
// top=false in cells/lists: the page-break sentinel rides top-level blocks only.
function paraAttrs(r: Rng, indents: boolean, top: boolean): N | null {
  const attrs: N = {};
  if (maybe(r, 0.3)) attrs.textAlign = pick(r, ['left', 'center', 'right', 'justify']);
  if (maybe(r, 0.2)) attrs.lineHeight = pick(r, ['1.5', '2']);
  if (maybe(r, 0.15)) attrs.spaceBefore = pick(r, [6, 12]);
  if (maybe(r, 0.15)) attrs.spaceAfter = pick(r, [12, 18]);
  if (indents && maybe(r, 0.15)) attrs.indent = pick(r, [1.25, 2.5]);
  if (indents && maybe(r, 0.1)) attrs.indentFirst = pick(r, [0.75, -0.75]);
  if (indents && maybe(r, 0.1)) attrs.indentRight = 1.5;
  if (top && maybe(r, 0.05)) attrs.breakBefore = 'page';
  return Object.keys(attrs).length ? attrs : null;
}

function paragraph(r: Rng, indents = true, top = false): N {
  if (maybe(r, 0.08)) return { type: 'paragraph' }; // empty line
  const attrs = paraAttrs(r, indents, top);
  const content = runs(r);
  const body: N[] = [];
  for (const run of content) {
    body.push(run);
    if (maybe(r, 0.1)) body.push({ type: 'hardBreak' });
  }
  return { type: 'paragraph', ...(attrs ? { attrs } : {}), content: body };
}

function list(r: Rng, kind: 'bulletList' | 'orderedList', depth: number): N {
  const items = Array.from({ length: int(r, 1, 3) }, () => {
    const kids: N[] = [paragraph(r, false)];
    if (depth < 2 && maybe(r, 0.25)) kids.push(list(r, pick(r, ['bulletList', 'orderedList']), depth + 1));
    return { type: 'listItem', content: kids };
  });
  // start only at the top level: applyListStartValues writes text:start-value for
  // top-level lists only, a nested list's start does not round-trip.
  const attrs: N = kind === 'orderedList' && depth === 0 && maybe(r, 0.2) ? { start: 3 } : null;
  return { type: kind, ...(attrs ? { attrs } : {}), content: items };
}

function table(r: Rng): N {
  const cols = int(r, 1, 3);
  const rows = Array.from({ length: int(r, 1, 3) }, () => ({
    type: 'tableRow',
    content: Array.from({ length: cols }, () => {
      const attrs: N = { colspan: 1, rowspan: 1, colwidth: null };
      // not #F2F2F2: that exact shade is HEADER_SHADE, whose bold is presentational
      if (maybe(r, 0.15)) attrs.backgroundColor = pick(r, ['#FFFF00', '#DDEEFF']);
      if (maybe(r, 0.1)) attrs.verticalAlign = pick(r, ['middle', 'bottom']);
      return { type: 'tableCell', attrs, content: [paragraph(r)] };
    }),
  }));
  return { type: 'table', content: rows };
}

// Roman labels for endnotes match the importer's default numbering.
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v'] as const;

export function genDoc(r: Rng): N {
  const blocks: N[] = [];
  const notes: N[] = [];
  let prev = '';
  const noteRef = (kind: 'footnote' | 'endnote'): N => {
    const n = notes.filter(x => x.attrs.kind === kind).length + 1;
    const text = kind === 'footnote' ? String(n) : ROMAN[n - 1];
    const id = `${kind[0]}${n}`;
    notes.push({ type: 'note', attrs: { id, kind, label: null, text },
      content: [{ type: 'text', text: `Note body ${id}` }] });
    return { type: 'noteRef', attrs: { id, kind, text } };
  };
  for (let i = int(r, 1, 6); i > 0; i--) {
    const roll = r();
    let block: N;
    if (roll < 0.45) {
      block = paragraph(r, true, true);
      if (block.content && maybe(r, 0.15)) block.content.push(noteRef(pick(r, ['footnote', 'endnote'])));
    }
    else if (roll < 0.55) block = { type: 'heading', attrs: { level: int(r, 1, 6) }, content: runs(r, true) };
    else if (roll < 0.75) block = list(r, pick(r, ['bulletList', 'orderedList']), 0);
    else block = table(r);
    // adjacent same-type lists merge on import; keep them apart so identity holds
    if (block.type.endsWith('List') && block.type === prev) blocks.push({ type: 'paragraph' });
    blocks.push(block);
    prev = block.type;
  }
  if (notes.length) blocks.push({ type: 'noteSection', content: notes });
  return { type: 'doc', content: blocks };
}
