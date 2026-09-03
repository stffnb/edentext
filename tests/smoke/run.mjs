// Browser smoke test: boots the production build in headless Chromium and checks the
// paths jsdom cannot — the bundle boots, typing works, autosave survives a reload,
// a corpus document imports and paginates, a margin balloon holds its content. Fails on
// any uncaught page error.
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = +(process.env.SMOKE_PORT ?? 4180);
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

const failures = [];
const check = (cond, label) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures.push(label);
};

async function previewServer() {
  const up = await fetch(`http://localhost:${PORT}/`).then(() => true).catch(() => false);
  if (up) return null;
  if (!existsSync(join(ROOT, 'dist/index.html'))) {
    console.log('no dist/, building…');
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  }
  const proc = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await fetch(`http://localhost:${PORT}/`).then(() => true).catch(() => false)) return proc;
  }
  throw new Error('preview server did not start');
}

const server = await previewServer();
const browser = await chromium.launch({ executablePath: chromium.executablePath(), args: ['--no-sandbox'] });
// Fixed locale, so the UI labels the test clicks are deterministic across machines.
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, locale: 'en-US' });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (d) => d.accept());

try {
  // Boot on a clean profile.
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });
  check(true, 'app boots, editor mounts');

  // Typing and a keyboard command reach ProseMirror.
  await page.click('.tiptap');
  await page.keyboard.type('Hello smoke ');
  await page.keyboard.press(`${MOD}+b`);
  await page.keyboard.type('bold');
  const strong = await page.evaluate(() => document.querySelector('.tiptap strong')?.textContent);
  check(strong === 'bold', 'typing + bold shortcut render');
  // The status-bar count follows a changed document a beat later, off the keystroke.
  await page.waitForFunction(() => /\b3 Words\b/.test(document.querySelector('.statusbar')?.textContent ?? ''),
    null, { timeout: 5_000 });
  check(true, 'word count follows the typing');

  // Autosave (1s debounce) persists the document across a reload.
  await page.waitForFunction(() => (localStorage.getItem('edentext-doc') ?? '').includes('Hello smoke'),
    null, { timeout: 10_000 });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });
  await page.waitForFunction(() => document.querySelector('.tiptap')?.textContent.includes('Hello smoke'),
    null, { timeout: 10_000 });
  check(true, 'autosave survives a reload');

  // A corpus document imports, renders its table and reports a page count.
  await page.setInputFiles('input.file-input', join(ROOT, 'tests/corpus/04-table.odt'));
  await page.waitForFunction(() => document.querySelector('.tiptap table td')?.textContent.trim(),
    null, { timeout: 30_000 });
  const pages = await page.evaluate(() => document.querySelector('.statusbar')?.textContent ?? '');
  check(/\d/.test(pages), 'ODT import renders table + statusbar page count');

  // Raster-PDF export over the loaded document: the seam in export/pdf.ts hands the
  // bytes to the sink instead of doc.save() (the download hangs in headless Chromium).
  await page.evaluate(() => {
    window.__edentextPdfSink = (buf) => {
      window.__pdfHead = String.fromCharCode(...new Uint8Array(buf, 0, 5));
      window.__pdfSize = buf.byteLength;
    };
  });
  await page.click('.ribbon-tab-file');
  await page.click('button:has-text("Raster PDF")');
  await page.waitForFunction(() => window.__pdfSize > 0, null, { timeout: 60_000 });
  const pdf = await page.evaluate(() => ({ head: window.__pdfHead, size: window.__pdfSize }));
  check(pdf.head === '%PDF-' && pdf.size > 20_000,
    `PDF export produces a PDF (${Math.round(pdf.size / 1024)} KB)`);

  // Margin balloons: every card's content stays inside its box and the column inside the
  // page. An unwrapped button row once pushed "Edit" clean out of the balloon, and a
  // comment of a few paragraphs pushed the cards under it off the sheet.
  // Leaving the page flushes a pending autosave over the key; let the debounce drain
  // before the key is written by hand.
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const m = (text, mark) => ({ type: 'paragraph', content: [{ type: 'text', text, marks: [mark] }] });
    const long = 'Donaudampfschifffahrtsgesellschaftskapitaenspatentpruefungsordnung';
    const essay = Array.from({ length: 16 }, (_, i) => `Absatz ${i + 1} eines sehr langen Kommentars, der ohne Deckel weit ueber das Seitenende hinaus reicht.`).join('\n\n');
    localStorage.setItem('edentext-app-language', 'de');
    localStorage.removeItem('edentext-markup-mode');
    // The flag the previous document's load left behind would send this one to
    // edentext-doc-broken and start the app empty.
    localStorage.removeItem('edentext-doc-loading');
    localStorage.setItem('edentext-doc', JSON.stringify({ type: 'doc', content: [
      p('Head.'),
      m('commented', { type: 'comment', attrs: { id: 'c1', author: 'Test Autor', date: '2026-03-04T05:06:07.000Z', text: 'Bitte kuerzen.', resolved: false, replies: [{ author: 'Zweiter Autor', date: '2026-03-05T05:06:07.000Z', text: 'Einverstanden, gekuerzt.' }] } }),
      m(long, { type: 'comment', attrs: { id: 'c2', author: 'Ein-Autor-Ohne-Leerzeichen-Im-Namen', date: '2026-03-04T05:06:07.000Z', text: long, resolved: false } }),
      m('lang kommentiert', { type: 'comment', attrs: { id: 'c3', author: 'Test Autor', date: '2026-03-04T05:06:07.000Z', text: essay, resolved: false } }),
      m('inserted', { type: 'insertion', attrs: { id: 'r1', author: 'Rev Autor', date: '2026-05-06T07:08:09.000Z' } }),
      ...Array.from({ length: 6 }, (_, i) => p(`Absatz ${i + 1}.`)),
    ] }));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });
  await page.waitForFunction(() => document.querySelectorAll('.balloon').length >= 4,
    null, { timeout: 15_000 }).catch(() => {});
  // The ⋯ menu opens inside the card: floating, it would be clipped by the balloon.
  const menuSpill = async () => page.evaluate(() => {
    const out = [];
    const cards = [...document.querySelectorAll('.balloon')];
    // A card taller than its share of the page scrolls; every other overflow is a bug.
    const layer = document.querySelector('.review-margin-layer')?.getBoundingClientRect();
    for (const b of cards) {
      const box = b.getBoundingClientRect();
      const scrolls = b.scrollHeight > b.clientHeight + 1;
      if (b.scrollWidth > b.clientWidth + 1) out.push('card clips its content sideways');
      for (const el of b.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        if (r.left < box.left - 0.5 || r.right > box.right + 0.5)
          out.push(`<${el.tagName.toLowerCase()}> "${el.textContent.trim().slice(0, 16)}" outside the card`);
        if (!scrolls && (r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5))
          out.push(`<${el.tagName.toLowerCase()}> "${el.textContent.trim().slice(0, 16)}" below the card`);
      }
      if (layer && (box.top < layer.top - 0.5 || box.bottom > layer.bottom + 0.5)) out.push('balloon hangs off the page');
    }
    const rects = cards.map((e) => e.getBoundingClientRect());
    for (let i = 1; i < rects.length; i++) if (rects[i].top < rects[i - 1].bottom - 0.5) out.push(`balloon ${i} overlaps the one above`);
    // The leader belongs in the gap under its line, never across the letters.
    const anchor = document.querySelector('[data-comment="c1"]')?.getBoundingClientRect();
    const first = document.querySelector('.review-margin-layer path')?.getAttribute('d');
    if (layer && anchor && first && +first.split(' ')[2] < anchor.bottom - layer.top - 1)
      out.push('leader crosses its own line');
    return { count: cards.length, out: [...new Set(out)] };
  });
  // The stack settles on the next frame after a card is measured, so let it.
  const settle = () => page.waitForTimeout(300);
  await settle();
  const spill = await menuSpill();
  await page.click('.balloon .more');
  await settle();
  const opened = await menuSpill();
  check(spill.count === 4 && spill.out.length === 0 && opened.out.length === 0,
    `margin balloons hold their content (${spill.count} balloons${[...spill.out, ...opened.out].length ? ': ' + [...spill.out, ...opened.out].join(', ') : ''})`);

  // The display modes, through the ribbon: no markup takes bars and balloons off the
  // page, and the full view brings the same ones back.
  const shown = () => page.evaluate(() => ({
    balloons: document.querySelectorAll('.balloon').length,
    bars: document.querySelectorAll('.change-bar-layer *').length,
  }));
  const pickMode = async (label) => {
    await page.locator('[role=tab], .ribbon-tabs button').filter({ hasText: /Überprüfen|Review/ }).first().click();
    await page.locator('button', { hasText: /Anzeige für Überprüfung|Display for review/ }).first().click();
    await page.locator('.ribbon-menu button', { hasText: label }).first().click();
    await settle();
    await settle();
  };
  const full = await shown();
  await pickMode(/Kein Markup|No markup/);
  const bare = await shown();
  await pickMode(/Alle Markups|All markup/);
  const back = await shown();
  check(full.balloons > 0 && full.bars > 0 && bare.balloons === 0 && bare.bars === 0
    && back.balloons === full.balloons && back.bars === full.bars,
    `no markup empties the margin and all markup fills it again (${full.balloons}/${full.bars} → ${bare.balloons}/${bare.bars} → ${back.balloons}/${back.bars})`);
} catch (err) {
  check(false, `smoke run threw: ${err.message ?? err}`);
} finally {
  check(pageErrors.length === 0, pageErrors.length ? `no uncaught page errors — got: ${pageErrors.join(' | ')}` : 'no uncaught page errors');
  await browser.close();
  if (server) process.kill(-server.pid);
}
process.exit(failures.length ? 1 : 0);
