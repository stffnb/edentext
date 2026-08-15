// Seeded random-document generator for the fuzz round-trip leg (fuzz-roundtrip.test.ts).
// ponytail: conservative node pool (no spans, notes, boxes); widen when it holds.
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
  if (maybe(r, 0.1)) out.push({ type: 'underline' });
  if (maybe(r, 0.1)) out.push({ type: 'strike' });
  if (maybe(r, 0.1)) out.push({ type: 'highlight', attrs: { color: pick(r, ['#FFFF00', '#00FF00']) } });
  if (maybe(r, 0.2)) {
    const attrs: N = {};
    if (maybe(r, 0.5)) attrs.color = pick(r, ['#C00000', '#0070C0']);
    if (!heading && maybe(r, 0.4)) attrs.fontFamily = 'Arial';
    if (!heading && maybe(r, 0.4)) attrs.fontSize = pick(r, ['10pt', '14pt', '18pt']);
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
function paraAttrs(r: Rng, indents: boolean): N | null {
  const attrs: N = {};
  if (maybe(r, 0.3)) attrs.textAlign = pick(r, ['left', 'center', 'right', 'justify']);
  if (maybe(r, 0.2)) attrs.lineHeight = pick(r, ['1.5', '2']);
  if (maybe(r, 0.15)) attrs.spaceBefore = pick(r, [6, 12]);
  if (maybe(r, 0.15)) attrs.spaceAfter = pick(r, [12, 18]);
  if (indents && maybe(r, 0.15)) attrs.indent = pick(r, [1.25, 2.5]);
  if (indents && maybe(r, 0.1)) attrs.indentFirst = pick(r, [0.75, -0.75]);
  if (indents && maybe(r, 0.1)) attrs.indentRight = 1.5;
  return Object.keys(attrs).length ? attrs : null;
}

function paragraph(r: Rng, indents = true): N {
  if (maybe(r, 0.08)) return { type: 'paragraph' }; // empty line
  const attrs = paraAttrs(r, indents);
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
    content: Array.from({ length: cols }, () => ({
      type: 'tableCell',
      attrs: { colspan: 1, rowspan: 1, colwidth: null },
      content: [paragraph(r)],
    })),
  }));
  return { type: 'table', content: rows };
}

export function genDoc(r: Rng): N {
  const blocks: N[] = [];
  let prev = '';
  for (let i = int(r, 1, 6); i > 0; i--) {
    const roll = r();
    let block: N;
    if (roll < 0.45) block = paragraph(r);
    else if (roll < 0.55) block = { type: 'heading', attrs: { level: int(r, 1, 6) }, content: runs(r, true) };
    else if (roll < 0.75) block = list(r, pick(r, ['bulletList', 'orderedList']), 0);
    else block = table(r);
    // adjacent same-type lists merge on import; keep them apart so identity holds
    if (block.type.endsWith('List') && block.type === prev) blocks.push({ type: 'paragraph' });
    blocks.push(block);
    prev = block.type;
  }
  return { type: 'doc', content: blocks };
}
