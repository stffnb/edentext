// Monkey run: random editing in the real browser under the invariants any sequence of
// commands must keep — no uncaught error, a document its schema accepts, undo back to the
// opened file and redo forward, and a saved file that validates and reads back as held.
// A second pass edits text with recording on: rejecting all gives the opened file back.
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { JSDOM } from 'jsdom';
import { ROOT, MOD, checker, devServer, openApp } from '../browser.mjs';
import { hasXmllint, validateOdt, validateDocx } from '../schemaValidate.ts';
import { PNG, WORDS, mulberry32, pick, int, drawOp, monkeyOn } from './ops.mjs';

// The schema helper strips foreign markup with the browser's DOM parser.
Object.assign(globalThis, (({ DOMParser, XMLSerializer }) => ({ DOMParser, XMLSerializer }))(new JSDOM('').window));

const PORT = +(process.env.MONKEY_PORT ?? 4189);
// UNDO=yjs runs the body's undo on Yjs (src/lib/editor/undoYjs.ts) instead of its history.
const QUERY = process.env.UNDO === 'yjs' ? '?undo=yjs' : '';
const SEED = +(process.env.MONKEY_SEED ?? 1);
const RUNS = +(process.env.MONKEY_RUNS ?? 3);
const OPS = +(process.env.MONKEY_OPS ?? 60);
const HF_OPS = +(process.env.MONKEY_HF_OPS ?? 8);
const DOCS = process.env.MONKEY_DOC ? [process.env.MONKEY_DOC] : ['02-blocks.odt', '16-hf-variants.odt', '04-table.odt', '08-lists.odt', '12-notes.odt', '15-chapters.odt'];
const { check, failures } = checker();
if (!hasXmllint) console.log('xmllint missing: the saved files are not validated against the schemas');

