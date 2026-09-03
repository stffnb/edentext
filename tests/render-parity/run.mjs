// Render-parity harness: opens a document in LibreOffice and in the editor, then
// compares the resulting text layout (pages, lines, positions in mm).
// Usage and prerequisites — including the mandatory font setup — are in README.md.
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, basename, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { compare, toLines } from './compare.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const CHROME = process.env.PARITY_CHROME ?? chromium.executablePath();
const PORT = +(process.env.PARITY_PORT ?? 5199);   // reuse a dev server already up
const PAGE_GAP = 20;           // pageBreaks.ts
const PT_MM = 25.4 / 72;
const PX_MM = 25.4 / 96;
const QUICK_PAGES = 50;        // --quick skips what last measured longer than this
const CACHE = process.env.PARITY_CACHE ?? join(ROOT, 'node_modules/.cache/render-parity');
// Keep the blank pages LibreOffice inserts itself (a chapter forced onto a right page):
// its PDF export drops them by default and the reference then loses a sheet the
// document really has.
const LO_ARGS = ['--convert-to',
  'pdf:writer_pdf_Export:{"IsSkipEmptyPages":{"type":"boolean","value":"false"}}'];

// ---------------------------------------------------------------- reference

// The reference depends on the file and the export arguments, never on our code, so a
// re-run after an editor change reuses it: the corpus measured 9:00 cold, 5:41 cached.
// `--no-cache` after installing or removing a font, which does change what LO renders.
function loRender(file, work, cache) {
  const key = createHash('sha1').update(LO_ARGS.join('\0')).update(readFileSync(file)).digest('hex').slice(0, 16);
  const pdf = join(CACHE, key + '.pdf');
  const xml = join(CACHE, key + '.xml');
  const hit = cache && existsSync(xml);
  if (!hit) {
    execFileSync('soffice', [
      '--headless', '--norestore', `-env:UserInstallation=file://${work}/loprofile`,
      ...LO_ARGS, '--outdir', work, file,
    ], { stdio: 'pipe', timeout: 120_000 });
    const out = join(work, basename(file, extname(file)) + '.pdf');
    if (!existsSync(out)) throw new Error(`LibreOffice produced no PDF for ${file}`);
    execFileSync('pdftotext', ['-bbox-layout', out, join(work, 'ref.xml')], { stdio: 'pipe' });
    mkdirSync(CACHE, { recursive: true });
    copyFileSync(out, pdf);
    copyFileSync(join(work, 'ref.xml'), xml);
  }
  return { pages: parseBbox(readFileSync(xml, 'utf8')), pdf, cached: hit };
}

// pdftotext -bbox-layout emits <page><flow><block><line><word>, coords in pt,
// origin top-left of the page.
function parseBbox(xml) {
  const pages = [];
  for (const [, attrs, body] of xml.matchAll(/<page ([^>]*)>([\s\S]*?)<\/page>/g)) {
    const words = [];
    for (const [, wattrs, text] of body.matchAll(/<word ([^>]*)>([\s\S]*?)<\/word>/g)) {
      const a = num(wattrs);
      const t = decode(text);
      if (t) words.push({ text: t, x: a.xMin * PT_MM, y: a.yMin * PT_MM, w: (a.xMax - a.xMin) * PT_MM, h: (a.yMax - a.yMin) * PT_MM });
    }
    const a = num(attrs);
    pages.push({ words, width: a.width * PT_MM, height: a.height * PT_MM });
  }
  return pages;
}

const num = (s) => Object.fromEntries([...s.matchAll(/(\w+)="([-\d.]+)"/g)].map(([, k, v]) => [k, +v]));
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();

// ------------------------------------------------------------------- editor

async function editorRender(browser, file) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('dialog', (d) => d.accept());
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('edentext-zoom', '100');   // no transform scale => rects are doc px
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap');
  await page.setInputFiles('input.file-input', file);
  await settle(page);
  const result = await page.evaluate(extractLayout);
  await page.close();
  return result;
}

// Pagination (and the columns flow) runs over several frames; wait for the page
// count and document height to stop moving. An image still decoding has no height
// yet and would settle the layout at a page count it leaves again a frame later.
async function settle(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('.tiptap');
    // Importing a large file takes seconds; an editor still empty is not "settled",
    // it is the blank document the file has not replaced yet.
    if (!el || !el.textContent.trim()) return false;
    const imgs = Array.from(document.querySelectorAll('.paper img'));
    if (imgs.some((i) => !i.complete)) return false;
    // The spacers' heights too, not just their count: they go on settling for a while
    // after the last one is placed, and the page a line lands on moves with them.
    const spacers = Array.from(document.querySelectorAll('[data-page-break-spacer]'));
    // The index's page numbers settle after the spacers do — a stale one is a line of
    // text that still changes.
    const toc = Array.from(document.querySelectorAll('.toc-page')).map((t) => t.textContent).join(',');
    const key = el.style.minHeight + '|' + el.children.length + '|' + spacers.length + '|'
      + spacers.reduce((sum, s) => sum + s.offsetHeight, 0) + '|' + toc;
    const w = window;
    if (w.__parityKey !== key) { w.__parityKey = key; w.__paritySince = performance.now(); return false; }
    return performance.now() - (w.__paritySince ?? 0) > 3000;
    // Polled, not per frame: the predicate walks every spacer and index row, and on a
  // 60-page document doing that each frame starves the layout it is waiting for.
  }, null, { timeout: 180_000, polling: 500 });
}

