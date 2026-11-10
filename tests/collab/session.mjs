// A shared session end to end: the real relay (relay/server.mjs), the dev server, and
// clients joining through the link. Checks that a joiner gets the starter's document with
// its layout and zones, that edits and undo work both ways, that the relay sees no plain
// text, that clients come, go and reload (four at once), that the assistant's edits travel
// and undo like typed ones, and that an idle session stays quiet, also when one client
// lays the pages out differently. The relay passes at most 1 MiB per frame, so a picture
// and a late joiner's copy go in parts; a line that keeps breaking stops showing `live`.
// Any engine (BROWSER).
import { join } from 'node:path';
import { MOD, ROOT, checker, devServer, openApp } from '../browser.mjs';
import { startRelay } from '../../relay/server.mjs';

const PORT = +(process.env.COLLAB_PORT ?? 4392);
const RELAY_PORT = +(process.env.COLLAB_RELAY_PORT ?? 4393);
process.env.RELAY_PORT = String(RELAY_PORT);
const { check, failures } = checker();
const seen = [];
const FRAME = 1 << 20;
const relay = await startRelay({ port: RELAY_PORT, maxFrame: FRAME, tap: (d) => seen.push(Buffer.from(d)) });
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
const sent = (page, kind = 1) => page.evaluate((k) => window.__collab.session.stats.sent[k], kind);
const [ASK, ANSWER] = [0, 5];
const status = (page) => page.evaluate(() => window.__collab.view().status);
// A noise picture, incompressible like a photo, of about 2.5 MB as a data URL.
const photo = (page) => page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 900; c.height = 700;
  const ctx = c.getContext('2d'), img = ctx.createImageData(900, 700);
  for (let i = 0; i < img.data.length; i++) img.data[i] = (i & 3) === 3 ? 255 : (Math.random() * 256) | 0;
  ctx.putImageData(img, 0, 0);
  const src = c.toDataURL('image/png');
  document.querySelector('.tiptap-host .tiptap').editor.chain().focus('start').setImage({ src, width: 300, height: 233 }).run();
  return src.length;
});
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
// Header and footer zones: one person at a time, the others see who.
const openZone = async (page, kind) => {
  const z = page.locator(`.hf-layer .hf-zone.hf-${kind}:not(.hf-active)`).first();
  await z.dblclick({ timeout: 5000 }).catch(() => z.dispatchEvent('dblclick'));
  await page.waitForTimeout(400);
};
const editing = (page) => page.evaluate(() => /hf-(header|footer)/.exec(document.querySelector('.hf-active')?.className ?? '')?.[1] ?? '');
const heldTag = (page) => page.evaluate(() => [...new Set([...document.querySelectorAll('.hf-held')].map((t) => t.textContent.trim()))].join('|'));
// Holds back every frame a page sends until released, as a slow line would.
const hold = (page, on) => page.evaluate((h) => {
  if (!window.__held) {
    const send = WebSocket.prototype.send;
    window.__held = [];
    window.__send = send;
    WebSocket.prototype.send = function (d) { if (window.__holding) window.__held.push([this, d]); else send.call(this, d); };
  }
  window.__holding = h;
  if (!h) for (const [w, d] of window.__held.splice(0)) if (w.readyState === 1) window.__send.call(w, d);
}, on);
const clientId = (page) => page.evaluate(() => window.__collab.session.awareness.clientID);
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

  // A has the header open: B sees it held with A's name and cannot open it, but can open
  // the footer. A's typing reaches B and goes back with A's undo on both; then B's turn.
  await openZone(a, 'header');
  await b.waitForTimeout(600);
  const heldForB = await heldTag(b);
  await openZone(b, 'header');
  const bInHeader = await editing(b);
  check(await editing(a) === 'header' && heldForB === 'Anna is editing' && !bInHeader, `B sees the header held by A and cannot open it ("${heldForB}", B in "${bInHeader}")`);
  await openZone(b, 'footer');
  check(await editing(b) === 'footer', 'B can open the footer meanwhile');
  await b.keyboard.press('Escape');
  await a.keyboard.type(' Xa');
  await a.keyboard.press('Escape');
  await settle(a);
  [va, vb] = [await view(a), await view(b)];
  check(same(va, vb) && vb.zones.includes('Xa') && !await heldTag(b), `A's header text reaches B and the header is free again (${brief(vb)})`);
  await caret(a, 'end');
  await a.keyboard.press(`${MOD}+z`);
  await settle(a);
  [va, vb] = [await view(a), await view(b)];
  check(same(va, vb) && !va.zones.includes('Xa'), `A's undo takes back the header text on both (${brief(va)} | ${brief(vb)})`);
  await openZone(b, 'header');
  await b.keyboard.type(' Yb');
  await b.keyboard.press('Escape');
  await settle(b);
  [va, vb] = [await view(a), await view(b)];
  check(same(va, vb) && va.zones.includes('Yb'), `then B opens the header and its text reaches A (${brief(va)})`);

  // Both open the header before either hears of the other: the higher client id gives way.
  await hold(a, true);
  await hold(b, true);
  await Promise.all([openZone(a, 'header'), openZone(b, 'header')]);
  await a.keyboard.type('Q');
  await b.keyboard.type('R');
  const opened = [await editing(a), await editing(b)];
  await hold(a, false);
  await hold(b, false);
  await a.waitForTimeout(1200);
  const kept = [await editing(a), await editing(b)];
  const ids = [await clientId(a), await clientId(b)];
  const [keeper, other] = kept[0] ? [a, b] : [b, a];
  const lower = kept[0] ? ids[0] < ids[1] : ids[1] < ids[0];
  check(opened.join() === 'header,header' && kept.filter(Boolean).length === 1 && lower && await heldTag(other),
    `two opening the header at once: one keeps it, the lower client id (${opened} → ${kept}, tag "${await heldTag(other)}")`);
  await keeper.keyboard.press('Escape');
  await settle(a);
  [va, vb] = [await view(a), await view(b)];
  check(same(va, vb) && !await heldTag(a) && !await heldTag(b), `after that both documents are the same (${brief(va)} | ${brief(vb)})`);

  const size = await photo(a);
  await a.waitForTimeout(2500);
  [va, vb] = [await view(a), await view(b)];
  check(size > FRAME && va.json === vb.json, `a picture longer than the relay's frame reaches the joiner (${(size / 1e6).toFixed(1)} MB)`);

  const answers = async () => await sent(a, ANSWER) + await sent(b, ANSWER);
  const answered = await answers();
  const c = await client('Cleo');
  await joinLink(c, link);
  const vc = await view(c);
  va = await view(a);
  check(same(va, vc) && await sheet(c) === await sheet(a), `a late joiner gets every edit so far, styles and the picture too (${brief(vc)})`);
  const once = [await sent(c, ASK), await answers() - answered];
  check(once.join() === '1,1', `the late joiner asks once and gets one answer (${once})`);
  check(seen.every((f) => f.length <= FRAME), `no frame exceeds the relay's limit (largest ${Math.max(...seen.map((f) => f.length))})`);
  const names = await a.evaluate(() => window.__collab.view().peers.map((p) => p.name).sort().join(','));
  const bar = (await a.textContent('.statusbar .collab-btn'))?.trim();
  check(names === 'Ben,Cleo' && /2/.test(bar ?? ''), `the starter sees who is there (${names}; "${bar}")`);

  const d4 = await client('Dan');
  await joinLink(d4, link);
  await caret(d4, 'end');
  await d4.keyboard.type(' Delta');
  await caret(c, 'start');
  await c.keyboard.type('Cleo ');
  await settle(a);
  await d4.waitForTimeout(600);
  const four = await Promise.all([a, b, c, d4].map(view));
  check(four.every((v) => same(v, four[0])) && four[0].text.startsWith('Cleo ') && four[0].text.endsWith(' Delta'),
    `a fourth client joins late and types, and all four converge (${four.map(brief).join(' | ')})`);

  // A tab closed with a zone open frees it for the others.
  await openZone(d4, 'footer');
  await b.waitForTimeout(600);
  const heldByDan = await heldTag(b);
  const closedAt = Date.now();
  await d4.close();
  const freed = await b.waitForFunction(() => !document.querySelector('.hf-held'), null, { timeout: 40_000 }).then(() => true, () => false);
  check(heldByDan === 'Dan is editing' && freed, `a tab closed with the footer open frees it ("${heldByDan}", after ${((Date.now() - closedAt) / 1000).toFixed(1)} s)`);

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

  // The relay drops every connection right after its welcome, as with a frame too large: the
  // line is not `live`, says so, retries with growing pauses and recovers once it holds.
  let sockets = 0;
  a.on('websocket', (w) => { if (w.url().includes('/relay')) sockets++; });
  const cut = setInterval(() => { for (const room of relay.rooms.values()) for (const w of room) w.close(1009, 'too big'); }, 200);
  const failing = await a.waitForFunction(() => window.__collab.view().status === 'failing', null, { timeout: 20_000 }).then(() => true, () => false);
  const told = await a.waitForSelector('dialog[open] [data-status="failing"]', { timeout: 2000 }).then(() => true, () => false);
  await a.waitForTimeout(12_000);
  clearInterval(cut);
  const during = [await status(a), sockets];
  check(failing && told && during[0] !== 'live' && sockets <= 8, `a line that keeps breaking is not live and says so, with backoff (${during[0]}, ${sockets} connections)`);
  for (const page of [a, e]) await page.keyboard.press('Escape');
  await a.waitForFunction(() => window.__collab.view().status === 'live', null, { timeout: 45_000 }).catch(() => {});
  await e.waitForFunction(() => window.__collab.view().status === 'live', null, { timeout: 15_000 }).catch(() => {});
  await caret(e, 'end');
  await e.keyboard.type(' Omega');
  await settle(a);
  await a.waitForTimeout(600);
  const [pa2, pe2] = [await view(a), await view(e)];
  check(await status(a) === 'live' && pa2.json === pe2.json && pa2.text.endsWith('Omega'), `once the line holds it is live again and edits arrive (${await status(a)})`);

  check(!pageErrors.length, `no uncaught page errors ${pageErrors.join(' | ')}`);
} catch (err) {
  check(false, `collab session run threw: ${err}`);
} finally {
  await browser.close();
  await relay.close();
  if (server) process.kill(-server.pid);
}
process.exit(failures.length ? 1 : 0);
