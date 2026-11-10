// Soak run of a shared session: clients over the real relay draw the monkey's random ops at
// once while lines drop, tabs reload and frames lag; each calm moment must find one valid,
// silent document, and each client's undo and redo stay its own (docs/architecture/collab-soak.md).
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, checker, collectErrors, devServer, openApp } from '../browser.mjs';
import { startRelay } from '../../relay/server.mjs';
import { mulberry32, pick, int, drawOp, monkeyOn } from '../monkey/ops.mjs';

const PORT = +(process.env.SOAK_PORT ?? 4394);
const RELAY_PORT = +(process.env.SOAK_RELAY_PORT ?? 4395);
process.env.RELAY_PORT = String(RELAY_PORT);
const SEED = +(process.env.SOAK_SEED ?? 1);
const CLIENTS = +(process.env.SOAK_CLIENTS ?? 4);
const ROUNDS = +(process.env.SOAK_ROUNDS ?? 4);
const OPS = +(process.env.SOAK_OPS ?? 8);
// The long run: several seeds, each a session of its own, within a time budget.
const RUNS = +(process.env.SOAK_RUNS ?? 1);
const MINUTES = +(process.env.SOAK_MINUTES ?? 0);
// By default the ops behind accepted conflicts are left out, so only new ones show (and the
// short run in test:collab stays green on them); `SOAK_SKIP=none` draws every op.
const SKIP = (process.env.SOAK_SKIP ?? 'known') === 'known';
const DOCS = process.env.SOAK_DOC ? [process.env.SOAK_DOC] : ['02-blocks.odt', '04-table.odt', '08-lists.odt', '12-notes.odt'];
const { check, failures } = checker();
const known = [];
const redrawn = [];
const refused = []; // held edits that no longer fit
const BEAT = 2000;
let lagOn = false;
const relay = await startRelay({ port: RELAY_PORT, beat: BEAT, lag: () => (lagOn ? Math.floor(Math.random() * 250) : 0) });
const server = await devServer(PORT);
const { browser, page: first } = await openApp(PORT);
const URL0 = `http://localhost:${PORT}/`;
// Each client's typing carries its own letter, so whose text is where can be counted.
const LETTERS = 'αβγδεζηθ';

// Ops behind a conflict the matrix accepts (collab-conflicts.md): deleting what another
// types in (a selection typed over, Backspace and Delete, a row, column or table).
const DELETE_OP = (op) => /^(setTextSelection|deleteRow|deleteColumn|deleteTable)$/.test(op.cmd ?? '')
  || /^(Backspace|Delete|Shift\+Arrow\w+)$/.test(op.key ?? '');
// Ops that rebuild a block as a copy: the copy is its maker's, so the typist's undo no
// longer reaches what it holds (and overlapping merges undo apart), as the matrix says.
const REBUILD_OP = (op) => (op.cmd === 'setParagraphStyle' && op.args[0] !== 'Standard' && op.args[0] !== 'Quotations')
  || /^(toggleBulletList|toggleOrderedList|sinkListItem|liftListItem|indentMore|indentLess|insertNote|setImage|insertFormula|insertTextBox|setHardBreak|insertPageBreak|mergeCells|splitCell|addRowAfter|addColumnAfter|insertTable)$/.test(op.cmd ?? '')
  || /^(Tab|Shift\+Tab|Enter)$/.test(op.key ?? '') || /\+(Shift\+[78]|Enter)$/.test(op.key ?? '');
// The columns flow rewrites a section's text outside the history, alone too (the monkey
// run leaves the history unchecked after it), so undo cannot take that text back.
const FLOW_OP = (op) => (op.cmd === 'setColumns' && op.args[0] > 1) || op.cmd === 'setColumnGap';