// Runs in the browser: every rendered word with its page and mm position.
function extractLayout() {
  const PAGE_GAP = 20, PX_MM = 25.4 / 96;
  const paper = document.querySelector('.paper');
  const cs = getComputedStyle(document.documentElement);
  const pageH = parseFloat(cs.getPropertyValue('--user-page-height'));
  const pageW = parseFloat(cs.getPropertyValue('--user-page-width'));
  const cycle = pageH + PAGE_GAP;
  const origin = paper.getBoundingClientRect();

  const skip = (node) => {
    for (let e = node.parentElement; e && e !== paper; e = e.parentElement) {
      if (e.hasAttribute('data-page-break-spacer') || e.classList.contains('band-layer')) return true;
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden') return true;
    }
    return false;
  };

  // A word broken mid-word — a token wider than its line, or one carrying a hyphen or a
  // slash — has a client rect per line, and pdftotext reads those as separate words. So
  // split it the same way, by the line each character lands on.
  const fragments = (node, from, to) => {
    const r = document.createRange();
    r.setStart(node, from); r.setEnd(node, to);
    const rects = r.getClientRects();
    const whole = (rect) => ({ top: rect.top, left: rect.left, width: rect.width, height: rect.height, text: node.nodeValue.slice(from, to) });
    if (rects.length < 2) return rects.length ? [whole(rects[0])] : [];
    const out = [];
    for (let i = from; i < to; i++) {
      const c = document.createRange();
      c.setStart(node, i); c.setEnd(node, i + 1);
      const rect = c.getClientRects()[0];
      if (!rect) continue;
      const last = out[out.length - 1];
      if (last && Math.abs(last.top - rect.top) < 1) { last.text += node.nodeValue[i]; last.right = rect.right; }
      else out.push({ top: rect.top, left: rect.left, right: rect.right, height: rect.height, text: node.nodeValue[i] });
    }
    return out.map((f) => ({ top: f.top, left: f.left, width: f.right - f.left, height: f.height, text: f.text }));
  };

  // What the page paints, not what the node holds: a style's fo:text-transform /
  // w:caps is a CSS transform here and real uppercase in the reference's PDF.
  const painted = (text, el) => {
    const t = getComputedStyle(el).textTransform;
    if (t === 'uppercase') return text.toUpperCase();
    if (t === 'lowercase') return text.toLowerCase();
    if (t === 'capitalize') return text.replace(/^\p{L}/u, (c) => c.toUpperCase());
    return text;
  };

  const words = [];
  const walker = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue;
    if (!text || !text.trim() || skip(n)) continue;
    for (const m of text.matchAll(/\S+/g)) {
      for (const f of fragments(n, m.index, m.index + m[0].length)) {
        if (!f.width) continue;
        const y = f.top - origin.top;
        const page = Math.floor(y / cycle);
        words.push({
          text: painted(f.text, n.parentElement),
          page,
          x: (f.left - origin.left) * PX_MM,
          y: (y - page * cycle) * PX_MM,
          w: f.width * PX_MM,
          h: f.height * PX_MM,
        });
      }
    }
  }
  // Folded, not spread: a several-hundred-page document has more words than a call
  // takes arguments, and Math.max(...words) then blows the stack instead of measuring.
  const numPages = words.reduce((m, w) => (w.page > m ? w.page : m), 0) + 1;
  const pages = Array.from({ length: numPages }, (_, i) => ({
    words: words.filter((w) => w.page === i).map(({ page, ...r }) => r),
    width: pageW * PX_MM,
    height: pageH * PX_MM,
  }));
  const mm = (v) => parseFloat(cs.getPropertyValue(v)) * PX_MM;
  return {
    pages,
    margins: { top: mm('--user-margin-top'), bottom: mm('--user-margin-bottom'),
               left: mm('--user-margin-left'), right: mm('--user-margin-right') },
  };
}

// ------------------------------------------------------------------- driver

async function devServer() {
  const up = await fetch(`http://localhost:${PORT}/`).then(() => true).catch(() => false);
  if (up) return null;
  const proc = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await fetch(`http://localhost:${PORT}/`).then(() => true).catch(() => false)) return proc;
  }
  throw new Error('dev server did not start');
}

