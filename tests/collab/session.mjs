// A shared session end to end: the real relay (relay/server.mjs), the dev server, and
// clients joining through the link. Checks that a joiner gets the starter's document with
// its layout and zones, that edits and undo work both ways, that the relay sees no plain
// text, that clients come, go and reload, that the assistant's edits travel
// and undo like typed ones, and that an idle session stays quiet, also when one client
// lays the pages out differently. Any engine (BROWSER).
import { join } from 'node:path';
import { MOD, ROOT, checker, devServer, openApp } from '../browser.mjs';
import { startRelay } from '../../relay/server.mjs';

const PORT = +(process.env.COLLAB_PORT ?? 4392);
const RELAY_PORT = +(process.env.COLLAB_RELAY_PORT ?? 4393);
process.env.RELAY_PORT = String(RELAY_PORT);
const { check, failures } = checker();
const seen = [];
const relay = await startRelay({ port: RELAY_PORT, tap: (d) => seen.push(Buffer.from(d)) });
const server = await devServer(PORT);
const { browser, page: a, pageErrors } = await openApp(PORT);
const URL0 = `http://localhost:${PORT}/`;

async function client(name, css) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'en-US', serviceWorkers: 'block' });
  await ctx.addInitScript((n) => { if (!localStorage.getItem('edentext-user-name')) localStorage.setItem('edentext-user-name', n); }, name);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { if (!/ResizeObserver loop/.test(String(e))) pageErrors.push(`${name}: ${e}`); });
  page.on('dialog', (d) => d.accept());
  if (css) await page.addInitScript((c) => addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = c; document.head.append(s); }), css);
  return page;
}
const ready = (page) => page.waitForFunction(() => document.querySelector('.tiptap-host .tiptap')?.editor, null, { timeout: 30_000 });
const live = (page) => page.waitForFunction(() => window.__collab?.view()?.status === 'live', null, { timeout: 20_000 });
async function openDoc(page, doc) {
  await page.goto(URL0, { waitUntil: 'load' });
  await page.evaluate((ai) => {
    localStorage.clear();
    localStorage.setItem('edentext-user-name', 'Anna');
    localStorage.setItem('edentext-ai', JSON.stringify(ai));
  }, AI);
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  await page.setInputFiles('input.file-input[accept*=".odt"]', join(ROOT, 'tests/corpus', doc));
  await page.waitForTimeout(2500);
}
// Through the File menu and the dialog, as a reader starts one.
async function start(page) {
  await page.click('.ribbon-tab-file');
  await page.click('.ribbon [data-cmd="collab"]');
  await page.click('dialog[open] [data-cmd="collabStart"]');
  await live(page);
  const link = await page.inputValue('dialog[open] input[readonly]');
  await page.click('dialog[open] .primary');
  return link;
}
async function joinLink(page, link) {
  await page.goto(link, { waitUntil: 'load' });
  await ready(page);
  await live(page);
  await page.waitForTimeout(1500);
}
const view = (page) => page.evaluate(() => {
  const ed = document.querySelector('.tiptap-host .tiptap').editor;
  return {
    json: JSON.stringify(ed.state.doc.toJSON()),
    text: ed.state.doc.textContent,
    pages: +(/of (\d+)/.exec(document.querySelector('.statusbar')?.textContent ?? '')?.[1] ?? 0),
    width: Math.round(document.querySelector('.page, .pm-page, .paper')?.getBoundingClientRect().width ?? 0),
    zones: [...document.querySelectorAll('.hf-zone')].map((z) => z.textContent.trim()).filter(Boolean).slice(0, 6).join('|'),
  };
});
const same = (x, y) => x.json === y.json && x.pages === y.pages && x.width === y.width && x.zones === y.zones;
const brief = (v) => `${v.pages}p ${v.width}px "${v.text.slice(0, 30)}" [${v.zones.slice(0, 40)}]`;
const settle = (page) => page.waitForTimeout(900);
const body = (page) => page.locator('.tiptap-host .tiptap').first();
// The caret at the body's start or end, where the keys go next.
// The click's own selection lands a moment later; the caret is placed after it.
const caret = async (page, where) => {
  await body(page).click();
  await page.waitForTimeout(150);
  await page.evaluate((w) => document.querySelector('.tiptap-host .tiptap').editor.commands.focus(w), where);
};
const SHEET = '/src/lib/styles/sheet.svelte.ts';
const sheet = (page) => page.evaluate(async (url) => JSON.stringify((await import(url)).styleSheet()), SHEET);
const sent = (page) => page.evaluate(() => window.__collab.session.stats.sent[1]);
// The assistant's provider, scripted: two tool calls, then a closing word. Nothing leaves.
const AI = { enabled: true, provider: 'openai', endpoint: 'http://mock.test/v1', apiKey: '', model: 'm' };
let aiRequests = 0;
await a.route('http://mock.test/**', async (route) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  aiRequests++;
  const msgs = JSON.parse(route.request().postData() ?? '{}').messages ?? [];
  const tool = (index, name, args) => ({ index, id: `c${index}`, function: { name, arguments: JSON.stringify(args) } });
  const delta = msgs.at(-1)?.role === 'tool' ? { content: '<p>Done.</p>' }
    : { tool_calls: [tool(0, 'replace_text', { paragraph: 1, find: 'ipsum', replace: 'Slow' }), tool(1, 'set_page', { orientation: 'portrait' })] };
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n` });
});
const RECORD = '/src/lib/storage/trackChanges.svelte.ts';
const record = (page, on) => page.evaluate(async ([url, v]) => (await import(url)).setRecordChanges(v), [RECORD, on]);
// Every recorded change's author in the body.
const authors = (page) => page.evaluate(() => {
  const out = new Set();
  document.querySelector('.tiptap-host .tiptap').editor.state.doc.descendants((n) => {
    for (const m of n.marks) if (m.type.name === 'insertion' || m.type.name === 'deletion') out.add(m.attrs.author);
  });
  return [...out].sort().join(',');
});

try {
  await openDoc(a, '16-hf-variants.odt');
  const link = await start(a);
  check(/#collab=[A-Za-z0-9_-]{43}$/.test(link), `the starter gets a link with the key after # (${link.replace(/=.*/, '=…')})`);

  const b = await client('Ben');
  await joinLink(b, link);
  let [va, vb] = [await view(a), await view(b)];
  check(same(va, vb), `the joiner gets the document, its pages and zones (${brief(va)} | ${brief(vb)})`);
  const stored = await b.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('edentext-doc')));
  check(!stored.length, `the joiner stores no copy (${stored.join(',')})`);

  await caret(a, 'end');
  await a.keyboard.type(' Alpha');
  await caret(b, 'start');
  await b.keyboard.type('Beta ');
  await settle(a);
  [va, vb] = [await view(a), await view(b)];
  check(va.json === vb.json && va.text.startsWith('Beta ') && va.text.endsWith(' Alpha'), `typing on both sides converges (${va.text.slice(0, 12)}…${va.text.slice(-8)})`);

  await body(b).click();
  await b.keyboard.press(`${MOD}+z`);
  await settle(a);
  [va, vb] = [await view(a), await view(b)];
  check(va.json === vb.json && !va.text.startsWith('Beta') && va.text.endsWith(' Alpha'), `the joiner's undo takes back only its own typing (${va.text.slice(0, 12)}…${va.text.slice(-8)})`);

  await a.click('[data-tab="layout"]');
  await a.click('[data-cmd="orientation"]');
  await a.click('[data-cmd="orientation-landscape"]');
  await a.waitForTimeout(1500);
  [va, vb] = [await view(a), await view(b)];
  check(same(va, vb) && va.width > 1000, `a page setup reaches the joiner (${brief(va)} | ${brief(vb)})`);

  await caret(a, 'start');
  await b.waitForTimeout(600);
  const cursor = await b.evaluate(() => document.querySelector('.ProseMirror-yjs-cursor')?.textContent ?? '');
  check(cursor.includes('Anna'), `the joiner sees the starter's caret with the name (${JSON.stringify(cursor)})`);

  const all = Buffer.concat(seen);
  check(seen.length > 0 && !['Alpha', 'Beta', 'Ben', 'Anna'].some((w) => all.includes(Buffer.from(w))),
    `the relay passed ${seen.length} frames, none with plain text`);

  await a.evaluate(async (url) => {
    const m = await import(url);
    const h = m.styleSheet().paragraph['Heading 2'];
    m.putStyle({ ...h, text: { ...h.text, fontSizePt: 22 } });
  }, SHEET);
  await settle(a);
  const styled = await sheet(a);
  check(styled.includes('"fontSizePt":22') && styled === await sheet(b), 'a style change reaches the joiner');

  const before = [await sent(a), await sent(b)];
  await a.waitForTimeout(5000);
  const after = [await sent(a), await sent(b)];
  check(before.join() === after.join(), `an idle session, also after a style change, sends no edits (${before} → ${after})`);

  // The assistant on A, both recording: its text change and page setup reach B, B keeps
  // the assistant's marks without recording them again, and A's undo takes back each.
  await record(a, true);
  await record(b, true);
  await a.locator('[data-cmd="aiPane"]:visible').first().click();
  await a.fill('.ai-pane textarea', 'Slower, and portrait');
  await a.keyboard.press('Enter');
  await a.waitForSelector('.ai-pane .tool', { timeout: 15_000 }).catch(() => {});
  await a.waitForTimeout(1500);
  [va, vb] = [await view(a), await view(b)];
  const [aa, ab] = [await authors(a), await authors(b)];
  check(same(va, vb) && va.text.includes('Slow') && va.width < 1000 && aiRequests === 2,
    `the assistant's tool calls reach the joiner (${brief(va)} | ${brief(vb)}; ${aiRequests} requests to the mock)`);
  check(aa === 'AI' && ab === 'AI', `the joiner keeps the assistant's recorded changes and records none of its own (${aa} | ${ab})`);
  await caret(a, 'end');
  await a.keyboard.press(`${MOD}+z`);
  await settle(a);
  [va, vb] = [await view(a), await view(b)];
  check(same(va, vb) && va.width > 1000 && va.text.includes('Slow'), `A's first undo takes back the assistant's page setup on both (${brief(va)} | ${brief(vb)})`);
  await a.keyboard.press(`${MOD}+z`);
  await settle(a);
  [va, vb] = [await view(a), await view(b)];
  check(same(va, vb) && !va.text.includes('Slow') && va.text.includes('ipsum') && await authors(b) === '',
    `A's next undo takes back the assistant's text change on both (${brief(va)} | ${brief(vb)})`);
  await record(a, false);
  await record(b, false);

  const c = await client('Cleo');
  await joinLink(c, link);
  const vc = await view(c);
  va = await view(a);
  check(same(va, vc) && await sheet(c) === await sheet(a), `a late joiner gets every edit so far, styles too (${brief(vc)})`);
  const names = await a.evaluate(() => window.__collab.view().peers.map((p) => p.name).sort().join(','));
  const bar = (await a.textContent('.statusbar .collab-btn'))?.trim();
  check(names === 'Ben,Cleo' && /2/.test(bar ?? ''), `the starter sees who is there (${names}; "${bar}")`);


  await a.click('.statusbar .collab-btn');
  await a.click('dialog[open] [data-cmd="collabLeave"]');
  await caret(b, 'end');
  await b.keyboard.type(' Gamma');
  await settle(b);
  const [vb2, vc2, va2] = [await view(b), await view(c), await view(a)];
  check(vb2.json === vc2.json && vc2.text.endsWith('Gamma') && !va2.text.endsWith('Gamma'), 'after the starter left, the others go on without it');

  await b.reload({ waitUntil: 'load' });
  await ready(b);
  await live(b);
  await b.waitForTimeout(1500);
  check(same(await view(b), await view(c)), 'a reloaded joiner is back in the session');

  const d = await client('Dora');
  await d.goto(`${URL0}#collab=short`, { waitUntil: 'load' });
  const said = await d.waitForSelector('dialog[open] [data-status="invalid"]', { timeout: 15_000 }).then(() => true, () => false);
  check(said, 'a cut-short link says so');

  // Another layout on the joiner's side (as with other fonts): page-number fields must not
  // flip back and forth between the two.
  const e = await client('Ella', '.tiptap-host .tiptap p { line-height: 2.2 !important; }');
  await openDoc(a, '20-index-footer.odt');
  const link2 = await start(a);
  await joinLink(e, link2);
  await e.waitForTimeout(3000);
  const quiet = [await sent(a), await sent(e)];
  await a.waitForTimeout(5000);
  const quiet2 = [await sent(a), await sent(e)];
  const [pa, pe] = [await view(a), await view(e)];
  check(pa.pages !== pe.pages && quiet.join() === quiet2.join(), `different layouts stay quiet (${quiet} → ${quiet2}, pages ${pa.pages}/${pe.pages})`);

  check(!pageErrors.length, `no uncaught page errors ${pageErrors.join(' | ')}`);
} catch (err) {
  check(false, `collab session run threw: ${err}`);
} finally {
  await browser.close();
  await relay.close();
  if (server) process.kill(-server.pid);
}
process.exit(failures.length ? 1 : 0);
