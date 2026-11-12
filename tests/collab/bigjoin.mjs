// Big-document join bench, not part of test:collab: A builds ~150 generated pages with 25 noise
// pictures (49 MB), B (and C) join; prints one JSON line of timings. Rows and method:
// docs/architecture/collab-perf.md. Env: SCEN, NET, THROTTLE, THIRD, TYPING, LIMIT, BIGJOIN_PORT/_OUT.
import net from 'node:net';
import { appendFileSync } from 'node:fs';
import { devServer, openApp, settle } from '../browser.mjs';
import { startRelay } from '../../relay/server.mjs';

const OUT = process.env.BIGJOIN_OUT;
const PORT = +(process.env.BIGJOIN_PORT ?? 4401), RELAY_PORT = PORT + 1, PROXY_PORT = PORT + 2;
const SCEN = process.env.SCEN ?? 'S1';
const NET = process.env.NET ?? 'none';
const THROTTLE = process.env.THROTTLE ?? 'proxy';
const THIRD = +(process.env.THIRD ?? 0);
const TYPING = process.env.TYPING === '1';
const GEN = process.env.GEN === '1';
const CHAPTERS = +(process.env.CHAPTERS ?? 84);
const NPICS = SCEN === 'S0' ? 0 : 25;
const rateBps = NET === 'none' ? Infinity : (+NET * 1e6) / 8;
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

// ---- relay with a tap: bytes per (sender, receiver), A's small frames, relay buffering ----
const T = { frames: [], cpu0: null };
let phase = 'setup';
const bytes = {}; // phase -> "from>to" -> bytes
const tap = (data) => {
  const to = data.readUInt32BE(0), size = data.length, t = Date.now(), ph = phase;
  // The relay writes the sender's id over `to` right after the tap, synchronously.
  queueMicrotask(() => {
    const from = data.readUInt32BE(0);
    const k = `${from}>${to}`;
    ((bytes[ph] ??= {})[k] ??= { n: 0, b: 0 });
    bytes[ph][k].n++; bytes[ph][k].b += size;
    if (size < 4000) T.frames.push({ t, from, to, size });
    else T.big ??= [], T.big.push({ t, from, to, size });
  });
};
const relay = await startRelay({ port: RELAY_PORT, beat: 0, tap });
let maxBuffered = 0, lagMax = 0;
let lastTick = Date.now();
const sampler = setInterval(() => {
  const now = Date.now();
  lagMax = Math.max(lagMax, now - lastTick - 100);
  lastTick = now;
  let sum = 0;
  for (const room of relay.rooms.values()) for (const ws of room) sum += ws.bufferedAmount ?? 0;
  maxBuffered = Math.max(maxBuffered, sum);
}, 100);

// ---- throttling TCP proxy in front of the relay, for A's socket ----
let proxyRate = THROTTLE === 'proxy' ? rateBps : Infinity;
const proxy = net.createServer((client) => {
  const up = net.connect(RELAY_PORT, '127.0.0.1');
  client.setNoDelay(true); up.setNoDelay(true);
  up.pipe(client);
  const q = []; let queued = 0, paused = false, last = Date.now(), credit = 0;
  client.on('data', (d) => {
    if (proxyRate === Infinity && !q.length) return void up.write(d);
    q.push(d); queued += d.length;
    if (queued > 256 * 1024 && !paused) { paused = true; client.pause(); }
  });
  const pump = setInterval(() => {
    const now = Date.now();
    credit = Math.min(credit + (now - last) / 1000 * proxyRate, 64 * 1024 + proxyRate * 0.02);
    last = now;
    while (q.length && (credit > 0 || proxyRate === Infinity)) {
      let d = q[0];
      const n = proxyRate === Infinity ? d.length : Math.min(d.length, Math.max(1, Math.floor(credit)));
      if (n < d.length) { q[0] = d.subarray(n); d = d.subarray(0, n); } else q.shift();
      credit -= n; queued -= n;
      up.write(d);
    }
    if (paused && queued < 64 * 1024) { paused = false; client.resume(); }
  }, 5);
  const end = () => { clearInterval(pump); client.destroy(); up.destroy(); };
  client.on('error', end); up.on('error', end); client.on('close', end); up.on('close', end);
});
await new Promise((r) => proxy.listen(PROXY_PORT, '127.0.0.1', r));

process.env.RELAY_PORT = String(RELAY_PORT);
const server = await devServer(PORT);
const { browser, page: first } = await openApp(PORT);
await first.close();
const URL0 = `http://localhost:${PORT}/`;

