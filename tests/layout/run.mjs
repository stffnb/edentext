// Layout run: corpus, showcase and fuzz seeds opened in the editor, the page count held
// against LibreOffice's PDF, the lines checked for overlap, margin escapes and stranded
// headings, and the page starts and load time held against tests/layout/baseline.json.
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename, extname, relative, sep } from 'node:path';
import { ROOT, checker, devServer, openApp, settle } from '../browser.mjs';
import { LOCAL_DOCS, LONG_DOCS, localDocs, longDocs, coreSet } from '../localDocs.mjs';

// `[regex]` limits the run by file name, `--no-cache` re-converts every document;
// LAYOUT_UPDATE=1 records the baseline for this engine and platform instead of holding
// the run against it. LAYOUT_LOCAL=all|0 runs every local document, long ones too
// (tests/localDocs.mjs), or none in place of their core set; `--plan` prints the choice.
const PORT = +(process.env.LAYOUT_PORT ?? 4188);
const SEEDS = +(process.env.LAYOUT_SEEDS ?? 10);
const UPDATE = process.env.LAYOUT_UPDATE === '1';
const args = process.argv.slice(2);
const NOCACHE = args.includes('--no-cache');
const pattern = args.find((a) => !a.startsWith('--'));
const only = pattern ? new RegExp(pattern) : null;
const has = (tool) => { try { execSync(`command -v ${tool}`, { stdio: 'ignore' }); return true; } catch { return false; } };
const LO = has('soffice') && has('pdfinfo');
const { check, failures } = checker();
// Line breaking is the engine's and the platform's, so each keeps its own baseline.
const BASE = join(ROOT, 'tests/layout/baseline.json');
const KEY = `${process.env.BROWSER ?? 'chromium'}/${process.platform}`;
const baseline = existsSync(BASE) ? JSON.parse(readFileSync(BASE, 'utf8')) : {};
// Page counts by the document's hash: a fresh soffice batch costs minutes, and a run
// after an editor change has nothing new for it to convert.
const COUNTS = process.env.LAYOUT_COUNTS ?? (existsSync(LOCAL_DOCS) ? join(LOCAL_DOCS, 'lo-pages.json') : join(ROOT, 'node_modules/.cache/layout-pages.json'));
const counts = (() => { try { return JSON.parse(readFileSync(COUNTS, 'utf8')); } catch { return {}; } })();
const known = baseline[KEY] ?? {};
const fresh = {};

const files = (dir) => (existsSync(dir)
  ? readdirSync(dir).filter((f) => /\.(odt|docx)$/.test(f) && !/^(~\$|\._)/.test(f)).sort().map((f) => join(dir, f))
  : []);
const docs = [...files(join(ROOT, 'tests/corpus')), ...files(join(ROOT, 'tests/corpus/word')), ...files(join(ROOT, 'docs/showcase'))];
// Local documents keep their record beside them. A run takes the new ones and the core
// set: the fewest, by load time, that still show every trait the folder holds.
const LOCAL_BASE = join(LOCAL_DOCS, 'layout-baseline.json');
const localAll = (() => { try { return JSON.parse(readFileSync(LOCAL_BASE, 'utf8')); } catch { return {}; } })();
const localKnown = localAll[KEY] ?? {};
const localFresh = {};
const hashes = new Map();
const sha = (p) => hashes.get(p) ?? hashes.set(p, createHash('sha1').update(readFileSync(p)).digest('hex').slice(0, 16)).get(p);
const isLocal = (file) => file.startsWith(LOCAL_DOCS);
const isLong = (file) => file.startsWith(LONG_DOCS + sep);
const nameOf = (file) => (isLong(file) ? `local/long/${basename(file)}` : isLocal(file) ? `local/${basename(file)}`
  : file.startsWith(ROOT) ? relative(ROOT, file) : `fuzz/${basename(file)}`);
