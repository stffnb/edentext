// A shared session end to end: the real relay (relay/server.mjs), the dev server, and
// clients joining through the link. Checks that a joiner gets the starter's document with
// its layout and zones, that edits and undo work both ways, that the relay sees no plain
// text, that clients come, go and reload (four at once), that the assistant's edits travel
// and undo like typed ones, and that an idle session stays quiet, also when one client
// lays the pages out differently. The relay passes at most 1 MiB per frame, so a picture
// and a late joiner's copy go in parts; a line that keeps breaking stops showing `live`.
// When the starter leaves, the others are told; a joiner leaving keeps its copy as a
// document of this browser or drops it, and a link to an empty room says so. A reader by
// the read link follows and changes nothing, nor do its forged or replayed frames; readers
// count toward the room's limit, alone give a newcomer nothing, and may keep a copy. The
// session chat reaches everyone here and nothing else, nor can a patched reader abuse it.
// Any engine (BROWSER).
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer as tcpServer, connect as tcpConnect } from 'node:net';
import { MOD, ROOT, checker, collectErrors, devServer, openApp } from '../browser.mjs';
import { startRelay } from '../../relay/server.mjs';
import { strFromU8, unzipSync } from 'fflate';

const PORT = +(process.env.COLLAB_PORT ?? 4392);
const RELAY_PORT = +(process.env.COLLAB_RELAY_PORT ?? 4393);
process.env.RELAY_PORT = String(RELAY_PORT);
const { check, failures } = checker();
const seen = [];
const FRAME = 1 << 20;
const BEAT = 2000;
const PING = 5000;
let relay = await startRelay({ port: RELAY_PORT, maxFrame: FRAME, beat: BEAT, ping: PING, tap: (d) => seen.push(Buffer.from(d)) });
// A line to the relay that can go silent without a close, as under a closed laptop lid, or
// pass the client's bytes at `rate` per second, holding back no more than a slow uplink would.
const STALL_PORT = +(process.env.COLLAB_STALL_PORT ?? RELAY_PORT + 5);
const stall = { on: false, rate: 0 };
const stallLine = tcpServer((down) => {
  const up = tcpConnect(RELAY_PORT, '127.0.0.1');
  const slow = [];
  let pump;
  const drain = () => {
    let budget = Math.ceil(stall.rate / 50) || Infinity;
    while (slow.length && budget > 0) {
      const d = slow.shift(), n = Math.min(d.length, budget);
      if (n < d.length) slow.unshift(d.subarray(n));
      budget -= n;
      up.write(d.subarray(0, n));
    }
    if (slow.reduce((n, d) => n + d.length, 0) < 64 << 10) down.resume();
    if (!slow.length) { clearInterval(pump); pump = undefined; }
  };
  for (const [from, to] of [[down, up], [up, down]]) {
    from.on('data', (d) => {
      if (stall.on) return;
      if (from === up || (!stall.rate && !slow.length)) return to.write(d);
      slow.push(d);
      if (slow.reduce((n, x) => n + x.length, 0) > 64 << 10) down.pause();
      pump ??= setInterval(drain, 20);
    });
    from.on('close', () => { if (!stall.on) to.destroy(); clearInterval(pump); });
    from.on('error', () => {});
  }
}).listen(STALL_PORT, '127.0.0.1');
const server = await devServer(PORT);
const { browser, page: a, pageErrors } = await openApp(PORT);
const URL0 = `http://localhost:${PORT}/`;

