// What the monkey runs share: the seeded generator, the table of random ops a body edit
// draws from, running one on a page, and Save As with the read-back of the saved file.
import { readFile } from 'node:fs/promises';
import { MOD, settle } from '../browser.mjs';

export const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNwaDgAAAKEAYEml6crAAAAAElFTkSuQmCC';

// fuzzDoc.ts's generator, so a seed replays.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
export const int = (r, min, max) => min + Math.floor(r() * (max - min + 1));

export const WORDS = ['lorem ', 'Ipsum', ' dolor sit ', 'äöü ', '42', '. ', 'A', ' — ', 'x'];
export const KEYS = ['Enter', 'Enter', 'Backspace', 'Backspace', 'Delete', 'Tab', 'Shift+Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Shift+ArrowLeft', 'Shift+ArrowRight', 'Shift+ArrowDown', 'Home', 'End', `${MOD}+b`, `${MOD}+i`, `${MOD}+u`, `${MOD}+Shift+7`, `${MOD}+Shift+8`,
  `${MOD}+Enter`, `${MOD}+z`, `${MOD}+Shift+z`];
export const STYLES = ['Standard', 'Heading 1', 'Heading 2', 'Heading 3', 'Title', 'Quotations'];
export const WRAPS = ['inline', 'left', 'right', 'topBottom', 'through'];
// Each entry: a weight and a draw of the op — a key, typed text, or an editor command.
export const OPS_TABLE = [
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
export const TOTAL = OPS_TABLE.reduce((n, [w]) => n + w, 0);
export const drawOp = (r, size) => {
  let x = r() * TOTAL;
  for (const [w, draw] of OPS_TABLE) { if ((x -= w) < 0) return draw(r, size); }
  return { key: 'ArrowRight' };
};

/** The ops that act on `page`'s body editor, and its saved file read back. */
export function monkeyOn(page) {
  const ed = (fn, arg) => page.evaluate(fn, arg);
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

  const saveAs = async (ext, retry = true) => {
    try {
      // A layout still moving swallows the click on the tab as well as the one in the menu,
      // so both are retried; a shorter timeout leaves room for the second go. The retry
      // forces the tab: on a settled document the ribbon no longer moves, and Playwright's
      // own stability sampling is what misses on a busy main thread.
      await page.click('.ribbon-tab-file', { timeout: 15_000, force: !retry });
      // Without a save picker the app asks for the name first; its dialog offers the document's.
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }),
        page.locator('.ribbon-menu button', { hasText: `(.${ext})` }).first().click()
          .then(() => page.locator('dialog[open] button.primary').click({ timeout: 15_000 }).catch(() => {})),
      ]);
      await page.keyboard.press('Escape');
      return new Uint8Array(await readFile(await dl.path()));
    } catch (err) {
      // One more go once the document stopped moving; a second miss is a finding — and so
      // is a document that never stops, which is what the app would be doing wrong here.
      if (!retry) throw err;
      await page.keyboard.press('Escape');
      await settle(page, true).catch(() => {
        throw new Error(`the document never stopped moving before Save As (.${ext})`);
      });
      return saveAs(ext, false);
    }
  };
  // The file the app saved, read back by the app's importer against the editor's document
  // (its paragraphs joined across a column or page merged, as the export merges them).
  const roundTrip = (bytes, ext) => ed(async ({ b64, ext }) => {
    const [{ importOdt }, { importDocx }, { mergeJoinedParagraphsJson }, { normalize, firstDiff, stripFontHoist, stripBoxGrowth, stripBreakSpace }, hfStore, { effectiveListLevel, defaultLevelBullet }, { withRenderedBoxHeights }] = await Promise.all([
      import('/src/lib/import/odt.ts'), import('/src/lib/import/docx.ts'), import('/src/lib/export/odt.ts'), import('/tests/normalize.ts'),
      import('/src/lib/storage/headerFooter.ts'), import('/src/lib/styles/listStyles.ts'), import('/src/lib/editor/extensions/textBox.ts')]);
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const res = ext === 'odt' ? importOdt(bin) : importDocx(bin);
    const editor = document.querySelector('.tiptap-host .tiptap').editor;
    // A .docx carries each box as tall as it renders, read back fixed (normalize.ts).
    const json = ext === 'docx' ? withRenderedBoxHeights(editor.view) : editor.getJSON();
    // What the importer suppresses as the style's own: a block attribute equal to what its
    // named style resolves to, and bold in a header cell.
    const { resolveStyle } = await import('/src/lib/styles/styleSheet.ts');
    const sheet = editor.extensionManager.extensions.find((e) => e.name === 'paragraphStyle')?.options.sheet();
    const plainText = (n) => n.text ?? (n.content ?? []).map(plainText).join('');
    const nameless = new Set();
    const lookless = (n) => {
      if (n.type === 'paragraph' && nameless.has(plainText(n))) { n.attrs = {}; for (const c of n.content ?? []) delete c.marks; }
      (n.content ?? []).forEach(lookless);
      return n;
    };
    const styled = (n, header = false, framed = false, text = {}, nested = false) => {
      // getJSON hands out the nodes' and marks' own attrs, which blocks can share.
      if (n.attrs) n.attrs = { ...n.attrs };
      n.marks = n.marks?.map((m) => (m.attrs ? { ...m, attrs: { ...m.attrs } } : m));
      // A heading's level already names its style, so neither importer writes one out —
      // and the style it resolves to is the one whose values are suppressed.
      const style = n.attrs?.styleName ?? (n.type === 'heading' ? `Heading ${n.attrs?.level ?? 1}` : null);
      if (style && sheet) {
        const own = resolveStyle(sheet, style, 'paragraph');
        for (const [k, v] of Object.entries(n.attrs)) if (k !== 'styleName' && own.para?.[k] === v) delete n.attrs[k];
        text = own.text ?? {};
        // A block in a list or a cell loses the name to its effect (import/CLAUDE.md), which
        // both files compare without, by the block's text.
        if (nested && n.type === 'paragraph' && n.attrs?.styleName) nameless.add(plainText(n));
      }
      if (header && n.type === 'text' && n.marks) n.marks = n.marks.filter((m) => m.type !== 'bold');
      // A formula alone in its block (beside no text, only breaks or white space) is a display
      // formula to both files; a note holds its inline content without a paragraph.
      const kids = ['paragraph', 'heading', 'note'].includes(n.type) ? n.content ?? [] : [];
      const lone = kids.filter((c) => c.type === 'formula');
      if (lone.length === 1 && kids.every((c) => c.type === 'formula' || c.type === 'hardBreak' || (c.type === 'text' && !c.text.trim()))) lone[0].attrs = { ...lone[0].attrs, display: true };
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
      for (const c of n.content ?? []) styled(c, header || n.type === 'tableHeader', inFrame, text, nested || inFrame || n.type === 'listItem');
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
    // A DOCX cell or text box ends in a paragraph, so one follows a table that ends it.
    const cellTail = (n) => {
      const kids = n.content ?? [], last = kids[kids.length - 1];
      if (/^(tableCell|tableHeader|textBox)$/.test(n.type) && last?.type === 'paragraph' && !last.content?.length && kids[kids.length - 2]?.type === 'table') kids.pop();
      kids.forEach(cellTail);
      return n;
    };
    const flat = (n) => stripFontHoist(normalize(lookless(ext === 'docx' ? cellTail(stripBreakSpace(stripBoxGrowth(flatLists(n)))) : n)));
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
  return { runCmd, docCheck, saveAs, roundTrip };
}
