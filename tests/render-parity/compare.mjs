// Pure comparison half of the harness: two rendered documents in, a list of
// differences out. Split from run.mjs so it can be tested without a browser.
const LINE_TOL_MM = 1.2;       // words within this vertical span are one line
const POS_TOL_MM = 1.0;        // reported as a position difference beyond this
const SYNC_WINDOW = 60;        // lines searched for a resync after a divergence
const BREAK_WINDOW = 80;       // lines within which two sides' page starts pair

// Both sides are reduced to the same shape before diffing: words sorted into
// lines by vertical band, then left to right.
export function toLines(words) {
  const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const w of sorted) {
    const last = lines[lines.length - 1];
    // Tops within a hair, or boxes that overlap by half the shorter one: a chapter
    // number set far larger than its title shares the title's baseline but starts a
    // long way above it, and banding by top alone reads that as two lines.
    const over = last ? Math.min(w.y + (w.h ?? 0), last.y2) - Math.max(w.y, last.y) : 0;
    if (last && (Math.abs(w.y - last.y) <= LINE_TOL_MM || over >= 0.5 * Math.min(w.h ?? 0, last.y2 - last.y))) {
      last.words.push(w);
      last.y = Math.min(last.y, w.y);
      last.y2 = Math.max(last.y2, w.y + (w.h ?? 0));
    } else lines.push({ y: w.y, y2: w.y + (w.h ?? 0), words: [w] });
  }
  return lines.map((l) => lineOf(l.y, l.words.sort((a, b) => a.x - b.x)));
}

const round = (n) => Math.round(n * 10) / 10;

const lineOf = (y, words) => ({
  y: round(y), x: round(words[0].x), x2: round(Math.max(...words.map((w) => w.x + w.w))),
  text: words.map((w) => w.text).join(' '), words,
});

// The editor draws list markers with CSS ::marker, which is not a text node and cannot
// be measured; LibreOffice's PDF has them as words. Drop a leading reference word only
// when that makes the two lines identical, so real content can never be skipped.
function withoutMarker(line) {
  return line.words.length > 1 ? lineOf(line.y, line.words.slice(1)) : null;
}

// One stream per side, in reading order: the two are aligned against each other as a
// whole, so a line the editor drops costs one report instead of every line after it.
const stream = (doc) => doc.pages.flatMap((p, i) =>
  toLines(p.words).map((l, k) => ({ ...l, page: i + 1, line: k + 1, n: norm(l.text) })));

// The reference line as it has to be read to match `b` — with its list marker dropped
// where that is what makes the two identical — or null when they are different lines.
function match(a, b) {
  if (a.n === b.n) return a;                  // normalized once per line, in `stream`
  const t = withoutMarker(a);
  return t && norm(t.text) === b.n ? { ...a, ...t, n: b.n } : null;
}

// The nearest pair of skips that puts the two streams back on the same line. Two
// consecutive matches are required: a page number or a lone word matches by accident
// often enough to resync on the wrong line and report the whole document as broken.
function resync(r, e, i, j) {
  for (let d = 1; d <= 2 * SYNC_WINDOW; d++) {
    for (let a = Math.max(0, d - SYNC_WINDOW); a <= Math.min(d, SYNC_WINDOW); a++) {
      const b = d - a;
      if (i + a >= r.length || j + b >= e.length || !match(r[i + a], e[j + b])) continue;
      const next = i + a + 1 >= r.length || j + b + 1 >= e.length || match(r[i + a + 1], e[j + b + 1]);
      if (next) return [a, b];
    }
  }
  return null;
}

// One cause, one report: neighbouring lines off by the same amount on the same page are
// one strut or spacing or band height, and a stretch of lines that never match — a
// contents block whose numbers are all off by one — is one region, not one report a row.
function collapse(issues) {
  const out = [];
  for (const i of issues) {
    const last = out[out.length - 1];
    const geo = i.kind === 'position' || i.kind === 'lineEnd';
    if (last && last.kind === i.kind && geo && !i.vertical
        && last.page === i.page && last.dxMm === i.dxMm && last.dyMm === i.dyMm) last.lines++;
    // Contiguous in the reference stream, not merely one report after the other:
    // divergences with clean text between them are separate causes.
    else if (last && last.kind === i.kind && !geo && last.at + last.refLines === i.at) {
      last.refLines += i.refLines; last.edLines += i.edLines;
      if (!i.follows) delete last.follows;
    } else out.push({ ...i, ...(geo ? { lines: 1 } : {}) });
  }
  for (const i of out) { delete i.at; delete i.jat; }
  return out;
}