const MODE = process.env.LAYOUT_LOCAL ?? 'core';
const dupes = new Set();
{
  // A byte-identical copy runs once, under the first name; long documents never join the
  // core set, only the full run or a pattern naming them.
  const first = new Map();
  const unique = (f) => {
    if (!first.has(sha(f))) return first.set(sha(f), f);
    console.log(`local duplicate: ${nameOf(f)} is ${nameOf(first.get(sha(f)))}, it can go`);
    dupes.add(nameOf(f));
  };
  const all = (MODE === '0' ? [] : localDocs()).filter(unique);
  const long = (MODE === '0' ? [] : longDocs()).filter(unique);
  // A changed file is a new document: what was recorded describes another one.
  const rec = (f) => { const e = localKnown[nameOf(f)]; return e && e.hash === sha(f) ? e : null; };
  const fresh = all.filter((f) => !rec(f));
  const core = coreSet(all.filter(rec).map((f) => ({ name: f, ms: rec(f).ms, traits: rec(f).traits ?? [] })));
  const take = MODE === 'all' || only ? [...all, ...long] : [...fresh, ...core.map((c) => c.name)];
  docs.push(...take);
  if (all.length) {
    const secs = Math.round(core.reduce((t, c) => t + c.ms, 0) / 1000);
    console.log(`local documents (${LOCAL_DOCS}): ${all.length}, of them ${fresh.length} new, ${core.length} the core set (~${secs}s)`
      + (MODE === 'all' || only ? `; all of them run, and ${long.length} long one(s)${only ? ' the pattern names' : ''}` : `; LAYOUT_LOCAL=all runs the other ${all.length - take.length}`));
  }
  if (long.length && MODE !== 'all' && !only) console.log(`long documents: ${long.length} wait for LAYOUT_LOCAL=all`);
  if (args.includes('--plan')) {
    for (const c of core) console.log(`  ${String(c.ms).padStart(6)}ms  ${basename(c.name)}  +${c.adds.length}: ${c.adds.slice(0, 6).join(' ')}${c.adds.length > 6 ? ' …' : ''}`);
    for (const f of fresh) console.log(`     new     ${basename(f)}`);
    process.exit(0);
  }
}
const work = mkdtempSync(join(tmpdir(), 'layout-'));
const server = await devServer(PORT);
const { browser, page, pageErrors } = await openApp(PORT);
if (!LO) console.log('soffice/pdfinfo missing: page counts are not held against LibreOffice');

// LibreOffice's page count from its PDF, the blank pages it inserts itself kept as the
// editor keeps them; one soffice call for the whole batch, under unique names. A count
// is the file's, never our code's, so only what the cache misses is converted.
function loPages(paths) {
  const key = sha;
  const keys = new Map(paths.map((p) => [p, key(p)]));
  const pages = new Map();
  const todo = paths.filter((p) => {
    const hit = !NOCACHE && counts[keys.get(p)];
    if (hit) pages.set(p, hit);
    return !hit;
  });
  console.log(`LibreOffice page counts: ${todo.length} to convert, ${pages.size} cached`);
  if (!todo.length) return pages;
  const inDir = join(work, 'in'), out = join(work, 'pdf');
  mkdirSync(inDir, { recursive: true }); mkdirSync(out, { recursive: true });
  const named = todo.map((p, i) => { const f = join(inDir, `${i}-${basename(p)}`); copyFileSync(p, f); return f; });
  // Long documents take LibreOffice minutes each; past the limit, what it did convert counts.
  try {
    execFileSync('soffice', ['--headless', '--norestore', `-env:UserInstallation=file://${work}/profile`, '--convert-to',
      'pdf:writer_pdf_Export:{"IsSkipEmptyPages":{"type":"boolean","value":"false"}}', '--outdir', out, ...named],
      { stdio: 'pipe', timeout: 900_000 + 300_000 * todo.filter(isLong).length });
  } catch (err) { console.log(`LibreOffice stopped: ${String(err.message).split('\n')[0]}`); }
  named.forEach((f, i) => {
    const pdf = join(out, basename(f, extname(f)) + '.pdf');
    const m = existsSync(pdf) && /Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' }));
    if (m) { pages.set(todo[i], +m[1]); counts[keys.get(todo[i])] = +m[1]; }
  });
  mkdirSync(dirname(COUNTS), { recursive: true });
  writeFileSync(COUNTS, JSON.stringify(counts));
  return pages;
}

