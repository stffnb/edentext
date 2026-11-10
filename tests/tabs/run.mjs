// Several tabs, several documents: the one thing jsdom cannot show, since it has no
// second tab. Two pages in one browser context share localStorage and have their own
// sessionStorage each — exactly what two tabs of the same browser are.
import { checker, collectErrors, previewServer, openApp } from '../browser.mjs';

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
  collectErrors(p, pageErrors);
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

  // An open tab holds its document's lock, and its end releases it however it came: the
  // marker is set back to held, as a tab that ended with no pagehide leaves it.
  const bId = await b.evaluate(() => sessionStorage.getItem('edentext-tab-doc'));
  const locks = await a.evaluate(async () => (await navigator.locks.query()).held.map((l) => l.name));
  check(locks.includes(`edentext-doc@${bId}`), `an open tab holds its document's lock (${locks.join(', ')})`);
  // A fresh tab starts empty; the document a closed tab held is offered, not opened.
  await b.close();
  await a.evaluate((id) => localStorage.setItem(`edentext-live@${id}`, String(Date.now())), bId);
  const c = await openTab();
  await settle(c, true);
  check(!(await text(c)).trim(), 'a new tab starts on an empty document');
  await c.getByRole('button', { name: 'Beta' }).click();
  await c.waitForFunction(() => document.querySelector('.tiptap')?.textContent.includes('Beta'));
  check(true, 'the resume card reopens the document the closed tab held');
} catch (err) {
  check(false, `tabs run threw: ${err.message ?? err}`);
} finally {
  check(pageErrors.length === 0, pageErrors.length ? `no uncaught page errors — got: ${pageErrors.join(' | ')}` : 'no uncaught page errors');
  await browser.close();
  if (server) process.kill(-server.pid);
}
process.exit(failures.length ? 1 : 0);
