// Two clients do one thing each to the same paragraph, table, change or comment before
// either hears of the other's (relayed by this script, as undo.mjs). Per pair: same doc on
// both, a valid doc with rectangular tables, nothing typed lost, no update after the
// exchange but the repairer's one, A's undo taking back A's op alone. Expected values are
// what the editor does now, accepted losses included (docs/architecture/collab-conflicts.md).
// Dev server, any engine.
import { checker, collectErrors, devServer, openApp } from '../browser.mjs';

const PORT = +(process.env.COLLAB_PORT ?? 4394);
const ROUNDS = +(process.env.ROUNDS ?? 8);
const ONLY = process.env.CASE ? new RegExp(process.env.CASE) : null;
const { check, failures } = checker();
const server = await devServer(PORT);
const { browser, page: a, pageErrors } = await openApp(PORT);
const b = await (await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'en-US', serviceWorkers: 'block' })).newPage();
collectErrors(b, pageErrors, 'B: ');
if (process.env.VERBOSE) for (const [p, n] of [[a, 'A'], [b, 'B']]) p.on('console', (m) => { if (/collab/.test(m.text())) console.log(n, m.text().slice(0, 200)); });
b.on('dialog', (d) => d.accept());

const open = async (page, name) => {
  await page.goto(`http://localhost:${PORT}/?undo=yjs-join`, { waitUntil: 'load' });
  await page.evaluate((n) => { localStorage.clear(); localStorage.setItem('edentext-user-name', n); }, name);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__undoYjs && document.querySelector('.tiptap-host .tiptap')?.editor, null, { timeout: 30_000 });
  await page.waitForTimeout(1500);
};
await open(a, 'Anna');
await open(b, 'Ben');

// Fixed client ids, so a tie between two inserts at one place resolves the same every run.
const attach = (page, id, state) => page.evaluate(([id, s]) => {
  const { Y, attachYjsUndo } = window.__undoYjs;
  const ydoc = new Y.Doc();
  ydoc.clientID = id;
  if (s) Y.applyUpdate(ydoc, Uint8Array.from(s), 'relay');
  const ed = document.querySelector('.tiptap-host .tiptap').editor;
  window.__yjsUndo = attachYjsUndo(ed, ydoc);
  // A writes the repairs, as the client bound first does in a session.
  window.__yjsUndo.setRepairer(() => id === 1);
  window.__yOut = [];
  ydoc.on('update', (u, origin) => { if (origin !== 'relay') window.__yOut.push([...u]); });
  // What the cases call: positions by text, cells by grid, typing as a transaction.
  const doc = () => ed.state.doc;
  const at = (text, after = 0) => {
    let pos = -1;
    doc().descendants((n, p) => {
      if (pos >= 0 || !n.isText) return pos < 0;
      const i = n.text.indexOf(text);
      if (i >= 0) pos = p + i + after;
      return false;
    });
    if (pos < 0) throw new Error(`no "${text}"`);
    return pos;
  };
  const cells = () => {
    const out = [];
    doc().descendants((n, p) => {
      if (n.type.name === 'tableRow') out.push([]);
      if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') { out.at(-1).push(p); return false; }
      return true;
    });
    return out;
  };
  const block = (i) => { let pos = 0; doc().forEach((_n, p, k) => { if (k === i) pos = p; }); return pos; };
  const type = (pos, text) => { ed.commands.setTextSelection(pos); ed.view.dispatch(ed.state.tr.insertText(text)); };
  const select = (from, to = from) => ed.commands.setTextSelection({ from, to });
  window.__h = { ed, doc, at, cells, block, type, select };
}, [id, state]);
await attach(a, 1);
await attach(b, 2, await a.evaluate(() => [...window.__undoYjs.Y.encodeStateAsUpdate(window.__yjsUndo.ydoc)]));