// Runs in the browser: the rendered lines against the page sheets and the document's
// margins (single-section documents only: a later section may have margins of its own).
function lintLayout() {
  const paper = document.querySelector('.paper');
  const origin = paper.getBoundingClientRect();
  const rel = (r) => ({ top: r.top - origin.top, bottom: r.bottom - origin.top, left: r.left - origin.left, right: r.right - origin.left });
  const sheets = [...document.querySelectorAll('.page-sheet')].map((s) => rel(s.getBoundingClientRect()));
  const pageOf = (y) => sheets.findIndex((s) => y >= s.top - 1 && y <= s.bottom + 1);
  const cs = getComputedStyle(document.documentElement);
  const px = (v) => parseFloat(cs.getPropertyValue(v));
  const margins = { top: px('--user-margin-top'), bottom: px('--user-margin-bottom'), left: px('--user-margin-left'), right: px('--user-margin-right') };
  const oneSection = !cs.getPropertyValue('--pb-section-page').includes(',');
  const mirrored = /[1-9]/.test(cs.getPropertyValue('--pb-section-mirror'));
  const side = mirrored ? Math.min(margins.left, margins.right) : null;

  // Where a text node is painted: a frame may sit on the text by design, a formula
  // stacks its own boxes, and a hidden or spacer node is not painted at all.
  // `clips`: the boxes that cut the node's text off (an exact row's cell), `table`: the
  // outermost table around it, which the file may stand in the margin.
  let clips = [], table = null;
  const originOf = (node) => {
    clips = []; table = null;
    for (let e = node.parentElement; e && e !== paper; e = e.parentElement) {
      if (e.classList.contains('tableWrapper')) table = e;
      if (e.tagName === 'TD' || e.tagName === 'TH') { if (getComputedStyle(e).overflow !== 'visible') clips.push(rel(e.getBoundingClientRect())); }
      if (e.hasAttribute('data-page-break-spacer') || e.classList.contains('band-layer')) return null;
      if (e.classList.contains('page-decor-layer') || e.classList.contains('line-number-layer')) return null;
      if (e.classList.contains('hf-layer')) return 'hf';
      if (e.classList.contains('textbox-node') || e.classList.contains('image-node')) return 'frame';
      if (e.classList.contains('formula')) return 'formula';
      if (e.classList.contains('note')) return 'note';
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden') return null;
    }
    return 'body';
  };
  const lines = [];
  const walker = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const kind = originOf(n);
    if (!kind) continue;
    const within = table && rel(table.getBoundingClientRect());
    // Between the tabs: a tab's own box runs to its stop, past a cell's edge if need be.
    for (const m of n.nodeValue.matchAll(/[^\t]+/g)) {
      const range = document.createRange();
      range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
      for (const r of range.getClientRects()) {
        const b = rel(r);
        // What a clipping cell cuts off is not painted: an exact row hides the lines past it.
        for (const c of clips) { b.top = Math.max(b.top, c.top); b.bottom = Math.min(b.bottom, c.bottom); b.left = Math.max(b.left, c.left); b.right = Math.min(b.right, c.right); }
        if (b.right - b.left < 0.5 || b.bottom - b.top < 0.5) continue;
        lines.push({ ...b, kind, within, node: n, from: m.index, to: m.index + m[0].length, page: pageOf((b.top + b.bottom) / 2), text: m[0].trim().slice(0, 40) });
      }
    }
  }
  const issues = [];
  const box = (b) => [b.left, b.top, b.right, b.bottom].map(Math.round).join(',');
  const issue = (kind, l, extra = {}) => { if (issues.length < 60) issues.push({ kind, page: l.page + 1, text: l.text, at: l.left != null ? box(l) : undefined, ...extra }); };

  // Two painted lines on one page may not share their box (a frame may, a formula's
  // pieces may). ponytail: a sorted sweep, quadratic only across lines that share a band.
  lines.sort((a, b) => a.top - b.top);
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    if (a.kind === 'frame' || a.kind === 'formula') continue;
    for (let j = i + 1; j < lines.length && lines[j].top < a.bottom; j++) {
      const b = lines[j];
      if (b.kind === 'frame' || b.kind === 'formula' || b.page !== a.page) continue;
      const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      if (dy > 0.5 * Math.min(a.bottom - a.top, b.bottom - b.top) && dx > 2) issue('overlap', a, { other: b.text, otherKind: b.kind, otherAt: box(b) });
    }
  }
  // What each page begins with. A decoration (a squiggle, a mark, a language span) splits
  // the text node it covers, so the topmost fragment alone is not the page's first line —
  // it is whatever the DOM happened to break off. Join every body fragment sharing that
  // band, left to right and untrimmed, so the value describes the page and not the
  // decorations on it.
  const starts = sheets.map((_, i) => {
    const own = lines.filter((l) => l.page === i && (l.kind === 'body' || l.kind === 'note'));
    const first = own[0];
    if (!first) return '';
    const mid = (first.top + first.bottom) / 2;
    return own.filter((l) => l.top < mid && l.bottom > mid).sort((a, b) => a.left - b.left)
      .map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  });
  // The spaces a line ends with hang past it unpainted, so only its words count.
  const wordsOf = (l) => {
    const words = [];
    for (const m of l.node.nodeValue.slice(l.from, l.to).matchAll(/\S+/g)) {
      const range = document.createRange();
      range.setStart(l.node, l.from + m.index); range.setEnd(l.node, l.from + m.index + m[0].length);
      for (const r of range.getClientRects()) { const b = rel(r); if (b.bottom > l.top + 1 && b.top < l.bottom - 1) words.push(b); }
    }
    return words;
  };
  // Body text stays on a sheet and, in a single-section document, inside the margins.
  for (const l of lines) {
    if (l.kind !== 'body' && l.kind !== 'note') continue;
    if (l.page < 0) { issue('in the page gap', l); continue; }
    const s = sheets[l.page];
    const off = (b) => b.left < s.left - 1 || b.right > s.right + 1;
    if (off(l) && wordsOf(l).some(off)) issue('off the page', l, { sheet: box(s) });
    if (!oneSection) continue;
    const [ml, mr] = side == null ? [margins.left, margins.right] : [side, side];
    const body = { left: s.left + ml, top: s.top + margins.top, right: s.right - mr, bottom: s.bottom - margins.bottom };
    if (l.top < body.top - 3) issue('above the top margin', l, { body: box(body) });
    if (l.bottom > body.bottom + 3) issue('below the bottom margin', l, { body: box(body) });
    // ponytail: 6px of slack for a justified line's overhang and the sheet's own border.
    // A table stands where the file indents it, in the margin too; its text is held to it.
    const left = Math.min(body.left, l.within?.left ?? body.left) - 6, right = Math.max(body.right, l.within?.right ?? body.right) + 6;
    if (l.left >= left && l.right <= right) continue;
    if (wordsOf(l).some((b) => b.left < left || b.right > right)) issue('beyond the side margin', l, { body: box(body) });
  }
  // A heading stays with the block it introduces, across a page and a column alike,
  // unless that block asks for the break itself or the heading's file style drops the keep.
  const blocks = (parent) => [...parent.children].filter((e) => !e.hasAttribute('data-page-break-spacer'));
  for (const h of paper.querySelectorAll('.tiptap-host .tiptap :is(h1, h2, h3, h4, h5, h6)')) {
    if (h.closest('td, th, li, .textbox-node, .hf-layer') || h.dataset.keepNext === 'false') continue;
    const sib = blocks(h.parentElement);
    const next = sib[sib.indexOf(h) + 1];
    if (!next || next.classList.contains('note') || next.hasAttribute('data-page-break-before')) continue;
    const hr = rel(h.getBoundingClientRect()), nr = rel(next.getBoundingClientRect());
    if (hr.bottom - hr.top < 1 || nr.bottom - nr.top < 1) continue;
    const l = { page: pageOf(hr.bottom - 1), text: h.textContent.trim().slice(0, 40) };
    if (pageOf(nr.top + 1) !== l.page) issue('heading alone at the page end', l);
    else if (h.closest('.columns-node') && nr.left > hr.left + 5) issue('heading alone at the column end', l);
  }
  const tiptap = document.querySelector('.tiptap');
  if (tiptap.scrollWidth > tiptap.clientWidth + 1) issues.push({ kind: 'content wider than the page', page: 0, text: `${tiptap.scrollWidth}px in ${tiptap.clientWidth}px` });
  return { pages: sheets.length, lines: lines.length, starts, issues };
}

