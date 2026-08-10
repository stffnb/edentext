// Render-parity harness: opens a document in LibreOffice and in the editor, then
// compares the resulting text layout (pages, lines, positions in mm).
// Usage and prerequisites — including the mandatory font setup — are in README.md.
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const CHROME = process.env.PARITY_CHROME ?? newestChromium();
const PORT = +(process.env.PARITY_PORT ?? 5199);   // reuse a dev server already up
const PAGE_GAP = 20;           // pageBreaks.ts
const PT_MM = 25.4 / 72;
const PX_MM = 25.4 / 96;
const LINE_TOL_MM = 1.2;       // words within this vertical span are one line
const POS_TOL_MM = 1.0;        // reported as a position difference beyond this

// `playwright-core install chromium` names the directory after its own build number,
// so take the highest one present. PARITY_CHROME overrides it.
function newestChromium() {
  const base = join(process.env.HOME, '.cache/ms-playwright');
  const builds = (existsSync(base) ? readdirSync(base) : [])
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => +b.slice(9) - +a.slice(9));
  if (!builds.length) throw new Error('no Chromium in ~/.cache/ms-playwright — see README.md');
  return join(base, builds[0], 'chrome-linux/chrome');
}

// ---------------------------------------------------------------- reference

function loRender(file, work) {
  execFileSync('soffice', [
    '--headless', '--norestore', `-env:UserInstallation=file://${work}/loprofile`,
    '--convert-to', 'pdf', '--outdir', work, file,
  ], { stdio: 'pipe', timeout: 120_000 });
  const pdf = join(work, basename(file, extname(file)) + '.pdf');
  if (!existsSync(pdf)) throw new Error(`LibreOffice produced no PDF for ${file}`);
  const xml = join(work, 'ref.xml');
  execFileSync('pdftotext', ['-bbox-layout', pdf, xml], { stdio: 'pipe' });
  return { pages: parseBbox(readFileSync(xml, 'utf8')), pdf };
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
      if (t) words.push({ text: t, x: a.xMin * PT_MM, y: a.yMin * PT_MM, w: (a.xMax - a.xMin) * PT_MM });
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
    localStorage.setItem('odf-editor-zoom', '100');   // no transform scale => rects are doc px
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
    const key = el.style.minHeight + '|' + el.children.length + '|' + spacers.length + '|'
      + spacers.reduce((sum, s) => sum + s.offsetHeight, 0);
    const w = window;
    if (w.__parityKey !== key) { w.__parityKey = key; w.__paritySince = performance.now(); return false; }
    return performance.now() - (w.__paritySince ?? 0) > 3000;
  }, null, { timeout: 180_000 });
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

  const words = [];
  const walker = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue;
    if (!text || !text.trim() || skip(n)) continue;
    for (const m of text.matchAll(/\S+/g)) {
      const r = document.createRange();
      r.setStart(n, m.index);
      r.setEnd(n, m.index + m[0].length);
      const rect = r.getClientRects()[0];
      if (!rect || !rect.width) continue;
      const y = rect.top - origin.top;
      const page = Math.floor(y / cycle);
      words.push({
        text: m[0],
        page,
        x: (rect.left - origin.left) * PX_MM,
        y: (y - page * cycle) * PX_MM,
        w: rect.width * PX_MM,
      });
    }
  }
  const numPages = words.length ? Math.max(...words.map((w) => w.page)) + 1 : 1;
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

// ---------------------------------------------------------------- compare

// Both sides are reduced to the same shape before diffing: words sorted into
// lines by vertical band, then left to right.
function toLines(words) {
  const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const w of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(w.y - last.y) <= LINE_TOL_MM) {
      last.words.push(w);
      last.y = Math.min(last.y, w.y);
    } else lines.push({ y: w.y, words: [w] });
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