// Moves every waiting update across once; returns how many went (`sent`: per client).
const sent = { a: 0, b: 0 };
const relay = async () => {
  let n = 0;
  for (const [from, to] of [[a, b], [b, a]]) {
    const out = await from.evaluate(() => window.__yOut.splice(0));
    n += out.length;
    sent[from === a ? 'a' : 'b'] = out.length;
    // The binding can throw while it applies an update; the case notes it and goes on.
    if (out.length) await to.evaluate((us) => {
      for (const u of us) {
        try { window.__undoYjs.Y.applyUpdate(window.__yjsUndo.ydoc, Uint8Array.from(u), 'relay'); } catch (e) { (window.__thrown ??= []).push(String(e).slice(0, 80)); }
      }
    }, out);
  }
  await a.waitForTimeout(150);
  return n;
};
const run = (page, code) => page.evaluate((c) => new Function('h', c)(window.__h), code);
const SHEET_RECORD = '/src/lib/storage/trackChanges.svelte.ts';
const record = (page, on) => page.evaluate(async ([url, v]) => (await import(url)).setRecordChanges(v), [SHEET_RECORD, on]);
// Doc JSON, the fragment, validity, ragged tables, text, notes' numbers, the TOC's rows, carets.
const view = (page) => page.evaluate(() => {
  const { ed, doc } = window.__h;
  let valid = true, error = '';
  try { doc().check(); } catch (e) { valid = false; error = String(e); }
  const ragged = [];
  doc().descendants((t) => {
    if (t.type.name !== 'table') return true;
    const rows = [];
    t.forEach((row, _o, r) => {
      let col = 0;
      row.forEach((cell) => {
        while (rows[r]?.[col]) col++;
        for (let dr = 0; dr < (cell.attrs.rowspan ?? 1); dr++)
          for (let dc = 0; dc < (cell.attrs.colspan ?? 1); dc++) (rows[r + dr] ??= [])[col + dc] = true;
        col += cell.attrs.colspan ?? 1;
      });
    });
    const widths = rows.slice(0, t.childCount).map((r) => r.filter(Boolean).length);
    if (new Set(widths).size > 1 || rows.length > t.childCount) ragged.push(widths.join(','));
    return true;
  });
  const notes = [], toc = [], marks = [];
  doc().descendants((n) => {
    if (n.type.name === 'noteRef') notes.push(n.attrs.text);
    if (n.type.name === 'tableOfContents') toc.push(JSON.stringify(n.attrs.entries ?? null));
    for (const m of n.marks) if (m.type.name !== 'textStyle') marks.push(`${m.type.name}:${n.text ?? ''}`);
  });
  return {
    json: JSON.stringify(doc().toJSON()),
    frag: window.__yjsUndo.ydoc.getXmlFragment('body').toString(),
    valid, error, ragged, text: doc().textContent, notes, toc, marks,
    sel: [ed.state.selection.from, ed.state.selection.$from.parent.type.name, ed.state.selection.$from.parent.textContent.slice(0, 40)],
  };
});

const P = (text, extra = {}) => ({ type: 'paragraph', ...extra, content: text ? [{ type: 'text', text }] : undefined });
const H = (text) => ({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text }] });
const LI = (text, nested) => ({ type: 'listItem', content: [P(text), ...(nested ? [nested] : [])] });
const UL = (...items) => ({ type: 'bulletList', content: items });
const FOX = 'The quick brown fox jumps over the lazy dog.';
const PARA = [P('Before.'), P(FOX), P('After.')];
const cell = (t) => ({ type: 'tableCell', content: [P(t)] });
const TABLE = [P('Above.'), { type: 'table', content: ['1', '2', '3'].map((r) => ({ type: 'tableRow', content: ['a', 'b', 'c'].map((c) => cell(`${c}${r}`)) })) }, P('Below.')];
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const INS = (text) => ({ type: 'text', text, marks: [{ type: 'insertion', attrs: { id: 'r1', author: 'Carl', date: '2026-11-01T00:00:00Z' } }] });
const REVISED = [P('Before.'), { type: 'paragraph', content: [{ type: 'text', text: 'The quick ' }, INS('brown fox '), { type: 'text', text: 'jumps.' }] }, P('After.')];
const COMMENT = { type: 'comment', attrs: { id: 'c1', author: 'Carl', text: 'Why brown?', replies: [], date: '2026-11-01T00:00:00Z', resolved: false } };
const COMMENTED = [P('Before.'), { type: 'paragraph', content: [{ type: 'text', text: 'The quick ' }, { type: 'text', text: 'brown', marks: [COMMENT] }, { type: 'text', text: ' fox.' }] }];

