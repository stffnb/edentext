// How typing feels in a shared session (Chromium): A's keystroke, others' batches, the time
// to B's screen, pagination and frame gaps while the others type; FLUENCY_MINUTES measures
// memory instead. Method and numbers: docs/architecture/collab-soak.md. With two clients it
// checks that a reader watching A type sees no page break or page count jump and come back.
import { join } from 'node:path';
import { ROOT, checker, devServer, openApp, settle } from '../browser.mjs';
import { startRelay } from '../../relay/server.mjs';

const PORT = +(process.env.FLUENCY_PORT ?? 4396);
const RELAY_PORT = +(process.env.FLUENCY_RELAY_PORT ?? 4397);
process.env.RELAY_PORT = String(RELAY_PORT);
const COUNTS = (process.env.FLUENCY_CLIENTS ?? '1,2,4,6').split(',').map(Number);
const DOCS = (process.env.FLUENCY_DOCS ?? 'short,mixed,long').split(',');
const MINUTES = +(process.env.FLUENCY_MINUTES ?? 0);
const FILES = { short: 'tests/corpus/02-blocks.odt', mixed: 'docs/showcase/newsletter.odt', long: 'tests/corpus/05-breaks.odt' };
const { check, failures } = checker();
const relay = await startRelay({ port: RELAY_PORT, beat: 0 });
const server = await devServer(PORT);
const { browser, page: first } = await openApp(PORT);
await first.close();
const URL0 = `http://localhost:${PORT}/`;

