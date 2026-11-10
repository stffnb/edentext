// Keystroke cost on 05-breaks repeated N times (argv, default 100,250): dispatch per key,
// split by plugin hook and listener, and the pagination after a burst and after an Enter.
// PERF_PROFILE=1 adds a CPU profile of the middle burst; Chromium only (CDP).
import { join, basename } from 'node:path';
import { ROOT, devServer, openApp, settle } from '../browser.mjs';

const PORT = +(process.env.PERF_PORT ?? 4197);
const REPEATS = (process.argv[2] ?? '100,250').split(',').map(Number);
const KEYS = +(process.env.PERF_KEYS ?? 40);
const PLACES = { start: 0.02, middle: 0.5, end: 0.98 };
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const f1 = (n) => n.toFixed(1);

// Runs in the page: every plugin hook a transaction reaches, the view update and the
// editor's listeners, each wrapped to add its time to window.__perf.acc while `on`.
function instrument() {
  const ed = document.querySelector('.tiptap-host .tiptap').editor;
  const view = ed.view;
  const P = (window.__perf = { on: false, acc: {}, fns: {} });
  // `at`: the function whose source names the hook (a plugin binds its props).
  const wrap = (k, fn, at = fn) => {
    P.fns[k] ??= at;
    return function (...a) {
      if (!P.on) return fn.apply(this, a);
      const t = performance.now();
      try { return fn.apply(this, a); } finally { P.acc[k] = (P.acc[k] ?? 0) + performance.now() - t; }
    };
  };
  // A plugin's state field binds `apply` when the configuration is built, so the field is
  // wrapped in place: reconfiguring would recreate the plugin views mid-measurement.
  for (const f of view.state.config.fields) {
    const p = view.state.plugins.find((pl) => pl.key === f.name);
    if (p) f.apply = wrap('apply ' + p.key, f.apply, p.spec.state.apply);
  }
  for (const p of view.state.plugins) {
    const s = p.spec;
    if (s.appendTransaction) s.appendTransaction = wrap('append ' + p.key, s.appendTransaction);
    if (s.filterTransaction) s.filterTransaction = wrap('filter ' + p.key, s.filterTransaction);
    if (p.props.decorations) p.props.decorations = wrap('deco ' + p.key, p.props.decorations, s.props.decorations);
  }
  const withViews = [...view.directPlugins, ...view.state.plugins].filter((p) => p.spec.view);
  view.pluginViews.forEach((pv, i) => { if (pv.update) pv.update = wrap('view ' + withViews[i].key, pv.update); });
  const S = Object.getPrototypeOf(view.state);
  S.applyTransaction = wrap('TOTAL state.applyTransaction', S.applyTransaction);
  view.updateState = wrap('TOTAL view.updateState', view.updateState);
  for (const [ev, list] of Object.entries(ed.callbacks)) {
    ed.callbacks[ev] = list.map((fn, i) => wrap(`on:${ev} #${i}`, fn));
  }
  return Object.keys(P.fns);
}

// Runs in the page: waits until no pagination pass is running or queued, bounded, since
// a pass that never reports done is a finding and not a reason to hang the run.
async function idle() {
  const view = document.querySelector('.tiptap-host .tiptap').editor.view;
  const { isPaginating } = await import('/src/lib/editor/extensions/pageBreaks.ts');
  const t = performance.now();
  while (isPaginating(view)) {
    if (performance.now() - t > 60_000) throw new Error('pagination still running after 60 s');
    await new Promise((r) => setTimeout(r, 10));
  }
  return performance.now() - t;
}

// Runs in the page: a burst of keys at one place, each its own dispatch, as typing is.
async function burst({ frac, keys, timed }) {
  const ed = document.querySelector('.tiptap-host .tiptap').editor;
  const view = ed.view;
  const doc = view.state.doc;
  let pos = Math.floor(frac * doc.content.size);
  while (pos < doc.content.size && !(doc.resolve(pos).parent.isTextblock && doc.resolve(pos).parent.content.size)) pos++;
  ed.commands.setTextSelection(doc.resolve(pos).end());
  const P = window.__perf;
  P.acc = {}; P.on = timed;
  const dispatch = [], frame = [];
  for (let i = 0; i < keys; i++) {
    const t0 = performance.now();
    view.dispatch(view.state.tr.insertText('x'));
    dispatch.push(performance.now() - t0);
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    frame.push(performance.now() - t0);
    // About 12 keys a second, well inside the pagination's pause.
    while (performance.now() - t0 < 80) await new Promise((r) => setTimeout(r, 5));
  }
  P.on = false;
  return { dispatch, frame, acc: P.acc };
}

// Runs in the page: an Enter changes the block structure, so its pass always runs.
function enter() {
  const view = document.querySelector('.tiptap-host .tiptap').editor.view;
  const t = performance.now();
  view.dispatch(view.state.tr.split(view.state.selection.from));
  return performance.now() - t;
}

// CPU samples into self time per function and per file.
function selfTimes(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000));
  const fn = new Map(), file = new Map();
  for (const [id, ms] of self) {
    const { functionName, url, lineNumber } = byId.get(id).callFrame;
    const f = (url.split('?')[0].split('/').pop() || '(native)');
    const k = `${functionName || '(anon)'} ${f}:${lineNumber + 1}`;
    fn.set(k, (fn.get(k) ?? 0) + ms);
    file.set(f, (file.get(f) ?? 0) + ms);
  }
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
  return { fn: top(fn, 30), file: top(file, 25) };
}

