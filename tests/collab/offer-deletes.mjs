// Repro: a client back from offline must not apply an offer's deletions before the edits
// that made them, or a list item whose only block another client retyped stands empty and
// the binding pauses. Red until session.ts holds offered delete sets for the pulls. Chromium.
import { checker, collectErrors, devServer, openApp } from '../browser.mjs';
import { startRelay } from '../../relay/server.mjs';

const PORT = +(process.env.COLLAB_PORT ?? 4780);
const RELAY_PORT = +(process.env.COLLAB_RELAY_PORT ?? 4781);
process.env.RELAY_PORT = String(RELAY_PORT);
const { check, failures } = checker();
const relay = await startRelay({ port: RELAY_PORT, maxFrame: 1 << 20, beat: 2000 });
const server = await devServer(PORT);
const { browser, page: a } = await openApp(PORT);
const URL0 = `http://localhost:${PORT}/`;
const logs = [];
const ready = (p) => p.waitForFunction(() => document.querySelector('.tiptap-host .tiptap')?.editor, null, { timeout: 30_000 });
const live = (p) => p.waitForFunction(() => window.__collab?.view()?.status === 'live', null, { timeout: 30_000 });
const ed = 'document.querySelector(".tiptap-host .tiptap").editor';
try {
  await a.goto(URL0, { waitUntil: 'load' });
  await a.evaluate(() => { localStorage.clear(); localStorage.setItem('edentext-user-name', 'Anna'); });
  await a.reload({ waitUntil: 'load' });
  await ready(a);
  await a.evaluate(`${ed}.commands.setContent({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'After' }] }] })`);
  await a.click('.ribbon-tab-file');
  await a.click('.ribbon [data-cmd="collab"]');
  await a.click('dialog[open] [data-cmd="collabStart"]');
  await live(a);
  const link = await a.inputValue('dialog[open] input[readonly]');
  await a.click('dialog[open] .primary');

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'en-US', serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    localStorage.setItem('edentext-user-name', 'Cleo');
    const O = window.WebSocket, st = window.__line = { away: false, sockets: [] };
    window.WebSocket = class extends O {
      constructor(url, ...x) {
        const relay = String(url).includes('/relay');
        super(st.away && relay ? 'ws://127.0.0.1:4/' : url, ...x);
        if (relay) st.sockets.push(this);
      }
    };
  });
  const c = await ctx.newPage();
  const errs = [];
  collectErrors(c, errs, 'Cleo: ');
  c.on('console', (m) => { if (/collab:/.test(m.text())) logs.push(`${Date.now() % 100000} ${m.text().slice(0, 160)}`); });
  await c.goto(link, { waitUntil: 'load' });
  await ready(c);
  await live(c);
  await c.waitForTimeout(1000);

  // Cleo goes offline; Anna turns the list item's only block, the heading, into a paragraph.
  await c.evaluate(() => { window.__line.away = true; for (const s of window.__line.sockets) s.close(); });
  await c.waitForTimeout(500);
  await a.evaluate(`(() => { const e = ${ed}; let at = -1; e.state.doc.descendants((n, p) => { if (n.type.name === 'heading') at = p + 1; });
    e.chain().setTextSelection(at).setNode('paragraph').run(); })()`);
  await a.waitForTimeout(1000);
  await c.evaluate(() => { window.__line.away = false; });
  await live(c);
  await c.waitForTimeout(3000);
  const [ja, jc] = await Promise.all([a, c].map((p) => p.evaluate(`JSON.stringify(${ed}.getJSON())`)));
  console.log(logs.join('\n'));
  check(!logs.some((l) => /paused/.test(l)), 'a client back from offline never holds deletions without the edits that made them');
  check(ja === jc && !/heading/.test(jc) && /Title/.test(jc), 'and ends with the shared doc');
  if (errs.length) console.log(errs.slice(0, 3).join('\n'));
} finally {
  await browser.close();
  await relay.close?.();
  if (server) process.kill(-server.pid);
}
process.exit(failures.length ? 1 : 0);
