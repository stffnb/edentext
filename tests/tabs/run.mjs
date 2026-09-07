// Several tabs, several documents: the one thing jsdom cannot show, since it has no
// second tab. Two pages in one browser context share localStorage and have their own
// sessionStorage each — exactly what two tabs of the same browser are.
import { checker, previewServer, openApp } from '../browser.mjs';

const PORT = +(process.env.TABS_PORT ?? 4183);
const URL = `http://localhost:${PORT}/`;
const { check, failures } = checker();
const server = await previewServer(PORT);
const { browser, page, pageErrors } = await openApp(PORT);
// openApp's page has a context of its own; the tabs need to share one.
await page.close();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'en-US' });

const settle = (p) => p.waitForTimeout(1500);
const text = (p) => p.textContent('.tiptap');

async function openTab() {
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  p.on('pageerror', (err) => pageErrors.push(String(err)));
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForSelector('.tiptap', { timeout: 15_000 });
  return p;
}

async function type(p, s) {
  await p.click('.tiptap p');
  await p.keyboard.type(s);
  await settle(p);
}

try {
  const a = await openTab();
  await a.evaluate(() => localStorage.clear());
  await a.reload({ waitUntil: 'load' });
  await a.waitForSelector('.tiptap');
  await type(a, 'Alpha');

  const b = await openTab();
  check(!(await text(b)).includes('Alpha'), 'a second tab starts on its own empty document');
  await type(b, 'Beta');
  check((await text(a)).includes('Alpha') && !(await text(a)).includes('Beta'), 'the first tab keeps its own text');

  const keys = await a.evaluate(() => Object.fromEntries(Object.keys(localStorage)
    .filter((k) => k.startsWith('edentext-doc'))
    .map((k) => [k, localStorage.getItem(k) ?? ''])));
  const scoped = Object.keys(keys).find((k) => k.startsWith('edentext-doc@'));
  check(keys['edentext-doc']?.includes('Alpha'), 'the first document keeps the unsuffixed key');
  check(!!scoped && keys[scoped].includes('Beta'), `the second document has its own key (${scoped})`);

  for (const p of [a, b]) {
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('.tiptap');
    await settle(p);
  }
  check((await text(a)).includes('Alpha') && (await text(b)).includes('Beta'), 'both tabs keep their document across a reload');

  // A closed tab signs its document off, so the next fresh tab takes it up again.
  await b.close();
  const c = await openTab();
  await settle(c);
  check((await text(c)).includes('Beta'), 'a new tab takes up the document the closed tab held');
} catch (err) {
  check(false, `tabs run threw: ${err.message ?? err}`);
} finally {
  check(pageErrors.length === 0, pageErrors.length ? `no uncaught page errors — got: ${pageErrors.join(' | ')}` : 'no uncaught page errors');
  await browser.close();
  if (server) process.kill(-server.pid);
}
process.exit(failures.length ? 1 : 0);