// What recording covers so far, drawn by the recording pass.
const RECORDED_KEYS = ['Enter', 'Enter', 'Backspace', 'Backspace', 'Backspace', 'Delete', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Shift+ArrowLeft', 'Shift+ArrowRight', 'Shift+ArrowDown', 'Shift+ArrowUp', 'Home', 'End'];
const drawRecorded = (r, size) => {
  const x = r();
  if (x < 0.3) return { type: pick(r, WORDS) };
  if (x < 0.8) return { key: pick(r, RECORDED_KEYS) };
  if (x < 0.85) return { cmd: 'focus', args: [int(r, 1, Math.max(1, size - 2))] };
  if (x < 0.88) return { drop: [r(), r(), r()] };
  if (x < 0.92) return { cells: [r(), r(), r()] };
  return pick(r, [{ cmd: 'toggleBold' }, { cmd: 'toggleItalic' }, { cmd: 'setFontSize', args: ['18pt'] }, { cmd: 'setTextAlign', args: ['center'] },
    { cmd: 'toggleBulletList' }, { cmd: 'toggleOrderedList' }, { cmd: 'sinkListItem', args: ['listItem'] }, { cmd: 'liftListItem', args: ['listItem'] },
    { cmd: 'setParagraphStyle', args: ['Heading 2'] }, { cmd: 'insertNote', args: ['footnote'] }, { cmd: 'insertTextBox' }, { cmd: 'addRowAfter' }, { cmd: 'addColumnBefore' }, { cmd: 'deleteRow' }, { cmd: 'deleteColumn' }, { cmd: 'deleteTable' },
    { cmd: 'insertTable', args: [{ rows: 2, cols: 2, withHeaderRow: false }] }, { cmd: 'moveChapter', args: [0, 1] }, { cmd: 'moveChapter', args: [0, -1] }]);
};

// The zone's own schema — one paragraph of runs, breaks, fields and inline images — so it
// draws from a table of its own. No Escape (that leaves), no undo: a pass falls into one
// history group, so one Mod+Z would empty the zone before the round trip ever sees it.
const HF_KEYS = ['Enter', 'Backspace', 'Backspace', 'Delete', 'Tab', 'Home', 'End',
  'ArrowLeft', 'ArrowRight', 'Shift+ArrowLeft', 'Shift+ArrowRight', `${MOD}+b`, `${MOD}+i`, `${MOD}+u`];
const HF_OPS_TABLE = [
  [14, (r) => ({ type: pick(r, WORDS) })],
  [12, (r) => ({ key: pick(r, HF_KEYS) })],
  // The insert bar's three field buttons, in its order: page number, count, chapter.
  [5, (r) => ({ field: int(r, 0, 2) })],
  [9, (r) => pick(r, [
    { cmd: 'toggleBold' }, { cmd: 'toggleItalic' }, { cmd: 'toggleUnderline' }, { cmd: 'toggleStrike' },
    { cmd: 'unsetAllMarks' }, { cmd: 'setTextAlign', args: [pick(r, ['left', 'center', 'right'])] },
    { cmd: 'setFontSize', args: ['10pt'] }, { cmd: 'setColor', args: ['#c00000'] },
    { cmd: 'setImage', args: [{ src: PNG, width: 24, height: 18 }] },
  ])],
];
const HF_TOTAL = HF_OPS_TABLE.reduce((n, [w]) => n + w, 0);
const drawHfOp = (r) => {
  let x = r() * HF_TOTAL;
  for (const [w, draw] of HF_OPS_TABLE) { if ((x -= w) < 0) return draw(r); }
  return { key: 'ArrowRight' };
};

// A few cells of a table selected, then cleared or their rows or columns deleted. Merged
// cells are regrouped unrecorded, so rejecting all could not give the file back.
async function overCells([a, b, c]) {
  const picked = await ed(async ({ a, b }) => {
    const { cells } = await import('/tests/trackChangesCases.ts');
    const editor = document.querySelector('.tiptap-host .tiptap').editor, at = [];
    editor.state.doc.descendants((n, pos) => { if (n.type.spec.tableRole === 'cell') at.push(pos); });
    if (at.length < 2) return false;
    const i = Math.floor(a * (at.length - 1)), j = Math.min(at.length - 1, i + 1 + Math.floor(b * 3));
    const table = (pos) => { const $at = editor.state.doc.resolve(pos); return $at.node($at.depth - 1); };
    if (table(at[i]) !== table(at[j])) return false;
    cells(i, j)(editor);
    return true;
  }, { a, b });
  if (!picked) return;
  if (c < 0.4) await press('Delete');
  else await runCmd({ cmd: c < 0.7 ? 'deleteColumn' : 'deleteRow' });
}

const server = await devServer(PORT);
const { browser, page, pageErrors } = await openApp(PORT);
// Across every reload: without a picker the save ends in a download, which the run reads.
await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
const consoleErrors = [];
let lostBefore = false;
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

const ed = (fn, arg) => page.evaluate(fn, arg);
const { runCmd, docCheck, saveAs, roundTrip } = monkeyOn(page);
// ProseMirror reads a caret the browser moved from the next selectionchange; a key sent
// before that acts on the old caret, which no typist is fast enough to do.
const press = async (key) => { await page.keyboard.press(key); await ed(() => new Promise(requestAnimationFrame)); };
const focused = async () => {
  const err = await ed(() => { try { document.querySelector('.tiptap-host .tiptap').editor.commands.focus(); return null; } catch (e) { return String(e); } });
  await page.waitForFunction(() => document.activeElement === document.querySelector('.tiptap-host .tiptap'), null, { timeout: 2000 }).catch(() => {});
  return err;
};
// What a drop of a selection does: ProseMirror reads where it lands from the event and
// what moves from `view.dragging`. Fractions of the document, snapped to text.
const dropText = ([a, b, c]) => ed(([a, b, c]) => {
  const { view, state } = document.querySelector('.tiptap-host .tiptap').editor;
  const at = (f) => {
    const size = state.doc.content.size;
    for (let n = Math.floor(f * size); n <= size; n++) if (state.doc.resolve(n).parent.inlineContent) return n;
    return null;
  };
  const [from, to] = [at(Math.min(a, b)), at(Math.max(a, b))], target = at(c);
  if (from == null || to == null || target == null || from === to || (target >= from && target <= to)) return;
  document.querySelector('.tiptap-host .tiptap').editor.commands.setTextSelection({ from, to });
  view.dragging = { slice: view.state.selection.content(), move: true };
  const { left, top } = view.coordsAtPos(target);
  const dataTransfer = new DataTransfer();
  dataTransfer.setData('text/plain', view.state.doc.textBetween(from, to, '\n'));
  view.dom.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: left, clientY: top + 1, dataTransfer }));
}, [a, b, c]);
const docJson = () => ed(() => JSON.stringify(document.querySelector('.tiptap-host .tiptap').editor.getJSON()));
// The key the history is held against, and the count of the columns flow's own rewrites:
// the flow changes the document outside the history (`FLOW_TX`, columnsFlow.ts), so undo
// rebases over it — ponytail: such a run has its history left unchecked.
const watchFlow = () => ed(async () => {
  const { mergeJoinedParagraphsJson } = await import('/src/lib/export/odt.ts');
  // The caches the editor recomputes off the history — a note's label, an index's rows, a
  // caption's number, a reference's text — plus a paragraph columnsFlow split at a page
  // boundary: layout and derived values, not the edits undo has to reverse.
  const DERIVED = { noteRef: 'text', note: 'text', chapterField: 'text', crossRef: 'text',
    bibliographyEntry: 'text', sequenceField: 'number', tableOfContents: 'entries' };
  const strip = (n) => {
    if (n.attrs && DERIVED[n.type]) n.attrs = { ...n.attrs, [DERIVED[n.type]]: null };
    for (const c of n.content ?? []) strip(c);
    return n;
  };
  window.__docKey = () => JSON.stringify(
    mergeJoinedParagraphsJson(strip(document.querySelector('.tiptap-host .tiptap').editor.getJSON()).content ?? []));
  const view = document.querySelector('.tiptap-host .tiptap').editor.view;
  window.__flowTx = 0;
  if (view.__flowWatched) return;
  view.__flowWatched = true;
  const dispatch = view.dispatch.bind(view);
  view.dispatch = (tr) => {
    if (tr.docChanged && tr.getMeta('columnsFlowTx')) window.__flowTx++;
    return dispatch(tr);
  };
});
const docKey = () => ed(() => window.__docKey());
const docSize = () => ed(() => document.querySelector('.tiptap-host .tiptap').editor.state.doc.content.size);