async function client(name, css) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'en-US', serviceWorkers: 'block' });
  await ctx.addInitScript((n) => { if (!localStorage.getItem('edentext-user-name')) localStorage.setItem('edentext-user-name', n); }, name);
  const page = await ctx.newPage();
  collectErrors(page, pageErrors, `${name}: `);
  page.dialogs = [];
  page.on('dialog', (d) => { page.dialogs.push(d.type()); d.accept(); });
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
// Whether each control is disabled (null when absent), and the spell check's squiggles.
const disabled = (page, sels) => page.evaluate((list) => list.map((q) => document.querySelector(q)?.matches(':disabled') ?? null), sels);
const EDITS = ['[data-cmd="bold"]', '[data-cmd="paste"]', '[data-cmd="replace"]', '[data-cmd="fontFamily"] input', '[data-cmd="orderedList"]'];
const squiggles = (page) => page.evaluate(() => {
  const st = document.querySelector('.tiptap-host .tiptap').editor.state;
  return st.plugins.find((p) => p.key.startsWith('spellCheck$'))?.getState(st)?.set.find().length ?? -1;
});
const caret = async (page, where) => {
  await body(page).click();
  await page.waitForTimeout(150);
  await page.evaluate((w) => document.querySelector('.tiptap-host .tiptap').editor.commands.focus(w), where);
};
const SHEET = '/src/lib/styles/sheet.svelte.ts';
const sheet = (page) => page.evaluate(async (url) => JSON.stringify((await import(url)).styleSheet()), SHEET);
const sent = (page, kind = 1) => page.evaluate((k) => window.__collab.session.stats.sent[k], kind);
const [ASK, ANSWER, PICTURE] = [0, 5, 6];
const status = (page) => page.evaluate(() => window.__collab.view().status);
// A noise picture, incompressible like a photo, of about 2.5 MB (900×700) as a data URL,
// put in the body or another editor; returns its length and its bytes'.
const photo = (page, at = '.tiptap-host .tiptap', w = 900, h = 700) => page.evaluate(([at, w, h]) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
  for (let i = 0; i < img.data.length; i++) img.data[i] = (i & 3) === 3 ? 255 : (Math.random() * 256) | 0;
  ctx.putImageData(img, 0, 0);
  const src = c.toDataURL('image/png');
  document.querySelector(at).editor.chain().focus('start').setImage({ src, width: Math.round(w / 3), height: Math.round(h / 3) }).run();
  return [src.length, atob(src.slice(src.indexOf(',') + 1)).length];
}, [at, w, h]);
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
// Pictures: how many the editor shows as bytes, the Yjs doc's size, bytes into the relay.
const shown = (page) => page.evaluate(() => [...document.querySelectorAll('.tiptap-host .tiptap img')].filter((i) => i.src.startsWith('data:') && i.src.length > 1e6).length);
const ysize = (page) => page.evaluate(async () => (await import('/src/lib/editor/undoYjs.ts')).Y.encodeStateAsUpdate(window.__collab.session.awareness.doc).length);
const relayed = () => seen.reduce((n, f) => n + f.length, 0);
const inline = (json) => /"src":"data:[^"]{5000}/.test(json);
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

  // Extra panes are views of the same state: they must neither loop nor take the
  // session's binding with them when they close.
  await b.click('[data-tab="view"]');
  await b.click('[data-cmd="splitView"]');
  await b.waitForTimeout(300);
  await b.click('[data-cmd="pagesAcross"]');
  await b.click('.ribbon-menu button >> nth=1');
  await b.waitForTimeout(600);
  const panes = await b.evaluate(() => document.querySelectorAll('[data-split-pane] .tiptap').length);
  await b.click('[data-cmd="pagesAcross"]');
  await b.click('.ribbon-menu button >> nth=0');
  await b.click('[data-cmd="zoomReset"]');
  await caret(a, 'end');
  await a.keyboard.type(' Gamma');
  await settle(a);
  [va, vb] = [await view(a), await view(b)];
  check(panes > 0 && va.json === vb.json && vb.text.endsWith(' Gamma'), `split, then pages across, then one page keeps the joiner in the session (${panes} panes, ${vb.text.slice(-8)})`);
  for (let i = 0; i < 6; i++) await a.keyboard.press('Backspace');
  await settle(a);

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

  // Typed keys reach the other as the edit, then the caret in it, at most these two frames a
  // key; and an edit reaching a tab whose last batch was cheap applies as it arrives.
  await caret(b, 'end');
  await a.waitForTimeout(400);
  await a.evaluate(() => {
    const s = window.__collab.session, st = window.__order = { kinds: '', arrived: [], applied: [], on: true };
    s.debug.tap = (d) => { if (d[0] === 1 || d[0] === 2) st.kinds += d[0]; if (d[0] === 1) st.arrived.push(performance.now()); };
    s.debug.ydoc.on('update', (_u, origin) => { if (st.on && typeof origin === 'symbol') st.applied.push(performance.now()); });
  });
  const keys0 = [await sent(b, 1), await sent(b, 2)];
  for (const ch of 'Xyzzy.') { await b.keyboard.type(ch); await b.waitForTimeout(150); }
  await a.waitForTimeout(400);
  const keys1 = [await sent(b, 1), await sent(b, 2)];
  const order = await a.evaluate(() => {
    const st = window.__order;
    st.on = false;
    window.__collab.session.debug.tap = null;
    const lag = st.arrived.map((t, i) => (st.applied[i] ?? Infinity) - t).sort((x, y) => x - y);
    return { kinds: st.kinds, lag: Math.round(lag[Math.floor(lag.length / 2)] ?? -1) };
  });
  for (let i = 0; i < 6; i++) await b.keyboard.press('Backspace');
  const perKey = (keys1[0] + keys1[1] - keys0[0] - keys0[1]) / 6;
  check(/^(12)+$/.test(order.kinds) && perKey <= 2, `each key goes as its edit, then the caret, ${perKey} frames a key (${order.kinds})`);
  check(order.lag >= 0 && order.lag < 25, `a cheap edit applies as it arrives (median ${order.lag} ms after its frame)`);

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

  const [y0, r0] = [await ysize(a), relayed()];
  const [size, bytes] = await photo(a);
  await a.waitForTimeout(2500);
  [va, vb] = [await view(a), await view(b)];
  check(size > FRAME && va.json === vb.json && await shown(b) === 1, `a picture longer than the relay's frame reaches the joiner (${(size / 1e6).toFixed(1)} MB)`);
  const [y1, r1] = [await ysize(a), relayed()];
  check(!inline(va.json) && y1 - y0 < 2000 && r1 - r0 > bytes && r1 - r0 < bytes * 1.05,
    `the shared doc names the picture by its key (+${y1 - y0} bytes), its bytes go once, not as base64 (${((r1 - r0) / bytes).toFixed(2)}× its bytes)`);
  // What leaves a client holds the picture: its copy on the clipboard, a saved file, autosave.
  const copied = await b.evaluate(() => {
    const ed = document.querySelector('.tiptap-host .tiptap').editor;
    let at = -1;
    ed.state.doc.descendants((n, pos) => { if (n.type.name === 'image') at = pos; });
    ed.commands.setNodeSelection(at);
    return ed.view.serializeForClipboard(ed.state.selection.content()).dom.innerHTML;
  });
  await b.evaluate(() => { window.showSaveFilePicker = undefined; });
  await b.click('.ribbon-tab-file');
  const [file] = await Promise.all([
    b.waitForEvent('download', { timeout: 30_000 }),
    b.locator('.ribbon-menu button', { hasText: '(.odt)' }).first().click()
      .then(() => b.locator('dialog[open] button.primary').click({ timeout: 2_000 }).catch(() => {})),
  ]);
  const saved = await readFile(await file.path());
  const stash = await a.evaluate(async () => {
    const keys = [...(localStorage.getItem('edentext-doc') ?? '').matchAll(/idb:([a-z0-9]+)/g)].map((m) => m[1]);
    const db = await new Promise((r) => { const q = indexedDB.open('edentext-images'); q.onsuccess = () => r(q.result); });
    const have = await Promise.all(keys.map((k) => new Promise((r) => { const q = db.transaction('images').objectStore('images').get(k); q.onsuccess = () => r(!!q.result); })));
    return `${keys.length}/${have.filter(Boolean).length}`;
  });
  check(/src="data:image\/png/.test(copied) && saved.includes('Pictures/') && saved.length > size * 0.7 && /^(\d+)\/\1$/.test(stash) && stash !== '0/0',
    `the copied picture, B's saved file (${saved.length} bytes) and A's autosave (${stash} keys stored) hold the picture`);
  await b.keyboard.press('Escape');

  const answers = async () => await sent(a, ANSWER) + await sent(b, ANSWER);
  const answered = await answers();
  const pictured = await sent(a, PICTURE) + await sent(b, PICTURE);
  const c = await client('Cleo');
  await joinLink(c, link);
  const vc = await view(c);
  va = await view(a);
  check(same(va, vc) && await sheet(c) === await sheet(a), `a late joiner gets every edit so far, styles and the picture too (${brief(vc)})`);
  const once = [await sent(c, ASK), await answers() - answered];
  check(once.join() === '1,1', `the late joiner asks once and gets one answer (${once})`);
  const given = await sent(a, PICTURE) + await sent(b, PICTURE) - pictured;
  check(await shown(c) === 1 && given === 1, `the late joiner gets the picture inserted after the start once, by one client (${given})`);

  // Moved five times, then deleted: the key moves, not the picture.
  const [y2, r2] = [await ysize(a), relayed()];
  for (const block of [2, 4, 1, 3, 2]) {
    await a.evaluate((block) => {
      const ed = document.querySelector('.tiptap-host .tiptap').editor;
      let at = -1;
      ed.state.doc.descendants((n, pos) => { if (n.type.name === 'image') at = pos; });
      const node = ed.state.doc.nodeAt(at);
      let target = 0;
      ed.state.doc.forEach((n, off, i) => { if (i === block) target = off + 1; });
      const tr = ed.state.tr.delete(at, at + node.nodeSize);
      ed.view.dispatch(tr.insert(tr.mapping.map(target), node).setMeta('composition', 4242 + block));
    }, block);
    await a.waitForTimeout(300);
  }
  await a.evaluate(() => {
    const ed = document.querySelector('.tiptap-host .tiptap').editor;
    let at = -1;
    ed.state.doc.descendants((n, pos) => { if (n.type.name === 'image') at = pos; });
    ed.chain().setNodeSelection(at).deleteSelection().run();
  });
  await settle(a);
  const [y3, r3] = [await ysize(a), relayed()];
  check(y3 - y2 < 8000 && r3 - r2 < 30_000 && (await view(b)).json === (await view(a)).json,
    `five moves and a delete send ${r3 - r2} bytes, and the doc grows by ${y3 - y2}`);
  // A picture in the header goes by its key as well: the zone in the shared doc stays small,
  // the bytes go once, and the others show it in their header.
  const [y4, r4] = [await ysize(a), relayed()];
  await openZone(a, 'header');
  const [, hbytes] = await photo(a, '.hf-active .tiptap', 600, 400);
  await a.keyboard.press('Escape');
  await settle(a);
  await a.waitForTimeout(1500);
  const hfShown = (page) => page.evaluate(() => [...document.querySelectorAll('.hf-layer .hf-zone img')].filter((i) => i.src.startsWith('data:') && i.src.length > 1e5).length);
  const [y5, r5] = [await ysize(a), relayed()];
  const hf = [await hfShown(a), await hfShown(b), await hfShown(c)];
  check(hf[0] > 0 && hf.every((n) => n === hf[0]) && y5 - y4 < 4000 && r5 - r4 > hbytes && r5 - r4 < hbytes * 1.1,
    `a header's picture reaches the others by its key (+${y5 - y4} bytes), its bytes once (${((r5 - r4) / hbytes).toFixed(2)}× them; shown ${hf})`);
  const addressed = seen.filter((f) => f.readUInt32BE(0) !== 0).length;
  check(seen.every((f) => f.length <= FRAME) && addressed > 0,
    `no frame exceeds the relay's limit (largest ${Math.max(...seen.map((f) => f.length))}), and ${addressed} went to one client alone`);
  const names = await a.evaluate(() => window.__collab.view().peers.map((p) => p.name).sort().join(','));
  const bar = (await a.textContent('.statusbar .collab-btn'))?.trim();
  check(names === 'Ben,Cleo' && /2/.test(bar ?? ''), `the starter sees who is there (${names}; "${bar}")`);

  // Shared content that does not fit the schema pauses editing: the status bar and the
  // dialog say so on every client, and both clear once it is gone again.
  const bogus = (page, put) => page.evaluate(async (put) => {
    const { Y } = await import('/src/lib/editor/undoYjs.ts');
    const body = window.__collab.session.awareness.doc.getXmlFragment('body');
    if (put) body.insert(0, [new Y.XmlElement('noSuchNode')]); else body.delete(0, 1);
  }, put);
  const pausedOn = (page) => page.waitForSelector('.statusbar .collab-btn.paused', { timeout: 5000 }).then(() => true, () => false);
  await bogus(a, true);
  const pausedBoth = [await pausedOn(a), await pausedOn(b)];
  await b.click('.statusbar .collab-btn');
  const hint = await b.isVisible('dialog[open] [data-notice="paused"]');
  await b.keyboard.press('Escape');
  await bogus(a, false);
  const cleared = await b.waitForFunction(() => !document.querySelector('.statusbar .collab-btn.paused'), null, { timeout: 5000 }).then(() => true, () => false);
  await caret(b, 'end');
  await b.keyboard.type(' Kappa');
  await settle(b);
  check(pausedBoth.every(Boolean) && hint && cleared && (await view(a)).text.endsWith(' Kappa'),
    `content that does not fit pauses editing with a notice, and editing resumes when it is gone (${pausedBoth}, ${hint}, ${cleared})`);

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

  // The client a joiner pulls from drops its answer and its line, while another keeps
  // typing so the joiner hears frames all along: the joiner still gets the doc from the rest.
  // The others' offers are held back, so Dan's is the one pulled from.
  const arm = (page, role) => page.evaluate((role) => {
    const Orig = WebSocket, send = Orig.prototype.send, sent = window.__collab.session.stats.sent;
    const st = window.__drop = { muted: role === 'mute', silent: false, fired: false, offers: sent[3], answers: sent[5] };
    Orig.prototype.send = function (data) {
      if (st.silent) return;
      if (sent[3] !== st.offers) {
        st.offers = sent[3];
        if (st.muted) return;
        if (role === 'slow') { setTimeout(() => send.call(this, data), 1500); return; }
      }
      if (role === 'drop' && (st.fired || sent[5] > st.answers)) {
        if (!st.fired) setTimeout(() => { this.close(); window.WebSocket = class extends Orig { constructor() { super('ws://127.0.0.1:4/'); } }; }, 1000);
        st.fired = true;
        return;
      }
      return send.call(this, data);
    };
  }, role);
  for (const page of [a, b, c]) await arm(page, 'mute');
  await arm(d4, 'drop');
  const f = await client('Finn');
  await f.goto(link, { waitUntil: 'load' });
  await ready(f);
  const dropped = await d4.waitForFunction(() => window.__drop.fired, null, { timeout: 15_000 }).then(() => true, () => false);
  for (const page of [a, b, c]) await page.evaluate(() => { window.__drop.muted = false; });
  await caret(c, 'end');
  let fLive = false;
  for (let i = 0; i < 10 && !fLive; i++) {
    await c.keyboard.type('.');
    await f.waitForTimeout(2000);
    fLive = await status(f) === 'live';
  }
  await f.waitForTimeout(1500);
  const [vf, va4] = [await view(f), await view(a)];
  check(dropped && fLive && same(vf, va4), `a joiner whose answer is lost with its sender's line gets the doc from another (${dropped}, ${await status(f)})`);

  // Anna's and Cleo's latest edits each stay their own, then the reloaded Ben asks and
  // Cleo's offer comes after the settle: Ben still pulls her edit, and what he pulled from
  // each reaches every other client without another sync.
  await arm(c, 'slow');
  const silent = (page, on) => page.evaluate((v) => { window.__drop.silent = v; }, on);
  for (const page of [a, c]) await silent(page, true);
  await caret(a, 'end');
  await a.keyboard.type(' Eta');
  await caret(c, 'end');
  await c.keyboard.type(' Zeta');
  await a.waitForTimeout(400);
  for (const page of [a, c]) await silent(page, false);
  await b.reload({ waitUntil: 'load' });
  await ready(b);
  await live(b);
  await b.waitForTimeout(4000);
  const [vb5, vc5, va5, vf5] = [await view(b), await view(c), await view(a), await view(f)];
  const both = (v) => v.text.includes(' Eta') && v.text.includes(' Zeta');
  check(vb5.json === vc5.json && both(vb5), `a late offer is pulled from and gets what it lacks (${both(vb5)}, ${both(vc5)})`);
  check(va5.json === vb5.json && vf5.json === vb5.json, `edits pulled from one offer reach the other clients too (${both(va5)}, ${both(vf5)})`);

  // A tab closed with a zone open frees it for the others.
  await openZone(f, 'footer');
  await b.waitForTimeout(600);
  const heldByFinn = await heldTag(b);
  const closedAt = Date.now();
  await f.close();
  const freed = await b.waitForFunction(() => !document.querySelector('.hf-held'), null, { timeout: 40_000 }).then(() => true, () => false);
  check(heldByFinn === 'Finn is editing' && freed, `a tab closed with the footer open frees it ("${heldByFinn}", after ${((Date.now() - closedAt) / 1000).toFixed(1)} s)`);

  // Ida is offline while Anna turns a list item's only block, a heading, into a paragraph.
  // Back, Ida must not apply the offers' deletions before the pulled paragraph: the list
  // item would stand empty and editing pause.
  const ida = await client('Ida');
  await ida.addInitScript(() => {
    const O = window.WebSocket, st = window.__line = { away: false, sockets: [] };
    window.WebSocket = class extends O {
      constructor(url, ...x) {
        const relay = String(url).includes('/relay');
        super(st.away && relay ? 'ws://127.0.0.1:4/' : url, ...x);
        if (relay) st.sockets.push(this);
      }
    };
  });
  const idaLog = [];
  ida.on('console', (m) => { if (/collab: paused/.test(m.text())) idaLog.push(m.text().slice(0, 120)); });
  await caret(a, 'end');
  await a.evaluate(() => document.querySelector('.tiptap-host .tiptap').editor.commands.insertContent([
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Iota' }] }] }] }]));
  await joinLink(ida, link);
  // Jo holds the footer and leaves while Ida is away: back, Ida never hears the relay's
  // `gone`, yet must not keep Jo's presence or zone.
  const jo = await client('Jo');
  await joinLink(jo, link);
  await openZone(jo, 'footer');
  await ida.waitForTimeout(800);
  const heldByJo = await heldTag(ida);
  await ida.evaluate(() => { window.__line.away = true; for (const w of window.__line.sockets) w.close(); });
  await jo.context().close();
  await ida.waitForTimeout(500);
  await a.evaluate(() => {
    const ed = document.querySelector('.tiptap-host .tiptap').editor;
    let at = -1;
    ed.state.doc.descendants((n, p) => { if (n.type.name === 'heading' && n.textContent === 'Iota') at = p + 1; });
    ed.chain().setTextSelection(at).setNode('paragraph').run();
  });
  await a.waitForTimeout(1000);
  await ida.evaluate(() => { window.__line.away = false; });
  await live(ida);
  const backAt = Date.now();
  const joGone = await ida.waitForFunction(() => !document.querySelector('.hf-held') && !window.__collab.view().peers.some((p) => p.name === 'Jo'), null, { timeout: 8000 })
    .then(() => (Date.now() - backAt) / 1000, () => Infinity);
  check(heldByJo === 'Jo is editing' && joGone < 6, `a client back on its line drops a writer who left meanwhile, zone and all ("${heldByJo}", after ${joGone.toFixed(1)} s)`);
  await ida.waitForTimeout(3000);
  const [vaI, viI] = [await view(a), await view(ida)];
  const iota = await ida.evaluate(() => {
    let t = '';
    document.querySelector('.tiptap-host .tiptap').editor.state.doc.descendants((n) => { if (n.isTextblock && n.textContent === 'Iota') t = n.type.name; });
    return t;
  });
  check(!idaLog.length && vaI.json === viI.json && iota === 'paragraph',
    `a client back from offline applies offered deletions only with the inserts that replaced them (${idaLog[0] ?? 'no pause'}, ${iota})`);
  await ida.close();

  // A joiner opening a file is asked first; cancelled, nothing changes. Keeping its copy, it
  // leaves and the file opens in a new document of its own; the others keep the shared one.
  const h = await client('Hana');
  await joinLink(h, link);
  await settle(a);
  const shared = await view(c);
  const otherFile = join(ROOT, 'tests/corpus', '20-index-footer.odt');
  await h.setInputFiles('input.file-input[accept*=".odt"]', otherFile);
  const askedOpen = await h.waitForSelector('dialog[open] [data-notice="open"]', { timeout: 5000 }).then(() => true, () => false);
  await h.keyboard.press('Escape');
  await h.waitForTimeout(1000);
  const stayed = await status(h) === 'live' && (await view(h)).json === shared.json;
  await h.setInputFiles('input.file-input[accept*=".odt"]', otherFile);
  await h.evaluate(() => { window.__before = true; });
  h.dialogs.length = 0;
  await h.click('dialog[open] [data-cmd="collabKeep"]');
  await h.waitForFunction(() => !window.__before && document.querySelector('.tiptap-host .tiptap')?.editor, null, { timeout: 30_000 });
  await h.waitForTimeout(2500);
  const hOpened = await view(h);
  const hDocs = await h.evaluate(() => Object.keys(localStorage).filter((k) => /^edentext-doc(@|$)/.test(k)).map((k) => localStorage.getItem(k).includes('Alpha')));
  const hState = await h.evaluate(() => ({ hash: location.hash, collab: !!window.__collab?.view() }));
  check(askedOpen && stayed && !hOpened.text.includes('Alpha') && hOpened.text.length > 0 && hDocs.filter(Boolean).length === 1 && hDocs.length === 2 && !hState.hash && !hState.collab && !h.dialogs.length,
    `a joiner opening a file is asked (${askedOpen}), stays on cancel (${stayed}), and keeping its copy opens the file alone (${brief(hOpened)}; docs ${hDocs}; ${JSON.stringify(hState)}; ${h.dialogs})`);
  await a.waitForTimeout(1500);
  const others = [await view(a), await view(b), await view(c)].map((v) => v.json === shared.json);
  const peersLeft = await a.evaluate(() => window.__collab.view().peers.map((p) => p.name));
  check(others.every(Boolean) && !peersLeft.includes('Hana'),
    `the others keep the shared document (${others}) and see the joiner gone (${peersLeft})`);
  await h.context().close();

  // A tab whose line goes silent without a close frees its zone once the relay's ping finds
  // it gone. Anna, the repairer, is busy meanwhile: late as she is, she stays present for the
  // others, her header held and no second client repairing.
  const repairs = (page) => page.evaluate(() => {
    const aw = window.__collab.session.awareness, me = aw.doc.clientID, mine = aw.getLocalState()?.rank;
    return typeof mine === 'number' && [...aw.getStates()].every(([id, s]) => id === me || typeof s.rank !== 'number' || s.rank > mine || (s.rank === mine && id > me));
  });
  const gus = await client('Gus');
  await gus.addInitScript((port) => {
    const Orig = window.WebSocket;
    window.WebSocket = class extends Orig { constructor(url, p) { super(String(url).includes('/relay') ? `ws://127.0.0.1:${port}/relay` : url, p); } };
  }, STALL_PORT);
  await joinLink(gus, link);
  await openZone(gus, 'footer');
  await openZone(a, 'header');
  await b.waitForTimeout(600);
  const heldByGus = await heldTag(b);
  const solo = [await repairs(a), await repairs(b), await repairs(c)];
  const busy = a.evaluate(() => { const t = Date.now(); while (Date.now() - t < 5500); });
  await b.waitForTimeout(200);
  const droppedAt = Date.now();
  stall.on = true;
  const release = b.waitForFunction(() => ![...document.querySelectorAll('.hf-held')].some((t) => /Gus/.test(t.textContent)), null, { timeout: 4 * PING })
    .then(() => (Date.now() - droppedAt) / 1000, () => Infinity);
  await b.waitForTimeout(4500);
  const lateHeld = await heldTag(b), second = [await repairs(b), await repairs(c)];
  const gusAfter = await release;
  await busy;
  await a.keyboard.press('Escape');
  check(heldByGus.includes('Gus is editing') && gusAfter < (2 * PING + 1500) / 1000, `a tab whose line stalls unannounced frees the footer within two pings ("${heldByGus}", after ${gusAfter.toFixed(1)} s)`);
  check(solo.join() === 'true,false,false' && lateHeld.split('|').includes('Anna is editing') && !second.some(Boolean),
    `a busy repairer stays present for the others ("${lateHeld}", repairers before ${solo}, others after 4.5 s ${second})`);
  await gus.close();

  // Reading along (`#view=`): the reader gets the document live and changes nothing; the
  // others list it by name only. Forged or replayed frames from a patched reader change no
  // writer's document, zones or carets, also at a newcomer that never saw their sender.
  {
    const viewUrl = await a.evaluate(() => window.__collab.session.viewLink);
    check(/#view=[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(viewUrl) && !viewUrl.includes(link.slice(link.indexOf('=') + 1)),
      'the starter has a read link without the write key');
    const r = await client('Rita');
    await joinLink(r, viewUrl);
    // Every frame reaching the reader, kept to replay; on an ask, forged offers go back.
    await r.evaluate(() => {
      window.__got = [];
      window.__collab.session.debug.tap = (d) => {
        window.__got.push(d.slice());
        if (d[0] === 0 && window.__onAsk) window.__onAsk(new DataView(d.buffer, d.byteOffset).getUint32(1));
      };
    });
    let vr = await view(r);
    va = await view(a);
    check(same(va, vr) && await hfShown(r) === await hfShown(a) && await sheet(r) === await sheet(a),
      `a reader gets the document, pages, zones, styles and pictures (${brief(vr)})`);
    await caret(a, 'end');
    await a.keyboard.type(' Lambda');
    await settle(a);
    await r.waitForTimeout(600);
    vr = await view(r);
    va = await view(a);
    const lists = await a.evaluate(() => [window.__collab.view().readers.map((x) => x.name).join(), window.__collab.view().peers.map((x) => x.name).sort().join()]);
    const rv = await r.evaluate(() => ({ reading: window.__collab.view().reading, peers: window.__collab.view().peers.length, local: window.__collab.session.awareness.getLocalState() }));
    check(vr.json === va.json && va.text.endsWith('Lambda') && lists[0] === 'Rita' && lists[1] === 'Ben,Cleo' && rv.reading && rv.peers === 3 && rv.local === null,
      `typing reaches the reader, listed as reading along, not as a writer (${lists}; ${JSON.stringify(rv)})`);
    // The starter's dialog offers both links, labelled apart; the reader's only the read link.
    const links = (page) => page.evaluate(() => [...document.querySelectorAll('dialog[open] [data-link]')]
      .map((l) => ({ which: l.dataset.link, label: l.querySelector('span').textContent, url: l.querySelector('input').value })));
    await a.click('.statusbar .collab-btn');
    const aLinks = await links(a);
    const aReaders = await a.evaluate(() => [...document.querySelectorAll('dialog[open] li[data-reader]')].map((li) => li.textContent).join());
    await a.click('dialog[open] .primary');
    await r.click('.statusbar .collab-btn');
    const rLinks = await links(r);
    const rPage = await r.evaluate(() => ({ html: document.body.innerHTML, bar: document.querySelector('.statusbar .collab-btn').textContent.trim() }));
    await r.click('dialog[open] .primary');
    check(aLinks.map((l) => `${l.which}:${l.url}`).join() === `edit:${link},view:${viewUrl}` && aLinks[0].label !== aLinks[1].label && /Rita.*reading along/.test(aReaders)
      && rLinks.length === 1 && rLinks[0].which === 'view' && rLinks[0].url === viewUrl && !rPage.html.includes(link.slice(link.indexOf('=') + 1)) && rPage.bar === 'Read only',
      `the starter's dialog shows a write and a read link and the reader as reading along; the reader's only the read link (${aLinks.map((l) => l.label)}; ${aReaders}; ${rLinks.map((l) => l.which)}; "${rPage.bar}")`);

    // Keys, a paste, commands as a menu runs them, undo, a header, the assistant.
    const SIGNED = [1, 2, 3, 5, 6, 10];
    const signedSent = () => r.evaluate((k) => k.reduce((n, i) => n + window.__collab.session.stats.sent[i], 0), SIGNED);
    const before = va.json;
    await caret(r, 'end');
    await r.keyboard.type('Zed');
    const nudged = await r.isVisible('.collab-hint[data-hint="reading"]');
    await r.keyboard.press('Enter');
    await r.keyboard.press(`${MOD}+b`);
    await r.keyboard.press(`${MOD}+z`);
    const tried = await r.evaluate(async () => {
      const ed = document.querySelector('.tiptap-host .tiptap').editor;
      const dt = new DataTransfer();
      dt.setData('text/plain', 'Pasted');
      ed.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      const ran = [ed.commands.insertContent('Cmd'), ed.chain().selectAll().toggleBold().run(), ed.commands.setTextSelection(1) && ed.commands.deleteSelection()];
      ed.view.dispatch(ed.state.tr.insertText('Raw', 1));
      return { editable: ed.isEditable, ai: (await import('/src/lib/storage/ai.svelte.ts')).aiHostOff(), ran: ran.length };
    });
    await openZone(r, 'header');
    const zone = await editing(r);
    await settle(r);
    await a.waitForTimeout(600);
    const after = [await view(a), await view(b), await view(c), await view(r)];
    check(after.every((v) => v.json === before) && !tried.editable && tried.ai && !zone && await signedSent() === 0 && nudged,
      `a reader changes nothing by keys, paste, commands, undo or a header, is told why when typing, has no assistant and signs nothing (${JSON.stringify(tried)}, zone "${zone}", hint ${nudged}, ${after.map(brief).join(' | ')})`);
    // The reader's controls that edit are greyed; find, statistics and zoom still work,
    // the context menu offers nothing that edits, and the spell check marks nothing.
    const homeOff = await disabled(r, [...EDITS, '[data-cmd="find"]']);
    await r.click('.ribbon-tab[data-tab="review"]');
    const reviewOff = await disabled(r, ['[data-cmd="newComment"]', '[data-cmd="trackChanges"]', '[data-cmd="wordCount"]']);
    await r.click('[data-cmd="wordCount"]');
    const stats = await r.isVisible('.stats-menu');
    await r.keyboard.press('Escape');
    const zoom0 = await r.textContent('.zoom-pct');
    await r.click('.ribbon-tab[data-tab="view"]');
    await r.click('[data-cmd="zoomIn"]');
    const zoom1 = await r.textContent('.zoom-pct');
    await r.click('.ribbon-tab[data-tab="home"]');
    await r.click('.tiptap-host .tiptap p', { button: 'right' });
    const menuLive = await r.evaluate(() => [...document.querySelectorAll('.cm-item')].filter((b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true').map((b) => b.textContent.trim()));
    await r.keyboard.press('Escape');
    const marksR = await squiggles(r);
    const marksA = await squiggles(a);
    check(homeOff.slice(0, -1).every((x) => x === true) && homeOff.at(-1) === false && reviewOff.join() === 'true,true,false' && stats && zoom1 !== zoom0 && !menuLive.length && marksR === 0 && marksA > 0,
      `a reader's editing controls and menu entries are greyed, find, statistics and zoom work, and no word is marked (${homeOff}; ${reviewOff}; stats ${stats}; ${zoom0} → ${zoom1}; menu ${menuLive}; squiggles ${marksR} vs ${marksA})`);

    // Forged frames, sealed with the read key: unsigned, with a random signature, or a real
    // frame altered. Updates add a paragraph or empty the first; the presence holds a zone.
    const writers = await r.evaluate(() => [...window.__collab.session.awareness.getStates().values()].map((s) => s.peer));
    const forge = () => r.evaluate(async (writers) => {
      const { Y } = await import('/src/lib/editor/undoYjs.ts');
      const d = window.__collab.session.debug;
      const u32 = (n) => { const x = new Uint8Array(4); new DataView(x.buffer).setUint32(0, n); return x; };
      const cat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let at = 0; for (const x of p) { o.set(x, at); at += x.length; } return o; };
      const sig = () => crypto.getRandomValues(new Uint8Array(64));
      const copy = new Y.Doc();
      Y.applyUpdate(copy, Y.encodeStateAsUpdate(d.ydoc));
      const sv0 = Y.encodeStateVector(copy);
      copy.getXmlFragment('body').delete(0, 1);
      const del = Y.encodeStateAsUpdate(copy, sv0);
      const fresh = new Y.Doc();
      const p = new Y.XmlElement('paragraph');
      p.insert(0, [new Y.XmlText('EVIL')]);
      fresh.getXmlFragment('body').insert(0, [p]);
      const add = Y.encodeStateAsUpdate(fresh);
      const vu = (n) => { const o = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); return o; };
      const aw = (id, clock, state) => { const j = new TextEncoder().encode(JSON.stringify(state)); return new Uint8Array([...vu(1), ...vu(id), ...vu(clock), ...vu(j.length), ...j]); };
      const mallory = { peer: writers[0], user: { name: 'Mallory', color: '#ff0000' }, zone: 'hf:0:footer', keeps: true, rank: 0 };
      const real = window.__got.find((x) => x[0] === 1 && x.length > 80);
      const bent = real.slice();
      bent[2] ^= 1;
      const frames = [
        cat([1], add), cat([1], del), cat([1], add, sig()), bent,
        cat([2], aw(4242, 99, mallory)), cat([2], aw(4243, 99, mallory), sig()),
        cat([6], u32(0), u32(1), new TextEncoder().encode('k'), u32(0), new TextEncoder().encode('data:image/png;base64,AAAA')),
        cat([8], u32(77), new TextEncoder().encode(JSON.stringify({ name: 'Rita', color: '#00f', zone: 'hf:0:header', peer: writers[0] }))),
      ];
      for (const to of writers) {
        frames.push(cat([5], u32(to), add), cat([5], u32(to), del, sig()), cat([6], u32(to), u32(1), new TextEncoder().encode('k'), u32(0), sig()));
        frames.push(cat([3], u32(to), u32(77), u32(sv0.length), sv0, del), cat([3], u32(to), u32(77), u32(sv0.length), sv0, del, sig()));
      }
      for (const f of frames) d.send(f, 0);
      // A newcomer's ask gets the same offers, the deleting ones, and every frame replayed.
      window.__onAsk = (to) => {
        d.send(cat([3], u32(to), u32(77), u32(sv0.length), sv0, del), to);
        d.send(cat([3], u32(to), u32(77), u32(sv0.length), sv0, del, sig()), to);
        for (const f of window.__got) d.send(f, 0);
      };
      return frames.length;
    }, writers);
    const sentForged = await forge();
    await a.waitForTimeout(1500);
    const caretNames = (page) => page.evaluate(() => [...document.querySelectorAll('.ProseMirror-yjs-cursor')].map((x) => x.textContent).join());
    const fa = [await view(a), await view(b), await view(c)];
    const peersOf = (page) => page.evaluate(() => window.__collab.view().peers.map((x) => x.name).sort().join());
    const readersOf = (page) => page.evaluate(() => window.__collab.view().readers.map((x) => x.name).join());
    const marks = [await heldTag(a), await heldTag(b), await caretNames(a), await caretNames(b), await peersOf(a), await peersOf(b), await readersOf(a)];
    check(fa.every((v) => v.json === before) && !marks[0] && !marks[1] && !/Mallory/.test(marks.join()) && marks[4] === 'Ben,Cleo' && marks[6] === 'Rita',
      `${sentForged} forged frames change no writer's document, zone, caret or list, nor list a reader not there (${marks.join(' / ')}; ${fa.map(brief).join(' | ')})`);

    // The reader dials the relay under Ben's id while Ben holds the header, then hangs up:
    // Ben stays listed, holds the header and keeps getting what is sent to him.
    await openZone(b, 'header');
    await b.waitForTimeout(800);
    const ids = await r.evaluate(() => Object.fromEntries([...window.__collab.session.awareness.getStates().values()].map((s) => [s.user.name, s.peer])));
    const posed = await r.evaluate(async (id) => {
      const { linkKeys, roomId } = await import('/src/lib/collab/key.ts');
      const { relayUrl, PROTOCOL } = await import('/src/lib/collab/channel.ts');
      const room = roomId(linkKeys(location.hash.slice(1)).read);
      const ws = new WebSocket(relayUrl());
      ws.binaryType = 'arraybuffer';
      let got = 0, welcomed = false;
      ws.onmessage = (e) => { if (typeof e.data === 'string') welcomed ||= JSON.parse(e.data).t === 'welcome'; else got++; };
      await new Promise((ok) => { ws.onopen = ok; });
      ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL ?? 1, room, token: null, id, claim: 'x'.repeat(22) }));
      await new Promise((ok) => setTimeout(ok, 1500));
      ws.close();
      return { welcomed, got };
    }, ids.Ben);
    await a.waitForTimeout(1500);
    const afterPose = [await heldTag(a), await peersOf(a), await heldTag(c)];
    await b.keyboard.press('Escape');
    await b.waitForTimeout(800);
    check(afterPose[0] === 'Ben is editing' && afterPose[1] === 'Ben,Cleo' && afterPose[2] === 'Ben is editing' && !posed.got,
      `a reader dialling in under a writer's id gets none of its frames and neither drops it from the list nor frees its header (${afterPose.join(' / ')}; ${JSON.stringify(posed)})`);

    // A picture asked for many times in one frame goes once (the header's: the body has none now).
    const key = await r.evaluate(() => /idb:([a-z0-9]+)/.exec(JSON.stringify(window.__collab.session.awareness.doc.toJSON()))?.[1]);
    const ritaId = await a.evaluate(() => window.__collab.view().readers.find((x) => x.name === 'Rita')?.id);
    const given0 = await sent(a, PICTURE);
    await r.evaluate(([to, from, key]) => {
      const keys = new TextEncoder().encode(Array(30).fill(key).join(','));
      const out = new Uint8Array(9 + keys.length);
      const v = new DataView(out.buffer);
      out[0] = 7;
      v.setUint32(1, to);
      v.setUint32(5, from);
      out.set(keys, 9);
      window.__collab.session.debug.send(out, to);
    }, [ids.Anna, ritaId, key]);
    await a.waitForTimeout(1500);
    const given1 = await sent(a, PICTURE);
    check(!!key && given1 - given0 === 1, `a picture asked for thirty times in one frame goes once (${key ? given1 - given0 : 'no picture in the doc'})`);

    // Forty readers made up in one tab fill no list: one reading along later is still listed.
    await r.evaluate(() => {
      for (let i = 0; i < 40; i++) {
        const name = new TextEncoder().encode(JSON.stringify({ name: `Ghost ${i}`, color: '#888' }));
        const out = new Uint8Array(5 + name.length);
        out[0] = 8;
        new DataView(out.buffer).setUint32(1, 1000 + i);
        out.set(name, 5);
        window.__collab.session.debug.send(out, 0);
      }
    });
    await a.waitForTimeout(800);
    const vera = await client('Vera');
    await joinLink(vera, viewUrl);
    await a.waitForTimeout(1500);
    const listedNow = await readersOf(a);
    await vera.context().close();
    check(listedNow === 'Rita,Vera', `readers made up by another tab fill no list, and a real one is still listed (${listedNow})`);

    // A writer holds the footer and lets it go while the reader records; replayed then, and
    // after the writer left to a newcomer that never saw it, the footer stays free.
    const w = await client('Walt');
    await joinLink(w, link);
    await openZone(w, 'footer');
    await w.waitForTimeout(800);
    const heldByWalt = await heldTag(a);
    await w.keyboard.press('Escape');
    await w.waitForTimeout(800);
    await r.evaluate(() => { for (const f of window.__got) window.__collab.session.debug.send(f, 0); });
    await a.waitForTimeout(1200);
    const freeNow = await heldTag(a);
    await w.context().close();
    await a.waitForTimeout(1500);
    const n = await client('Nora');
    await joinLink(n, link);
    await r.evaluate(() => { for (const f of window.__got) window.__collab.session.debug.send(f, 0); });
    await n.waitForTimeout(2000);
    const vn = await view(n);
    va = await view(a);
    const nMarks = [await heldTag(n), await peersOf(n), await caretNames(n), await heldTag(a)];
    check(heldByWalt === 'Walt is editing' && !freeNow && vn.json === va.json && !nMarks[0] && !nMarks[3] && !/Walt|Mallory/.test(nMarks.join()),
      `replayed presence frames hold no zone, at a newcomer neither ("${heldByWalt}"; ${nMarks.join(' / ')}; ${brief(vn)})`);
    await n.context().close();
    await r.context().close();
    await a.waitForTimeout(1000);
    const left = await a.evaluate(() => window.__collab.view().readers.length);
    check(left === 0, `a reader that goes leaves the list (${left})`);
  }

  // The session chat: a writer, a joiner and a reader write to each other. None of it reaches
  // the relay in plain text, the doc, a file or autosave; a patched reader cannot pose, flood
  // or inject; the pane keeps its own width and side; a line that is down shuts the field.
  {
    stall.on = false;
    const CHAT = '/src/lib/collab/chat.svelte.ts';
    const said = (page) => page.evaluate(async (url) => (await import(url)).chatLines().filter((l) => l.kind === 'message')
      .map((l) => `${l.own ? 'me' : l.name}${l.reading ? '*' : ''}:${l.text}`), CHAT);
    const toggle = (page) => page.click('.statusbar [data-cmd="chatToggle"]');
    const say = async (page, text) => { await page.fill('.chat-pane textarea', text); await page.press('.chat-pane textarea', 'Enter'); };
    const unread = (page) => page.evaluate(() => document.querySelector('.statusbar .chat-unread')?.textContent ?? '');
    const from = seen.length;
    const viewUrl = await a.evaluate(() => window.__collab.session.viewLink);
    const r = await client('Rosa');
    await r.addInitScript((port) => {
      const Orig = window.WebSocket;
      window.WebSocket = class extends Orig { constructor(url, p) { super(String(url).includes('/relay') ? `ws://127.0.0.1:${port}/relay` : url, p); } };
    }, STALL_PORT);
    await joinLink(r, viewUrl);
    await a.waitForFunction(() => window.__collab.view().readers.some((x) => x.name === 'Rosa'), null, { timeout: 10_000 }).catch(() => {});
    const noButton = await r.$('.statusbar [data-cmd="chatToggle"]:disabled');
    for (const p of [a, b, r]) await toggle(p);
    await say(a, 'Hi from Anna');
    await a.waitForTimeout(400);
    await say(b, 'Ben here');
    await a.waitForTimeout(400);
    await say(r, 'Rosa reads');
    await a.waitForTimeout(1000);
    const heard = [await said(a), await said(b), await said(r)];
    const texts = heard.map((h) => h.map((x) => x.slice(x.indexOf(':') + 1)).join('|'));
    const tagged = await a.evaluate(() => [...document.querySelectorAll('.chat-pane .message')].find((m) => m.textContent.includes('Rosa reads'))?.querySelector('.meta')?.textContent ?? '');
    check(!noButton && heard[0].join() === 'me:Hi from Anna,Ben:Ben here,Rosa*:Rosa reads' && heard[1].join() === 'Anna:Hi from Anna,me:Ben here,Rosa*:Rosa reads'
      && heard[2].join() === 'Anna:Hi from Anna,Ben:Ben here,me*:Rosa reads' && new Set(texts).size === 1 && tagged.includes('reading along'),
      `chat messages reach the others under the right name, a reader's marked, in one order (${heard.map((h) => h.join()).join(' / ')}; "${tagged}")`);
    const relayed = Buffer.concat(seen.slice(from));
    check(!['Hi from Anna', 'Ben here', 'Rosa reads', 'Rosa', 'Anna'].some((w) => relayed.includes(Buffer.from(w))), `the relay's ${seen.length - from} chat-time frames hold no text and no name`);

    // Width and side: B drags the edge wider, shrinks it by a key, docks it left and reloads.
    const panes = (page) => page.evaluate(() => {
      const box = (q) => { const r = document.querySelector(q)?.getBoundingClientRect(); return r ? [Math.round(r.left), Math.round(r.right)] : null; };
      const kept = JSON.parse(localStorage.getItem('edentext-panes') ?? '{}');
      return { pane: box('.chat-pane'), page: box('.editor-panes'), chat: kept.chat, comments: kept.comments ?? { side: 'right', width: 260 } };
    });
    const p0 = await panes(b);
    const grip = await b.locator('.chat-pane .pane-resize').boundingBox();
    await b.mouse.move(grip.x + grip.width / 2, grip.y + 200);
    await b.mouse.down();
    await b.mouse.move(grip.x + grip.width / 2 - 40, grip.y + 200, { steps: 4 });
    await b.mouse.move(grip.x + grip.width / 2 - 80, grip.y + 200, { steps: 4 });
    await b.mouse.up();
    await b.focus('.chat-pane .pane-resize');
    await b.keyboard.press('ArrowRight');
    await b.click('.chat-pane .pane-options');
    await b.click('.cm-menu .cm-item:has-text("Dock")');
    await b.click('.cm-sub button:has-text("Left")');
    await b.waitForTimeout(300);
    const p1 = await panes(b);
    await b.reload({ waitUntil: 'load' });
    await ready(b);
    await live(b);
    await b.waitForTimeout(1500);
    const afterReload = await said(b);
    await toggle(b);
    const p2 = await panes(b);
    const w = (p) => p.pane[1] - p.pane[0];
    check(w(p1) === w(p0) + 64 && p1.chat?.side === 'left' && p1.pane[1] <= p1.page[0] + 1 && w(p2) === w(p1) && p2.pane[1] <= p2.page[0] + 1
      && p2.comments.side === 'right' && p2.comments.width === 260 && !afterReload.length,
      `the chat pane drags and keys wider, docks left beside the page, keeps both after a reload, apart from the comments pane; the reload empties the chat (${w(p0)} → ${w(p1)} → ${w(p2)}, ${JSON.stringify(p2.chat)}, comments ${JSON.stringify(p2.comments)}, page ${p2.page}, ${afterReload.length} lines)`);
    await toggle(b);

    // B types in the document, its pane closed, while A writes: the count climbs, the focus stays.
    await caret(b, 'end');
    const typing = b.keyboard.type(' Kappa', { delay: 120 });
    await say(a, 'one');
    await say(a, 'two');
    await typing;
    await b.waitForTimeout(800);
    const focused = await b.evaluate(() => !!document.activeElement?.closest('.tiptap-host .tiptap'));
    const count = await unread(b);
    const typed = (await view(b)).text.endsWith(' Kappa');
    await toggle(b);
    const reset = await unread(b);
    check(count === '2' && focused && typed && reset === '', `a closed pane counts new messages (${count}) without taking the typist's focus (${focused}, typed ${typed}); opening resets it ("${reset}")`);
    for (let i = 0; i < 6; i++) await b.keyboard.press('Backspace');
    await toggle(b);

    // A late joiner sees nothing from before, and the note that only those here see it.
    const d = await client('Dora');
    await joinLink(d, link);
    await toggle(d);
    const late = [await said(d), await d.locator('.chat-pane .intro').isVisible()];
    check(!late[0].length && late[1], `a late joiner sees no earlier message, only the note (${late[0].length}, ${late[1]})`);
    await d.context().close();

    // Nothing of the chat in A's files, autosave or shared doc (body, `state`, `meta`).
    const saveAs = async (ext) => {
      await a.evaluate(() => { window.showSaveFilePicker = undefined; });
      await a.click('.ribbon-tab-file');
      const [file] = await Promise.all([
        a.waitForEvent('download', { timeout: 30_000 }),
        a.locator('.ribbon-menu button', { hasText: `(.${ext})` }).first().click()
          .then(() => a.locator('dialog[open] button.primary').click({ timeout: 2_000 }).catch(() => {})),
      ]);
      const zip = unzipSync(new Uint8Array(await readFile(await file.path())));
      return Object.values(zip).map((x) => strFromU8(x)).join('\n');
    };
    const files = [await saveAs('odt'), await saveAs('docx')];
    await a.keyboard.press('Escape');
    const stored = await a.evaluate(async () => {
      const { Y } = await import('/src/lib/editor/undoYjs.ts');
      const doc = window.__collab.session.debug.ydoc;
      return [Object.values(localStorage).join('\n'), new TextDecoder().decode(Y.encodeStateAsUpdate(doc)), JSON.stringify(doc.getMap('state').toJSON())];
    });
    const leaks = [...files, ...stored].map((x) => ['Hi from Anna', 'Ben here', 'Rosa reads'].some((w) => x.includes(w)));
    check(files.every((f) => f.length > 1000) && !leaks.some(Boolean), `no chat text in A's .odt, .docx, autosave or shared doc (${leaks})`);

    // The patched reader: unsigned and falsely signed CHATs, a SAY from an id nobody lists,
    // a text with markup and a javascript: address, a 1 MB text, and 50 messages in a second.
    await say(r, '<img src=x onerror="window.__pwned=1"> javascript:alert(1) https://example.com/a).');
    await a.waitForTimeout(600);
    await r.evaluate(async () => {
      const d = window.__collab.session.debug;
      const enc = (s) => new TextEncoder().encode(s);
      const cat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let at = 0; for (const x of p) { o.set(x, at); at += x.length; } return o; };
      d.send(cat([12], enc('EVIL unsigned')));
      d.send(cat([12], enc('EVIL signed'), crypto.getRandomValues(new Uint8Array(64))));
      d.send(cat([13], enc('x'.repeat(1 << 20))));
      const { linkKeys } = await import('/src/lib/collab/key.ts');
      const { openChannel, relayUrl } = await import('/src/lib/collab/channel.ts');
      const keys = linkKeys(location.hash.slice(1));
      await new Promise((ok) => {
        const ch = openChannel({ url: relayUrl(), key: keys.read, id: 4711, onFrame() {}, onPeers() {}, onStatus() {}, onOpen() {
          ch.send(cat([8], new Uint8Array([0, 0, 18, 103]), enc(JSON.stringify({ name: 'Anna', color: '#f00' }))));
          ch.send(cat([13], enc('EVIL stranger')));
          setTimeout(() => { ch.close(); ok(); }, 800);
        } });
      });
      for (let i = 0; i < 50; i++) d.send(cat([13], enc(`flood ${i}`)));
    });
    await a.waitForTimeout(1500);
    const evil = await a.evaluate(() => {
      const log = document.querySelector('.chat-pane .log');
      const links = [...log.querySelectorAll('a')].map((x) => `${x.getAttribute('href')}|${x.target}|${x.rel}`);
      return { imgs: log.querySelectorAll('img').length, links, pwned: !!window.__pwned, text: log.textContent.includes('<img src=x onerror=') };
    });
    const got = await said(a);
    const floods = got.filter((x) => x.includes('flood')).length;
    check(!got.some((x) => /EVIL|xxxxxxxx/.test(x)) && floods <= 5 && floods > 0 && !evil.imgs && !evil.pwned && evil.text
      && evil.links.join() === 'https://example.com/a|_blank|noopener noreferrer',
      `a patched reader poses as nobody, floods ${floods} messages through, and its markup stays text, only the https address a link (${JSON.stringify(evil)})`);

    // Idle with the pane open: no edits, asks or chat frames go out.
    const kinds = (page) => page.evaluate(() => [0, 1, 12, 13].map((k) => window.__collab.session.stats.sent[k]).join());
    const quiet0 = [await kinds(a), await kinds(b)];
    await a.waitForTimeout(5000);
    const quiet1 = [await kinds(a), await kinds(b)];
    check(quiet0.join() === quiet1.join(), `an idle session with the chat open stays quiet (${quiet0.join(' / ')} → ${quiet1.join(' / ')})`);

    // The reader's line goes silent: the field shuts with a reason, and opens once it is back.
    stall.on = true;
    const shut = await r.waitForSelector('.chat-pane textarea:disabled', { timeout: 6 * BEAT }).then(() => true, () => false);
    const why = await r.$('.chat-pane [data-chat-note="offline"]');
    stall.on = false;
    const back = await r.waitForSelector('.chat-pane textarea:not(:disabled)', { timeout: 45_000 }).then(() => true, () => false);
    await caret(a, 'end');
    await a.keyboard.type(' Mu');
    await settle(a);
    await r.waitForTimeout(800);
    const synced = (await view(r)).json === (await view(a)).json && (await view(r)).text.endsWith(' Mu');
    check(shut && !!why && back && synced, `a line that is down shuts the reader's field with a reason, and its return opens it, the document in sync (${shut}, ${!!why}, ${back}, ${synced})`);
    for (let i = 0; i < 3; i++) await a.keyboard.press('Backspace');
    await settle(a);
    await r.context().close();
    for (const p of [a, b]) await toggle(p);
  }

  await a.click('.statusbar .collab-btn');
  await a.click('dialog[open] [data-cmd="collabLeave"]');
  const unkept = (page) => page.waitForSelector('.collab-notice[data-notice="unkept"]', { timeout: 10_000 }).then(() => true, () => false);
  const heard = [await unkept(b), await unkept(c)];
  check(heard.every(Boolean) && !(await a.$("dialog[open]")) && !(await b.$("dialog[open]")), `the starter leaves unasked, and the others hear, without a dialog over the page, that nobody keeps the document (${heard})`);
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

  // B leaves and keeps its copy: the tab reloads into a document of its own, which a
  // further reload still opens, with the picture, the styles and the zones.
  await unkept(b);
  // The earlier picture is gone; this one B holds only as a session picture, by its key.
  await photo(c);
  await b.waitForTimeout(2500);
  const [vKept, sheetKept] = [await view(c), await sheet(c)];
  await b.evaluate(() => { window.__before = true; });
  b.dialogs.length = 0;
  await b.click('.collab-notice [data-cmd="collabDetails"]');
  await b.click('dialog[open] [data-cmd="collabLeave"]');
  await b.click('dialog[open] [data-cmd="collabKeep"]');
  await b.waitForFunction(() => !window.__before && document.querySelector('.tiptap-host .tiptap')?.editor, null, { timeout: 30_000 });
  await b.waitForTimeout(2500);
  const keptView = async () => ({ v: await view(b), sheet: await sheet(b), hash: await b.evaluate(() => location.hash) });
  let copy = await keptView();
  // In the session a picture is named by its key; the kept copy holds the picture itself.
  const srcless = (v) => ({ ...v, json: v.json.replace(/"src":"[^"]*"/g, '"src":""') });
  const keptOk = (k) => same(srcless(k.v), srcless(vKept)) && k.sheet === sheetKept && !k.hash && k.v.json.includes('data:image/png') && !k.v.json.includes('idb:');
  check(keptOk(copy) && !b.dialogs.includes('beforeunload'), `a joiner that keeps its copy reloads into it, unwarned (${brief(copy.v)} | ${brief(vKept)}; ${b.dialogs})`);
  await b.reload({ waitUntil: 'load' });
  await ready(b);
  await b.waitForTimeout(2500);
  copy = await keptView();
  const slots = await b.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('edentext-live@')).length);
  check(keptOk(copy) && slots === 1, `the kept copy is a stored document, there after a reload (${brief(copy.v)}; ${slots} slot)`);

  // C is the last one there and holds the only copy: closing the tab asks first.
  await c.close({ runBeforeUnload: true });
  await c.waitForEvent('close', { timeout: 5000 }).catch(() => {});
  check(c.dialogs.includes('beforeunload'), `the last joiner's tab warns before it closes (${c.dialogs})`);

  const lone = await client('Gus');
  await lone.goto(`${URL0}#collab=${randomBytes(32).toString('base64url')}`, { waitUntil: 'load' });
  const empty = await lone.waitForSelector('dialog[open] [data-status="empty"]', { timeout: 20_000 }).then(() => true, () => false);
  check(empty, 'a link to a room nobody is in says the session has ended');

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
  const told = await a.waitForSelector('.collab-notice[data-notice="failing"]', { timeout: 2000 }).then(() => true, () => false);
  await a.waitForTimeout(12_000);
  clearInterval(cut);
  const during = [await status(a), sockets];
  check(failing && told && during[0] !== 'live' && sockets <= 8, `a line that keeps breaking is not live and says so, with backoff (${during[0]}, ${sockets} connections)`);
  await a.waitForFunction(() => window.__collab.view().status === 'live', null, { timeout: 45_000 }).catch(() => {});
  await e.waitForFunction(() => window.__collab.view().status === 'live', null, { timeout: 15_000 }).catch(() => {});
  await caret(e, 'end');
  await e.keyboard.type(' Omega');
  await settle(a);
  await a.waitForTimeout(600);
  const [pa2, pe2] = [await view(a), await view(e)];
  check(await status(a) === 'live' && pa2.json === pe2.json && pa2.text.endsWith('Omega'), `once the line holds it is live again and edits arrive (${await status(a)})`);

  // A line that dies without a close: Ella hears and sends nothing, while the relay still
  // holds her socket. The relay's beats stop reaching her, so within a few she is no longer
  // `live`, and she is back once the line works again.
  await e.evaluate(() => {
    const O = WebSocket, st = window.__deaf = { on: false };
    window.WebSocket = class extends O {
      constructor(...x) { super(...x); this.addEventListener('message', (ev) => { if (st.on) ev.stopImmediatePropagation(); }); }
      send(d) { if (!st.on) super.send(d); }
    };
  });
  const relive = async () => {
    for (const room of relay.rooms.values()) for (const w of room) w.close();
    for (const page of [a, e]) await page.waitForFunction(() => window.__collab.view().status === 'live', null, { timeout: 30_000 }).catch(() => {});
  };
  await relive();
  // Anna holds back her offers, so the sync Ella starts on the next welcome stays open when
  // her line dies: it must end there, not keep asking into a line that is down.
  await a.evaluate(() => {
    const send = WebSocket.prototype.send, sent = window.__collab.session.stats.sent;
    let offers = sent[3];
    window.__noOffers = true;
    WebSocket.prototype.send = function (d) {
      if (sent[3] !== offers) { offers = sent[3]; if (window.__noOffers) return; }
      return send.call(this, d);
    };
  });
  await relive();
  await e.evaluate(() => { window.__deaf.on = true; });
  const noticed = await e.waitForFunction(() => window.__collab.view().status !== 'live', null, { timeout: 5 * BEAT }).then(() => true, () => false);
  const asked = await sent(e, ASK);
  await e.waitForTimeout(12_000);
  const stacked = await sent(e, ASK) - asked;
  const deafAs = await status(e);
  await a.evaluate(() => { window.__noOffers = false; });
  await e.evaluate(() => { window.__deaf.on = false; });
  await e.waitForFunction(() => window.__collab.view().status === 'live', null, { timeout: 45_000 }).catch(() => {});
  await e.keyboard.press('Escape');
  await caret(e, 'end');
  await e.keyboard.type(' Psi');
  await settle(a);
  const [pa3, pe3] = [await view(a), await view(e)];
  check(noticed && await status(e) === 'live' && pa3.json === pe3.json && pa3.text.endsWith('Psi'),
    `a line that dies without a close is not live (${deafAs}), and live again once it works`);
  check(stacked === 0, `a sync open when the line died asks nothing while it is down (${stacked} asks)`);

  // A joiner alone in the room waits; when a client with the doc comes back, the joiner
  // asks it, and that client's own sync sends no copy to the joiner's empty offer.
  const away = (page) => page.evaluate(() => {
    window.__WS ??= WebSocket;
    window.WebSocket = class extends window.__WS { constructor() { super('ws://127.0.0.1:4/'); } };
  });
  for (const page of [a, e]) await away(page);
  for (const room of relay.rooms.values()) for (const w of room) w.close();
  await a.waitForTimeout(500);
  const g = await client('Gus');
  await g.goto(link2, { waitUntil: 'load' });
  await ready(g);
  const waited = await g.waitForFunction(() => window.__collab?.view()?.status === 'waiting', null, { timeout: 15_000 }).then(() => true, () => false);
  const pushed = await sent(a);
  await a.evaluate(() => { window.WebSocket = window.__WS; });
  const gLive = await g.waitForFunction(() => window.__collab.view().status === 'live', null, { timeout: 45_000 }).then(() => true, () => false);
  await g.waitForTimeout(1500);
  const [pa4, pg4, pushed2] = [await view(a), await view(g), await sent(a)];
  check(waited && gLive && pa4.json === pg4.json && pushed2 === pushed,
    `a waiting joiner asks the client that comes back, which sends it no copy of its own (${waited}, ${gLive}, ${pushed2 - pushed} updates)`);

  // The only client with a picture leaves before its bytes went out: the other shows a grey
  // box and says so, and stays live. The one who left has the picture in its own copy.
  await a.evaluate(() => {
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (d) { if ((d.byteLength ?? d.length) < 30_000) return send.call(this, d); };
  });
  await photo(a);
  await g.waitForSelector('.tiptap-host .tiptap .image-waiting', { timeout: 10_000 }).catch(() => {});
  const aMissing = await a.evaluate(() => window.__collab.view().missing);
  if (!await a.isVisible('dialog[open] [data-cmd="collabLeave"]')) await a.click('.statusbar .collab-btn');
  await a.click('dialog[open] [data-cmd="collabLeave"]');
  // The relay says she left, so this takes no awareness timeout.
  const told2 = await g.waitForSelector('.collab-notice[data-notice="missing"]', { timeout: 8000 }).then(() => true, () => false);
  const gView = await g.evaluate(() => `${window.__collab.view().missing} missing, notice ${!!document.querySelector('.collab-notice[data-notice="missing"]')}`);
  const own = await a.evaluate(() => /"src":"data:image\/png/.test(JSON.stringify(document.querySelector('.tiptap-host .tiptap').editor.getJSON())));
  const boxes = await g.locator('.tiptap-host .tiptap .image-waiting').count();
  check(told2 && await status(g) === 'live' && boxes === 1 && own,
    `a picture whose only holder left shows as a grey box (${boxes}) with a note, the session stays live (${told2}, ${await status(g)}, ${gView}), and the holder keeps it (${own}, ${aMissing} missing there)`);

  // The start file and pictures put in alone carry no picture to the relay. On a slow uplink,
  // a joiner asking for them still gets the starter's typing at once, the starter knows it is
  // still serving them, and a third joining while the second loads gets them all.
  {
    const h = await client('Hana');
    await h.addInitScript((port) => {
      const Orig = window.WebSocket;
      window.WebSocket = class extends Orig { constructor(url, p) { super(String(url).includes('/relay') ? `ws://127.0.0.1:${port}/relay` : url, p); } };
    }, STALL_PORT);
    await openDoc(h, '16-hf-variants.odt');
    for (let n = 0; n < 2; n++) await photo(h);
    const link5 = await start(h);
    const r0 = relayed();
    for (let n = 0; n < 2; n++) await photo(h);
    await h.waitForTimeout(500);
    const alone = relayed() - r0 + await ysize(h);
    stall.rate = 2e6;
    await h.evaluate(() => { window.__served = 0; setInterval(() => { window.__served = Math.max(window.__served, window.__collab.session?.serving() ?? 0); }, 20); });
    const [iv, jo] = [await client('Ivo'), await client('Jon')];
    await joinLink(iv, link5);
    const joined = joinLink(jo, link5);
    await caret(h, 'end');
    const t0 = Date.now();
    await h.keyboard.type(' Swift');
    const quick = await iv.waitForFunction(() => document.querySelector('.tiptap-host .tiptap').editor.state.doc.textContent.endsWith(' Swift'), null, { timeout: 15_000 })
      .then(() => Date.now() - t0, () => Infinity);
    const loading = await shown(iv);
    const serving = await h.evaluate(() => window.__served);
    await joined;
    // Saving before the pictures are all here waits for them, saying so, and the file has all.
    const lacking = 4 - await shown(jo);
    await jo.evaluate(() => { window.showSaveFilePicker = undefined; });
    await jo.click('.ribbon-tab-file');
    const saving = Promise.all([
      jo.waitForEvent('download', { timeout: 60_000 }),
      jo.locator('.ribbon-menu button', { hasText: '(.odt)' }).first().click()
        .then(() => jo.locator('dialog[open] button.primary').click({ timeout: 2_000 }).catch(() => {})),
    ]).catch(() => [null]);
    const noted = await jo.waitForSelector('.collab-notice[data-notice="loading"]', { timeout: 5000 }).then(() => true, () => false);
    const [file] = await saving;
    // Each noise photo is about 1.9 MB that no zip shrinks, so three would stay under 7 MB.
    const savedMB = file ? (await readFile(await file.path())).length / 1e6 : 0;
    check(savedMB > 7 && (!lacking || noted), `a save while ${lacking} of 4 pictures are on their way waits for them (notice ${noted}) and holds them all (${savedMB.toFixed(1)} MB)`);
    const all = (p) => p.waitForFunction(() => [...document.querySelectorAll('.tiptap-host .tiptap img')].filter((i) => i.src.startsWith('data:') && i.src.length > 1e6).length === 4, null, { timeout: 60_000 }).then(() => true, () => false);
    const got = [await all(iv), await all(jo)];
    const gaps = [await iv.evaluate(() => window.__collab.view().missing), await jo.evaluate(() => window.__collab.view().missing)];
    stall.rate = 0;
    check(alone < 200_000 && quick < 1000 && loading < 4 && serving > 0 && got.every(Boolean) && gaps.join() === '0,0',
      `start file and pictures put in alone take ${alone} bytes; on a slow line typing arrives in ${quick} ms while the joiner shows ${loading} of 4 and the starter serves ${serving}, and a third joining meanwhile gets all (${got}, missing ${gaps})`);
    for (const p of [h, iv, jo]) await p.context().close();
  }

  // The starter choosing New in a session is asked, leaves, and starts empty; the joiner keeps the document.
  await openDoc(a, '16-hf-variants.odt');
  const link3 = await start(a);
  const k = await client('Kai');
  await joinLink(k, link3);
  const kShared = await view(k);
  await a.click('.ribbon-tab-file');
  await a.click('.ribbon [data-cmd="newDocument"]');
  await a.click('dialog[open] [data-cmd="collabLeaveOpen"]');
  await a.waitForTimeout(1500);
  const aNew = await a.evaluate(() => ({ text: document.querySelector('.tiptap-host .tiptap').editor.state.doc.textContent, collab: !!window.__collab.view() }));
  check(!aNew.text && !aNew.collab && await status(k) === 'live' && (await view(k)).json === kShared.json && !!kShared.text,
    `the starter choosing New leaves first and starts empty, the joiner keeps the document (${JSON.stringify(aNew)})`);

  // Readers count toward the relay's limit. With only readers left, the one there hears it
  // and a newcomer finds the room empty; the reader keeps its copy and can edit it.
  await k.context().close();
  await relay.close();
  relay = await startRelay({ port: RELAY_PORT, maxFrame: FRAME, beat: BEAT, ping: PING, maxPeers: 6 });
  await openDoc(a, '16-hf-variants.odt');
  const link4 = await start(a);
  const view4 = await a.evaluate(() => window.__collab.session.viewLink);
  const wes = await client('Wes');
  await joinLink(wes, link4);
  const rs = [];
  for (const name of ['Rhea', 'Rolf', 'Ruth', 'Rudi']) {
    rs.push(await client(name));
    await joinLink(rs.at(-1), view4);
  }
  const listed = await a.waitForFunction(() => window.__collab.view().readers.length === 4, null, { timeout: 15_000 }).then(() => true, () => false);
  const sven = await client('Sven');
  await sven.goto(view4, { waitUntil: 'load' });
  const full = await sven.waitForSelector('dialog[open] [data-status="full"]', { timeout: 20_000 }).then(() => true, () => false);
  const counts = await a.evaluate(() => [window.__collab.view().peers.length, window.__collab.view().readers.length]);
  check(listed && full && counts.join() === '1,4', `two writers and four readers fill the room: a seventh is refused (${full}; ${counts})`);
  await sven.context().close();
  for (const p of rs.slice(1)) await p.context().close();
  const rhea = rs[0];
  const shared4 = await view(rhea);
  await wes.click('.statusbar .collab-btn');
  await wes.click('dialog[open] [data-cmd="collabLeave"]');
  await wes.click('dialog[open] [data-cmd="collabDiscard"]');
  await a.click('.statusbar .collab-btn');
  await a.click('dialog[open] [data-cmd="collabLeave"]');
  const unwritten = await rhea.waitForSelector('.collab-notice[data-notice="unwritten"]', { timeout: 15_000 }).then(() => true, () => false);
  const lars = await client('Lars');
  await lars.goto(view4, { waitUntil: 'load' });
  const emptyRoom = await lars.waitForSelector('dialog[open] [data-status="empty"]', { timeout: 20_000 }).then(() => true, () => false);
  const larsText = await lars.evaluate(() => document.querySelector('.tiptap-host .tiptap').editor.state.doc.textContent);
  check(unwritten && emptyRoom && !larsText && await status(rhea) === 'live' && (await view(rhea)).json === shared4.json,
    `with every writer gone the reader hears so and keeps its state; a reader joining then finds the room empty (${unwritten}, ${emptyRoom}, "${larsText.slice(0, 20)}")`);
  await lars.context().close();
  await rhea.evaluate(() => { window.__before = true; });
  await rhea.click('.collab-notice [data-cmd="collabDetails"]');
  await rhea.click('dialog[open] [data-cmd="collabLeave"]');
  await rhea.click('dialog[open] [data-cmd="collabKeep"]');
  await rhea.waitForFunction(() => !window.__before && document.querySelector('.tiptap-host .tiptap')?.editor, null, { timeout: 30_000 });
  await rhea.waitForTimeout(2500);
  const keptR = await view(rhea);
  const rheaOff = await disabled(rhea, EDITS);
  await caret(rhea, 'end');
  await rhea.keyboard.type(' Qwzxv Mine');
  await settle(rhea);
  await rhea.waitForTimeout(1500);
  const mine = await rhea.evaluate(async () => ({
    editable: document.querySelector('.tiptap-host .tiptap').editor.isEditable,
    text: document.querySelector('.tiptap-host .tiptap').editor.state.doc.textContent,
    hash: location.hash,
    reading: (await import('/src/lib/collab/reading.svelte.ts')).reading(),
    ai: (await import('/src/lib/storage/ai.svelte.ts')).aiHostOff(),
    bar: !!document.querySelector('.statusbar .collab-btn'),
  }));
  mine.controls = rheaOff.every((x) => x === false);
  mine.squiggles = await squiggles(rhea);
  check(same(srcless(keptR), srcless(shared4)) && mine.editable && mine.text.endsWith('Mine') && !mine.hash && !mine.reading && !mine.ai && !mine.bar && mine.controls && mine.squiggles > 0,
    `a reader keeping its copy reloads into an editable document of its own, its controls and squiggles back (${brief(keptR)}; ${JSON.stringify({ ...mine, text: mine.text.slice(-12) })})`);

  check(!pageErrors.length, `no uncaught page errors ${pageErrors.join(' | ')}`);
} catch (err) {
  check(false, `collab session run threw: ${err}`);
} finally {
  await browser.close();
  await relay.close();
  stallLine.close();
  if (server) process.kill(-server.pid);
}
process.exit(failures.length ? 1 : 0);