async function client(name, page) {
  if (!page) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'en-US', serviceWorkers: 'block' });
    page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
  }
  const c = { name, page, errors: [], log: [], history: true };
  await page.addInitScript((n) => {
    if (!localStorage.getItem('edentext-user-name')) localStorage.setItem('edentext-user-name', n);
    window.showSaveFilePicker = undefined;
    // The relay line can be cut (dialled to a dead port) or deafened (frames dropped both
    // ways). The dev server's own socket stays: the page reloads when it closes.
    const O = window.WebSocket, st = window.__line = { away: false, deaf: false, sockets: [] };
    window.WebSocket = class extends O {
      constructor(url, ...x) {
        const relay = String(url).includes('/relay');
        super(st.away && relay ? 'ws://127.0.0.1:4/' : url, ...x);
        this.relay = relay;
        if (!relay) return;
        st.sockets.push(this);
        this.addEventListener('message', (ev) => { if (st.deaf) ev.stopImmediatePropagation(); });
      }
      send(d) { if (!(st.deaf && this.relay)) super.send(d); }
    };
  }, name);
  collectErrors(page, c.errors);
  // What the dev server's client said last: a reload it orders is no finding of the app's.
  page.on('console', (m) => {
    if (/\[vite\]/.test(m.text())) c.vite = m.text().slice(0, 120);
    // The binding's fallback when it cannot restore the caret (yjsRepair.ts): counted, not
    // failed; a redraw that is not the shared doc, or content that does not fit, pauses it.
    if (/caret not restorable/.test(m.text())) redrawn.push(`${name}: ${m.text().slice(0, 160)}`);
    if (/collab: paused/.test(m.text())) check(false, `${name}: ${m.text().slice(0, 200)}`);
    if (/inside a repair not yet shared/.test(m.text())) refused.push(name);
  });
  page.on('crash', () => { c.vite = 'renderer crashed'; });
  return c;
}
const ready = (page) => page.waitForFunction(() => document.querySelector('.tiptap-host .tiptap')?.editor, null, { timeout: 30_000 });
const live = (page, timeout = 30_000) => page.waitForFunction(() => window.__collab?.view()?.status === 'live', null, { timeout });

async function start(c, doc) {
  const { page } = c;
  await page.goto(URL0, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('edentext-user-name', 'Anna'); });
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  if (doc) {
    await page.setInputFiles('input.file-input[accept*=".odt"]', join(ROOT, 'tests/corpus', doc));
    await page.waitForTimeout(2500);
  }
  await page.click('.ribbon-tab-file');
  await page.click('.ribbon [data-cmd="collab"]');
  await page.click('dialog[open] [data-cmd="collabStart"]');
  await live(page);
  const link = await page.inputValue('dialog[open] input[readonly]');
  await page.click('dialog[open] .primary');
  return link;
}
async function joinAt(c, link) {
  await c.page.goto(link, { waitUntil: 'load' });
  await ready(c.page);
  await live(c.page);
}
async function leave(c) {
  await c.page.evaluate(() => window.__collab?.session?.leave()).catch(() => {});
}

