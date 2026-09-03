// Pure comparison half of the harness: two rendered documents in, a list of
// differences out. Split from run.mjs so it can be tested without a browser.
const LINE_TOL_MM = 1.2;       // words within this vertical span are one line
const POS_TOL_MM = 1.0;        // reported as a position difference beyond this
const SYNC_WINDOW = 60;        // lines searched for a resync after a divergence

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
    if (last && last.kind === i.kind && geo
        && last.page === i.page && last.dxMm === i.dxMm && last.dyMm === i.dyMm) last.lines++;
    // Contiguous in the reference stream, not merely one report after the other:
    // divergences with clean text between them are separate causes.
    else if (last && last.kind === i.kind && !geo && last.at + last.refLines === i.at) {
      last.refLines += i.refLines; last.edLines += i.edLines;
    } else out.push({ ...i, ...(geo ? { lines: 1 } : {}) });
  }
  for (const i of out) delete i.at;
  return out;
}

export function compare(ref, ed) {
  const issues = [];
  if (ref.pages.length !== ed.pages.length) {
    issues.push({ kind: 'pageCount', ref: ref.pages.length, editor: ed.pages.length });
  }
  const r = stream(ref), e = stream(ed);
  let i = 0, j = 0, shift = 0;
  while (i < r.length && j < e.length) {
    const a = match(r[i], e[j]);
    if (!a) {
      // No resync in reach: report this line and step both sides, rather than declaring
      // the documents parted — a contents block of numbers all off by one has no two
      // consecutive matching rows, and giving up there hides everything behind it.
      const [da, db] = resync(r, e, i, j) ?? [1, 1];
      issues.push({
        kind: da && db ? 'lineBreak' : 'lineCount', page: r[i].page, line: r[i].line,
        ref: r[i].text, editor: e[j].text, refLines: da, edLines: db, at: i,
      });
      i += da; j += db;
      continue;
    }
    const b = e[j];
    if (b.page - a.page !== shift) {
      shift = b.page - a.page;
      issues.push({ kind: 'pageShift', page: a.page, edPage: b.page, by: shift, text: a.text.slice(0, 48) });
    }
    const dx = round(b.x - a.x), dy = round(b.y - a.y);
    const loc = { page: a.page, line: a.line, ...(shift ? { edPage: b.page } : {}) };
    if (Math.abs(dx) > POS_TOL_MM || Math.abs(dy) > POS_TOL_MM) {
      issues.push({ kind: 'position', ...loc, text: a.text.slice(0, 48), dxMm: dx, dyMm: dy });
    }
    // The line's end catches what its start cannot: tab stops, justification and
    // any per-word drift that leaves the first word in place.
    const dEnd = round(b.x2 - a.x2);
    if (Math.abs(dEnd - dx) > POS_TOL_MM) {
      issues.push({ kind: 'lineEnd', ...loc, text: a.text.slice(0, 48), dxMm: dEnd });
    }
    i++; j++;
  }
  if (i < r.length || j < e.length) {
    issues.push({ kind: 'lineCount', page: (r[i] ?? e[j]).page, line: (r[i] ?? e[j]).line, at: i,
      ref: r[i]?.text ?? null, editor: e[j]?.text ?? null, refLines: r.length - i, edLines: e.length - j });
  }
  return collapse(issues);
}

// Whitespace-insensitive, and blind to the invisible joiners a note anchor leaves
// behind: the engines needn't agree on word boundaries, only on what sits on a line. A
// tab or index leader collapses to one token too — both end the fill at the same stop.
const norm = (s) => s.replace(/[\s\u00a0\u00ad\u200b\u2060\ufeff]+/g, '').replace(/([.\u00b7_-])\1{2,}/g, '\u2026');