// ---- pages ----
const probe = () => {
  const P = window.__probe = { dispatch: [], gaps: [], marks: [], seen: [], long: [], on: false, t: {} };
  const raf = window.requestAnimationFrame.bind(window);
  let last = 0;
  const tick = (t) => { if (P.on && last) P.gaps.push(t - last); last = t; raf(tick); };
  raf(tick);
  addEventListener('keydown', (e) => { if (e.key === '#') P.marks.push(Date.now()); }, true);
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push([Math.round(performance.timeOrigin + e.startTime), Math.round(e.duration)]); })
      .observe({ type: 'longtask', buffered: true });
  } catch {}
};
// Join milestones, polled in the joiner's page.
const milestones = (target) => {
  const P = window.__probe;
  const mark = (k) => { P.t[k] ??= Date.now(); };
  setInterval(() => {
    const ed = document.querySelector('.tiptap-host .tiptap')?.editor;
    if (ed) {
      mark('editor');
      const d = ed.state.doc;
      if (d.childCount > 20) mark('firstText');
      if (d.lastChild?.textContent.includes('END-OF-DOCUMENT') || d.textBetween(Math.max(0, d.content.size - 400), d.content.size).includes('END-OF-DOCUMENT')) mark('allText');
    }
    if (window.__collab?.view()?.status === 'live') mark('live');
    const imgs = [...document.querySelectorAll('.tiptap-host img')].filter((i) => i.naturalWidth >= 500).length;
    P.imgs = imgs;
    if (imgs >= 1) mark('firstPic');
    if (target.pics && imgs >= target.pics) mark('allPics');
    const pages = +(/of (\d+)/.exec(document.querySelector('.statusbar')?.textContent ?? '')?.[1] ?? 0);
    if (target.pages && pages >= target.pages) mark('pages');
  }, 100);
};

async function tab(name, { viaProxy = false, cdpRate = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'en-US', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript((n) => { if (!localStorage.getItem('edentext-user-name')) localStorage.setItem('edentext-user-name', n); }, name);
  await page.addInitScript(probe);
  // Route the relay socket straight to the relay, or for A through the throttling proxy.
  await page.addInitScript((port) => {
    const O = window.WebSocket;
    window.WebSocket = class extends O {
      constructor(url, ...x) { super(String(url).includes('/relay') ? `ws://127.0.0.1:${port}/relay` : url, ...x); }
    };
  }, viaProxy ? PROXY_PORT : RELAY_PORT);
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => log(`${name} pageerror`, String(e).slice(0, 160)));
  if (cdpRate) {
    const s = await ctx.newCDPSession(page);
    await s.send('Network.enable');
    await s.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: cdpRate });
  }
  return page;
}
const ready = (page) => page.waitForFunction(() => document.querySelector('.tiptap-host .tiptap')?.editor, null, { timeout: 60_000 });
const live = (page, timeout = 600_000) => page.waitForFunction(() => window.__collab?.view()?.status === 'live', null, { timeout, polling: 200 });
const pagesOf = (page) => page.evaluate(() => +(/of (\d+)/.exec(document.querySelector('.statusbar')?.textContent ?? '')?.[1] ?? 0));