// A page start one side has and the other has not pairs with the other side's nearest
// one: the page then starts `carry` lines later in the editor (negative: earlier). A page that
// starts as many lines off as the one before it only carries that difference on.
function pageBreaks(starts) {
  const out = [];
  let carry = 0;
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k], o = starts[k + 1];
    if (s.ref && s.ed) { carry = 0; continue; }
    if (o && o.ref !== o.ed && o.ref !== s.ref && o.at - s.at <= BREAK_WINDOW) {
      const [r, e] = s.ref ? [s, o] : [o, s];
      const lines = e.at - r.at;
      out.push({ kind: 'pageBreak', page: r.page, line: r.line, edPage: e.edPage, carry: lines, text: r.text,
        ...(lines === carry ? { follows: true } : {}) });
      carry = lines; k++;
    } else {
      // A page only one side starts, while the pages already run off, is where that ends.
      out.push({ kind: 'pageBreak', page: s.page, line: s.line, edPage: s.edPage, only: s.ref ? 'ref' : 'editor', text: s.text,
        ...(carry ? { follows: true } : {}) });
      carry = 0;
    }
  }
  return out;
}

// Raw issues, one per divergent line or region. A `position` the line before it already
// carried is marked `follows`, as is a page start that only carries an earlier one on:
// consequences, kept for diagnosis but not counted as causes (`summarize`).
export function compare(ref, ed) {
  const issues = [];
  if (ref.pages.length !== ed.pages.length) {
    issues.push({ kind: 'pageCount', ref: ref.pages.length, editor: ed.pages.length });
  }
  const r = stream(ref), e = stream(ed);
  const starts = [], pairs = [];
  let i = 0, j = 0, prev = null, anchor = 0, uneven = false;
  while (i < r.length && j < e.length) {
    const a = match(r[i], e[j]);
    if (!a) {
      // No resync in reach: report this line and step both sides, rather than declaring
      // the documents parted — a contents block of numbers all off by one has no two
      // consecutive matching rows, and giving up there hides everything behind it.
      const [da, db] = resync(r, e, i, j) ?? [1, 1];
      issues.push({
        kind: da && db ? 'lineBreak' : 'lineCount', page: r[i].page, line: r[i].line,
        ref: r[i].text, editor: e[j].text, refLines: da, edLines: db, at: i, jat: j,
      });
      uneven ||= da !== db;
      i += da; j += db;
      continue;
    }
    const b = e[j];
    const dx = round(b.x - a.x), dy = round(b.y - a.y);
    const topR = !prev || a.page !== prev.a.page, topE = !prev || b.page !== prev.b.page;
    if (topR || topE) starts.push({ ref: topR, ed: topE, at: i, page: a.page, line: a.line, edPage: b.page, text: a.text.slice(0, 48) });
    // Vertically a line is measured against the line before it: an offset it inherits is
    // not its own. A page top is measured against the page; a page one side starts
    // alone, or lines one side spent more of, explain the offset and restart the count.
    let vertical = null, by = 0;
    if (topR !== topE || (uneven && !topR)) anchor = dy;
    else {
      if (topR) anchor = 0;
      const from = topR ? 0 : prev.dy;
      if (Math.abs(dy - from) > POS_TOL_MM) { vertical = 'step'; by = dy - from; }
      // Each line a little further off — a line pitch — adds up to a cause of its own.
      else if (Math.abs(dy - anchor) > POS_TOL_MM) { vertical = 'drift'; by = dy - anchor; }
      if (vertical) anchor = dy;
    }
    uneven = false;
    const loc = { page: a.page, line: a.line, ...(b.page !== a.page ? { edPage: b.page } : {}) };
    const off = Math.abs(dx) > POS_TOL_MM;
    if (vertical || off || Math.abs(dy) > POS_TOL_MM) {
      issues.push({ kind: 'position', ...loc, text: a.text.slice(0, 48), dxMm: dx, dyMm: dy,
        ...(vertical ? { vertical, byMm: round(by) } : off ? {} : { follows: true }) });
    }
    // The line's end catches what its start cannot: tab stops, justification and
    // any per-word drift that leaves the first word in place.
    const dEnd = round(b.x2 - a.x2);
    if (Math.abs(dEnd - dx) > POS_TOL_MM) {
      issues.push({ kind: 'lineEnd', ...loc, text: a.text.slice(0, 48), dxMm: dEnd });
    }
    pairs.push({ page: a.page, y: a.y, edPage: b.page, dx, dy });
    prev = { a, b, dy };
    i++; j++;
  }
  if (i < r.length || j < e.length) {
    issues.push({ kind: 'lineCount', page: (r[i] ?? e[j]).page, line: (r[i] ?? e[j]).line, at: i, jat: j,
      ref: r[i]?.text ?? null, editor: e[j]?.text ?? null, refLines: r.length - i, edLines: e.length - j });
  }
  const order = (x) => x.kind === 'pageCount' ? -1 : x.page * 1e4 + (x.line ?? 0);
  // The same lines in another order — a body line and a running foot swapping places
  // where one side's page ends earlier — are that page break's doing, not a wrap.
  const lines = (s, from, n) => s.slice(from, from + n).map((l) => l.n).sort().join('\n');
  for (const x of issues) if (x.refLines && lines(r, x.at, x.refLines) === lines(e, x.jat, x.edLines)) x.follows = true;
  return [...collapse(issues), ...pageBreaks(starts), ...compareImages(ref.images, ed.images, pairs)]
    .sort((x, y) => order(x) - order(y));
}