// Every frame callback timed by its name ('calculate' is the pagination pass), every
// dispatch timed and marked remote when y-tiptap applied it, and the gaps between frames.
const probe = () => {
  const P = window.__probe = { raf: {}, dispatch: [], gaps: [], marks: [], seen: [], on: false };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => {
    if (!P.on) return cb(t);
    const t0 = performance.now();
    try { return cb(t); } finally {
      const k = cb.name || 'anonymous', ms = performance.now() - t0;
      (P.raf[k] ??= { n: 0, ms: 0, max: 0 }).n++;
      P.raf[k].ms += ms;
      P.raf[k].max = Math.max(P.raf[k].max, ms);
    }
  });
  let last = 0;
  const tick = (t) => { if (P.on && last) P.gaps.push(t - last); last = t; raf(tick); };
  raf(tick);
  addEventListener('keydown', (e) => { if (P.on && e.key === '#') P.marks.push(Date.now()); }, true);
};
const hook = (page, name) => page.evaluate((name) => {
  const ed = document.querySelector('.tiptap-host .tiptap').editor, view = ed.view, P = window.__probe;
  P.name = name;
  let marks = (ed.state.doc.textContent.match(/#/g) ?? []).length;
  const dispatch = view.dispatch.bind(view);
  view.dispatch = (tr) => {
    const t0 = performance.now();
    const before = view.state.doc;
    dispatch(tr);
    if (!P.on || !tr.docChanged) return;
    const remote = !!tr.getMeta('y-sync$')?.isChangeOrigin;
    P.dispatch.push({ ms: performance.now() - t0, remote });
    if (!remote) return;
    // Another's '#' arrived: when it reached this tab and when the frame after showed it.
    let now = 0;
    tr.steps.forEach((s, i) => {
      const doc = tr.docs[i] ?? before, map = s.getMap?.();
      if (!s.slice || !map) return;
      const old = doc.textBetween(s.from, s.to, '\n'), fresh = s.slice.content.textBetween(0, s.slice.content.size, '\n');
      now += (fresh.match(/#/g) ?? []).length - (old.match(/#/g) ?? []).length;
    });
    if (now <= 0) return;
    const at = Date.now();
    marks += now;
    requestAnimationFrame(() => { for (let i = 0; i < now; i++) P.seen.push({ at, shown: Date.now() }); });
  };
}, name);

async function tab() {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'en-US', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { if (!localStorage.getItem('edentext-user-name')) localStorage.setItem('edentext-user-name', 'X'); });
  await page.addInitScript(probe);
  page.on('dialog', (d) => d.accept().catch(() => {}));
  return page;
}
const ready = (page) => page.waitForFunction(() => document.querySelector('.tiptap-host .tiptap')?.editor, null, { timeout: 30_000 });
const live = (page) => page.waitForFunction(() => window.__collab?.view()?.status === 'live', null, { timeout: 60_000 });
const pagesOf = (page) => page.evaluate(() => +(/of (\d+)/.exec(document.querySelector('.statusbar')?.textContent ?? '')?.[1] ?? 0));

async function open(doc) {
  const a = await tab();
  await a.goto(URL0, { waitUntil: 'load' });
  await a.evaluate(() => { localStorage.clear(); localStorage.setItem('edentext-user-name', 'Anna'); });
  await a.reload({ waitUntil: 'load' });
  await ready(a);
  await a.setInputFiles('input.file-input[accept*=".odt"]', join(ROOT, FILES[doc]));
  await settle(a);
  if (doc === 'long') {
    await a.evaluate(() => {
      const ed = document.querySelector('.tiptap-host .tiptap').editor, json = ed.getJSON();
      ed.commands.setContent({ type: 'doc', content: Array.from({ length: 100 }, () => json.content).flat() });
    });
    await settle(a, true);
  }
  return a;
}
async function share(a, n) {
  await a.click('.ribbon-tab-file');
  await a.click('.ribbon [data-cmd="collab"]');
  await a.click('dialog[open] [data-cmd="collabStart"]');
  await live(a);
  const link = await a.inputValue('dialog[open] input[readonly]');
  await a.click('dialog[open] .primary');
  const others = [];
  for (let i = 1; i < n; i++) {
    const p = await tab();
    await p.goto(link, { waitUntil: 'load' });
    await ready(p);
    await live(p);
    others.push(p);
  }
  const want = await pagesOf(a);
  for (const p of others) await p.waitForFunction((w) => +(/of (\d+)/.exec(document.querySelector('.statusbar')?.textContent ?? '')?.[1] ?? 0) === w, want, { timeout: 120_000, polling: 500 }).catch(() => {});
  return others;
}
// The caret at a fraction of the document, in a text block, and the view scrolled there.
const caretAt = (page, f) => page.evaluate((f) => {
  const ed = document.querySelector('.tiptap-host .tiptap').editor, doc = ed.state.doc;
  let at = Math.floor(f * doc.content.size);
  while (at < doc.content.size && !doc.resolve(at).parent.isTextblock) at++;
  ed.commands.focus(at);
  ed.commands.scrollIntoView();
}, f);
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) : null; };
const WORDS = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ';

async function measure(doc, n) {
  const a = await open(doc);
  const others = n > 1 ? await share(a, n) : [];
  const pages = await pagesOf(a);
  await hook(a, 'A');
  if (others[0]) await hook(others[0], 'B');
  // A in the middle; one other above it, the rest spread over the document.
  await caretAt(a, 0.5);
  for (const [i, p] of others.entries()) await caretAt(p, i === 0 ? 0.3 : (i + 1) / (others.length + 2));
  await a.waitForTimeout(1500);
  for (const p of [a, ...others]) await p.evaluate(() => { window.__probe.on = true; });
  let typing = true;
  const background = others.map(async (p) => {
    for (let i = 0; typing; i = (i + 1) % WORDS.length) await p.keyboard.type(WORDS[i], { delay: 0 }).then(() => p.waitForTimeout(200));
  });
  // A types 80 keys, every eighth a '#' for the latency, at about eight a second.
  const text = Array.from({ length: 80 }, (_, i) => (i % 8 === 7 ? '#' : 'abcdefg'[i % 7])).join('');
  const sent = () => a.evaluate(() => [...(window.__collab?.session?.stats.sent ?? [])]);
  const sent0 = await sent();
  for (const ch of text) { await a.keyboard.type(ch); await a.waitForTimeout(120); }
  await a.waitForTimeout(1500);
  // A's frames per key it typed (all kinds; UPDATE is 1, PRESENCE 2).
  const sentBy = (await sent()).map((n, k) => n - (sent0[k] ?? 0));
  typing = false;
  await Promise.all(background);
  for (const p of [a, ...others]) await p.evaluate(() => { window.__probe.on = false; });
  const [pa, pb] = [await a.evaluate(() => window.__probe), others[0] ? await others[0].evaluate(() => window.__probe) : null];
  const own = pa.dispatch.filter((d) => !d.remote).map((d) => d.ms), remote = pa.dispatch.filter((d) => d.remote).map((d) => d.ms);
  const lat = pb ? pb.seen.map((s, i) => [s.at - pa.marks[i], s.shown - pa.marks[i]]).filter(([x]) => Number.isFinite(x)) : [];
  const calc = pa.raf.calculate ?? { n: 0, ms: 0, max: 0 };
  const top = Object.entries(pa.raf).sort((x, y) => y[1].ms - x[1].ms).slice(0, 3).map(([k, v]) => `${k} ${v.n}× ${Math.round(v.ms)} ms`).join(', ');
  const res = {
    doc, clients: n, pages,
    key: { median: pct(own, 0.5), p95: pct(own, 0.95), n: own.length },
    remote: { median: pct(remote, 0.5), p95: pct(remote, 0.95), n: remote.length },
    latency: pb ? { arrive: pct(lat.map((l) => l[0]), 0.5), shown: pct(lat.map((l) => l[1]), 0.5), shownP95: pct(lat.map((l) => l[1]), 0.95), n: lat.length } : null,
    paginate: { n: calc.n, avg: calc.n ? +(calc.ms / calc.n).toFixed(1) : 0, max: +calc.max.toFixed(1) },
    gaps: { p95: pct(pa.gaps, 0.95), max: pct(pa.gaps, 1), over50: pa.gaps.filter((g) => g > 50).length },
    frames: top,
    perKey: n > 1 ? { all: +(sentBy.reduce((x, y) => x + y, 0) / text.length).toFixed(2), update: +(sentBy[1] / text.length).toFixed(2), presence: +(sentBy[2] / text.length).toFixed(2) } : null,
  };
  // B's caret and view when A writes a line above it.
  if (others[0]) {
    const b = others[0];
    await caretAt(b, 0.3);
    await caretAt(a, 0.05);
    await b.waitForTimeout(800);
    const look = () => b.evaluate(() => {
      const ed = document.querySelector('.tiptap-host .tiptap').editor, { head } = ed.state.selection;
      const doc = ed.state.doc, around = doc.textBetween(Math.max(1, head - 12), Math.min(doc.content.size, head + 12), '¶');
      return { around, y: Math.round(ed.view.coordsAtPos(head).top), scroll: Math.round(document.scrollingElement.scrollTop + [...document.querySelectorAll('*')].reduce((s, e) => s + (e.scrollTop || 0), 0)) };
    });
    const before = await look();
    await a.keyboard.type('A line written above the others. ');
    await a.keyboard.press('Enter');
    await b.waitForTimeout(1500);
    const after = await look();
    res.caret = { kept: before.around === after.around, shift: after.y - before.y, scrolled: after.scroll - before.scroll };
  }
  if (n === 2) await churn(a, others[0], doc);
  console.log(JSON.stringify(res));
  for (const p of [a, ...others]) await p.context().close();
  return res;
}

// B only reads while A types mid-document, Enter included: sampled right before each paint,
// the blocks after A's must never move and return within a second, nor the page count.
async function churn(a, b, doc) {
  await caretAt(a, 0.5);
  const at = await a.evaluate(() => document.querySelector('.tiptap-host .tiptap').editor.state.selection.head);
  await b.waitForTimeout(1500);
  await b.evaluate((at) => {
    const view = document.querySelector('.tiptap-host .tiptap').editor.view, host = view.dom;
    const blocks = [...host.children].filter((e) => !e.dataset.pageBreakSpacer);
    const i = blocks.findIndex((e) => e.contains(view.domAtPos(at).node));
    blocks[i]?.scrollIntoView({ block: 'center' });
    const watch = [1, 2, 3, 5, 8, 13, 21, 40].map((k) => blocks[i + k]).filter(Boolean);
    const C = window.__churn = { on: true, rows: [] };
    // A ResizeObserver runs after the frame's callbacks and layout, just before its paint.
    const probe = document.body.appendChild(document.createElement('div'));
    probe.style.cssText = 'position:fixed;left:0;top:0;height:1px;width:1px;pointer-events:none';
    new ResizeObserver(() => {
      if (!C.on) return;
      const pages = +(/of (\d+)/.exec(document.querySelector('.statusbar')?.textContent ?? '')?.[1] ?? 0);
      const top = host.getBoundingClientRect().top;
      C.rows.push([performance.now(), pages, ...watch.map((e) => Math.round(e.getBoundingClientRect().top - top))]);
    }).observe(probe);
    const flip = () => { if (C.on) { probe.style.width = probe.style.width === '1px' ? '2px' : '1px'; requestAnimationFrame(flip); } };
    requestAnimationFrame(flip);
  }, at);
  const line = 'the quick brown fox jumps over the lazy dog ';
  for (let i = 0; i < 120; i++) {
    if (i % 50 === 49) await a.keyboard.press('Enter');
    else await a.keyboard.type(line[i % line.length]);
    await a.waitForTimeout(120);
  }
  await b.waitForTimeout(2000);
  const rows = await b.evaluate(() => { window.__churn.on = false; return window.__churn.rows; });
  // A value that leaves and comes back within a second was shown wrongly in between.
  const back = [];
  for (let c = 1; c < (rows[0]?.length ?? 0); c++) {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][c] === rows[i - 1][c]) continue;
      const j = rows.findIndex((r, k) => k > i && r[0] - rows[i][0] < 1000 && r[c] === rows[i - 1][c]);
      if (j < 0) continue;
      back.push(`${c === 1 ? 'pages' : `block ${c - 1}`} ${rows[i - 1][c]}→${rows[i][c]} for ${Math.round(rows[j][0] - rows[i][0])} ms`);
      i = j;
    }
  }
  check(rows.length > 100 && !back.length, `${doc}: a reader sees nothing jump and return while the other types (${rows.length} frames${back.length ? `; ${back.slice(0, 4).join(', ')}` : ''})`);
}

