// Render-parity harness: opens a document in LibreOffice and in the editor, then
// compares the resulting text layout (pages, lines, positions in mm).
// Usage and prerequisites — including the mandatory font setup — are in README.md.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, basename, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { compare, toLines } from './compare.mjs';
import { devServer, settle, extractLayout } from '../browser.mjs';

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
  await page.setInputFiles('input.file-input[accept*=".odt"]', file);
  await settle(page);
  const result = await page.evaluate(extractLayout);
  await page.close();
  return result;
}

// ------------------------------------------------------------------- driver

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

const server = await devServer(PORT);
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