// What a raw issue is a symptom of: fixing one cause tends to clear its whole group.
const ROOT = {
  pageCount: () => 'pages', pageBreak: () => 'pageBreak', lineBreak: () => 'wrap',
  lineCount: (i) => (i.refLines && i.edLines ? 'wrap' : 'content'),
  position: (i) => (i.vertical ? 'vertical' : 'horizontal'), lineEnd: () => 'width',
  image: () => 'image', imageCount: () => 'image',
};
export const ROOTS = ['pages', 'pageBreak', 'content', 'wrap', 'vertical', 'horizontal', 'width', 'image'];
const GEO = new Set(['vertical', 'horizontal', 'width']);
const RUNNING = new Set([...GEO, 'wrap', 'content']);

// The causes behind `compare`'s issues: consequences dropped, neighbouring lines of one
// root kind on a page folded (a font's width shows on every line it touches), and so is
// the same text on another page, page numbers aside: a running head or foot is one cause.
export function summarize(issues, pages = 1) {
  const causes = [], open = {}, running = new Map();
  for (const i of issues) {
    if (i.follows) continue;
    const root = ROOT[i.kind](i);
    // A drift is one per page however many lines it takes to cross the tolerance again.
    const slot = i.vertical === 'drift' ? 'drift' : root;
    const last = open[slot], end = i.line + (i.lines ?? 1) - 1;
    if (GEO.has(root) && last && last.page === i.page && (slot === 'drift' || i.line <= last.end + 1)) {
      last.end = Math.max(last.end, end); last.n++;
      continue;
    }
    const key = RUNNING.has(root) && `${root}:${norm(i.text ?? i.ref ?? i.editor).replace(/\d+/g, '#')}`;
    const seen = key && running.get(key);
    if (seen && seen.page !== i.page) { seen.n++; (seen.pages ??= [seen.page]).push(i.page); continue; }
    causes.push(open[slot] = { root, page: i.page, line: i.line, end, n: 1, issue: i });
    if (key && !seen) running.set(key, open[slot]);
  }
  const kinds = Object.fromEntries(ROOTS.map((k) => [k, causes.filter((c) => c.root === k).length]));
  const first = causes.find((c) => c.root !== 'pages') ?? causes[0] ?? null;
  return { causes: causes.length, raw: issues.length, per10: round(causes.length / Math.max(1, pages) * 10),
    kinds, first, list: causes, keys: causes.map(keyOf) };
}