// B types "Zed" after "lazy " unless said otherwise. `keep`: the strings that must stay
// (a side's deliberate deletion excepted). `want`: what the run measures now.
const B_TYPES = 'h.type(h.at("lazy ", 5), "Zed")';
const NOTED = [P('Before.'), { type: 'paragraph', content: [{ type: 'text', text: 'Noted' }, { type: 'noteRef', attrs: { id: 'n1', kind: 'footnote', text: '1' } }, { type: 'text', text: '.' }] }, P('After.'),
  { type: 'noteSection', content: [{ type: 'note', attrs: { id: 'n1', kind: 'footnote', text: '1' }, content: [{ type: 'text', text: 'First note.' }] }] }];
const ok = { same: true, valid: true, clean: true, kept: true, quiet: true, undo: true };
const red = (...keys) => ({ ...ok, ...Object.fromEntries(keys.map((k) => k.endsWith('?') ? [k.slice(0, -1), null] : [k, false])) });
const CASES = [
  { name: 'A types elsewhere in the paragraph (control)', doc: PARA, a: 'h.type(h.at("The ", 4), "Ann")', b: B_TYPES, keep: ['The Ann', 'lazy Zed'], want: ok },
  { name: 'A splits the paragraph before B\'s place', doc: PARA, a: 'h.select(h.at("brown ", 6)); h.ed.commands.splitBlock()', b: B_TYPES, keep: ['lazy Zed'], want: ok },
  { name: 'A splits the paragraph behind B\'s place', doc: PARA, a: 'h.select(h.at("lazy d", 6)); h.ed.commands.splitBlock()', b: B_TYPES, keep: ['lazy Zed'], want: ok },
  { name: 'A joins it to the paragraph before', doc: PARA, a: 'h.select(h.at("The ")); h.ed.commands.joinBackward()', b: B_TYPES, keep: ['lazy Zed'], want: ok },
  { name: 'A makes it a heading', doc: PARA, a: 'h.select(h.at("The ")); h.ed.commands.setParagraphStyle("Heading 1")', b: B_TYPES, keep: ['lazy Zed'], want: ok },
  { name: 'A makes a heading a paragraph again', doc: [P('Before.'), H(FOX), P('After.')], a: 'h.select(h.at("The ")); h.ed.commands.setParagraph()', b: B_TYPES, keep: ['lazy Zed'], want: ok },
  { name: 'A makes it a list item', doc: PARA, a: 'h.select(h.at("The ")); h.ed.commands.toggleBulletList()', b: B_TYPES, keep: ['lazy Zed'], want: ok },
  { name: 'A indents it in its list', doc: [UL(LI('One'), LI(FOX), LI('Three'))], a: 'h.select(h.at("The ")); h.ed.commands.indentListForward()', b: B_TYPES, keep: ['lazy Zed'], want: ok },
  { name: 'A outdents it in its list', doc: [UL(LI('One', UL(LI(FOX))), LI('Three'))], a: 'h.select(h.at("The ")); h.ed.commands.liftListItem("listItem")', b: B_TYPES, keep: ['lazy Zed'], want: ok },
  { name: 'A gives it another paragraph style', doc: PARA, a: 'h.select(h.at("The ")); h.ed.commands.setParagraphStyle("Quotations")', b: B_TYPES, keep: ['lazy Zed'], want: ok },
  { name: 'A centres it', doc: PARA, a: 'h.select(h.at("The ")); h.ed.commands.setTextAlign("center")', b: B_TYPES, keep: ['lazy Zed'], want: ok },
  { name: 'A indents it', doc: PARA, a: 'h.select(h.at("The ")); h.ed.commands.indentMore()', b: B_TYPES, keep: ['lazy Zed'], want: ok },
  { name: 'A drags it below the next one', doc: PARA,
    a: 'const from = h.block(1), node = h.doc().child(1); const tr = h.ed.state.tr.delete(from, from + node.nodeSize); tr.insert(tr.doc.content.size, node); h.ed.view.dispatch(tr)',
    b: B_TYPES, keep: ['lazy Zed'], want: ok },
  { name: 'A deletes it whole', doc: PARA, a: 'const from = h.block(1); h.ed.view.dispatch(h.ed.state.tr.delete(from, from + h.doc().child(1).nodeSize))', b: B_TYPES, keep: [], want: red('undo') },
  { name: 'A puts a footnote in it', doc: PARA, a: 'h.select(h.at("quick", 5)); h.ed.commands.insertNote("footnote")', b: B_TYPES, keep: ['lazy Zed'], want: ok },
  { name: 'A comments a word in it', doc: PARA, a: 'h.select(h.at("brown"), h.at("brown", 5)); h.ed.commands.addComment({ author: "Anna", text: "Hm" })', b: B_TYPES, keep: ['lazy Zed'], want: ok },
  { name: 'A puts a picture in it', doc: PARA, a: `h.select(h.at("fox ", 4)); h.ed.commands.setImage({ src: "${PNG}", width: 20, height: 20 })`, b: B_TYPES, keep: ['lazy Zed'], want: ok },
  { name: 'A replaces a word in it (Replace All)', doc: PARA,
    a: 'h.ed.commands.setSearch({ term: "quick", matchCase: false, wholeWord: false, useRegex: false }); h.ed.commands.replaceAll("slow"); h.ed.commands.clearSearch()',
    b: B_TYPES, keep: ['lazy Zed', 'slow'], want: ok },

  // Tables: 3 × 3, cell text "a1".."c3"; h.cells()[row][col] is a cell's position.
  { name: 'A inserts a column, B a row', doc: TABLE, a: 'h.select(h.cells()[0][0] + 2); h.ed.commands.addColumnAfter()', b: 'h.select(h.cells()[1][1] + 2); h.ed.commands.addRowAfter()', keep: [], want: ok },
  { name: 'A deletes a row, B types in it', doc: TABLE, a: 'h.select(h.cells()[1][0] + 2); h.ed.commands.deleteRow()', b: 'h.type(h.at("b2", 2), "Zed")', keep: [], want: red('undo') },
  { name: 'A deletes a column, B types in it', doc: TABLE, a: 'h.select(h.cells()[0][1] + 2); h.ed.commands.deleteColumn()', b: 'h.type(h.at("b2", 2), "Zed")', keep: [], want: red('undo') },
  { name: 'A merges two cells, B types in one', doc: TABLE,
    a: 'const c = h.cells(); h.ed.commands.setCellSelection({ anchorCell: c[0][0], headCell: c[0][1] }); h.ed.commands.mergeCells()',
    b: 'h.type(h.at("b1", 2), "Zed")', keep: ['b1Zed', 'a1'], want: ok },
  { name: 'A and B merge overlapping cells', doc: TABLE,
    a: 'const c = h.cells(); h.ed.commands.setCellSelection({ anchorCell: c[0][0], headCell: c[0][1] }); h.ed.commands.mergeCells()',
    b: 'const c = h.cells(); h.ed.commands.setCellSelection({ anchorCell: c[0][1], headCell: c[1][1] }); h.ed.commands.mergeCells()',
    keep: ['a1', 'b1', 'b2'], want: red('undo') },
  { name: 'A widens a column, B inserts one', doc: TABLE,
    a: 'const tr = h.ed.state.tr; h.cells().forEach((r, i) => tr.setNodeAttribute(r[0], "colwidth", [300])); h.ed.view.dispatch(tr)',
    b: 'h.select(h.cells()[0][1] + 2); h.ed.commands.addColumnAfter()', keep: [], want: ok },
  { name: 'A sorts the table, B types in a cell', doc: TABLE,
    a: 'h.select(h.cells()[0][0] + 2); h.ed.commands.sortTable({ keys: [{ column: 0, descending: true, type: "text" }], headerRow: false })',
    b: 'h.type(h.at("b1", 2), "Zed")', keep: ['b1Zed'], want: ok },
  { name: 'A deletes the table, B types in a cell', doc: TABLE, a: 'h.select(h.cells()[0][0] + 2); h.ed.commands.deleteTable()', b: 'h.type(h.at("b2", 2), "Zed")', keep: [], want: red('undo') },

  // Recorded changes (r1 marks "brown fox ") and comments (c1 on "brown").
  { name: 'A accepts a change, B types in it', doc: REVISED, a: 'h.ed.commands.acceptRevision("r1")', b: 'h.type(h.at("brown ", 6), "Zed")', keep: ['brown Zed'], want: ok },
  { name: 'A rejects a change, B types in it', doc: REVISED, a: 'h.ed.commands.rejectRevision("r1")', b: 'h.type(h.at("brown ", 6), "Zed")', keep: ['Zed'], want: ok },
  { name: 'A accepts all, B records a new one', doc: REVISED, recordB: true, a: 'h.ed.commands.acceptRevisions(true)', b: 'h.type(h.at("After"), "Zed ")', keep: ['Zed After'], want: ok },
  { name: 'A deletes a comment, B answers it', doc: COMMENTED, a: 'h.ed.commands.removeComment("c1")', b: 'h.ed.commands.replyToComment("c1", { author: "Ben", text: "Because" })', keep: [], want: red('undo') },

  // Derived content: the TOC's rows, the notes' numbers.
  { name: 'A updates the TOC, B edits a heading', doc: [{ type: 'tableOfContents', attrs: { index: 'toc', entries: [{ text: 'Alpha', level: 1, page: 1 }, { text: 'Old', level: 1, page: 1 }] } }, H('Alpha'), P('Text.'), H('Beta')],
    a: 'h.ed.commands.updateIndexes()', b: 'h.type(h.at("Alpha", 5), " Zed")', keep: ['Alpha Zed'], want: red('quiet?', 'undo') },
  { name: 'A adds the first footnote, B one before it', doc: PARA, a: 'h.select(h.at("After", 5)); h.ed.commands.insertNote("footnote")', b: 'h.select(h.at("Before", 6)); h.ed.commands.insertNote("footnote")', keep: [], notes: 2, want: ok },
  { name: 'A adds a footnote, B one before it', doc: NOTED, a: 'h.select(h.at("After", 5)); h.ed.commands.insertNote("footnote")', b: 'h.select(h.at("Before", 6)); h.ed.commands.insertNote("footnote")', keep: [], notes: 3, want: ok },
];