// What a calm moment compares, hashed in the page: the doc, the map of stores, the pages.
const stateOf = (c) => c.page.evaluate((letters) => {
  const ed = document.querySelector('.tiptap-host .tiptap')?.editor;
  const s = window.__collab?.session, y = s?.awareness?.doc;
  const hash = (t) => { let h = 2166136261; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619); return `${(h >>> 0).toString(36)}:${t.length}`; };
  const json = ed ? JSON.stringify(ed.state.doc.toJSON()) : '';
  const map = y ? JSON.stringify([...y.getMap('state').entries()].sort(([a], [b]) => (a < b ? -1 : 1))) : '';
  const text = (ed?.state.doc.textContent ?? '').toLowerCase();
  const tokens = [];
  ed?.state.doc.descendants((n) => { if (n.isTextblock) tokens.push(...n.textContent.toLowerCase().split(/\s+/)); return !n.isTextblock; });
  return {
    status: window.__collab?.view()?.status ?? 'none', doc: hash(json), state: hash(map),
    body: y ? hash(y.getXmlFragment('body').toString()) : '', invalid: String(ed?.state['y-sync$']?.binding?._invalidContentError ?? ''),
    pages: +(/of (\d+)/.exec(document.querySelector('.statusbar')?.textContent ?? '')?.[1] ?? 0),
    sent: s?.stats.sent[1] ?? 0, letters: [...letters].map((l) => text.split(l).length - 1),
    words: [...letters].map((l) => [...new Set(tokens.filter((w) => w.includes(l)))]),
  };
}, LETTERS);
// The schema's check, and every table rectangular (rowspans counted).
const validity = (c) => c.page.evaluate(() => {
  const ed = document.querySelector('.tiptap-host .tiptap').editor;
  try { ed.state.doc.check(); } catch (e) { return `schema: ${String(e).slice(0, 200)}`; }
  let bad = null;
  ed.state.doc.descendants((t, pos) => {
    if (bad || t.type.spec.tableRole !== 'table') return !bad;
    const grid = [];
    t.forEach((row, _, ri) => row.forEach((cell) => {
      grid[ri] ??= [];
      let col = 0;
      while (grid[ri][col]) col++;
      for (let k = 0; k < (cell.attrs.rowspan ?? 1); k++) for (let j = 0; j < (cell.attrs.colspan ?? 1); j++) (grid[ri + k] ??= [])[col + j] = true;
    }));
    const widths = grid.map((r) => r.length);
    if (grid.length !== t.childCount || widths.some((w, i) => w !== widths[0] || grid[i].includes(undefined))) bad = `table at ${pos} not rectangular (${widths})`;
    return false;
  });
  return bad;
});
const docJson = (c) => c.page.evaluate(() => JSON.stringify(document.querySelector('.tiptap-host .tiptap').editor.getJSON()));

// A finding, classified: a known conflict is logged and the run goes on, a new one fails it.
function report(kind, detail, ctx = {}) {
  const ops = ctx.ops ?? [];
  const why = /threw/.test(detail) ? null
    : kind === 'undo' && ops.some(FLOW_OP) ? 'undo after the columns flow rewrote text'
    : kind === 'undo' && ops.some((op) => REBUILD_OP(op) || DELETE_OP(op)) ? 'undo after a block copied by another client or deleted'
    : kind === 'lost' && ops.some(DELETE_OP) ? 'text typed into what another deleted'
    : kind === 'copied' && ops.some((op) => REBUILD_OP(op) || DELETE_OP(op)) ? 'undo and redo after two rebuilds of one block'
    : null;
  if (why) { known.push(`${kind}: ${why}`); console.log(`  known (${why}): ${kind} — ${detail.slice(0, 200)}`); }
  else check(false, `seed ${seed}, round ${roundNo}: ${kind} — ${detail}`);
  return !why;
}