// Builds the document in A's page: seeded noise pictures and generated text.
const build = (o) => (async () => {
  let s = 0x9e3779b9;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
  const pics = [];
  for (let i = 0; i < o.npics; i++) {
    const png = i % 5 === 4;
    const [w, h] = png ? [830, 830] : [2000, 1500];
    const c = new OffscreenCanvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
    for (let p = 0; p < d.length; p += 4) {
      const x = (p / 4) % w, y = (p / 4 / w) | 0, r = rnd();
      // A gradient under strong noise: photo-like entropy, not solid colour.
      d[p] = ((x * 255) / w + (r & 127)) & 255; d[p + 1] = ((y * 255) / h + ((r >>> 8) & 127)) & 255; d[p + 2] = (i * 37 + ((r >>> 16) & 255)) & 255; d[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await c.convertToBlob({ type: png ? 'image/png' : 'image/jpeg', quality: 0.85 });
    const url = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
    pics.push({ src: url, bytes: blob.size, w: png ? 360 : 480, h: 360 });
  }
  const W = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat'.split(' ');
  let wi = 0;
  const words = (n) => { const out = []; for (let k = 0; k < n; k++) out.push(W[(wi++ * 7 + k) % W.length]); return out.join(' '); };
  const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  const content = [];
  let slot = 0;
  for (let c = 0; c < o.chapters; c++) {
    content.push({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: `Chapter ${c + 1} ${words(3)}` }] });
    for (let p = 0; p < 9; p++) {
      content.push(para(`${words(105)}.`));
      if (p === 4 && slot < 25) {
        const pic = pics[slot];
        content.push(pic ? { type: 'paragraph', content: [{ type: 'image', attrs: { src: pic.src, width: pic.w, height: pic.h } }] } : para(`PIC-SLOT-${slot}`));
        slot++;
      }
      if (p === 6) content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `Section ${c + 1}.1 ${words(2)}` }] });
    }
    content.push({ type: 'bulletList', content: Array.from({ length: 6 }, () => ({ type: 'listItem', content: [para(words(14))] })) });
    if (c % 5 === 2) {
      content.push({ type: 'table', content: Array.from({ length: 8 }, () => ({ type: 'tableRow', content: Array.from({ length: 4 }, () => ({ type: 'tableCell', content: [para(words(4))] })) })) });
    }
  }
  content.push(para('END-OF-DOCUMENT'));
  const ed = document.querySelector('.tiptap-host .tiptap').editor;
  window.__pics = pics;
  ed.commands.setContent({ type: 'doc', content });
  return { pics: pics.length, picBytes: pics.reduce((n, p) => n + p.bytes, 0), sizes: pics.map((p) => Math.round(p.bytes / 1024)), uriChars: pics.reduce((n, p) => n + p.src.length, 0) };
})();

// S2: the slots get their pictures in one transaction, inside the session.
const insertPics = (picsUrl) => {
  const ed = document.querySelector('.tiptap-host .tiptap').editor, { state } = ed.view;
  const tr = state.tr, slots = [];
  state.doc.descendants((n, pos) => { const m = n.isTextblock && /^PIC-SLOT-(\d+)$/.exec(n.textContent); if (m) slots.push([pos, n, +m[1]]); });
  for (const [pos, n, i] of slots.reverse()) {
    const p = window.__pics[i];
    tr.replaceWith(pos + 1, pos + 1 + n.content.size, state.schema.nodes.image.create({ src: p.src, width: p.w, height: p.h }));
  }
  ed.view.dispatch(tr);
  return slots.length;
};