// A cause by what it is, not where: a line moving a page on keeps its key, so two runs'
// keys tell which causes are new and which went away.
const keyOf = (c) => {
  const i = c.issue;
  const what = i.kind === 'pageCount' ? '' : i.wMm ? `${Math.round(i.wMm)}x${Math.round(i.hMm)}` : norm(i.text ?? i.ref ?? i.editor ?? '').slice(0, 32);
  return `${c.root}:${what}`;
};

// Two runs' cause keys as multisets: what this run has that the last had not, and back.
export function diffCauses(now, was) {
  const left = new Map();
  for (const k of was) left.set(k, (left.get(k) ?? 0) + 1);
  const added = [];
  for (const k of now) if (left.get(k)) left.set(k, left.get(k) - 1); else added.push(k);
  return { added, gone: [...left].flatMap(([k, n]) => Array(n).fill(k)) };
}

// Whitespace-insensitive, and blind to the invisible joiners a note anchor leaves
// behind: the engines needn't agree on word boundaries, only on what sits on a line. A
// tab or index leader collapses to one token too — both end the fill at the same stop.
const norm = (s) => s.replace(/[\s\u00a0\u00ad\u200b\u2060\ufeff]+/g, '').replace(/([.\u00b7_-])\1{2,}/g, '\u2026');


// Pictures, which pdftotext cannot see: each reference picture pairs with the editor's
// nearest to it, page first, where one of about its size (a tenth either way) counts two
// pages nearer — so alike icons pair by place and one pushed a page on still finds itself.
const SIZE_TOL_MM = 1.5;
export function compareImages(ref = [], ed = [], lines = []) {
  const issues = [], left = [...ed];
  const at = (i) => ({ page: i.page + 1, wMm: round(i.w), hMm: round(i.h) });
  for (const a of ref) {
    let best = -1, cost = Infinity;
    left.forEach((b, k) => {
      const alike = Math.abs(a.w - b.w) <= 0.1 * a.w && Math.abs(a.h - b.h) <= 0.1 * a.h;
      const c = (alike ? 0 : 2e6) + Math.abs(a.page - b.page) * 1e6 + Math.hypot(a.x - b.x, a.y - b.y)
        + 10 * (Math.abs(a.w - b.w) + Math.abs(a.h - b.h));
      if (c < cost) { best = k; cost = c; }
    });
    if (best < 0) { issues.push({ kind: 'imageCount', side: 'ref', ...at(a) }); continue; }
    const [b] = left.splice(best, 1);
    const dx = round(b.x - a.x), dy = round(b.y - a.y), dw = round(b.w - a.w), dh = round(b.h - a.h);
    if (a.page !== b.page || Math.abs(dx) > POS_TOL_MM || Math.abs(dy) > POS_TOL_MM
        || Math.abs(dw) > SIZE_TOL_MM || Math.abs(dh) > SIZE_TOL_MM) {
      // A picture that moved with the text nearest it (`lines`, compare's aligned lines) follows it.
      const near = nearest(lines, a);
      const moved = near && near.edPage === b.page + 1 && Math.abs(dx - near.dx) <= POS_TOL_MM
        && Math.abs(dy - near.dy) <= POS_TOL_MM && Math.abs(dw) <= SIZE_TOL_MM && Math.abs(dh) <= SIZE_TOL_MM;
      issues.push({ kind: 'image', ...at(a), edPage: b.page + 1, dxMm: dx, dyMm: dy, dwMm: dw, dhMm: dh,
        ...(moved ? { follows: true } : {}) });
    }
  }
  for (const b of left) issues.push({ kind: 'imageCount', side: 'editor', ...at(b) });
  return issues;
}

// The aligned line on the picture's page closest to it vertically, above, beside or below.
function nearest(lines, img) {
  let best = null, gap = Infinity;
  for (const l of lines) {
    if (l.page !== img.page + 1) continue;
    const d = l.y < img.y ? img.y - l.y : Math.max(0, l.y - img.y - img.h);
    if (d < gap) { best = l; gap = d; }
  }
  return best;
}
