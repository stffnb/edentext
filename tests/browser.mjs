// What the browser runs (smoke, dom) share: the dist/ preview server, the checklist
// both print, and a page wired to fail the run on an uncaught error.
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

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

// Fixed locale, so the UI labels a test clicks are deterministic across machines.
export async function openApp(port) {
  const browser = await chromium.launch({ executablePath: chromium.executablePath(), args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, locale: 'en-US' });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('dialog', (d) => d.accept());
  return { browser, page, pageErrors };
}
