// Monkey run: random editing in the real browser under the invariants any sequence of
// commands must keep — no uncaught error, a document its schema accepts, undo back to the
// opened file and redo forward, and a saved file that validates and reads back as held.
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
const HF_OPS = +(process.env.MONKEY_HF_OPS ?? 8);
const DOCS = process.env.MONKEY_DOC ? [process.env.MONKEY_DOC] : ['02-blocks.odt', '16-hf-variants.odt', '04-table.odt', '08-lists.odt', '12-notes.odt', '15-chapters.odt'];
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNwaDgAAAKEAYEml6crAAAAAElFTkSuQmCC';
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
const WRAPS = ['inline', 'left', 'right', 'topBottom', 'through'];
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
  [8, (r) => pick(r, [
    { cmd: 'setImage', args: [{ src: PNG, width: int(r, 40, 220), height: int(r, 30, 160), wrap: pick(r, WRAPS) }] },
    { cmd: 'setImageWrap', args: [pick(r, WRAPS)] }, { cmd: 'insertTextBox' },
    { cmd: 'setTextBoxAttrs', args: [{ width: int(r, 60, 280), height: int(r, 40, 200) }] },
    { cmd: 'setTextBoxAttrs', args: [{ wrap: pick(r, WRAPS), wrapDist: pick(r, [0, 0.2]) }] },
    { cmd: 'setTextBoxAlign', args: [pick(r, ['left', 'center', 'right', null])] },
    { cmd: 'setColumns', args: [int(r, 2, 3)] }, { cmd: 'setColumnGap', args: [pick(r, [0.5, 1.5])] },
  ])],
  [3, (r) => ({ cmd: pick(r, ['undo', 'redo']) })],
];
const TOTAL = OPS_TABLE.reduce((n, [w]) => n + w, 0);
const drawOp = (r, size) => {
  let x = r() * TOTAL;
  for (const [w, draw] of OPS_TABLE) { if ((x -= w) < 0) return draw(r, size); }
  return { key: 'ArrowRight' };
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

const server = await devServer(PORT);
const { browser, page, pageErrors } = await openApp(PORT);
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

const ed = (fn, arg) => page.evaluate(fn, arg);
const focused = async () => {
  const err = await ed(() => { try { document.querySelector('.tiptap-host .tiptap').editor.commands.focus(); return null; } catch (e) { return String(e); } });
  await page.waitForFunction(() => document.activeElement === document.querySelector('.tiptap-host .tiptap'), null, { timeout: 2000 }).catch(() => {});
  return err;
};
const runCmd = (op) => ed(({ cmd, args }) => {
  const editor = document.querySelector('.tiptap-host .tiptap').editor;
  // A caret only ever sits in a text block — the view puts it nowhere else — but
  // focus(pos) makes the selection wherever it is told, and Enter on one between two
  // list items throws out of prosemirror. Snap to the next text position instead.
  if (cmd === 'focus' && typeof args?.[0] === 'number') {
    const doc = editor.state.doc;
    let at = Math.max(0, Math.min(args[0], doc.content.size));
    for (let n = at; n <= doc.content.size; n++) if (doc.resolve(n).parent.isTextblock) { at = n; break; }
    args = [at];
  }
  try { return { ok: editor.commands[cmd](...(args ?? [])) }; } catch (e) { return { threw: String(e?.stack ?? e) }; }
}, op);
// The schema's own check of the document after every op — a command may leave a node
// with content its spec rejects, which nothing else reports.
const docCheck = () => ed(() => {
  try { document.querySelector('.tiptap-host .tiptap').editor.state.doc.check(); return null; } catch (e) { return String(e); }
});
const docJson = () => ed(() => JSON.stringify(document.querySelector('.tiptap-host .tiptap').editor.getJSON()));
// The key the history is held against, and the count of the columns flow's own rewrites:
// the flow changes the document outside the history (`FLOW_TX`, columnsFlow.ts), so undo
// rebases over it — ponytail: such a run has its history left unchecked.
const watchFlow = () => ed(async () => {
  const { mergeJoinedParagraphsJson } = await import('/src/lib/export/odt.ts');
  // The caches the editor recomputes off the history — a note's label, an index's rows, a
  // caption's number, a reference's text — plus a paragraph columnsFlow split at a page
  // boundary: layout and derived values, not the edits undo has to reverse.
  const DERIVED = { noteRef: 'text', note: 'text', chapterField: 'text', crossReference: 'text',
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

// Flipping a flag ends an open zone edit (App.svelte drops hfActive with it), which
// tears the live editor down mid-session — what was typed must be in the zones anyway.
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
  const gone = await page.waitForSelector('.hf-active', { state: 'detached', timeout: 5000 }).then(() => true, () => false);
  const kept = await ed((m) => ['edentext-header', 'edentext-footer', 'edentext-header-first',
    'edentext-footer-first', 'edentext-header-even', 'edentext-footer-even', 'edentext-hf-sections']
    .some((k) => (localStorage.getItem(k) ?? '').includes(m)), mark);
  if (!gone) return 'the flag left the zone editor open';
  return kept ? null : 'the text typed before the flag flipped is in no zone';
}

// A zone edited the way a user reaches it: double-click in, edit, leave by Done. Pages
// 1 to 3 in turn — with the two variant flags on that is one session per variant, the
// title page's, an even page's and a running one's. Only the round trip reports on it.
async function editZone(r, zone) {
  const zones = page.locator(`.hf-zone.hf-${zone}`);
  const n = await zones.count();
  if (!n) return { ops: [], broken: `no ${zone} zone on the page` };
  const ops = [];
  let broken = null;
  for (let p = 0; p < Math.min(3, n) && !broken; p++) {
    await clickish(zones.nth(p), 'dblclick');
    await page.waitForSelector(HF_LIVE, { timeout: 5000 });
    // The mount focuses itself a tick later; typing before that loses its first keys.
    await page.waitForFunction(() => document.activeElement?.closest?.('.hf-active'), null, { timeout: 2000 }).catch(() => {});
    for (let i = 0; i < HF_OPS && !broken; i++) {
      const op = { page: p + 1, ...drawHfOp(r) };
      ops.push(op);
      if (op.type) await page.keyboard.type(op.type);
      else if (op.key) await page.keyboard.press(op.key);
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

const saveAs = async (ext, retry = true) => {
  await page.click('.ribbon-tab-file');
  try {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.locator('.ribbon-menu button', { hasText: `(.${ext})` }).first().click(),
    ]);
    await page.keyboard.press('Escape');
    return new Uint8Array(await readFile(await dl.path()));
  } catch (err) {
    // The File menu can miss a click while the app is still laying the document out, and
    // no download follows. One more go; a second miss is a finding.
    if (!retry) throw err;
    await page.keyboard.press('Escape');
    return saveAs(ext, false);
  }
};
// The file the app saved, read back by the app's importer against the editor's document
// (its paragraphs joined across a column or page merged, as the export merges them).
const roundTrip = (bytes, ext) => ed(async ({ b64, ext }) => {
  const [{ importOdt }, { importDocx }, { mergeJoinedParagraphsJson }, { normalize, firstDiff, stripFontHoist }, hfStore, { effectiveListLevel, defaultLevelBullet }] = await Promise.all([
    import('/src/lib/import/odt.ts'), import('/src/lib/import/docx.ts'), import('/src/lib/export/odt.ts'), import('/tests/normalize.ts'),
    import('/src/lib/storage/headerFooter.ts'), import('/src/lib/styles/listStyles.ts')]);
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const res = ext === 'odt' ? importOdt(bin) : importDocx(bin);
  const editor = document.querySelector('.tiptap-host .tiptap').editor;
  const json = editor.getJSON();
  // What the importer suppresses as the style's own: a block attribute equal to what its
  // named style resolves to, and bold in a header cell.
  const { resolveStyle } = await import('/src/lib/styles/styleSheet.ts');
  const sheet = editor.extensionManager.extensions.find((e) => e.name === 'paragraphStyle')?.options.sheet();
  const styled = (n, header = false, framed = false, text = {}) => {
    // A heading's level already names its style, so neither importer writes one out —
    // and the style it resolves to is the one whose values are suppressed.
    const style = n.attrs?.styleName ?? (n.type === 'heading' ? `Heading ${n.attrs?.level ?? 1}` : null);
    if (style && sheet) {
      const own = resolveStyle(sheet, style, 'paragraph');
      for (const [k, v] of Object.entries(n.attrs)) if (k !== 'styleName' && own.para?.[k] === v) delete n.attrs[k];
      text = own.text ?? {};
    }
    if (header && n.type === 'text' && n.marks) n.marks = n.marks.filter((m) => m.type !== 'bold');
    // A formula alone in its block is a display formula to both files — a note holds its
    // inline content without a paragraph, so it is a block here too.
    if ((n.type === 'paragraph' || n.type === 'note') && n.content?.length === 1 && n.content[0].type === 'formula') n.content[0].attrs = { ...n.content[0].attrs, display: true };
    // A box with no size of its own is saved at the size the exporter falls back to, and
    // Word's table grid always carries widths, so a merged cell reads back with them.
    if (n.type === 'textBox') n.attrs = { ...n.attrs, width: n.attrs?.width ?? 280, height: n.attrs?.height ?? 96 };
    if (n.attrs?.colwidth) delete n.attrs.colwidth;
    // Both formats spell a header row as the one that repeats, so it reads back repeating.
    if (n.type === 'table' && n.content?.[0]?.content?.[0]?.type === 'tableHeader') delete n.attrs?.repeatHeader;
    if (n.attrs?.styleName === style || n.attrs?.styleName === 'Standard') delete n.attrs.styleName;
    // Same for bold and italic: a heading is already both where its style says so, and
    // a mark repeating that is what the importers drop.
    if (n.type === 'text' && n.marks) n.marks = n.marks.filter((m) =>
      !((m.type === 'bold' && text.bold) || (m.type === 'italic' && text.italic)));
    // A run repeating what its own style says is direct formatting both importers
    // suppress — they cannot tell it from a style that failed to resolve.
    for (const m of n.type === 'text' ? n.marks ?? [] : []) {
      if (m.type !== 'textStyle' || !m.attrs) continue;
      if (m.attrs.fontFamily === (text.fontFamily ?? 'Liberation Serif')) delete m.attrs.fontFamily;
      if (parseFloat(m.attrs.fontSize) === (text.fontSizePt ?? 12)) delete m.attrs.fontSize;
    }
    // Word has no anchored drawing inside a text box, so a frame in one goes out inline.
    if (framed && ext === 'docx' && (n.type === 'image' || n.type === 'textBox') && n.attrs) n.attrs = { ...n.attrs, wrap: null, inFront: null };
    // A block in a box or a cell carries no style name (import/CLAUDE.md), so its chain
    // is baked in and a heading there reads back bold instead of styled.
    if (framed && n.type === 'heading') for (const c of n.content ?? []) if (c.marks) c.marks = c.marks.filter((m) => m.type !== 'bold');
    const inFrame = framed || n.type === 'textBox' || n.type === 'tableCell' || n.type === 'tableHeader';
    for (const c of n.content ?? []) styled(c, header || n.type === 'tableHeader', inFrame, text);
    return n;
  };
  // The exporter folds a columns section's page-split chain back into one node and merges
  // the flow-split paragraphs inside it (replaceColumns, odt.ts); so must the held side.
  const foldColumns = (blocks) => {
    const out = [];
    for (const b of mergeJoinedParagraphsJson(blocks)) {
      const prev = out[out.length - 1];
      if (b.type !== 'columns') { out.push(b); continue; }
      if (prev?.type === 'columns' && JSON.stringify(prev.attrs) === JSON.stringify(b.attrs)) {
        prev.content = mergeJoinedParagraphsJson([...(prev.content ?? []), ...(b.content ?? [])]);
      } else out.push({ ...b, content: mergeJoinedParagraphsJson(b.content ?? []) });
    }
    return out;
  };
  // A list's type is only what its marker draws: where the document's own list style
  // governs the depth, that level's kind decides it (listStyles.ts) and neither file
  // carries a node type beside it. Both sides compare the drawn kind.
  const effListKinds = (n, style = null, depth = 0) => {
    const list = n.type === 'bulletList' || n.type === 'orderedList';
    const own = list && depth === 0 ? sheet?.list?.[n.attrs?.listStyleName] ?? null : style;
    if (list) {
      const eff = effectiveListLevel(n.attrs ?? {}, n.type === 'orderedList', own, depth + 1);
      n.type = eff.kind === 'number' ? 'orderedList' : 'bulletList';
      // The name is not always written: direct formatting on a marker makes the list keep
      // its resolved automatic clone instead (odt.ts), and a nested list's own name is only
      // the memory for a later lift out. corpus.test.ts holds the plain round trip.
      // Its marker then reads back as the direct char the style drew, so both sides carry
      // the drawn one — the same model the kind above compares by.
      n.attrs = { ...(n.attrs ?? {}), listStyleName: null,
        bulletChar: eff.kind === 'bullet' ? eff.bulletChar ?? defaultLevelBullet(depth + 1) : null };
    }
    for (const c of n.content ?? []) effListKinds(c, own, depth + (list ? 1 : 0));
    return n;
  };
  const held = effListKinds(styled({ ...json, content: foldColumns(json.content ?? []) }));
  // Word's list model is flat — an item's further blocks are unnumbered paragraphs at its
  // indent, and nesting is the numbering's — so the DOCX leg compares a list's content
  // flat, without its structure or the indent Word writes on a block it does not number.
  const flatLists = (n) => {
    if (!n.content) return n;
    const out = [];
    let inList = false;
    const bare = (b) => (b.attrs ? { ...b, attrs: { ...b.attrs, indent: null } } : b);
    for (const kid of n.content.map(flatLists)) {
      if (kid.type === 'bulletList' || kid.type === 'orderedList') {
        for (const item of kid.content ?? []) for (const b of item.content ?? []) out.push(bare(b));
        inList = true;
        continue;
      }
      // A block following the list carries the same indent: it is a continuation of the
      // item, which is the one shape Word has for a block it does not number.
      const cont = kid.type === 'paragraph' || kid.type === 'heading';
      out.push(inList && cont ? bare(kid) : kid);
      inList = inList && cont;
    }
    return { ...n, content: out };
  };
  const flat = (n) => stripFontHoist(normalize(ext === 'docx' ? flatLists(n) : n));
  // The zones the app holds (its own storage is what it exports from) against the ones
  // the file gives back — a zone is no part of the document compared above.
  const { loadHfDoc, loadExtraHfSections, loadDifferentFirstPage, loadDifferentOddEven, hfIsEmpty, EMPTY_HF_SET } = hfStore;
  const heldSets = [{ ...EMPTY_HF_SET,
    header: loadHfDoc('header'), footer: loadHfDoc('footer'),
    headerFirst: loadHfDoc('header', 'first'), footerFirst: loadHfDoc('footer', 'first'),
    headerEven: loadHfDoc('header', 'even'), footerEven: loadHfDoc('footer', 'even'),
    differentFirstPage: loadDifferentFirstPage(), differentOddEven: loadDifferentOddEven() }, ...loadExtraHfSections()];
  const zoneOf = (d) => (hfIsEmpty(d) ? null : stripFontHoist(normalize(structuredClone(d))));
  // Only the variants a set's flags put in play: the file carries them nowhere else.
  const zonesOf = (s) => {
    const out = { header: zoneOf(s.header), footer: zoneOf(s.footer),
      differentFirstPage: !!s.differentFirstPage, differentOddEven: !!s.differentOddEven };
    if (out.differentFirstPage) { out.headerFirst = zoneOf(s.headerFirst); out.footerFirst = zoneOf(s.footerFirst); }
    if (out.differentOddEven) { out.headerEven = zoneOf(s.headerEven); out.footerEven = zoneOf(s.footerEven); }
    return out;
  };
  const hfDiff = firstDiff(heldSets.map(zonesOf), (res.hfSections ?? []).map(zonesOf));
  return { diff: firstDiff(flat(held), flat(effListKinds(styled(res.content)))), hfDiff, warnings: res.warnings,
    held: JSON.stringify(held), read: JSON.stringify(res.content),
    hfHeld: JSON.stringify(heldSets.map(zonesOf)), hfRead: JSON.stringify((res.hfSections ?? []).map(zonesOf)) };
}, { b64: Buffer.from(bytes).toString('base64'), ext });

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.clear(); window.showSaveFilePicker = undefined; });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap-host .tiptap', { timeout: 30_000 });
  await page.evaluate(() => { window.showSaveFilePicker = undefined; });

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
          else await page.keyboard.press(op.key);
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
      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
      await page.evaluate(() => { localStorage.clear(); window.showSaveFilePicker = undefined; });
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.tiptap-host .tiptap', { timeout: 30_000 });
      run--;
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