const HF_LIVE = '.hf-active .tiptap';
const hfCmd = (op) => ed(({ cmd, args }) => {
  const editor = document.querySelector('.hf-active .tiptap')?.editor;
  if (!editor) return { threw: 'the zone editor is gone' };
  try { return { ok: editor.commands[cmd](...(args ?? [])) }; } catch (e) { return { threw: String(e?.stack ?? e) }; }
}, op);
const hfCheck = () => ed(() => {
  const editor = document.querySelector('.hf-active .tiptap')?.editor;
  if (!editor) return 'the zone editor is gone';
  try { editor.state.doc.check(); return null; } catch (e) { return String(e); }
});

// A floating toolbar of the body's — a selected frame's, say — can sit over the zone
// and its bar; the handler behind the element is what this run is after, not hit-testing.
const clickish = (at, how = 'click') => at[how]({ timeout: 4000 })
  .catch(() => at.dispatchEvent(how, {}, { timeout: 4000 }))
  .catch(() => false); // gone already (an op closed the zone): the checks after it still speak

// A checkbox in the ribbon's own menu: the menu re-renders under the click (the flag
// ends an open zone edit), so a real click can find the element detached.
const setBox = (at, on) => at.setChecked(on, { timeout: 4000 })
  .catch(() => at.evaluate((el, v) => { if (el.checked !== v) el.click(); }, on));

