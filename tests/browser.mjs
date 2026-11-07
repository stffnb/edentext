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
  // No service worker: under one, WebKit's page.route misses the page's cross-origin fetches.
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, locale: 'en-US', serviceWorkers: 'block', ...opts });
  const pageErrors = [];
  // The text box's ResizeObserver refits the wrapper it observes, so the browser defers
  // the rest of the round to the next frame and reports it — a converging loop, not an error.
  const benign = /ResizeObserver loop/;
  page.on('pageerror', (err) => { if (!benign.test(String(err))) pageErrors.push(String(err)); });
  // Something the built page's Content-Security-Policy blocked is a broken feature too.
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => {
    console.error(`CSP blocked ${e.blockedURI || 'inline'} (${e.violatedDirective}) at ${e.sourceFile}:${e.lineNumber}:${e.columnNumber}`);
  }));
  page.on('console', (msg) => { if (msg.type() === 'error' && msg.text().startsWith('CSP blocked')) pageErrors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
  // Chromium can leave a close unanswered for good (after a download still running, or
  // the page grid), idle as the page is; a run then ends anyway and Playwright's exit
  // hook takes the browser down with the process.
  const close = browser.close.bind(browser);
  browser.close = () => Promise.race([close(), new Promise((r) => setTimeout(r, 10_000).unref())]);
  return { browser, page, pageErrors };
}

// Pagination (and the columns flow) runs over several frames; wait for the page
// count and document height to stop moving. An image still decoding has no height
// yet and would settle the layout at a page count it leaves again a frame later.
// `loaded`: the caller knows the file is in (a document may be empty for good).
export async function settle(page, loaded = false) {
  // Each call waits out its own quiet period: a key left from the last call would pass at
  // once, before a change just asked for (an index update) has even landed.
  await page.evaluate(() => { window.__parityKey = undefined; });
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

// Runs in the browser: every rendered word and picture with its page and mm position.
export function extractLayout() {
  const PAGE_GAP = 20, PX_MM = 25.4 / 96;
  const paper = document.querySelector('.paper');
  const cs = getComputedStyle(document.documentElement);
  const pageH = parseFloat(cs.getPropertyValue('--user-page-height'));
  const pageW = parseFloat(cs.getPropertyValue('--user-page-width'));
  const paperW = parseFloat(cs.getPropertyValue('--pb-paper-width')) || pageW;
  const origin = paper.getBoundingClientRect();
  // The grid Editor.svelte publishes ("fromPage|height|left"): a section on its own paper
  // makes the pages differ in height, so one cycle would put every page after a landscape
  // one on the wrong sheet, and a page narrower than the sheet is centred in it, so a word
  // is that much right of the sheet edge without being right of the page's.
  const runs = cs.getPropertyValue('--pb-page-runs').split(',')
    .map((r) => r.split('|').map(Number))
    .filter(([from, h]) => Number.isFinite(from) && from >= 1 && h > 0)
    .sort((a, b) => a[0] - b[0]);
  const boxes = [];
  for (let top = 0, p = 1; top < origin.height + 1; p++) {
    let h = pageH, left = Math.round((paperW - pageW) / 2);
    for (const [from, rh, rl] of runs) if (p >= from) { h = rh; left = Number.isFinite(rl) ? rl : 0; }
    boxes.push({ top, height: h, left, width: paperW - 2 * left });
    top += h + PAGE_GAP;
  }
  // The page a y falls on; its gap counts to the page above it, as PageGrid does.
  const pageAt = (y) => {
    let i = 0;
    while (i + 1 < boxes.length && boxes[i + 1].top <= y) i++;
    return i;
  };

  // Visibility inherits and a child can turn it back on (a zone's background layer shows
  // only its frames), so only the node's own element decides it; display does not.
  const skip = (node) => {
    const own = node.nodeType === 1 ? node : node.parentElement;
    if (own && getComputedStyle(own).visibility === 'hidden') return true;
    for (let e = node.parentElement; e && e !== paper; e = e.parentElement) {
      if (e.hasAttribute('data-page-break-spacer') || e.classList.contains('band-layer')) return true;
      if (getComputedStyle(e).display === 'none') return true;
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
        const page = pageAt(y);
        const box = boxes[page];
        words.push({
          text: painted(f.text, n.parentElement),
          page,
          x: (f.left - origin.left - box.left) * PX_MM,
          y: (y - box.top) * PX_MM,
          w: f.width * PX_MM,
          h: f.height * PX_MM,
        });
      }
    }
  }
  // Every picture drawn, on the page its middle falls on: a sheet-sized background that
  // starts a hair above its page would otherwise count to the gap's page above.
  const images = [];
  for (const img of paper.querySelectorAll('img')) {
    const r = img.getBoundingClientRect();
    if (!r.width || !r.height || skip(img)) continue;
    const y = r.top - origin.top, page = pageAt(y + r.height / 2), box = boxes[page];
    images.push({ page, x: (r.left - origin.left - box.left) * PX_MM, y: (y - box.top) * PX_MM,
      w: r.width * PX_MM, h: r.height * PX_MM });
  }
  // Folded, not spread: a several-hundred-page document has more words than a call
  // takes arguments, and Math.max(...words) then blows the stack instead of measuring.
  // Every page the grid draws counts, a page holding only a picture too, as in the PDF.
  const numPages = Math.max(boxes.length, words.reduce((m, w) => (w.page > m ? w.page : m), 0) + 1);
  const pages = Array.from({ length: numPages }, (_, i) => ({
    words: words.filter((w) => w.page === i).map(({ page, ...r }) => r),
    width: (boxes[i]?.width ?? pageW) * PX_MM,
    height: (boxes[i]?.height ?? pageH) * PX_MM,
  }));
  const mm = (v) => parseFloat(cs.getPropertyValue(v)) * PX_MM;
  return {
    pages,
    images,
    margins: { top: mm('--user-margin-top'), bottom: mm('--user-margin-bottom'),
               left: mm('--user-margin-left'), right: mm('--user-margin-right') },
  };
}
