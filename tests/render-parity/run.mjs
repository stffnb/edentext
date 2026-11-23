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
import { compare, summarize, diffCauses, ROOTS, toLines } from './compare.mjs';
import { devServer, settle, extractLayout } from '../browser.mjs';
import { LOCAL_DOCS, LONG_DOCS } from '../localDocs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const CHROME = process.env.PARITY_CHROME ?? chromium.executablePath();
const PORT = +(process.env.PARITY_PORT ?? 5199);   // reuse a dev server already up
const JOBS = +(process.env.PARITY_JOBS ?? 4);      // editor renders at a time
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
  const imgs = join(CACHE, key + '.img.json');
  if (!cache || !existsSync(imgs)) writeFileSync(imgs, JSON.stringify(pdfImages(pdf, work)));
  return { pages: parseBbox(readFileSync(xml, 'utf8')), images: JSON.parse(readFileSync(imgs, 'utf8')), pdf, cached: hit };
}

// A PDF of the same name beside the document is the reference in LibreOffice's place:
// the word processor that made the file, where it lays the file out better than LO.
function pdfReference(file) {
  const pdf = file.slice(0, -extname(file).length) + '.pdf';
  if (!existsSync(pdf)) return null;
  const xml = execFileSync('pdftotext', ['-bbox-layout', pdf, '-'], { maxBuffer: 1 << 28 }).toString();
  return { pages: parseBbox(xml), images: pdfImages(pdf, tmpdir()), pdf, cached: false, source: 'PDF' };
}

// Every picture the PDF places, as { page, x, y, w, h } in mm: pdftotext sees none of
// them. pdftohtml lists them only while writing each one out, so it writes into a
// directory of its own that goes again.
function pdfImages(pdf, work) {
  const dir = mkdtempSync(join(work, 'img-'));
  try {
    const xml = execFileSync('pdftohtml', ['-xml', '-zoom', '1', '-q', '-stdout', pdf, join(dir, 'i')],
      { maxBuffer: 1 << 28 }).toString();
    const out = [];
    for (const [, n, body] of xml.matchAll(/<page number="(\d+)"[^>]*>([\s\S]*?)<\/page>/g)) {
      for (const [, attrs] of body.matchAll(/<image ([^>]*)\/>/g)) {
        const a = num(attrs);
        out.push({ page: +n - 1, x: a.left * PT_MM, y: a.top * PT_MM, w: a.width * PT_MM, h: a.height * PT_MM });
      }
    }
    return out;
  } finally { rmSync(dir, { recursive: true, force: true }); }
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
  // A dialog still open as the page closes rejects its accept: unhandled, that ends the run.
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('edentext-zoom', '100');   // no transform scale => rects are doc px
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap');
  await page.setInputFiles('input.file-input[accept*=".odt"]', file);
  await settle(page);
  // The header/footer layer draws a window of pages; a printout opens it to all of them.
  await page.evaluate(() => new Promise((done) => {
    window.dispatchEvent(new Event('beforeprint'));
    requestAnimationFrame(() => requestAnimationFrame(done));
  }));
  const result = await page.evaluate(extractLayout);
  await page.close();
  return result;
}

// ------------------------------------------------------------------- driver

// An argument that names no file is a regular expression over the corpus' file names,
// as the layout run's is; a path and a pattern combine. Long local documents run only
// when a path or a pattern names them.
function corpus(args) {
  const paths = args.filter((a) => existsSync(resolve(a)));
  const pattern = args.filter((a) => !paths.includes(a));
  const only = pattern.length ? new RegExp(pattern.join('|')) : null;
  const out = [];
  for (const p of paths.length ? paths : [join(HERE, '..', 'corpus'), LOCAL_DOCS, ...(only ? [LONG_DOCS] : [])]) {
    const abs = resolve(p);
    if (!existsSync(abs)) continue;
    try {
      // `~$name` is the lock file a word processor leaves beside a document it has open —
      // opening a fixture to compare it by eye would otherwise add it to the corpus.
      for (const f of readdirSync(abs)) if (/\.(docx|odt)$/i.test(f) && !/^(~\$|\._)/.test(f)) out.push(join(abs, f));
    } catch { out.push(abs); }
  }
  return out.filter((f) => !only || only.test(basename(f))).sort();
}