// The two variant flags and the zone distances, from the ribbon's Insert tab. Setting
// them here is what puts the first-page and even-page zones in play on a document that
// carries none of its own.
async function setHfOptions(r) {
  await page.locator('.ribbon-tab', { hasText: 'Insert' }).first().click();
  const options = page.locator('button.rb', { hasText: 'Options' }).first();
  await clickish(options);
  await page.waitForSelector('.ribbon-menu .check-row input', { timeout: 5000 });
  const boxes = page.locator('.ribbon-menu .check-row input');
  for (const i of [0, 1]) await setBox(boxes.nth(i), r() < 0.6);
  if (r() < 0.4) {
    const dist = page.locator('.ribbon-menu .num-row input').nth(int(r, 0, 1));
    await dist.fill(String(pick(r, [0.6, 1, 1.8])));
    await dist.dispatchEvent('change');
  }
  await clickish(options);
}

// Flipping a flag keeps the zone open and swaps the live editor to the variant the
// page now shows, mid-session — what was typed must be in the zones anyway.
async function flipUnderEdit(mark) {
  const zone = page.locator('.hf-zone.hf-footer').first();
  if (!(await zone.count())) return null;
  await clickish(zone, 'dblclick');
  await page.waitForSelector(HF_LIVE, { timeout: 5000 });
  await page.waitForFunction(() => document.activeElement?.closest?.('.hf-active'), null, { timeout: 2000 }).catch(() => {});
  await page.keyboard.type(mark);
  await page.locator('.ribbon-tab', { hasText: 'Insert' }).first().click();
  const options = page.locator('button.rb', { hasText: 'Options' }).first();
  await clickish(options);
  const box = page.locator('.ribbon-menu .check-row input').nth(1);
  await setBox(box, !(await box.isChecked()));
  await clickish(options);
  const open = await page.waitForSelector(HF_LIVE, { timeout: 5000 }).then(() => true, () => false);
  await clickish(page.locator('.hf-bar-done'));
  await page.waitForSelector('.hf-active', { state: 'detached', timeout: 5000 }).catch(() => {});
  const kept = await ed((m) => ['edentext-header', 'edentext-footer', 'edentext-header-first',
    'edentext-footer-first', 'edentext-header-even', 'edentext-footer-even', 'edentext-hf-sections']
    .some((k) => (localStorage.getItem(k) ?? '').includes(m)), mark);
  if (!open) return 'the flag closed the zone editor';
  return kept ? null : 'the text typed before the flag flipped is in no zone';
}

// A zone edited the way a user reaches it: double-click in, edit, leave by Done. Pages
// 1 to 3 in turn — with the two variant flags on that is one session per variant, the
// title page's, an even page's and a running one's. Only the round trip reports on it.
async function editZone(r, zone, pages = 3) {
  const zones = page.locator(`.hf-zone.hf-${zone}`);
  const n = await zones.count();
  if (!n) return { ops: [], broken: `no ${zone} zone on the page` };
  const ops = [];
  let broken = null;
  for (let p = 0; p < Math.min(pages, n) && !broken; p++) {
    await clickish(zones.nth(p), 'dblclick');
    await page.waitForSelector(HF_LIVE, { timeout: 5000 });
    // The mount focuses itself a tick later; typing before that loses its first keys.
    await page.waitForFunction(() => document.activeElement?.closest?.('.hf-active'), null, { timeout: 2000 }).catch(() => {});
    for (let i = 0; i < HF_OPS && !broken; i++) {
      const op = { page: p + 1, ...drawHfOp(r) };
      ops.push(op);
      if (op.type) await page.keyboard.type(op.type);
      else if (op.key) await press(op.key);
      else if (op.field !== undefined) await clickish(page.locator('.hf-bar-btn').nth(op.field));
      else {
        const res = await hfCmd(op);
        if (res.threw) broken = `${op.cmd} threw: ${res.threw}`;
      }
      const invalid = broken ? null : await hfCheck();
      if (invalid) broken = `schema-invalid ${zone} on page ${p + 1}: ${invalid}`;
      if (pageErrors.length) broken = `uncaught: ${pageErrors.join(' | ')}`;
    }
    await clickish(page.locator('.hf-bar-done'));
    await page.waitForSelector('.hf-active', { state: 'detached', timeout: 5000 }).catch(() => {});
  }
  return { ops, broken };
}

