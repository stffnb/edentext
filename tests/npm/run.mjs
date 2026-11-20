// The npm packages as a developer meets them: packed, installed into a fresh Vite
// project with the plugin, built, and driven in Chromium through the helper, the custom
// element and the React wrapper; edentext-copy's English-only copy opens a German document.
import { execSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { ROOT, MOD, checker, openApp } from '../browser.mjs';

const PORT = 5480;
const { check, failures } = checker();
const run = (cmd, cwd = ROOT) => execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, GOATCOUNTER: '' } }).toString();

run('npm run build');
run('node scripts/pack-npm.mjs');
const work = mkdtempSync(join(tmpdir(), 'edentext-npm-'));
const tarballs = ['app', 'embed'].map((p) => join(work, run(`npm pack --silent --pack-destination ${work}`, join(ROOT, 'dist-npm', p)).trim().split('\n').at(-1)));

// The host project: one page per way in, built by Vite with the plugin.
const project = join(work, 'host');
mkdirSync(join(project, 'public'), { recursive: true });
const vite = JSON.parse(readFileSync(join(ROOT, 'node_modules/vite/package.json'), 'utf8')).version;
writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'host', private: true, type: 'module' }));
writeFileSync(join(project, 'vite.config.js'), `import edentext from '@edentext/app/vite';
export default { plugins: [edentext()], build: { rollupOptions: { input: ['index.html', 'element.html', 'react.html'] } } };`);
const page = (script) => `<!doctype html><meta charset="utf-8"><div id="c" style="height:950px"></div>
<script type="module">${script}
window.events = [];
for (const t of ['dirty', 'saveRequest', 'warning']) ed.on(t, (m) => events.push(m));
ed.ready.then(() => { window.isReady = true; }, (e) => { window.readyError = e.message; });
</script>`;
writeFileSync(join(project, 'index.html'), page(`import { EdenTextFrame } from '@edentext/embed';
window.ed = new EdenTextFrame(document.getElementById('c'), { url: new URLSearchParams(location.search).get('url') ?? undefined, user: 'Host' });`));
// The element and the wrapper behind the helper's interface, so one check list drives all three.
writeFileSync(join(project, 'element.html'), page(`import '@edentext/embed/element';
const el = document.createElement('eden-text');
el.setAttribute('user', 'Host');
el.style.height = '100%';
document.getElementById('c').append(el);
window.ed = { get ready() { return el.ready; }, load: (...a) => el.load(...a), export: (f) => el.export(f), markSaved: () => el.markSaved(),
  on: (t, fn) => el.addEventListener(t, (e) => fn(e.detail)) };`));
writeFileSync(join(project, 'react.html'), page(`import { createElement, createRef, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EdenText } from '@edentext/embed/react';
const ref = createRef();
const handlers = new Map();
const emit = (t, m) => handlers.get(t)?.(m);
createRoot(document.getElementById('c')).render(createElement(StrictMode, null, createElement(EdenText, { ref, user: 'Host',
  onDirty: (dirty) => emit('dirty', { type: 'dirty', dirty }), onSaveRequest: () => emit('saveRequest', { type: 'saveRequest' }),
  onWarning: (warnings) => emit('warning', { type: 'warning', warnings }), onReady: () => emit('ready') })));
const ready = new Promise((r) => handlers.set('ready', r));
window.ed = { ready, load: (...a) => ref.current.load(...a), export: (f) => ref.current.export(f), markSaved: () => ref.current.markSaved(),
  on: (t, fn) => handlers.set(t, fn) };`));
run(`npm install --no-audit --no-fund --loglevel=error ${tarballs.join(' ')} vite@${vite} react@19 react-dom@19`, project);
// The English-only copy, made the way a prebuild script makes it.
run('npx edentext-copy public/trim --languages en', project);
check(!existsSync(join(project, 'public/trim/dictionaries/de')) && existsSync(join(project, 'public/trim/dictionaries/en'))
  && JSON.parse(readFileSync(join(project, 'public/trim/embed.config.json'), 'utf8')).origins.join() === 'self',
'edentext-copy keeps only the named languages and writes embed.config.json');
const installed = (p) => join(project, 'node_modules/@edentext', p);
check(JSON.parse(readFileSync(installed('embed/package.json'), 'utf8')).license === 'MIT' && /^MIT License/.test(readFileSync(installed('embed/LICENSE'), 'utf8'))
  && ['LICENSE', 'NOTICE.md', 'licenses.txt', 'dictionaries/en/LICENSE'].every((f) => existsSync(join(project, 'public/trim', f))),
'the helper is MIT and the copied editor carries its license files');
let refused = '';
mkdirSync(join(project, 'src'), { recursive: true });
writeFileSync(join(project, 'src/app.js'), '');
try { execSync('npx edentext-copy src', { cwd: project, stdio: 'pipe' }); } catch (e) { refused = e.stderr.toString(); }
check(/refusing/.test(refused) && existsSync(join(project, 'src/app.js')), 'edentext-copy leaves a folder that is not an earlier copy alone');
run('npx vite build --logLevel error', project);