async function startA() {
  const a = await tab('Anna', { viaProxy: THROTTLE === 'proxy', cdpRate: THROTTLE === 'cdp' && rateBps !== Infinity ? rateBps : 0 });
  await a.goto(URL0, { waitUntil: 'load' });
  await a.evaluate(() => { localStorage.clear(); localStorage.setItem('edentext-user-name', 'Anna'); });
  await a.reload({ waitUntil: 'load' });
  await ready(a);
  const t0 = Date.now();
  // In S2 the pictures are made but the doc holds slots; they go in after the session starts.
  const info = await a.evaluate(build, { npics: NPICS, chapters: CHAPTERS, slotsOnly: SCEN === 'S2' }).catch((e) => { throw e; });
  if (SCEN === 'S2') {
    // Rebuild with slots: build() put pictures in; replace them with slot paragraphs.
    await a.evaluate(() => {
      const ed = document.querySelector('.tiptap-host .tiptap').editor, { state } = ed.view, tr = state.tr;
      let i = 0; const at = [];
      state.doc.descendants((n, pos) => { if (n.type.name === 'image') at.push(pos); });
      for (const pos of at) tr.replaceWith(tr.mapping.map(pos), tr.mapping.map(pos + 1), state.schema.text(`PIC-SLOT-${i++}`));
      ed.view.dispatch(tr);
    });
  }
  await settle(a, true);
  const pages = await pagesOf(a);
  log(`A built: ${pages} pages, ${info.pics} pictures, ${(info.picBytes / 1048576).toFixed(1)} MB (${(info.uriChars / 1048576).toFixed(1)} M data-URI chars) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { a, info, pages };
}

async function share(a) {
  await a.click('.ribbon-tab-file');
  await a.click('.ribbon [data-cmd="collab"]');
  const t0 = Date.now();
  await a.click('dialog[open] [data-cmd="collabStart"]');
  await live(a);
  const startMs = Date.now() - t0;
  const link = await a.inputValue('dialog[open] input[readonly]');
  await a.click('dialog[open] .primary');
  const snap = await a.evaluate(() => { const m = window.__collab.session.awareness.doc.getMap('meta').get('snapshot'); return m?.length ?? 0; });
  return { link, startMs, snapshot: snap };
}

async function joiner(name, link, target) {
  const p = await tab(name);
  await p.addInitScript(milestones, target);
  const t0 = Date.now();
  await p.goto(link, { waitUntil: 'load' });
  return { p, t0, name };
}
const collect = async (j) => {
  const P = await j.p.evaluate(() => ({ t: window.__probe.t, imgs: window.__probe.imgs, long: window.__probe.long }));
  const rel = Object.fromEntries(Object.entries(P.t).map(([k, v]) => [k, +((v - j.t0) / 1000).toFixed(2)]));
  const lt = P.long.filter(([t]) => t >= j.t0);
  return { ...rel, imgs: P.imgs, longTasks: lt.length, longMax: Math.max(0, ...lt.map((x) => x[1])), longSum: lt.reduce((n, x) => n + x[1], 0) };
};
const waitDone = (j, target, timeout) => j.p.waitForFunction((tg) => {
  const t = window.__probe.t; return t.allText && t.live && (!tg.pics || t.allPics) && (!tg.pages || t.pages);
}, target, { timeout, polling: 500 });

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) : null; };

// Post-join typing: A types 48 keys with a '#' every 8th; B measures arrival and paint.
const hook = (page) => page.evaluate(() => {
  if (window.__hooked) return; window.__hooked = true;
  const ed = document.querySelector('.tiptap-host .tiptap').editor, view = ed.view, P = window.__probe;
  const dispatch = view.dispatch.bind(view);
  view.dispatch = (tr) => {
    const t0 = performance.now(), before = view.state.doc;
    dispatch(tr);
    if (!P.on || !tr.docChanged) return;
    const remote = !!tr.getMeta('y-sync$')?.isChangeOrigin;
    P.dispatch.push({ ms: performance.now() - t0, remote });
    if (!remote) return;
    let now = 0;
    tr.steps.forEach((s, i) => {
      const doc = tr.docs[i] ?? before;
      if (!s.slice) return;
      now += (s.slice.content.textBetween(0, s.slice.content.size, '\n').match(/#/g) ?? []).length - (doc.textBetween(s.from, s.to, '\n').match(/#/g) ?? []).length;
    });
    if (now <= 0) return;
    const at = Date.now();
    requestAnimationFrame(() => { for (let i = 0; i < now; i++) P.seen.push({ at, shown: Date.now() }); });
  };
});
const caretAt = (page, f) => page.evaluate((f) => {
  const ed = document.querySelector('.tiptap-host .tiptap').editor, doc = ed.state.doc;
  let at = Math.floor(f * doc.content.size);
  while (at < doc.content.size && !doc.resolve(at).parent.isTextblock) at++;
  ed.commands.focus(at); ed.commands.scrollIntoView();
}, f);
async function typing(a, others) {
  for (const p of [a, ...others]) await p.evaluate(() => { const P = window.__probe; P.dispatch = []; P.gaps = []; P.marks = []; P.seen = []; });
  await hook(a);
  for (const p of others) await hook(p);
  await caretAt(a, 0.5);
  for (const [i, p] of others.entries()) await caretAt(p, i === 0 ? 0.3 : 0.7);
  await a.waitForTimeout(1500);
  for (const p of [a, ...others]) await p.evaluate(() => { window.__probe.on = true; });
  let go = true;
  const W = 'lorem ipsum dolor ';
  const bg = others.slice(1).map(async (p) => { for (let i = 0; go; i = (i + 1) % W.length) await p.keyboard.type(W[i]).then(() => p.waitForTimeout(200)); });
  const text = Array.from({ length: 48 }, (_, i) => (i % 8 === 7 ? '#' : 'abcdefg'[i % 7])).join('');
  for (const ch of text) { await a.keyboard.type(ch); await a.waitForTimeout(120); }
  await a.waitForTimeout(2000);
  go = false; await Promise.all(bg);
  for (const p of [a, ...others]) await p.evaluate(() => { window.__probe.on = false; });
  const pa = await a.evaluate(() => window.__probe), pb = await others[0].evaluate(() => window.__probe);
  const own = pa.dispatch.filter((d) => !d.remote).map((d) => d.ms);
  const lat = pb.seen.map((s, i) => [s.at - pa.marks[i], s.shown - pa.marks[i]]).filter(([x]) => Number.isFinite(x));
  return {
    clients: 1 + others.length,
    keyA: { p50: pct(own, 0.5), p95: pct(own, 0.95), n: own.length },
    arriveB: { p50: pct(lat.map((l) => l[0]), 0.5), p95: pct(lat.map((l) => l[0]), 0.95) },
    shownB: { p50: pct(lat.map((l) => l[1]), 0.5), p95: pct(lat.map((l) => l[1]), 0.95), n: lat.length },
    gapsA: { p95: pct(pa.gaps, 0.95), max: pct(pa.gaps, 1) },
  };
}

const heap = async (page) => {
  const s = await page.context().newCDPSession(page);
  await s.send('HeapProfiler.collectGarbage');
  await s.send('Performance.enable');
  const { metrics } = await s.send('Performance.getMetrics');
  return Math.round(metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576);
};

const res = { tag: process.env.TAG, scen: SCEN, net: NET, throttle: THROTTLE, third: THIRD };
try {
  const { a, info, pages } = await startA();
  Object.assign(res, { pages, pics: info.pics, picMB: +(info.picBytes / 1048576).toFixed(1), picSizesKB: info.sizes });
  if (GEN) { console.log(JSON.stringify(res)); process.exit(0); }
  phase = 'start';
  const sh = await share(a);
  if (SCEN === 'S2') {
    const n = await a.evaluate(insertPics);
    await settle(a, true);
    const t1 = Date.now();
    const sentA = () => Object.entries(bytes.start ?? {}).reduce((x, [k, v]) => x + v.b, 0);
    // Waits for the broadcast to drain, or for 3 s without growth (nothing goes to an empty room).
    let prev = -1, still = 0;
    while (sentA() < info.picBytes * 0.99 && Date.now() - t1 < 180_000 && still < 6) { const n = sentA(); still = n === prev ? still + 1 : 0; prev = n; await a.waitForTimeout(500); }
    log(`A inserted ${n} pictures in the session; broadcast of ${(sentA() / 1048576).toFixed(1)} MB to an empty room drained in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  }
  res.startMs = sh.startMs; res.snapshotMB = +(sh.snapshot / 1048576).toFixed(2);
  log(`session live after ${sh.startMs} ms; snapshot ${res.snapshotMB} MB`);
  await a.waitForTimeout(1500);
  const aId = await a.evaluate(() => window.__collab.session.me);
  const target = { pics: NPICS, pages: await pagesOf(a) };

  // A types a '#' every 700 ms while the others join: when does each reach the relay?
  phase = 'join';
  T.frames = []; T.big = [];
  maxBuffered = 0; lagMax = 0;
  const cpu0 = process.cpuUsage(), wall0 = Date.now();
  await caretAt(a, 0.02);
  await a.evaluate(() => { window.__probe.marks = []; window.__probe.long = []; });
  let typingA = true;
  const typer = (async () => { while (typingA) { await a.keyboard.type('#'); await a.waitForTimeout(700); } })();

  const b = await joiner('Ben', sh.link, target);
  let c = null;
  if (THIRD) { await b.p.waitForTimeout(THIRD); c = await joiner('Cleo', sh.link, target); }
  const limit = +(process.env.LIMIT ?? (NET === '10' ? 600_000 : 300_000));
  const st = (pg) => pg.evaluate(() => { const v = window.__collab?.view?.(), s = window.__collab?.session; return { imgs: window.__probe.imgs, status: v?.status, missing: v?.missing, peers: v?.peers?.map((p) => p.peer), sent: s?.stats.sent.join(',') }; }).catch(() => null);
  const diag = process.env.DIAG ? setInterval(async () => log('diag', JSON.stringify({ A: await st(a), B: await st(b.p), C: c && await st(c.p), me: { A: aId } })), 15_000) : null;
  await waitDone(b, target, limit).catch((e) => log('B not done', String(e).slice(0, 80)));
  res.B = await collect(b);
  log('B', JSON.stringify(res.B));
  if (c) {
    await waitDone(c, target, limit).catch((e) => log('C not done', String(e).slice(0, 80)));
    res.C = await collect(c);
    log('C', JSON.stringify(res.C));
  }
  clearInterval(diag);
  typingA = false; await typer;
  const cpu = process.cpuUsage(cpu0);
  res.relay = { cpuMs: Math.round((cpu.user + cpu.system) / 1000), wallMs: Date.now() - wall0, maxBufferedMB: +(maxBuffered / 1048576).toFixed(1), loopLagMaxMs: lagMax };
  // A's '#' marks vs. the first small frame from A at the relay after each.
  const marks = await a.evaluate(() => window.__probe.marks);
  const aSmall = T.frames.filter((f) => f.from === aId).map((f) => f.t);
  const hol = marks.map((m) => { const t = aSmall.find((x) => x >= m); return t ? t - m : null; }).filter((x) => x !== null);
  res.aKeyToRelay = { p50: pct(hol, 0.5), p95: pct(hol, 0.95), max: pct(hol, 1), n: hol.length, marks: marks.length };
  // Alone, A sends nothing to everyone: keys before its first frame wait for a joiner, not the line.
  const live = marks.filter((m) => m >= (aSmall[0] ?? Infinity) - 50);
  const hol2 = live.map((m) => { const t = aSmall.find((x) => x >= m); return t ? t - m : null; }).filter((x) => x !== null);
  res.aKeyLive = { p50: pct(hol2, 0.5), p95: pct(hol2, 0.95), max: pct(hol2, 1), n: hol2.length };
  res.aKeySlow = marks.map((m) => { const t = aSmall.find((x) => x >= m); return [+((m - wall0) / 1000).toFixed(1), t ? t - m : null]; }).filter(([, d]) => d === null || d > 500);
  const aLong = (await a.evaluate(() => window.__probe.long)).filter(([t]) => t >= wall0);
  res.aLong = { n: aLong.length, max: Math.max(0, ...aLong.map((x) => x[1])), sum: aLong.reduce((n, x) => n + x[1], 0) };
  const bId = await b.p.evaluate(() => window.__collab.session.me);
  res.B.firstFrame = +(((T.frames.find((f) => f.from === bId)?.t ?? 0) - b.t0) / 1000).toFixed(2);
  if (c) { const cId = await c.p.evaluate(() => window.__collab.session.me); res.C.firstFrame = +(((T.frames.find((f) => f.from === cId)?.t ?? 0) - c.t0) / 1000).toFixed(2); }
  const ids = { [aId]: 'A', [await b.p.evaluate(() => window.__collab.session.me)]: 'B', ...(c ? { [await c.p.evaluate(() => window.__collab.session.me)]: 'C' } : {}), 0: 'all' };
  const named = (ph) => Object.fromEntries(Object.entries(bytes[ph] ?? {}).map(([k, v]) => { const [f, t] = k.split('>'); return [`${ids[f] ?? f}>${ids[t] ?? t}`, +(v.b / 1048576).toFixed(2)]; }).filter(([, v]) => v > 0.01));
  res.bytesMB = { start: named('start'), join: named('join') };
  // Large frames per receiver: first and last arrival at the relay, seconds after B's goto.
  const big = {};
  for (const f of T.big ?? []) { const k = `${ids[f.from] ?? f.from}>${ids[f.to] ?? f.to}`; const x = (big[k] ??= { first: f.t, last: f.t, n: 0 }); x.last = f.t; x.n++; }
  res.bigFrames = Object.fromEntries(Object.entries(big).map(([k, v]) => [k, { first: +((v.first - b.t0) / 1000).toFixed(1), last: +((v.last - b.t0) / 1000).toFixed(1), n: v.n }]));
  res.heapMB = { A: await heap(a), B: await heap(b.p), ...(c ? { C: await heap(c.p) } : {}) };
  log('relay', JSON.stringify(res.relay), 'A key->relay', JSON.stringify(res.aKeyToRelay), 'A long', JSON.stringify(res.aLong));
  log('bytes', JSON.stringify(res.bytesMB), 'big', JSON.stringify(res.bigFrames), 'heap', JSON.stringify(res.heapMB));

  if (TYPING) {
    phase = 'typing';
    proxyRate = Infinity;
    res.typing2 = await typing(a, [b.p]);
    log('typing 2', JSON.stringify(res.typing2));
    if (c) { res.typing3 = await typing(a, [b.p, c.p]); log('typing 3', JSON.stringify(res.typing3)); }
  }
} catch (e) {
  res.error = String(e).slice(0, 300);
  log('error', res.error);
} finally {
  console.log(JSON.stringify(res));
  if (OUT) appendFileSync(OUT, JSON.stringify(res) + '\n');
  clearInterval(sampler);
  await browser.close();
  await relay.close();
  proxy.close();
  if (server) process.kill(-server.pid);
}
process.exit(0);