// The last run's issue count per file, so a re-run prints what a change moved instead
// of leaving the arithmetic to whoever reads two reports side by side.
// It lives in the checkout's own git directory, so parallel worktrees sharing one
// node_modules never overwrite each other's counts.
const gitDir = () => {
  try { return resolve(ROOT, execFileSync('git', ['rev-parse', '--git-dir'], { cwd: ROOT, encoding: 'utf8' }).trim()); } catch { return CACHE; }
};
const BASELINE = process.env.PARITY_BASELINE ?? join(gitDir(), 'render-parity-baseline.json');
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

// `JOBS` documents at a time: a page is its own browser context, and the reference is the
// file's alone, so the work does not cross. A document's lines are written in one call so
// two finishing together cannot interleave, and the report keeps the corpus' order.
let next = 0;
async function worker() {
  while (next < files.length) {
    const at = next++;
    const file = files[at];
    const name = basename(file);
    const log = [];
    try {
      const ref = pdfReference(file) ?? loRender(file, work, cache);
      // A render that times out under load is retried once: a failed document drops out
      // of the total, which would read as a drop in differences.
      const ed = await editorRender(browser, file).catch(() => editorRender(browser, file));
      const issues = compare(ref, ed);
      const sum = summarize(issues, ref.pages.length);
      const was = baseline?.[name];
      report[at] = {
        file: name, refPages: ref.pages.length, editorPages: ed.pages.length, summary: sum, issues,
        ...(jsonAt ? {
          ref: ref.pages.map((p) => toLines(p.words)),
          editor: ed.pages.map((p) => toLines(p.words)),
          images: { ref: ref.images, editor: ed.images },
          margins: ed.margins,
        } : {}),
      };
      log.push(`\n${sum.causes ? '\u2717' : '\u2713'} ${name}  (${ref.source ?? 'LO'} ${ref.pages.length}p / editor ${ed.pages.length}p)`
        + `  ${sum.causes} cause(s) ${delta(sum.causes, was?.causes)}  \u00b7 ${sum.raw} issue(s)${ref.cached ? '  [cached]' : ''}`);
      if (sum.first) log.push(`    first: ${cause(sum.first)}`);
      for (const c of sum.list.filter((c) => c !== sum.first).slice(0, 11)) log.push('    ' + cause(c));
      if (sum.causes > 12) log.push(`    \u2026 ${sum.causes - 12} more`);
      if (was?.keys) {
        const { added, gone } = diffCauses(sum.keys, was.keys);
        if (added.length) log.push(`    new:  ${added.slice(0, 5).join('  |  ')}${added.length > 5 ? `  (+${added.length - 5})` : ''}`);
        if (gone.length) log.push(`    gone: ${gone.slice(0, 5).join('  |  ')}${gone.length > 5 ? `  (+${gone.length - 5})` : ''}`);
      }
    } catch (err) {
      report[at] = { file: name, error: String(err.message ?? err) };
      log.push(`\n! ${name}  ${err.message ?? err}`);
    }
    console.log(log.join('\n'));
  }
}
await Promise.all(Array.from({ length: Math.max(1, Math.min(JOBS, files.length)) }, worker));

// Only what this run measured: a single-fixture run says what that fixture moved and
// leaves the other files' recorded counts alone. Causes are the headline; issues, every
// symptom including consequences, stay beside them for diagnosis.
const done = report.filter((r) => !r.error);
const failed = report.filter((r) => r.error);
const add = (rs, f) => rs.reduce((n, r) => n + f(r), 0);
const seen = done.filter((r) => baseline?.[r.file]?.causes != null);
const all = seen.length === done.length;
const was = (f) => (all ? add(seen, (r) => f(baseline[r.file])) : null);
console.log(`\ncauses ${add(done, (r) => r.summary.causes)} ${delta(add(done, (r) => r.summary.causes), was((b) => b.causes))}`
  + `  \u00b7 issues ${add(done, (r) => r.summary.raw)} ${delta(add(done, (r) => r.summary.raw), was((b) => b.issues))}`
  + `  across ${done.length} document(s)${!all && seen.length ? ` (${done.length - seen.length} without a baseline)` : ''}`);
