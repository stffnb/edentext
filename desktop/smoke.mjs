// Boots the desktop app on ../dist and checks what the main process owns:
// the app:// origin, the native save picker, and external links staying outside.
import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

// APP=<packaged binary> checks a built app instead of this checkout. playwright-core
// sits in the root node_modules and cannot find this electron itself.
// An own profile: a running EdenText holds the single-instance lock of the default one.
const profile = `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'edentext-smoke-'))}`;
const app = await electron.launch(
  process.env.APP
    ? { executablePath: process.env.APP, args: [profile] }
    : { executablePath: createRequire(import.meta.url)('electron'), args: ['.', profile], cwd: import.meta.dirname },
);
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('.ProseMirror', { timeout: 30_000 });
  assert.equal(await page.evaluate(() => location.origin), 'app://edentext');
  assert.equal(await page.evaluate(() => typeof window.showSaveFilePicker), 'function');

  await page.click('.ProseMirror');
  await page.keyboard.type('Hallo');
  assert.match(await page.locator('.ProseMirror').innerText(), /Hallo/);

  await app.evaluate(({ shell }) => {
    globalThis.opened = [];
    shell.openExternal = async (url) => void globalThis.opened.push(url);
  });
  await page.evaluate(() => window.open('https://example.invalid/', '_blank'));
  await page.waitForTimeout(500);
  assert.equal(app.windows().length, 1, 'external link opened an app window');
  assert.deepEqual(await app.evaluate(() => globalThis.opened), ['https://example.invalid/']);

  // The print page, served with its own script-free policy, still renders to PDF.
  const pdf = await page.evaluate(async () => {
    const bytes = await window.edentextDesktop.printToPdf('<p>Druck</p>');
    return new TextDecoder().decode(bytes.slice(0, 5));
  });
  assert.equal(pdf, '%PDF-');

  // The service worker cannot register on app://; main.ts swallows that.
  assert.deepEqual(errors.filter((e) => !/service ?worker/i.test(e)), []);
  console.log('desktop smoke ok');
} finally {
  // Skip the unload guard the typed text arms.
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
