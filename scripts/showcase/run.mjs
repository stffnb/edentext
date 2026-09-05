// Builds the showcase documents and their screenshots into docs/showcase/. The document
// modules are TypeScript the browser imports straight from the dev server, and the app's
// own exporters write the .odt/.docx; each is then opened through the file input and shot.
// `node scripts/showcase/run.mjs [regex]` limits the run to matching document names.
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, openApp } from '../../tests/browser.mjs';

const PORT = 4187;
const OUT = join(ROOT, 'docs/showcase');
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const DOCS = ['thesis', 'thesis-review', 'book', 'newsletter'].filter((n) => !only || only.test(n));

async function devServer() {
  const up = () => fetch(`http://localhost:${PORT}/`).then(() => true).catch(() => false);
  if (await up()) return null;
  const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
  return proc;
}

await mkdir(OUT, { recursive: true });
const server = await devServer();
const { browser, page, pageErrors } = await openApp(PORT);
const url = `http://localhost:${PORT}/`;

const ready = async () => {
  await page.waitForSelector('.tiptap', { timeout: 30_000 });
  // The page count settles a while after the last reflow; wait for it to hold still.
  let last = '';
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(500);
    const now = await page.evaluate(() => document.querySelector('.statusbar')?.textContent ?? '');
    if (now === last && now.includes('of')) break;
    last = now;
  }
};
const reloadWith = async (settings) => {
  await page.evaluate((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, settings);
  await page.reload({ waitUntil: 'load' });
  await ready();
};

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 30_000 });

  for (const name of DOCS) {
    const built = await page.evaluate(async (name) => {
      const [{ buildOdt }, { buildDocx }, { exportArgs }, mod] = await Promise.all([
        import('/src/lib/export/odt.ts'), import('/src/lib/export/docx.ts'),
        import('/scripts/showcase/lib.ts'), import(`/scripts/showcase/${name}.ts`),
      ]);
      const s = await mod.build();
      const b64 = (u8) => {
        let out = '';
        for (let i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        return btoa(out);
      };
      const args = exportArgs(s);
      return { odt: b64(await buildOdt(...args)), docx: b64(await buildDocx(...args)), shots: s.shots };
    }, name);
    const odt = join(OUT, `${name}.odt`);
    await writeFile(odt, Buffer.from(built.odt, 'base64'));
    await writeFile(join(OUT, `${name}.docx`), Buffer.from(built.docx, 'base64'));
    console.log(`${name}: .odt ${built.odt.length * 3 / 4 | 0} B, .docx ${built.docx.length * 3 / 4 | 0} B`);

    // The autosave holds the document across the reloads a theme or zoom change takes;
    // its pictures follow into IndexedDB a moment after the JSON.
    const before = await page.evaluate(() => localStorage.getItem('edentext-doc'));
    await page.setInputFiles('input.file-input', odt);
    await ready();
    await page.waitForFunction((b) => localStorage.getItem('edentext-doc') !== b, before, { timeout: 15_000 });
    await page.waitForTimeout(2000);

    for (const shot of built.shots) {
      await reloadWith({
        'edentext-theme': shot.theme ?? 'light',
        'edentext-zoom': String(shot.zoom ?? 100),
        'edentext-markup-mode': shot.markup ? 'all' : 'none',
        'edentext-page-columns': String(shot.columns ?? 1),
      });
      // Unknown names would wear squiggles in every shot; the review shot keeps them.
      if (!shot.spelling) await page.addStyleTag({ content: '.pm-spell-error { text-decoration: none !important; background: none !important; }' });
      // One .paper holds every page; page n starts n-1 page cycles down it. The caret
      // goes to the first paragraph in view, so the ribbon shows the body's formatting.
      await page.evaluate(({ page: n, at }) => {
        const editor = document.querySelector('.editor');
        const paper = document.querySelector('.paper');
        const cycle = parseFloat(getComputedStyle(paper).getPropertyValue('--page-height')) + 20;
        const zoom = (parseFloat(localStorage.getItem('edentext-zoom')) || 100) / 100;
        const top = paper.getBoundingClientRect().top - editor.getBoundingClientRect().top + editor.scrollTop;
        if (at) {
          const h = [...document.querySelectorAll('.tiptap :is(h1, h2, h3, p)')].find((e) => e.textContent.trim() === at);
          n = Math.floor((h.getBoundingClientRect().top - paper.getBoundingClientRect().top) / (cycle * zoom)) + 1;
        }
        editor.scrollTop = top + (n - 1) * cycle * zoom - 12;
        const limit = editor.getBoundingClientRect().top + 40;
        const plain = (p) => [...p.querySelectorAll('*')].every((e) => /^(SPAN|STRONG|EM|B|I|U|S|A|SUP|SUB|BR)$/.test(e.tagName));
        const first = [...document.querySelectorAll('.tiptap > p')].find((p) => p.getBoundingClientRect().top > limit && p.textContent.trim() && plain(p));
        const view = document.querySelector('.tiptap').editor;
        if (first) view.commands.focus(view.view.posAtDOM(first, 0) + 1, { scrollIntoView: false });
      }, { page: shot.page ?? 1, at: shot.at });
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(OUT, `${shot.file}.png`) });
      console.log(`  ${shot.file}.png`);
    }
  }
} finally {
  if (pageErrors.length) console.log(`page errors: ${pageErrors.join(' | ')}`);
  await browser.close();
  if (server) process.kill(-server.pid);
}