console.log('by kind: ' + ROOTS.map((k) => {
  const n = add(done, (r) => r.summary.kinds[k]), w = was((b) => b.kinds?.[k] ?? 0);
  return `${k} ${n}${w != null && w !== n ? ` (${n > w ? '+' : '\u2212'}${Math.abs(n - w)})` : ''}`;
}).join('  '));
const worst = done.filter((r) => r.summary.causes).sort((a, b) => b.summary.causes - a.summary.causes);
if (worst.length > 1) {
  console.log('\n causes   /10p  issues  pages LO/ed  document');
  for (const r of worst.slice(0, 15)) {
    const b = baseline?.[r.file]?.causes;
    console.log(`${String(r.summary.causes).padStart(7)}${String(r.summary.per10).padStart(7)}${String(r.summary.raw).padStart(8)}`
      + `  ${`${r.refPages}/${r.editorPages}`.padStart(11)}  ${r.file}${b != null && b !== r.summary.causes ? `  ${delta(r.summary.causes, b)}` : ''}`);
  }
}
if (failed.length) console.log(`\n${failed.length} document(s) FAILED and are in no total: ${failed.map((r) => r.file).join(', ')}`);

if (baseline) {
  for (const r of done) {
    const s = r.summary;
    baseline[r.file] = { causes: s.causes, issues: s.raw, kinds: s.kinds, keys: s.keys, refPages: r.refPages };
  }
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, JSON.stringify(baseline));
}

function delta(now, was) {
  if (was == null) return '(new)';
  return now === was ? '(unchanged)' : `(was ${was}, ${now > was ? '+' : '\u2212'}${Math.abs(now - was)})`;
}

function fmt(i) {
  const at = `p${i.page}${i.edPage ? `\u2192ed p${i.edPage}` : ''} l${i.line}`;
  const n = i.lines > 1 ? ` \u00d7${i.lines}` : '';
  if (i.kind === 'pageCount') return `pages: LO ${i.ref}, editor ${i.editor}`;
  if (i.kind === 'pageBreak') return i.only
    ? `p${i.page}: a page starts here only in the ${i.only === 'ref' ? 'reference' : 'editor'} \u2014 "${i.text}"`
    : `p${i.page}: the page starts ${Math.abs(i.carry)} line(s) ${i.carry > 0 ? 'later' : 'earlier'} in the editor \u2014 "${i.text}"`;
  if (i.kind === 'position') return `${at}${n} off by dx ${i.dxMm}mm dy ${i.dyMm}mm`
    + (i.vertical ? ` (${i.vertical} ${i.byMm > 0 ? '+' : ''}${i.byMm}mm)` : '') + ` \u2014 "${i.text}"`;
  if (i.kind === 'image') return `p${i.page}${i.edPage !== i.page ? `\u2192ed p${i.edPage}` : ''} picture ${i.wMm}\u00d7${i.hMm}mm off by dx ${i.dxMm}mm dy ${i.dyMm}mm`
    + (i.dwMm || i.dhMm ? `, size by ${i.dwMm}\u00d7${i.dhMm}mm` : '');
  if (i.kind === 'imageCount') return `p${i.page} picture ${i.wMm}\u00d7${i.hMm}mm only in the ${i.side === 'ref' ? 'reference' : 'editor'}`;
  if (i.kind === 'lineEnd') return `${at}${n} ends ${i.dxMm}mm off \u2014 "${i.text}"`;
  return `p${i.page} l${i.line} ${i.kind} (LO ${i.refLines} / ed ${i.edLines} line(s))`
    + `\n        LO: ${i.ref}\n        ed: ${i.editor}`;
}

// A cause as its first symptom, with how many more it folded in.
function cause(c) {
  const more = c.n > 1 ? `  [+${c.n - 1} alike${c.pages ? ` on ${new Set(c.pages).size} pages` : ''}]` : '';
  return `${c.root.padEnd(10)} ${fmt(c.issue)}${more}`;
}

await browser.close();
if (server) process.kill(-server.pid);
if (jsonAt) writeFileSync(jsonAt, JSON.stringify(report, null, 2));
if (!keep) rmSync(work, { recursive: true, force: true }); else console.log(`\nartifacts: ${work}`);
process.exit(report.some((r) => r.error || r.summary?.causes) ? 1 : 0);