const diff = (x, y) => { let i = 0; while (i < x.length && x[i] === y[i]) i++; return `…${x.slice(Math.max(0, i - 40), i + 80)}… vs …${y.slice(Math.max(0, i - 40), i + 80)}…`; };
const thrown = async () => [...await a.evaluate(() => (window.__thrown ?? []).splice(0)), ...await b.evaluate(() => (window.__thrown ?? []).splice(0))];
try {
  for (const c of CASES) {
    if (ONLY && !ONLY.test(c.name)) continue;
    await record(b, false);
    // Each pair from fresh Yjs docs: the history one leaves (Yjs keeps deleted items) would
    // steer where the next one's undo puts things back.
    // FRESH=0 keeps one pair of docs for the whole run, the history included.
    if (process.env.FRESH !== '0') {
      for (const p of [a, b]) await p.evaluate(() => window.__yjsUndo.detach());
      await a.evaluate((d) => window.__h.ed.commands.setContent({ type: 'doc', content: d }), c.doc);
      await attach(a, 1);
      await attach(b, 2, await a.evaluate(() => [...window.__undoYjs.Y.encodeStateAsUpdate(window.__yjsUndo.ydoc)]));
    } else await a.evaluate((d) => window.__h.ed.commands.setContent({ type: 'doc', content: d }), c.doc);
    for (let i = 0; i < 3; i++) { await a.waitForTimeout(250); await relay(); }
    await thrown();
    for (const p of [a, b]) await p.evaluate(() => { window.__yjsUndo.undoManager.clear(); window.__yOut.length = 0; });
    if (c.recordB) await record(b, true);
    const base = await view(a);
    await run(a, c.a);
    await run(b, c.b);
    const onlyB = await view(b);
    // The exchange, then whatever either sends on its own afterwards.
    await relay();
    // A, the repairer, may write its repair once, right after the exchange.
    let extra = 0, quietRounds = 0;
    for (let i = 0; i < ROUNDS && quietRounds < 3; i++) {
      await a.waitForTimeout(i === 0 ? 700 : 200);
      const n = await relay();
      extra += i === 0 ? sent.b : n;
      if (process.env.VERBOSE && n) console.log(`  round ${i}: ${n} updates`, process.env.DUMP ? (await view(a)).json.replace(/"attrs":\{[^{}]*\}/g, '').replace(/"(revMark|revFormat)":null,?/g, '') : '');
      quietRounds = n ? 0 : quietRounds + 1;
    }
    const [va, vb] = [await view(a), await view(b)];
    const threw = await thrown();
    const lost = c.keep.filter((s) => !va.text.includes(s) && !va.json.includes(s));
    if (c.notes && va.notes.length !== c.notes) lost.push(`${c.notes - va.notes.length} of ${c.notes} notes`);
    const got = {
      same: va.json === vb.json && va.frag === vb.frag,
      valid: va.valid && vb.valid && !va.ragged.length && !vb.ragged.length && va.notes.join() === va.notes.map((_, i) => i + 1).join(),
      clean: !threw.length,
      kept: !lost.length,
      quiet: extra === 0,
      undo: false,
    };
    await record(b, false);
    await a.evaluate(() => window.__h.ed.commands.undo());
    for (let i = 0; i < 3; i++) { await a.waitForTimeout(250); await relay(); }
    const [ua, ub] = [await view(a), await view(b)];
    got.undo = ua.json === ub.json && ua.valid && ub.valid && !ua.ragged.length && ua.json === onlyB.json;
    const note = [
      !got.same && `differ: ${diff(va.json, vb.json)}`,
      threw.length && `threw: ${threw[0]}`,
      !got.valid && `invalid: ${va.error || vb.error} ragged ${va.ragged}|${vb.ragged} notes ${va.notes}|${vb.notes}`,
      lost.length && `lost ${lost.join(', ')}`,
      extra && `${extra} updates after the exchange${quietRounds < 3 ? ', still going' : ', then quiet'}`,
      !got.undo && `undo: ${ua.json === onlyB.json ? '' : diff(ua.json, onlyB.json)}${ua.json === ub.json ? '' : ' (clients differ)'}`,
    ].filter(Boolean);
    if (process.env.VERBOSE) console.log(JSON.stringify({ case: c.name, text: [base.text, va.text, ua.text], sel: vb.sel, toc: va.toc, notes: [va.notes, vb.notes, ua.notes], marks: [va.marks, ua.marks] }));
    // null: not asserted, since it depends on how the repairs race.
    const keys = Object.keys(c.want).filter((k) => c.want[k] !== null);
    const match = keys.every((k) => got[k] === c.want[k]);
    const known = keys.filter((k) => !c.want[k]);
    check(match, `${c.name}: ${keys.map((k) => `${k} ${got[k] ? '✓' : '✗'}`).join(' ')}${known.length ? ` (known: ${known.join(', ')})` : ''}${note.length ? ` — ${note.join('; ')}` : ''}`);
  }
  check(!pageErrors.length, `no uncaught page errors ${pageErrors.join(' | ')}`);
} catch (e) {
  check(false, `conflict run threw: ${e?.stack ?? e}`);
} finally {
  await browser.close();
  server?.kill?.();
}
process.exit(failures.length ? 1 : 0);
