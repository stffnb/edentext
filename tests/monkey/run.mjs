// Monkey run: random editing in the real browser under the invariants any sequence of
// commands must keep — no uncaught error, a document its schema accepts, undo back to the
// opened file and redo forward again, and a saved file the schema validates and the
// importer reads back as the editor holds it. A failure names the seed and the last ops.
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { JSDOM } from 'jsdom';
import { ROOT, MOD, checker, devServer, openApp } from '../browser.mjs';
import { hasXmllint, validateOdt, validateDocx } from '../schemaValidate.ts';

// The schema helper strips foreign markup with the browser's DOM parser.
Object.assign(globalThis, (({ DOMParser, XMLSerializer }) => ({ DOMParser, XMLSerializer }))(new JSDOM('').window));

const PORT = +(process.env.MONKEY_PORT ?? 4189);
const SEED = +(process.env.MONKEY_SEED ?? 1);
const RUNS = +(process.env.MONKEY_RUNS ?? 3);
const OPS = +(process.env.MONKEY_OPS ?? 60);
const DOCS = process.env.MONKEY_DOC ? [process.env.MONKEY_DOC] : ['02-blocks.odt', '04-table.odt', '08-lists.odt', '12-notes.odt', '15-chapters.odt'];
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const { check, failures } = checker();
if (!hasXmllint) console.log('xmllint missing: the saved files are not validated against the schemas');

// fuzzDoc.ts's generator, so a seed replays.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const int = (r, min, max) => min + Math.floor(r() * (max - min + 1));

const WORDS = ['lorem ', 'Ipsum', ' dolor sit ', 'äöü ', '42', '. ', 'A', ' — ', 'x'];
const KEYS = ['Enter', 'Enter', 'Backspace', 'Backspace', 'Delete', 'Tab', 'Shift+Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Shift+ArrowLeft', 'Shift+ArrowRight', 'Shift+ArrowDown', 'Home', 'End', `${MOD}+b`, `${MOD}+i`, `${MOD}+u`, `${MOD}+Shift+7`, `${MOD}+Shift+8`,
  `${MOD}+Enter`, `${MOD}+z`, `${MOD}+Shift+z`];
const STYLES = ['Standard', 'Heading 1', 'Heading 2', 'Heading 3', 'Title', 'Quotations'];
// Each entry: a weight and a draw of the op — a key, typed text, or an editor command.
const OPS_TABLE = [
  [24, (r) => ({ type: pick(r, WORDS) + (r() < 0.3 ? pick(r, WORDS) : '') })],
  [20, (r) => ({ key: pick(r, KEYS) })],
  [10, (r, size) => ({ cmd: 'focus', args: [int(r, 1, Math.max(1, size - 2))] })],
  [6, (r, size) => { const a = int(r, 1, Math.max(1, size - 2)), b = int(r, 1, Math.max(1, size - 2)); return { cmd: 'setTextSelection', args: [{ from: Math.min(a, b), to: Math.max(a, b) }] }; }],
  [8, (r) => pick(r, [
    { cmd: 'toggleBold' }, { cmd: 'toggleItalic' }, { cmd: 'toggleUnderline' }, { cmd: 'toggleStrike' },
    { cmd: 'toggleSubscript' }, { cmd: 'toggleSuperscript' }, { cmd: 'setColor', args: ['#c00000'] },
    { cmd: 'setFontSize', args: ['14pt'] }, { cmd: 'setFontFamily', args: ['Liberation Sans'] }, { cmd: 'unsetAllMarks' },
  ])],
  [12, (r) => pick(r, [
    { cmd: 'setParagraphStyle', args: [pick(r, STYLES)] }, { cmd: 'setTextAlign', args: [pick(r, ['left', 'center', 'right', 'justify'])] },
    { cmd: 'indentMore' }, { cmd: 'indentLess' }, { cmd: 'setLineHeight', args: ['1.5'] }, { cmd: 'setSpaceBefore', args: [6] },
    { cmd: 'toggleBulletList' }, { cmd: 'toggleOrderedList' }, { cmd: 'sinkListItem', args: ['listItem'] }, { cmd: 'liftListItem', args: ['listItem'] },
    { cmd: 'insertPageBreak' }, { cmd: 'setColumns', args: [2] }, { cmd: 'setColumns', args: [1] }, { cmd: 'clearDirectFormatting' },
  ])],
  [8, (r) => pick(r, [
    { cmd: 'insertTable', args: [{ rows: int(r, 2, 3), cols: int(r, 2, 3), withHeaderRow: r() < 0.5 }] },
    { cmd: 'addRowAfter' }, { cmd: 'addColumnAfter' }, { cmd: 'deleteRow' }, { cmd: 'deleteColumn' },
    { cmd: 'mergeCells' }, { cmd: 'splitCell' }, { cmd: 'deleteTable' }, { cmd: 'goToNextCell' },
  ])],
  [8, (r) => pick(r, [
    { cmd: 'insertNote', args: ['footnote'] }, { cmd: 'insertNote', args: ['endnote'] },
    { cmd: 'insertFormula', args: [{ latex: 'x^{2}+1', display: false }] }, { cmd: 'insertTextBox' },
    { cmd: 'setImage', args: [{ src: PNG, width: 80, height: 60 }] }, { cmd: 'setHardBreak' },
    { cmd: 'addComment', args: [{ author: 'Monkey', text: 'hm' }] }, { cmd: 'insertContent', args: ['—'] },
  ])],
  [3, (r) => ({ cmd: pick(r, ['undo', 'redo']) })],
];
const TOTAL = OPS_TABLE.reduce((n, [w]) => n + w, 0);
const drawOp = (r, size) => {
  let x = r() * TOTAL;
  for (const [w, draw] of OPS_TABLE) { if ((x -= w) < 0) return draw(r, size); }
  return { key: 'ArrowRight' };
};