function compare(ref, ed) {
  const issues = [];
  if (ref.pages.length !== ed.pages.length) {
    issues.push({ kind: 'pageCount', ref: ref.pages.length, editor: ed.pages.length });
  }
  const n = Math.min(ref.pages.length, ed.pages.length);
  for (let p = 0; p < n; p++) {
    const r = toLines(ref.pages[p].words);
    const e = toLines(ed.pages[p].words);
    const rows = Math.max(r.length, e.length);
    for (let i = 0; i < rows; i++) {
      let a = r[i];
      const b = e[i];
      if (!a || !b) {
        issues.push({ kind: 'lineCount', page: p + 1, line: i + 1, ref: a?.text ?? null, editor: b?.text ?? null });
        break; // once the lines slip, every following row is noise
      }
      if (norm(a.text) !== norm(b.text)) {
        const trimmed = withoutMarker(a);
        if (!trimmed || norm(trimmed.text) !== norm(b.text)) {
          issues.push({ kind: 'lineBreak', page: p + 1, line: i + 1, ref: a.text, editor: b.text });
          break;
        }
        a = trimmed;
      }
      const dx = round(b.x - a.x), dy = round(b.y - a.y);
      if (Math.abs(dx) > POS_TOL_MM || Math.abs(dy) > POS_TOL_MM) {
        issues.push({ kind: 'position', page: p + 1, line: i + 1, text: a.text.slice(0, 48), dxMm: dx, dyMm: dy });
      }
      // The line's end catches what its start cannot: tab stops, justification and
      // any per-word drift that leaves the first word in place.
      const dEnd = round(b.x2 - a.x2);
      if (Math.abs(dEnd - dx) > POS_TOL_MM) {
        issues.push({ kind: 'lineEnd', page: p + 1, line: i + 1, text: a.text.slice(0, 48), dxMm: dEnd });
      }
    }
  }
  return issues;
}

// Whitespace-insensitive: spell decorations split text nodes mid-word and the two
// engines needn't agree on word boundaries — only on what sits on a line.
const norm = (s) => s.replace(/[\s\u00a0\u00ad]+/g, '');

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
  const paths = args.length ? args : [join(HERE, 'fixtures')];
  const out = [];
  for (const p of paths) {
    const abs = resolve(p);
    const stat = existsSync(abs) && readdirSync(dirname(abs)).length >= 0;
    if (!stat) continue;
    try {
      for (const f of readdirSync(abs)) if (/\.(docx|odt)$/i.test(f)) out.push(join(abs, f));
    } catch { out.push(abs); }
  }
  return out.sort();
}

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const jsonAt = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const files = corpus(args.filter((a) => !a.startsWith('--') && a !== jsonAt));
if (!files.length) { console.error('no .docx/.odt files found'); process.exit(2); }

const server = await devServer();
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const work = mkdtempSync(join(tmpdir(), 'parity-'));
const report = [];

for (const file of files) {
  const name = basename(file);
  try {
    const ref = loRender(file, work);
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
    console.log(`\n${issues.length ? '✗' : '✓'} ${name}  (LO ${ref.pages.length}p / editor ${ed.pages.length}p)`);
    for (const i of issues.slice(0, 12)) console.log('   ', fmt(i));
    if (issues.length > 12) console.log(`    … ${issues.length - 12} more`);
  } catch (err) {
    report.push({ file: name, error: String(err.message ?? err) });
    console.log(`\n! ${name}  ${err.message ?? err}`);
  }
}

function fmt(i) {
  if (i.kind === 'pageCount') return `pages: LO ${i.ref}, editor ${i.editor}`;
  if (i.kind === 'position') return `p${i.page} l${i.line} off by dx ${i.dxMm}mm dy ${i.dyMm}mm — "${i.text}"`;
  if (i.kind === 'lineEnd') return `p${i.page} l${i.line} ends ${i.dxMm}mm off — "${i.text}"`;
  return `p${i.page} l${i.line} ${i.kind}\n        LO: ${i.ref}\n        ed: ${i.editor}`;
}

await browser.close();
if (server) process.kill(-server.pid);
if (jsonAt) writeFileSync(jsonAt, JSON.stringify(report, null, 2));
if (!keep) rmSync(work, { recursive: true, force: true }); else console.log(`\nartifacts: ${work}`);
process.exit(report.some((r) => r.error || r.issues?.length) ? 1 : 0);