// Waits until every client is live, all hold the same doc, stores and pages, and nobody
// has sent an update for a second. Then the session must stay silent for three seconds.
async function calm(cs, ops) {
  lagOn = false;
  // A deaf line is given back only once its client noticed: frames lost on a line that
  // stays up are not something a real connection does.
  for (const c of cs) await c.page.evaluate(() => Promise.resolve(window.__line.deaf && new Promise((done) => {
    const t = setInterval(() => { if (window.__collab.view().status !== 'live') { clearInterval(t); done(); } }, 100);
    setTimeout(() => { clearInterval(t); done(); }, 20_000);
  })).then(() => { window.__line.away = false; window.__line.deaf = false; }));
  const t0 = Date.now();
  let states = [], since = Date.now(), last = '';
  while (Date.now() - t0 < 60_000) {
    states = await Promise.all(cs.map(stateOf));
    const key = JSON.stringify(states);
    if (key !== last) { last = key; since = Date.now(); }
    const one = (k) => states.every((s) => s[k] === states[0][k]);
    if (states.every((s) => s.status === 'live') && one('doc') && one('state') && one('pages') && Date.now() - since > 1000) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  const one = (k) => states.every((s) => s[k] === states[0][k]);
  const desc = cs.map((c, i) => `${c.name} ${states[i].status} ${states[i].doc} ${states[i].pages}p`).join(', ');
  if (!states.every((s) => s.status === 'live')) return report('offline', `not every client live after 60 s: ${desc}`, { ops }) || 'reset';
  if (!one('doc') || !one('state')) {
    const [a, b] = [await docJson(cs[0]), await docJson(cs[states.findIndex((s) => s.doc !== states[0].doc || s.state !== states[0].state)])];
    const diff = await cs[0].page.evaluate(async ([a, b]) => (await import('/tests/normalize.ts')).firstDiff(JSON.parse(a), JSON.parse(b)), [a, b]);
    await writeFile(join(tmpdir(), `soak-${seed}-${roundNo}-diverged.json`), JSON.stringify({ a: JSON.parse(a), b: JSON.parse(b) }));
    const why = `${one('body') ? 'same Yjs body' : 'Yjs bodies differ'}${states.some((x) => x.invalid) ? `, invalid content: ${states.map((x) => x.invalid).join('|')}` : ''}`;
    report('diverged', `${desc} (${why}): ${one('doc') ? 'stores differ' : diff}`, { ops });
    return 'reset';
  }
  if (!one('pages')) report('pages', desc, { ops });
  const sent = states.map((s) => s.sent);
  await new Promise((r) => setTimeout(r, 3000));
  const after = (await Promise.all(cs.map(stateOf))).map((s) => s.sent);
  if (after.join() !== sent.join()) { report('loud', `updates while idle ${sent} → ${after}`, { ops }); return 'reset'; }
  for (const c of cs) {
    const bad = await validity(c);
    if (bad) report('invalid', `${c.name}: ${bad}`, { ops });
  }
  for (const c of cs) if (c.errors.length) { report('uncaught', `${c.name}: ${c.errors.splice(0).join(' | ')}`, { ops }); }
  return states[0];
}

// One client's ops for a round, the way the monkey run does them.
async function play(c, r, n, ops) {
  const m = monkeyOn(c.page);
  const letter = LETTERS[c.index];
  for (let i = 0; i < n; i++) {
    const size = await c.page.evaluate(() => document.querySelector('.tiptap-host .tiptap').editor.state.doc.content.size).catch(() => 0);
    let op = drawOp(r, size);
    while (SKIP && (DELETE_OP(op) || FLOW_OP(op))) op = drawOp(r, size);
    if (op.type) op = { type: op.type + letter };
    c.log.push(op);
    ops.push(op);
    try {
      if (op.type || op.key) {
        await c.page.evaluate(() => document.querySelector('.tiptap-host .tiptap').editor.commands.focus());
        if (op.type) await c.page.keyboard.type(op.type, { delay: 15 });
        else await c.page.keyboard.press(op.key);
      } else {
        const res = await m.runCmd(op);
        if (res.threw) report('threw', `${c.name}: ${op.cmd} ${res.threw.slice(0, 300)}`, { ops: c.log });
      }
    } catch (err) {
      // An editor gone from under the ops is a finding of its own; it has to come back.
      if (!/Execution context was destroyed|Target closed|closed|reading 'editor'/.test(String(err))) throw err;
      const what = await c.page.evaluate(() => `${location.hash ? 'link' : 'no link'}, ${document.querySelector('dialog[open]')?.textContent?.trim().slice(0, 120) ?? 'no dialog'}, ${window.__collab?.view()?.status}`).catch((e) => String(e).slice(0, 80));
      report('gone', `${c.name}'s editor went away during ${JSON.stringify(op).slice(0, 80)} (${what}; vite: ${c.vite ?? '–'})`, { ops });
      await ready(c.page).catch(() => {});
    }
    await c.page.waitForTimeout(int(r, 20, 250));
  }
}

// Something happening to one client between two rounds; it keeps editing in the next.
async function disrupt(cs, r, link) {
  const x = r(), joiners = cs.slice(1);
  const c = pick(r, joiners);
  if (x < 0.2) {
    lagOn = true;
    return 'frames delayed 0–250 ms';
  }
  if (x < 0.35) {
    const ms = int(r, 2000, 5000);
    await c.page.evaluate((ms) => {
      window.__line.away = true;
      for (const s of window.__line.sockets) s.close();
      setTimeout(() => { window.__line.away = false; }, ms);
    }, ms);
    return `${c.name} offline ${ms} ms`;
  }
  if (x < 0.45) {
    // A line that dies without a close; it is given back once the client noticed.
    await c.page.evaluate(() => { window.__line.deaf = true; });
    c.page.waitForFunction(() => window.__collab.view().status !== 'live', null, { timeout: 20_000, polling: 200 })
      .catch(() => {}).then(() => c.page.evaluate(() => { window.__line.deaf = false; }).catch(() => {}));
    return `${c.name} deaf until it notices`;
  }
  if (x < 0.55) {
    await c.page.reload({ waitUntil: 'load' });
    await ready(c.page);
    await live(c.page).catch(() => {});
    c.history = false;
    return `${c.name} reloaded`;
  }
  if (x < 0.62) {
    await leave(c);
    await c.page.context().close();
    const fresh = await client(`${c.name}'`);
    Object.assign(c, { page: fresh.page, errors: fresh.errors, log: [], history: true, name: fresh.name });
    await joinAt(c, link);
    c.base = (await stateOf(c)).letters[c.index];
    return `${c.name} came in for one who left`;
  }
  return null;
}

// Everyone leaves; the starter shares its document again and the others join it.
async function restart(cs) {
  for (const c of cs) await leave(c);
  for (const c of cs.slice(1)) { await c.page.context().close(); }
  const link = await start(cs[0], null);
  for (let i = 1; i < cs.length; i++) {
    const fresh = await client(`${LETTERS[i]}${roundNo}`);
    Object.assign(cs[i], { page: fresh.page, errors: fresh.errors, log: [], history: true });
    await joinAt(cs[i], link);
  }
  cs[0].log = [];
  for (const c of cs) c.base = (await stateOf(c)).letters[c.index];
  return link;
}

let seed = SEED, roundNo = 0, rounds = 0, opsDone = 0;
const t0 = Date.now();
try {
  const anna = await client('Anna', first);
  for (let run = 0; run < RUNS && (!MINUTES || Date.now() - t0 < MINUTES * 60_000); run++) {
    seed = SEED + run;
    const doc = DOCS[(seed - 1) % DOCS.length];
    const cs = [Object.assign(anna, { log: [], history: true })];
    for (let i = 1; i < CLIENTS; i++) cs.push(await client(['Ben', 'Cleo', 'Dan', 'Ella', 'Finn', 'Gus', 'Hal'][i - 1]));
    cs.forEach((c, i) => { c.index = i; });
    let link = await start(cs[0], doc);
    for (const c of cs.slice(1)) await joinAt(c, link);
    for (const c of cs) c.base = (await stateOf(c)).letters[c.index];
    const rs = cs.map((_, i) => mulberry32(seed * 1000 + i)), rd = mulberry32(seed * 1000 + 999);
    for (roundNo = 1; roundNo <= ROUNDS && (!MINUTES || Date.now() - t0 < MINUTES * 60_000); roundNo++) {
      const what = roundNo > 1 ? await disrupt(cs, rd, link) : null;
      const ops = [];
      await Promise.all(cs.map((c, i) => play(c, rs[i], OPS, ops)));
      opsDone += ops.length;
      rounds++;
      const st = await calm(cs, ops);
      console.log(`seed ${seed} on ${doc}, round ${roundNo}${what ? ` (${what})` : ''}: ${ops.length} ops, ${st === 'reset' ? 'session restarted' : `${st.pages} pages, letters ${st.letters}`}`);
      if (st === 'reset') {
        await writeFile(join(tmpdir(), `soak-${seed}-${roundNo}-ops.json`), JSON.stringify(cs.map((c) => ({ name: c.name, log: c.log }))));
        link = await restart(cs);
        await calm(cs, []);
      }
    }

    // The starter's file reads back as held.
    const m = monkeyOn(cs[0].page);
    const rt = await m.roundTrip(await m.saveAs('odt'), 'odt').catch((e) => ({ diff: `threw: ${e.message.split('\n')[0]}`, warnings: [] }));
    const bad = rt.diff ?? (rt.warnings.length ? `warnings: ${rt.warnings.join(' | ')}` : null);
    check(!bad, `seed ${seed}: the starter's .odt reads back${bad ? ` — ${bad}` : ''}`);

    // Each client in turn undoes all its steps and redoes them: the others' text stays,
    // and everyone ends where it started.
    for (const c of cs) {
      const before = await calm(cs, c.log);
      if (before === 'reset') break;
      const d0 = await docJson(cs[0]);
      const n = await c.page.evaluate(() => {
        const ed = document.querySelector('.tiptap-host .tiptap').editor;
        let n = 0;
        try { while (n < 800 && ed.can().undo()) { ed.commands.undo(); n++; } } catch (e) { return `undo threw: ${String(e.stack ?? e).split('\n').slice(0, 6).join(' / ').slice(0, 700)}`; }
        return n;
      });
      if (typeof n === 'string') { report('undo', `${c.name}: ${n}`, { ops: c.log }); continue; }
      const undone = await calm(cs, c.log);
      if (undone === 'reset') break;
      // Lost: fewer of another's letters and a word of its gone; fewer copies of a word are not.
      const gone = before.words.flatMap((ws, i) => (i === c.index || undone.letters[i] >= before.letters[i] ? [] : ws.filter((w) => !undone.words[i].includes(w))));
      if (gone.length) report('lost', `${c.name}'s ${n} undos took others' text: ${gone.slice(0, 4).join(' ')}, letters ${before.letters} → ${undone.letters}`, { ops: cs.flatMap((x) => x.log) });
      if (c.history && undone.letters[c.index] > c.base) report('undo', `${c.name}'s ${n} undos leave ${undone.letters[c.index] - c.base} of its letters`, { ops: cs.flatMap((x) => x.log) });
      await c.page.evaluate((n) => { const ed = document.querySelector('.tiptap-host .tiptap').editor; for (let i = 0; i < n; i++) ed.commands.redo(); }, n);
      const redone = await calm(cs, c.log);
      if (redone === 'reset') break;
      // Copies of others' text change the document too: one finding, `copied`, with the diff.
      const copied = before.letters.some((k, i) => i !== c.index && redone.letters[i] > k);
      const d1 = await docJson(cs[0]);
      const diff = d1 === d0 ? '' : await cs[0].page.evaluate(async ([a, b]) => (await import('/tests/normalize.ts')).firstDiff(JSON.parse(a), JSON.parse(b)), [d0, d1]);
      if (copied) report('copied', `${c.name}'s undos and redos copied others' text: letters ${before.letters} → ${undone.letters} → ${redone.letters}; ${diff}`, { ops: cs.flatMap((x) => x.log) });
      else if (diff) report('undo', `${c.name}'s ${n} redos do not give the document back: ${diff}`, { ops: c.log });
      else console.log(`  ${c.name}: ${n} undos and redos, letters ${before.letters} → ${undone.letters} → ${redone.letters}`);
    }
    for (const c of cs) await leave(c);
    for (const c of cs.slice(1)) await c.page.context().close();
  }
  check(true, `${rounds} rounds, ${opsDone} ops on ${CLIENTS} clients in ${Math.round((Date.now() - t0) / 1000)} s; ${known.length} known conflicts`);
} catch (err) {
  check(false, `soak run threw (seed ${seed}, round ${roundNo}): ${err.stack ?? err}`);
} finally {
  if (redrawn.length) console.log(`redrawn after a caret not restorable: ${redrawn.length} (${redrawn[0]})`);
  if (refused.length) console.log(`held edits lost inside a repair not yet shared: ${refused.length}`);
  if (known.length) console.log(`known: ${[...new Set(known)].map((k) => `${k} ×${known.filter((x) => x === k).length}`).join('; ')}`);
  await browser.close();
  await relay.close();
  if (server) process.kill(-server.pid);
}
process.exit(failures.length ? 1 : 0);