const server = await devServer(PORT);
const { browser, page, pageErrors } = await openApp(PORT);
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

const ed = (fn, arg) => page.evaluate(fn, arg);
const focused = async () => {
  const err = await ed(() => { try { document.querySelector('.tiptap').editor.commands.focus(); return null; } catch (e) { return String(e); } });
  await page.waitForFunction(() => document.activeElement === document.querySelector('.tiptap'), null, { timeout: 2000 }).catch(() => {});
  return err;
};
const runCmd = (op) => ed(({ cmd, args }) => {
  const editor = document.querySelector('.tiptap').editor;
  try { return { ok: editor.commands[cmd](...(args ?? [])) }; } catch (e) { return { threw: String(e?.stack ?? e) }; }
}, op);
// The schema's own check of the document after every op — a command may leave a node
// with content its spec rejects, which nothing else reports.
const docCheck = () => ed(() => {
  try { document.querySelector('.tiptap').editor.state.doc.check(); return null; } catch (e) { return String(e); }
});
const docJson = () => ed(() => JSON.stringify(document.querySelector('.tiptap').editor.getJSON()));
const docSize = () => ed(() => document.querySelector('.tiptap').editor.state.doc.content.size);

const saveAs = async (ext) => {
  await page.click('.ribbon-tab-file');
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.locator('.ribbon-menu button', { hasText: `(.${ext})` }).first().click(),
  ]);
  await page.keyboard.press('Escape');
  return new Uint8Array(await readFile(await dl.path()));
};
// The file the app saved, read back by the app's importer against the editor's document
// (its paragraphs joined across a column or page merged, as the export merges them).
const roundTrip = (bytes, ext) => ed(async ({ b64, ext }) => {
  const [{ importOdt }, { importDocx }, { mergeJoinedParagraphsJson }, { normalize, firstDiff, stripFontHoist }] = await Promise.all([
    import('/src/lib/import/odt.ts'), import('/src/lib/import/docx.ts'), import('/src/lib/export/odt.ts'), import('/tests/normalize.ts')]);
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const res = ext === 'odt' ? importOdt(bin) : importDocx(bin);
  const editor = document.querySelector('.tiptap').editor;
  const json = editor.getJSON();
  // What the importer suppresses as the style's own: a block attribute equal to what its
  // named style resolves to, and bold in a header cell.
  const { resolveStyle } = await import('/src/lib/styles/styleSheet.ts');
  const sheet = editor.extensionManager.extensions.find((e) => e.name === 'paragraphStyle')?.options.sheet();
  const styled = (n, header = false) => {
    if (n.attrs?.styleName && sheet) {
      const own = resolveStyle(sheet, n.attrs.styleName, 'paragraph').para ?? {};
      for (const [k, v] of Object.entries(n.attrs)) if (k !== 'styleName' && own[k] === v) delete n.attrs[k];
    }
    if (header && n.type === 'text' && n.marks) n.marks = n.marks.filter((m) => m.type !== 'bold');
    // A formula alone in its paragraph is a display formula to both files.
    if (n.type === 'paragraph' && n.content?.length === 1 && n.content[0].type === 'formula') n.content[0].attrs = { ...n.content[0].attrs, display: true };
    for (const c of n.content ?? []) styled(c, header || n.type === 'tableHeader');
    return n;
  };
  const held = styled({ ...json, content: mergeJoinedParagraphsJson(json.content ?? []) });
  return { diff: firstDiff(stripFontHoist(normalize(held)), stripFontHoist(normalize(styled(res.content)))), warnings: res.warnings, held: JSON.stringify(held), read: JSON.stringify(res.content) };
}, { b64: Buffer.from(bytes).toString('base64'), ext });

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.clear(); window.showSaveFilePicker = undefined; });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 30_000 });
  await page.evaluate(() => { window.showSaveFilePicker = undefined; });

  for (let run = 0; run < RUNS; run++) {
    const seed = SEED + run;
    const doc = DOCS[run % DOCS.length];
    const r = mulberry32(seed);
    const before = await docJson();
    await page.setInputFiles('input.file-input', join(ROOT, 'tests/corpus', doc));
    await page.waitForFunction((b) => JSON.stringify(document.querySelector('.tiptap').editor.getJSON()) !== b, before, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const initial = await docJson();
    const log = [];
    let broken = null;
    for (let i = 0; i < OPS && !broken; i++) {
      const op = drawOp(r, await docSize());
      log.push(op);
      if (op.type || op.key) {
        const err = await focused();
        if (err) broken = `focus threw: ${err}`;
        else if (op.type) await page.keyboard.type(op.type);
        else await page.keyboard.press(op.key);
      } else {
        const res = await runCmd(op);
        if (res.threw) broken = `${op.cmd} threw: ${res.threw}`;
      }
      const invalid = await docCheck();
      if (invalid) broken = `schema-invalid document: ${invalid}`;
      if (pageErrors.length) broken = `uncaught: ${pageErrors.join(' | ')}`;
    }
    const final = await docJson();
    await writeFile(join(tmpdir(), `monkey-${seed}-ops.json`), JSON.stringify(log));
    // Undo until the opened document is back, redo as often, and the edited one is back.
    const undone = broken ? -1 : await ed((initial) => {
      const editor = document.querySelector('.tiptap').editor;
      for (let n = 0; n < 500; n++) {
        if (JSON.stringify(editor.getJSON()) === initial) return n;
        if (!editor.can().undo()) return -1;
        try { editor.commands.undo(); } catch (e) { return `undo threw: ${String(e).slice(0, 300)}`; }
      }
      return -1;
    }, initial);
    const redone = typeof undone !== 'number' || undone < 0 ? null : await ed((n) => {
      const editor = document.querySelector('.tiptap').editor;
      for (let i = 0; i < n; i++) editor.commands.redo();
      return JSON.stringify(editor.getJSON());
    }, undone);
    const history = broken ?? (typeof undone === 'string' ? undone : undone < 0 ? 'undo does not reach the opened document' : redone !== final ? 'redo does not restore the edited document' : null);
    const label = `seed ${seed} on ${doc}: ${log.length} ops, ${undone} undo steps`;
    check(!history, history ? `${label} — ${history}` : label);
    if (history) for (const op of log.slice(-12)) console.log('    ', JSON.stringify(op));
    if (broken) break;

    for (const ext of ['odt', 'docx']) {
      const bytes = await saveAs(ext);
      const schema = hasXmllint ? (ext === 'odt' ? validateOdt : validateDocx)(unzipSync(bytes)) : [];
      const rt = await roundTrip(bytes, ext).catch((err) => ({ diff: null, warnings: [], threw: String(err.message ?? err).split('\n')[0] }));
      const bad = rt.threw ? `import threw: ${rt.threw}` : schema.length ? `schema: ${schema[0].slice(0, 300)}`
        : rt.diff ? `round trip: ${rt.diff}` : rt.warnings.length ? `warnings: ${rt.warnings.join(' | ')}` : null;
      check(!bad, `seed ${seed}: the saved .${ext} validates and reads back${bad ? ` — ${bad}` : ''}`);
      if (bad) {
        // The file and both documents, for the repro.
        const stem = join(tmpdir(), `monkey-${seed}`);
        await writeFile(`${stem}.${ext}`, bytes);
        if (rt.held) await Promise.all([writeFile(`${stem}-${ext}-held.json`, rt.held), writeFile(`${stem}-${ext}-read.json`, rt.read)]);
        console.log(`    kept: ${stem}.${ext}`);
      }
    }
  }
} catch (err) {
  check(false, `monkey run threw: ${err.stack ?? err}`);
} finally {
  if (consoleErrors.length) console.log(`console errors (${consoleErrors.length}): ${[...new Set(consoleErrors)].slice(0, 5).join(' | ')}`);
  check(pageErrors.length === 0, pageErrors.length ? `no uncaught page errors — got: ${pageErrors.join(' | ')}` : 'no uncaught page errors');
  await browser.close();
  if (server) process.kill(-server.pid);
}
process.exit(failures.length ? 1 : 0);