const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 30_000 });
  // The fuzz seeds, written by the app's own exporter in the page.
  mkdirSync(join(work, 'fuzz'), { recursive: true });
  for (let seed = 1; seed <= SEEDS; seed++) {
    const odt = await page.evaluate(async ({ seed, b64 }) => {
      const [{ buildOdt }, { mulberry32 }, { genCase, exportArgs }] = await Promise.all([
        import('/src/lib/export/odt.ts'), import('/tests/fuzzDoc.ts'), import('/tests/fuzzOptions.ts')]);
      const { doc, opts } = genCase(mulberry32(seed));
      return new Function('return ' + b64)()(await buildOdt(doc, ...exportArgs(opts)));
    }, { seed, b64: b64.toString() });
    const f = join(work, 'fuzz', `seed-${seed}.odt`);
    writeFileSync(f, Buffer.from(odt, 'base64'));
    docs.push(f);
  }
  const todo = docs.filter((d) => !only || only.test(d)).sort((a, b) => isLong(a) - isLong(b));
  const retried = new Set();
  const timings = [];
  const lo =LO ? loPages(todo) : new Map();

  for (const file of todo) {
    const name = nameOf(file);
    const local = isLocal(file);
    // A long document gets minutes to load and settle, and its reload minutes to tear down
    // the long one before it; one that needs more is a finding.
    const wait = isLong(file) ? 5 : 1;
    try {
    // A fresh editor for each document, so its settle cannot be the previous one's.
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load', timeout: 30_000 * wait });
    await page.waitForSelector('.tiptap', { timeout: 30_000 * wait });
    await page.evaluate(() => { window.__loadAt = performance.now(); });
    await page.setInputFiles('input.file-input[accept*=".odt"]', file);
    // The document's name says the file is in; a document may hold nothing to wait for.
    await page.waitForFunction((n) => document.querySelector('.doc-name-input')?.value.startsWith(n), basename(file, extname(file)), { timeout: 60_000 * wait });
    await settle(page, true, 180_000 * wait);
    // The layout's own time: from the file going in to the last change settle saw, so the
    // quiet period it waits out afterwards is not part of the measurement.
    const ms = await page.evaluate(() => Math.round((window.__paritySince - window.__loadAt) / 100) * 100);
    const r = await page.evaluate(lintLayout);
    // A settled document dispatches nothing: a plugin that keeps re-measuring puts the
    // selection back each frame, and a click then never sets the caret.
    const idle = await page.evaluate(async () => {
      const eds = Array.from(document.querySelectorAll('.tiptap')).map((e) => e.editor).filter(Boolean);
      const metas = new Set();
      const seen = ({ transaction }) => metas.add(Object.keys(transaction.meta).join('+') || 'plain');
      eds.forEach((ed) => ed.on('transaction', seen));
      await new Promise((done) => setTimeout(done, 400));
      eds.forEach((ed) => ed.off('transaction', seen));
      return [...metas];
    });
    if (idle.length) r.issues.push({ page: 1, kind: 'dispatches while idle', text: idle.join(', ') });
    // Where the pictures and boxes of the first pages' headers and footers stand: no line
    // of text moves with one, so the page starts alone would not show it shifting.
    const frames = await page.evaluate(() => {
      const sheets = Array.from(document.querySelectorAll('.page-sheet')).slice(0, 4).map((s) => s.getBoundingClientRect());
      const zoom = sheets[0] ? sheets[0].width / document.querySelector('.page-sheet').offsetWidth || 1 : 1;
      const out = [];
      for (const zone of document.querySelectorAll('.hf-zone')) {
        if (zone.closest('.hf-measure')) continue;
        for (const f of zone.querySelectorAll('.image-node, .textbox-node')) {
          if (f.parentElement.closest('.textbox-node')) continue;
          const b = (f.querySelector('.image-rotor, .textbox-rotor') ?? f).getBoundingClientRect();
          const i = sheets.findIndex((s) => b.top + b.height / 2 >= s.top && b.top + b.height / 2 <= s.bottom);
          if (i < 0) continue;
          const n = (v) => Math.round(v / zoom);
          out.push(`p${i + 1} ${zone.classList.contains('hf-footer') ? 'footer' : 'header'} ${n(b.left - sheets[i].left)},${n(b.top - sheets[i].top)} ${n(b.width)}x${n(b.height)}`);
        }
      }
      return out.sort();
    });
    // What a local document shows, by format: the choice of the core set rests on it.
    const traits = !local ? null : await page.evaluate(({ ext, zoneFrames }) => {
      const out = new Set();
      for (const el of document.querySelectorAll('.tiptap')) {
        const pre = el.closest('.hf-layer') ? 'zone-' : '';
        el.editor?.state.doc.descendants((n) => { out.add(pre + n.type.name); n.marks.forEach((m) => out.add(pre + m.type.name)); });
      }
      const sheets = Array.from(document.querySelectorAll('.page-sheet'), (s) => s.offsetWidth);
      if (getComputedStyle(document.documentElement).getPropertyValue('--pb-section-page').includes(',')) out.add('sections');
      if (new Set(sheets).size > 1) out.add('mixed-pages');
      if (zoneFrames) out.add('zone-frames');
      if (document.querySelector('.hf-zone table')) out.add('zone-table');
      for (const n of [20, 100]) if (sheets.length > n) out.add(`over-${n}-pages`);
      return [...out].sort().map((t) => `${ext}:${t}`);
    }, { ext: extname(file).slice(1).toLowerCase(), zoneFrames: frames.length });
    const ref = lo.get(file);
    const off = ref == null ? 0 : r.pages - ref;
    // A page or a tenth either way is the slack two layout engines take.
    const pagesOk = Math.abs(off) <= Math.max(1, Math.round((ref ?? 0) / 10));
    // What the baseline holds: where each page starts, and what the load cost.
    const hash = local ? sha(file) : null;
    const prev = local ? (localKnown[name]?.hash === hash ? localKnown[name] : undefined) : known[name];
    const entry = { pages: r.pages, lines: r.lines, ms, starts: r.starts, ...(frames.length ? { frames } : {}) };
    // A local document is recorded the first time it runs; its traits are kept current.
    if (!local) fresh[name] = entry;
    else localFresh[name] = { ...(prev && !UPDATE ? prev : entry), hash, traits, issues: UPDATE ? r.issues.length : prev?.issues ?? r.issues.length };
    // A local document's findings are recorded with it and held as a ceiling: a real-world
    // file rarely has none, and the run asks only that a change adds no more.
    const allowed = local ? localFresh[name].issues : 0;
    // Compared without its spaces: a decoration splits the text node it covers, and the
    // pieces are rejoined with one space whether the file had one there or not.
    const bare = (t) => String(t).replace(/\s+/g, '');
    const moved = prev ? r.starts.map((t, i) => [i + 1, t, prev.starts[i] ?? '—']).filter(([, a, b]) => bare(a) !== bare(b)) : [];
    // A frame a pixel or two off is rounding; a baseline older than the frames holds none.
    const nums = (row) => (row.match(/-?\d+/g) ?? []).map(Number);
    const was = prev?.frames ?? null;
    const shifted = !was ? [] : frames.length !== was.length ? [[`${frames.length} frame(s)`, `${was.length}`]]
      : frames.map((row, i) => [row, was[i]]).filter(([a, b]) => nums(a).some((v, k) => Math.abs(v - nums(b)[k]) > 2));
    if (prev?.ms != null) timings.push({ name, ms, was: prev.ms });
    const label = `${name}  editor ${r.pages}p${ref != null ? ` / LO ${ref}p` : ''}${off && pagesOk ? ' (~)' : ''}  ${r.issues.length} issue(s)${allowed ? `, ${allowed} known` : ''}${prev ? '' : ' (new)'}`;
    check(pagesOk && r.issues.length <= allowed && (UPDATE || (!moved.length && !shifted.length)), label);
    for (const [now, old] of shifted.slice(0, 5)) console.log(`    header/footer frame "${now}", the baseline has "${old}"`);
    for (const [pg, now, was] of moved.slice(0, 5)) console.log(`    p${pg} starts "${now}", the baseline has "${was}"`);
    if (moved.length > 5) console.log(`    … ${moved.length - 5} page start(s) more`);
    for (const i of r.issues.length > allowed || !prev ? r.issues.slice(0, 8) : []) {
      const where = i.other ? ` × ${i.otherKind} "${i.other}" @${i.otherAt}` : i.body ? ` (body ${i.body})` : i.sheet ? ` (sheet ${i.sheet})` : '';
      console.log(`    p${i.page} ${i.kind}: "${i.text}"${i.at ? ` @${i.at}` : ''}${where}`);
    }
    if (r.issues.length > 8 && (r.issues.length > allowed || !prev)) console.log(`    … ${r.issues.length - 8} more`);
    } catch (err) {
      // A layout that never settles is a finding of its own, not the end of the run; a
      // page torn down under the probe (the app's own reload) gets one more go.
      if (/Execution context was destroyed/.test(err.message) && !retried.has(file)) { retried.add(file); todo.push(file); continue; }
      check(false, `${name}: ${err.message.split('\n')[0]}`);
    }
  }
  // Loads are judged against the run's median slowdown (recorded times under half a second
  // count as half a second), so a busy machine slows every document alike and fails none;
  // one document over three times that median and over three times its record plus 1s fails.
  const factor = ({ ms, was }) => ms / Math.max(was, 500);
  const ratios = timings.map(factor).sort((a, b) => a - b);
  const median = ratios.length >= 5 ? Math.max(1, ratios[ratios.length >> 1]) : 1;
  if (median >= 1.5) console.log(`the whole run loaded ${median.toFixed(1)}× slower than the baseline; load times are judged against that`);
  if (!UPDATE) for (const t of timings) {
    if (t.ms > t.was * 3 + 1000 && factor(t) > 3 * median) check(false, `${t.name}  slower than the baseline: ${t.ms}ms against ${t.was}ms`);
  }
  if (Object.keys(localFresh).length) {
    const here = new Set([...localDocs(), ...longDocs()].map(nameOf).filter((n) => !dupes.has(n)));
    const kept = Object.entries({ ...localKnown, ...localFresh }).filter(([n]) => here.has(n)).sort();
    writeFileSync(LOCAL_BASE, JSON.stringify({ ...localAll, [KEY]: Object.fromEntries(kept) }, null, 1) + '\n');
  }
  if (UPDATE) {
    const merged = Object.fromEntries(Object.entries({ ...known, ...fresh }).sort());
    writeFileSync(BASE, JSON.stringify({ ...baseline, [KEY]: merged }, null, 1) + '\n');
    console.log(`baseline for ${KEY}: ${Object.keys(fresh).length} document(s) recorded`);
  } else if (!Object.keys(known).length) {
    console.log(`no baseline for ${KEY} — record one with LAYOUT_UPDATE=1`);
  }
} catch (err) {
  check(false, `layout run threw: ${err.stack ?? err}`);
} finally {
  check(pageErrors.length === 0, pageErrors.length ? `no uncaught page errors — got: ${pageErrors.join(' | ')}` : 'no uncaught page errors');
  await browser.close();
  if (server) process.kill(-server.pid);
}
process.exit(failures.length ? 1 : 0);
