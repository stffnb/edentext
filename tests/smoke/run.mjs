// Browser smoke test: boots the production build in headless Chromium and checks the
// paths jsdom cannot — the bundle boots, typing works, autosave survives a reload,
// a corpus document imports and paginates. Fails on any uncaught page error.
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
} catch (err) {
  check(false, `smoke run threw: ${err.message ?? err}`);
} finally {
  check(pageErrors.length === 0, pageErrors.length ? `no uncaught page errors — got: ${pageErrors.join(' | ')}` : 'no uncaught page errors');
  await browser.close();
  if (server) process.kill(-server.pid);
}
process.exit(failures.length ? 1 : 0);