// The dev server serves the editor under /edentext/, with a 404 past its files.
const dev = spawn('npx', ['vite', '--port', String(PORT + 1), '--strictPort'], { cwd: project, stdio: 'ignore', detached: true });
const devUrl = `http://localhost:${PORT + 1}/edentext/`;
let devOk = false;
for (let i = 0; i < 60 && !devOk; i++) {
  await new Promise((r) => setTimeout(r, 500));
  devOk = await fetch(devUrl).then((r) => r.ok && r.headers.get('content-type').includes('html')).catch(() => false);
}
const devConfig = await fetch(`${devUrl}embed.config.json`).then((r) => r.json()).catch(() => null);
const devMissing = await fetch(`${devUrl}dictionaries/xx/xx.aff`).then((r) => r.status).catch(() => 0);
process.kill(-dev.pid);
check(devOk && devConfig?.origins?.join() === 'self' && devMissing === 404, `vite dev serves the editor under /edentext/ (${devOk}, ${JSON.stringify(devConfig)}, ${devMissing})`);

const out = join(project, 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/table.odt') return void res.writeHead(200).end(readFileSync(join(ROOT, 'tests/corpus/04-table.odt')));
  let file = join(out, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(out) || !existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
}).listen(PORT);
await new Promise((r) => server.once('listening', r));

const { browser, page: first, pageErrors } = await openApp(PORT);
try {
  check(existsSync(join(out, 'edentext/index.html')) && existsSync(join(out, 'edentext/embed.config.json')), 'vite build copies the editor to /edentext/');
  for (const [i, which] of ['index', 'element', 'react'].entries()) {
    const host = i === 0 ? first : await browser.newPage({ viewport: { width: 1400, height: 1000 }, locale: 'en-US', serviceWorkers: 'block' });
    if (i) host.on('pageerror', (err) => pageErrors.push(`[${which}] ${err}`));
    host.on('dialog', (d) => d.accept());
    await host.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => { window.cspViolation = `${e.violatedDirective} ${e.blockedURI}`; }));
    await host.goto(`http://localhost:${PORT}/${which === 'index' ? '' : `${which}.html`}`);
    await host.waitForFunction(() => window.isReady || window.readyError, null, { timeout: 30_000 });
    const frame = host.frames().find((f) => f.url().includes('/edentext/?embed=1'));
    check(!!frame && await host.evaluate(() => window.isReady), `${which}: the editor boots under /edentext/ and takes init`);
    check(await frame.isVisible('.powered-by'), `${which}: "Powered by EdenText" shows`);
    check(await host.evaluate(async () => ed.load(await (await fetch('/table.odt')).blob(), 'table.odt')), `${which}: load answers ok`);
    await frame.waitForFunction(() => document.querySelector('.tiptap table td')?.textContent.trim(), null, { timeout: 30_000 });
    await frame.click('.tiptap p');
    await host.keyboard.type('Packaged ');
    await host.waitForFunction(() => events.some((m) => m.type === 'dirty' && m.dirty), null, { timeout: 5_000 }).catch(() => {});
    await host.keyboard.press(`${MOD}+s`);
    await host.waitForFunction(() => events.some((m) => m.type === 'saveRequest'), null, { timeout: 5_000 }).catch(() => {});
    const seen = await host.evaluate(() => events.map((m) => m.type + (m.type === 'dirty' ? m.dirty : '')).join());
    check(/dirtytrue/.test(seen) && /saveRequest/.test(seen), `${which}: an edit reports dirty and Ctrl+S asks the host to save (${seen})`);
    const docx = await host.evaluate(async () => {
      const f = await ed.export('docx');
      const head = String.fromCharCode(...new Uint8Array(await f.slice(0, 2).arrayBuffer()));
      return [head, f.name, await ed.load(f)];
    });
    await frame.waitForFunction(() => document.querySelector('.tiptap')?.textContent.includes('Packaged'), null, { timeout: 30_000 }).catch(() => {});
    check(docx.join() === 'PK,table.docx,true' && await frame.evaluate(() => document.querySelector('.tiptap').textContent.includes('Packaged')),
      `${which}: export gives a .docx that loads back with the edit (${docx})`);
    const csp = await host.evaluate(() => window.cspViolation) ?? await frame.evaluate(() => window.cspViolation);
    check(!csp, `${which}: no Content-Security-Policy violation${csp ? ` (${csp})` : ''}`);
    if (i) await host.close();
  }

  // English only: a German document opens with no dialog and no error.
  const de = await browser.newPage({ viewport: { width: 1400, height: 1000 }, locale: 'de-DE', serviceWorkers: 'block' });
  const dialogs = [];
  de.on('pageerror', (err) => pageErrors.push(`[trim] ${err}`));
  de.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await de.goto(`http://localhost:${PORT}/?url=/trim/`);
  await de.waitForFunction(() => window.isReady || window.readyError, null, { timeout: 30_000 });
  const frame = de.frames().find((f) => f.url().includes('/trim/?embed=1'));
  await frame.click('.tiptap p');
  await de.keyboard.type('Ein deutscher Satz mit Fehlre ');
  await de.waitForTimeout(3000);
  check(await de.evaluate(() => window.isReady) && dialogs.length === 0, `--languages en: a German document opens without a dialog (${dialogs.join(' | ')})`);
  await de.close();
} catch (err) {
  check(false, `npm run threw: ${err.message ?? err}`);
} finally {
  check(pageErrors.length === 0, pageErrors.length ? `no uncaught page errors — got: ${pageErrors.join(' | ')}` : 'no uncaught page errors');
  await browser.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}
process.exit(failures.length ? 1 : 0);