// Four clients type for MINUTES; the tabs' heap after a collection and the doc's size.
async function endurance() {
  const a = await open('short');
  const others = await share(a, 4);
  const all = [a, ...others];
  for (const [i, p] of all.entries()) await caretAt(p, (i + 1) / 6);
  const cdp = await Promise.all(all.map((p) => p.context().newCDPSession(p)));
  const heap = async () => Promise.all(cdp.map(async (s) => {
    await s.send('HeapProfiler.collectGarbage');
    const { metrics } = await s.send('Performance.getMetrics');
    return Math.round(metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576);
  }));
  for (const s of cdp) await s.send('Performance.enable');
  const size = () => a.evaluate(async () => {
    const { Y } = await import('/src/lib/editor/undoYjs.ts');
    return Math.round(Y.encodeStateAsUpdate(window.__collab.session.awareness.doc).length / 1024);
  });
  console.log(`minute 0: heap ${await heap()} MB, doc ${await size()} kB`);
  let typing = true;
  const t0 = Date.now();
  const typists = all.map(async (p, k) => {
    for (let i = k; typing; i = (i + 1) % WORDS.length) {
      await p.keyboard.type(WORDS[i]);
      await p.waitForTimeout(200);
      if (WORDS[i] === ' ' && Math.random() < 0.05) await p.keyboard.press('Enter');
    }
  });
  for (let m = 1; m <= MINUTES; m++) {
    await a.waitForTimeout(Math.max(0, t0 + m * 60_000 - Date.now()));
    console.log(`minute ${m}: heap ${await heap()} MB, doc ${await size()} kB, ${await a.evaluate(() => document.querySelector('.tiptap-host .tiptap').editor.state.doc.textContent.length)} chars, ${await pagesOf(a)} pages`);
  }
  typing = false;
  await Promise.all(typists);
}

try {
  if (MINUTES) await endurance();
  else for (const doc of DOCS) for (const n of COUNTS) await measure(doc, n);
} finally {
  await browser.close();
  await relay.close();
  if (server) process.kill(-server.pid);
}
process.exit(failures.length ? 1 : 0);
