// A shared session end to end: the real relay (relay/server.mjs), the dev server, and
// clients joining through the link. Checks that a joiner gets the starter's document with
// its layout and zones, that edits and undo work both ways, that the relay sees no plain
// text, that clients come, go and reload (four at once), that the assistant's edits travel
// and undo like typed ones, and that an idle session stays quiet, also when one client
// lays the pages out differently. The relay passes at most 1 MiB per frame, so a picture
// and a late joiner's copy go in parts; a line that keeps breaking stops showing `live`.
// When the starter leaves, the others are told; a joiner leaving keeps its copy as a
// document of this browser or drops it, and a link to an empty room says so.
// Any engine (BROWSER).
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { MOD, ROOT, checker, collectErrors, devServer, openApp } from '../browser.mjs';
import { startRelay } from '../../relay/server.mjs';

const PORT = +(process.env.COLLAB_PORT ?? 4392);
const RELAY_PORT = +(process.env.COLLAB_RELAY_PORT ?? 4393);
process.env.RELAY_PORT = String(RELAY_PORT);
const { check, failures } = checker();
const seen = [];
const FRAME = 1 << 20;
const BEAT = 2000;
const relay = await startRelay({ port: RELAY_PORT, maxFrame: FRAME, beat: BEAT, tap: (d) => seen.push(Buffer.from(d)) });
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

  const [y0, r0] = [await ysize(a), relayed()];
  const size = await photo(a);
  await a.waitForTimeout(2500);
  [va, vb] = [await view(a), await view(b)];
  check(size > FRAME && va.json === vb.json && await shown(b) === 1, `a picture longer than the relay's frame reaches the joiner (${(size / 1e6).toFixed(1)} MB)`);
  const [y1, r1] = [await ysize(a), relayed()];
  check(!inline(va.json) && y1 - y0 < 2000 && r1 - r0 > size && r1 - r0 < size * 1.1,
    `the shared doc names the picture by its key (+${y1 - y0} bytes), its bytes go once (${((r1 - r0) / size).toFixed(2)}× its size)`);
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
  // Cleo's offer comes after the settle: Ben still pulls her edit and sends her Anna's.
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
  const [vb5, vc5] = [await view(b), await view(c)];
  const both = (v) => v.text.includes(' Eta') && v.text.includes(' Zeta');
  check(vb5.json === vc5.json && both(vb5), `a late offer is pulled from and gets what it lacks (${both(vb5)}, ${both(vc5)})`);

  // A tab closed with a zone open frees it for the others.
  await openZone(f, 'footer');
  await b.waitForTimeout(600);
  const heldByFinn = await heldTag(b);
  const closedAt = Date.now();
  await f.close();
  const freed = await b.waitForFunction(() => !document.querySelector('.hf-held'), null, { timeout: 40_000 }).then(() => true, () => false);
  check(heldByFinn === 'Finn is editing' && freed, `a tab closed with the footer open frees it ("${heldByFinn}", after ${((Date.now() - closedAt) / 1000).toFixed(1)} s)`);

  await a.click('.statusbar .collab-btn');
  await a.click('dialog[open] [data-cmd="collabLeave"]');
  const unkept = (page) => page.waitForSelector('dialog[open] [data-notice="unkept"]', { timeout: 10_000 }).then(() => true, () => false);
  const heard = [await unkept(b), await unkept(c)];
  check(heard.every(Boolean) && !(await a.$("dialog[open]")), `the starter leaves unasked, and the others hear nobody keeps the document (${heard})`);
  for (const page of [b, c]) await page.keyboard.press('Escape');
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
    WebSocket.prototype.send = function (d) { if ((d.byteLength ?? d.length) < 200_000) return send.call(this, d); };
  });
  await photo(a);
  await g.waitForSelector('.tiptap-host .tiptap .image-waiting', { timeout: 10_000 }).catch(() => {});
  const aMissing = await a.evaluate(() => window.__collab.view().missing);
  if (!await a.isVisible('dialog[open] [data-cmd="collabLeave"]')) await a.click('.statusbar .collab-btn');
  await a.click('dialog[open] [data-cmd="collabLeave"]');
  const told2 = await g.waitForSelector('dialog[open] [data-missing]', { timeout: 30_000 }).then(() => true, () => false);
  const own = await a.evaluate(() => /"src":"data:image\/png/.test(JSON.stringify(document.querySelector('.tiptap-host .tiptap').editor.getJSON())));
  const boxes = await g.locator('.tiptap-host .tiptap .image-waiting').count();
  check(told2 && await status(g) === 'live' && boxes === 1 && own,
    `a picture whose only holder left shows as a grey box (${boxes}) with a note, the session stays live (${told2}, ${await status(g)}), and the holder keeps it (${own}, ${aMissing} missing there)`);

  check(!pageErrors.length, `no uncaught page errors ${pageErrors.join(' | ')}`);
} catch (err) {
  check(false, `collab session run threw: ${err}`);
} finally {
  await browser.close();
  await relay.close();
  if (server) process.kill(-server.pid);
}
process.exit(failures.length ? 1 : 0);