// The zones the review reaches without an editor, against which recording in one is held.
const zoneKeys = () => ed(async () => {
  const { loadHfDoc } = await import('/src/lib/storage/headerFooter.ts');
  return JSON.stringify(['header', 'footer'].map((z) => loadHfDoc(z)));
});


try {
  await page.goto(`http://localhost:${PORT}/${QUERY}`, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap-host .tiptap', { timeout: 30_000 });

  const retried = new Set();
  for (let run = 0; run < RUNS; run++) {
    try {
      const seed = SEED + run;
      const doc = DOCS[run % DOCS.length];
      const r = mulberry32(seed);
      const before = await docJson();
      await page.setInputFiles('input.file-input[accept*=".odt"]', join(ROOT, 'tests/corpus', doc));
      await page.waitForFunction((b) => JSON.stringify(document.querySelector('.tiptap-host .tiptap').editor.getJSON()) !== b, before, { timeout: 30_000 });
      await page.waitForTimeout(1500);
      const log = [];
      let broken = null;

      // Both zones, before the body ops: they can cut the document to a single page,
      // and pages 1 to 3 are what the two variant flags spread the six zones over.
      await setHfOptions(r);
      for (const zone of ['header', 'footer']) {
        const pass = await editZone(r, zone);
        await writeFile(join(tmpdir(), `monkey-${seed}-${zone}.json`), JSON.stringify(pass.ops));
        check(!pass.broken, `seed ${seed}: ${pass.ops.length} ops in the ${zone}${pass.broken ? ` — ${pass.broken}` : ''}`);
        if (pass.broken) { broken = pass.broken; break; }
      }
      if (broken) break;
      const flipped = await flipUnderEdit(`zap${seed}`);
      check(!flipped, `seed ${seed}: a flag flipped under an open zone${flipped ? ` — ${flipped}` : ''}`);
      if (flipped) { broken = flipped; break; }
      await watchFlow();
      const initial = await docKey();
      for (let i = 0; i < OPS && !broken; i++) {
        const op = drawOp(r, await docSize());
        log.push(op);
        if (op.type || op.key) {
          const err = await focused();
          if (err) broken = `focus threw: ${err}`;
          else if (op.type) await page.keyboard.type(op.type);
          else await press(op.key);
        } else {
          const res = await runCmd(op);
          if (res.threw) broken = `${op.cmd} threw: ${res.threw}`;
        }
        const invalid = await docCheck();
        if (invalid) broken = `schema-invalid document: ${invalid}`;
        if (pageErrors.length) broken = `uncaught: ${pageErrors.join(' | ')}`;
      }
      const final = await docKey();
      await writeFile(join(tmpdir(), `monkey-${seed}-ops.json`), JSON.stringify(log));
      // Undo until the opened document is back, redo as often, and the edited one is back.
      const undone = broken ? -1 : await ed(async (initial) => {
        const { firstDiff } = await import('/tests/normalize.ts');
        const editor = document.querySelector('.tiptap-host .tiptap').editor;
        for (let n = 0; n < 500; n++) {
          if (window.__docKey() === initial) return n;
          if (!editor.can().undo()) return `undo stops at ${firstDiff({ type: 'doc', content: JSON.parse(initial) }, { type: 'doc', content: JSON.parse(window.__docKey()) })}`;
          try { editor.commands.undo(); } catch (e) { return `undo threw: ${String(e).slice(0, 300)}`; }
        }
        return -1;
      }, initial);
      const redone = typeof undone !== 'number' || undone < 0 ? null : await ed((n) => {
        const editor = document.querySelector('.tiptap-host .tiptap').editor;
        for (let i = 0; i < n; i++) editor.commands.redo();
        return window.__docKey();
      }, undone);
      const flowed = await ed(() => window.__flowTx ?? 0);
      const history = broken ?? (flowed ? null : typeof undone === 'string' ? undone : undone < 0 ? 'undo does not reach the opened document'
        : redone !== final ? `redo does not restore the edited document: ${await ed(async ([a, b]) => (await import('/tests/normalize.ts')).firstDiff({ type: 'doc', content: JSON.parse(a) }, { type: 'doc', content: JSON.parse(b) }), [final, redone])}` : null);
      const label = `seed ${seed} on ${doc}: ${log.length} ops, `
        + (flowed ? `the columns flow rewrote the document ${flowed}× — history not checked` : `${undone} undo steps`);
      check(!history, history ? `${label} — ${history}` : label);
      if (history) for (const op of log.slice(-12)) console.log('    ', JSON.stringify(op));
      if (broken) break;

      for (const ext of ['odt', 'docx']) {
        const bytes = await saveAs(ext);
        const schema = hasXmllint ? (ext === 'odt' ? validateOdt : validateDocx)(unzipSync(bytes)) : [];
        const rt = await roundTrip(bytes, ext).catch((err) => ({ diff: null, warnings: [], threw: String(err.message ?? err).split('\n')[0] }));
        const bad = rt.threw ? `import threw: ${rt.threw}` : schema.length ? `schema: ${schema[0].slice(0, 300)}`
          : rt.diff ? `round trip: ${rt.diff}` : rt.hfDiff ? `header/footer: ${rt.hfDiff}`
          : rt.warnings.length ? `warnings: ${rt.warnings.join(' | ')}` : null;
        check(!bad, `seed ${seed}: the saved .${ext} validates and reads back${bad ? ` — ${bad}` : ''}`);
        if (bad) {
          // The file and both documents, for the repro.
          const stem = join(tmpdir(), `monkey-${seed}`);
          await writeFile(`${stem}.${ext}`, bytes);
          if (rt.held) await Promise.all([writeFile(`${stem}-${ext}-held.json`, rt.held), writeFile(`${stem}-${ext}-read.json`, rt.read)]);
          if (rt.hfDiff) await Promise.all([writeFile(`${stem}-${ext}-hf-held.json`, rt.hfHeld), writeFile(`${stem}-${ext}-hf-read.json`, rt.hfRead)]);
          console.log(`    kept: ${stem}.${ext}`);
        }
      }
    } catch (err) {
      // The app reloading under the run (its own recovery prompt, a settings write)
      // tears the page context down mid-op — either message says so; one more go, then
      // it is a finding.
      if (!/Execution context was destroyed|promise was garbage collected/.test(err.message) || retried.has(run)) throw err;
      retried.add(run);
      await page.goto(`http://localhost:${PORT}/${QUERY}`, { waitUntil: 'load' });
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.tiptap-host .tiptap', { timeout: 30_000 });
      run--;
    }
  }

  for (let run = 0; run < RUNS; run++) {
    const seed = SEED + 100 + run, doc = ['02-blocks.odt', '08-lists.odt', '04-table.odt', '15-chapters.odt', '16-hf-variants.odt'][run % 5], r = mulberry32(seed);
    const before = await docJson();
    await page.setInputFiles('input.file-input[accept*=".odt"]', join(ROOT, 'tests/corpus', doc));
    await page.waitForFunction((b) => JSON.stringify(document.querySelector('.tiptap-host .tiptap').editor.getJSON()) !== b, before, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    await watchFlow();
    const initial = await docKey();
    await ed(async () => (await import('/src/lib/storage/trackChanges.svelte.ts')).setRecordChanges(true));
    const log = [];
    let broken = null;
    for (let i = 0; i < OPS && !broken; i++) {
      const op = drawRecorded(r, await docSize());
      log.push(op);
      if (op.cmd) await runCmd(op);
      else {
        const err = await focused();
        if (err) broken = `focus threw: ${err}`;
        else if (op.drop) await dropText(op.drop);
        else if (op.cells) await overCells(op.cells);
        else if (op.type) await page.keyboard.type(op.type);
        else await press(op.key);
      }
      await page.waitForTimeout(5);
      broken ??= await docCheck();
      if (consoleErrors.some((m) => m.startsWith('Recording would lose')) && !lostBefore) { broken ??= 'the recorder lost an edit'; lostBefore = true; }
    }
    const zonesBefore = await zoneKeys();
    if (!broken) {
      const pass = await editZone(r, 'header', 1);
      log.push(...pass.ops);
      broken = pass.broken;
    }
    const left = await ed(async ({ initial, zonesBefore }) => {
      const { firstDiff } = await import('/tests/normalize.ts');
      (await import('/src/lib/storage/trackChanges.svelte.ts')).setRecordChanges(false);
      const { revisions } = await import('/src/lib/editor/extensions/trackChanges.ts');
      const editor = document.querySelector('.tiptap-host .tiptap').editor;
      const { settleAll } = await import('/src/lib/components/reviewItems.ts');
      const { loadHfDoc } = await import('/src/lib/storage/headerFooter.ts');
      const { zoneRevisions } = await import('/src/lib/editor/zoneReview.ts');
      const zones = () => JSON.stringify(['header', 'footer'].map((z) => loadHfDoc(z)));
      const made = revisions(editor.state.doc).length, inZones = zoneRevisions().length;
      const moves = revisions(editor.state.doc).filter((c) => c.moved).length;
      settleAll(editor, false);
      await new Promise((done) => setTimeout(done, 1200)); // zones are stored after a tick
      // An attr at its default may be spelled out or absent: a rebuilt block spells it. Widths
      // rescale by a rounding error as columns come and go.
      const plain = (key) => JSON.parse(JSON.stringify(JSON.parse(key), (k, v) => (v === null || k === 'colwidth' ? undefined : v)));
      // A table at the very end leaves an empty paragraph, as the last block has no mark.
      const [opened, left] = [plain(initial), plain(window.__docKey())];
      if (left.length === opened.length + 1 && left.at(-1).type === 'paragraph' && !left.at(-1).content) left.pop();
      const diff = firstDiff({ type: 'doc', content: opened }, { type: 'doc', content: left })
        ?? firstDiff({ zones: plain(zonesBefore) }, { zones: plain(zones()) });
      const rejected = window.__docKey();
      editor.commands.undo();
      settleAll(editor, true);
      const after = revisions(editor.state.doc).length + zoneRevisions().length;
      editor.state.doc.check();
      return { made, moves, inZones, diff, after, rejected };
    }, { initial, zonesBefore });
    const bad = broken ?? left.diff ?? (left.after ? `${left.after} changes left after accepting all` : null);
    check(!bad, `seed ${seed} on ${doc}: ${left.made} recorded changes, ${left.moves} moved, ${left.inZones} in the header${bad ? ` — ${bad}` : ', all rejected and accepted'}`);
    if (bad) { await writeFile(join(tmpdir(), `monkey-${seed}-recorded.json`), JSON.stringify(log)); await writeFile(join(tmpdir(), `monkey-${seed}-initial.json`), initial); await writeFile(join(tmpdir(), `monkey-${seed}-rejected.json`), left.rejected ?? ''); for (const op of log.slice(-14)) console.log('    ', JSON.stringify(op)); }
  }
} catch (err) {
  check(false, `monkey run threw: ${err.stack ?? err}`);
} finally {
  if (consoleErrors.length) console.log(`console errors (${consoleErrors.length}): ${[...new Set(consoleErrors)].slice(0, 5).join(' | ')}`);
  const lost = consoleErrors.filter((m) => m.startsWith('Recording would lose'));
  check(!lost.length, lost.length ? `the recorder kept every edit — ${lost.length} passed unrecorded` : 'the recorder kept every edit');
  check(pageErrors.length === 0, pageErrors.length ? `no uncaught page errors — got: ${pageErrors.join(' | ')}` : 'no uncaught page errors');
  await browser.close();
  if (server) process.kill(-server.pid);
}
process.exit(failures.length ? 1 : 0);