// The whole run has a deadline; PERF_DEADLINE_MIN, 20 by default.
const deadline = setTimeout(() => {
  console.error('deadline passed');
  try { if (server) process.kill(-server.pid); } catch { /* already gone */ }
  process.exit(2);
}, 60_000 * +(process.env.PERF_DEADLINE_MIN ?? 20));
deadline.unref();
const step = (what) => console.log(`  [${new Date().toISOString().slice(11, 19)}] ${what}`);
const server = await devServer(PORT);
const { browser, page, pageErrors } = await openApp(PORT);
try {
  const cdp = await page.context().newCDPSession(page);
  for (const n of REPEATS) {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('.tiptap-host .tiptap')?.editor);
    await page.setInputFiles('input.file-input[accept*=".odt"]', join(ROOT, 'tests/corpus/05-breaks.odt'));
    step('opening 05-breaks');
    await settle(page);
    step('building the long document');
    const info = await page.evaluate((n) => {
      const ed = document.querySelector('.tiptap-host .tiptap').editor;
      const json = ed.getJSON();
      ed.commands.setContent({ type: 'doc', content: Array.from({ length: n }, () => json.content).flat() });
      let paras = 0;
      ed.state.doc.descendants((nd) => { if (nd.isTextblock) paras++; return true; });
      return { paras };
    }, n);
    await settle(page, true);
    step('instrumenting');
    const keys = await page.evaluate(instrument);
    await settle(page, true);
    const pages = await page.evaluate(() => +/of (\d+)/.exec(document.querySelector('.statusbar').textContent)[1]);
    console.log(`\n== 05-breaks x${n}: ${pages} pages, ${info.paras} textblocks`);

    // Where each wrapped function lives, so an unnamed plugin key gets a file.
    const scripts = new Map();
    cdp.on('Debugger.scriptParsed', (e) => scripts.set(e.scriptId, e.url));
    await cdp.send('Debugger.enable');
    const where = {};
    for (const k of keys) {
      const { result } = await cdp.send('Runtime.evaluate', { expression: `window.__perf.fns[${JSON.stringify(k)}]` });
      const { internalProperties } = await cdp.send('Runtime.getProperties', { objectId: result.objectId, ownProperties: true });
      const loc = internalProperties?.find((p) => p.name === '[[FunctionLocation]]')?.value?.value;
      if (loc) where[k] = `${basename((scripts.get(loc.scriptId) ?? '?').split('?')[0])}:${loc.lineNumber + 1}`;
    }
    await cdp.send('Debugger.disable');

    const acc = {}; let timedKeys = 0, timedDispatch = 0;
    for (const [place, frac] of Object.entries(PLACES)) {
      step(`typing at the ${place}`);
      await page.evaluate(idle);
      const plain = await page.evaluate(burst, { frac, keys: KEYS, timed: false });
      plain.settleAfterBurst = await page.evaluate(idle);
      const t0 = Date.now();
      plain.enterDispatch = await page.evaluate(enter);
      await page.evaluate(idle);
      plain.settleAfterEnter = Date.now() - t0;
      await page.evaluate(idle);
      const profiling = process.env.PERF_PROFILE && place === 'middle';
      if (profiling) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start'); }
      const timed = await page.evaluate(burst, { frac, keys: KEYS, timed: true });
      if (profiling) {
        const { profile } = await cdp.send('Profiler.stop');
        const st = selfTimes(profile);
        console.log(`  profile of the ${KEYS} instrumented keys at the middle, without the pagination after them`);
        console.log('  profile, self ms by file:', st.file.map(([k, v]) => `${k} ${f1(v)}`).join(' | '));
        console.log('  profile, self ms by function:\n' + st.fn.map(([k, v]) => `    ${f1(v).padStart(7)}  ${k}`).join('\n'));
      }
      await page.evaluate(idle);
      for (const [k, v] of Object.entries(timed.acc)) acc[k] = (acc[k] ?? 0) + v;
      timedKeys += KEYS; timedDispatch += timed.dispatch.reduce((a, b) => a + b, 0);
      console.log(`  ${place.padEnd(6)} dispatch median ${f1(pct(plain.dispatch, 0.5))} p90 ${f1(pct(plain.dispatch, 0.9))} max ${f1(Math.max(...plain.dispatch))} ms`
        + ` | to next frame median ${f1(pct(plain.frame, 0.5))} | pagination after the burst ${Math.round(plain.settleAfterBurst)} ms,`
        + ` after an Enter ${Math.round(plain.settleAfterEnter)} ms (its dispatch ${f1(plain.enterDispatch)})`
        + ` | instrumented median ${f1(pct(timed.dispatch, 0.5))}`);
    }
    const per = timedDispatch / timedKeys;
    console.log(`  split of the instrumented dispatch (${f1(per)} ms a key, mean over ${timedKeys} keys):`);
    for (const [k, v] of Object.entries(acc).sort((a, b) => b[1] - a[1])) {
      if (v / timedKeys < 0.01) continue;
      console.log(`    ${f1(v / timedKeys).padStart(6)} ms ${String(Math.round((100 * v) / timedDispatch)).padStart(3)}%  ${k}${where[k] ? '  ' + where[k] : ''}`);
    }
  }
  if (pageErrors.length) console.log('page errors:', pageErrors);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser.close();
  try { if (server) process.kill(-server.pid); } catch { /* already gone */ }
}
