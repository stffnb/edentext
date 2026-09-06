// What the browser runs share: the preview and dev servers, the checklist they print, a
// page wired to fail the run on an uncaught error, and the layout readers (settle,
// extractLayout) the parity, layout and monkey runs measure with.
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as playwright from 'playwright-core';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

export function checker() {
  const failures = [];
  const check = (cond, label) => {
    console.log(`${cond ? '✓' : '✗'} ${label}`);
    if (!cond) failures.push(label);
  };
  return { check, failures };
}

export async function previewServer(port) {
  const up = await fetch(`http://localhost:${port}/`).then(() => true).catch(() => false);
  if (up) return null;
  if (!existsSync(join(ROOT, 'dist/index.html'))) {
    console.log('no dist/, building…');
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  }
  const proc = spawn('npm', ['run', 'preview', '--', '--port', String(port), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await fetch(`http://localhost:${port}/`).then(() => true).catch(() => false)) return proc;
  }
  throw new Error('preview server did not start');
}

// The dev server: Vite serves TypeScript as is, so a page can import src/ and tests/
// modules straight from it. Reused when one is already up on the port.
export async function devServer(port) {
  const up = () => fetch(`http://localhost:${port}/`).then(() => true).catch(() => false);
  if (await up()) return null;
  const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 120 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await up())) throw new Error('dev server did not start');
  return proc;
}

// BROWSER=chromium|firefox|webkit picks the engine (Chromium by default). Fixed locale,
// so the UI labels a test clicks are deterministic across machines.
export async function openApp(port, opts = {}) {
  const name = process.env.BROWSER ?? 'chromium';
  const engine = playwright[name];
  if (!engine) throw new Error(`unknown BROWSER "${name}": chromium, firefox or webkit`);
  const args = name === 'chromium' ? ['--no-sandbox'] : [];
  const browser = await engine.launch({ executablePath: engine.executablePath(), args });
  console.log(`engine: ${name} ${browser.version()}`);
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, locale: 'en-US', ...opts });
  const pageErrors = [];
  // The text box's ResizeObserver refits the wrapper it observes, so the browser defers
  // the rest of the round to the next frame and reports it — a converging loop, not an error.
  const benign = /ResizeObserver loop/;
  page.on('pageerror', (err) => { if (!benign.test(String(err))) pageErrors.push(String(err)); });
  page.on('dialog', (d) => d.accept());
  return { browser, page, pageErrors };
}

// Pagination (and the columns flow) runs over several frames; wait for the page
// count and document height to stop moving. An image still decoding has no height
// yet and would settle the layout at a page count it leaves again a frame later.
// `loaded`: the caller knows the file is in (a document may be empty for good).
export async function settle(page, loaded = false) {
  await page.waitForFunction((loaded) => {
    const el = document.querySelector('.tiptap');
    // Importing a large file takes seconds; an editor still empty is not "settled",
    // it is the blank document the file has not replaced yet.
    if (!el || (!loaded && !(el.textContent.trim() || el.querySelector('img, table, .textbox-node, .formula, .toc')))) return false;
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
  }, loaded, { timeout: 180_000, polling: 500 });
}

// Runs in the browser: every rendered word with its page and mm position.
export function extractLayout() {
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