function corpus(args) {
  const paths = args.length ? args : [join(HERE, '..', 'corpus'), join(HERE, 'fixtures')];
  const out = [];
  for (const p of paths) {
    const abs = resolve(p);
    const stat = existsSync(abs) && readdirSync(dirname(abs)).length >= 0;
    if (!stat) continue;
    try {
      // `~$name` is the lock file a word processor leaves beside a document it has open —
      // opening a fixture to compare it by eye would otherwise add it to the corpus.
      for (const f of readdirSync(abs)) if (/\.(docx|odt)$/i.test(f) && !f.startsWith('~$')) out.push(join(abs, f));
    } catch { out.push(abs); }
  }
  return out.sort();
}

// The last run's issue count per file, so a re-run prints what a change moved instead
// of leaving the arithmetic to whoever reads two reports side by side.
const BASELINE = join(CACHE, 'baseline.json');
const readBaseline = () => {
  try { return JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { return {}; }
};

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const cache = !args.includes('--no-cache');
const jsonAt = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const baseline = args.includes('--no-baseline') ? null : readBaseline();
let files = corpus(args.filter((a) => !a.startsWith('--') && a !== jsonAt));
if (args.includes('--quick')) {
  const long = files.filter((f) => (baseline?.[basename(f)]?.refPages ?? 0) > QUICK_PAGES);
  files = files.filter((f) => !long.includes(f));
  if (long.length) console.log(`--quick: skipping ${long.length} document(s) over ${QUICK_PAGES} pages`);
}
if (!files.length) { console.error('no .docx/.odt files found'); process.exit(2); }

const server = await devServer();
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const work = mkdtempSync(join(tmpdir(), 'parity-'));
const report = [];

for (const file of files) {
  const name = basename(file);
  try {
    const ref = loRender(file, work, cache);
    const ed = await editorRender(browser, file);
    const issues = compare(ref, ed);
    report.push({
      file: name, refPages: ref.pages.length, editorPages: ed.pages.length, issues,
      ...(jsonAt ? {
        ref: ref.pages.map((p) => toLines(p.words)),
        editor: ed.pages.map((p) => toLines(p.words)),
        margins: ed.margins,
      } : {}),
    });
    const was = baseline?.[name]?.issues;
    console.log(`\n${issues.length ? '✗' : '✓'} ${name}  (LO ${ref.pages.length}p / editor ${ed.pages.length}p)`
      + `  ${issues.length} ${delta(issues.length, was)}${ref.cached ? '  [cached]' : ''}`);
    for (const i of issues.slice(0, 12)) console.log('   ', fmt(i));
    if (issues.length > 12) console.log(`    … ${issues.length - 12} more`);
  } catch (err) {
    report.push({ file: name, error: String(err.message ?? err) });
    console.log(`\n! ${name}  ${err.message ?? err}`);
  }
}

// Only what this run measured: a single-fixture run says what that fixture moved and
// leaves the other files' recorded counts alone.
const done = report.filter((r) => !r.error);
const total = done.reduce((n, r) => n + r.issues.length, 0);
const seen = done.filter((r) => baseline?.[r.file]);
const before = seen.reduce((n, r) => n + baseline[r.file].issues, 0);
console.log(`\ntotal ${total} across ${done.length} document(s)`
  + (seen.length === done.length ? `  ${delta(total, before)}`
     : seen.length ? `  (${done.length - seen.length} without a baseline)` : ''));

if (baseline) {
  for (const r of done) baseline[r.file] = { issues: r.issues.length, refPages: r.refPages };
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(BASELINE, JSON.stringify(baseline, null, 2));
}

function delta(now, was) {
  if (was == null) return '(new)';
  return now === was ? '(unchanged)' : `(was ${was}, ${now > was ? '+' : '\u2212'}${Math.abs(now - was)})`;
}

function fmt(i) {
  const at = `p${i.page}${i.edPage ? `\u2192ed p${i.edPage}` : ''} l${i.line}`;
  const n = i.lines > 1 ? ` \u00d7${i.lines}` : '';
  if (i.kind === 'pageCount') return `pages: LO ${i.ref}, editor ${i.editor}`;
  if (i.kind === 'pageShift') return `p${i.page}: the editor runs ${i.by > 0 ? '+' : ''}${i.by} page(s) from here — "${i.text}"`;
  if (i.kind === 'position') return `${at}${n} off by dx ${i.dxMm}mm dy ${i.dyMm}mm — "${i.text}"`;
  if (i.kind === 'lineEnd') return `${at}${n} ends ${i.dxMm}mm off — "${i.text}"`;
  return `p${i.page} l${i.line} ${i.kind} (LO ${i.refLines} / ed ${i.edLines} line(s))`
    + `\n        LO: ${i.ref}\n        ed: ${i.editor}`;
}

await browser.close();
if (server) process.kill(-server.pid);
if (jsonAt) writeFileSync(jsonAt, JSON.stringify(report, null, 2));
if (!keep) rmSync(work, { recursive: true, force: true }); else console.log(`\nartifacts: ${work}`);
process.exit(report.some((r) => r.error || r.issues?.length) ? 1 : 0);
