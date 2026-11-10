// Browser DOM run: the layout the vitest suite cannot see. A corpus document is
// opened and its pagination watched through a settle, a reload, a zoom and an edit —
// the page count is what every layer on the page is measured against. Fails on any
// uncaught page error.
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT, MOD, checker, previewServer, openApp, settle } from '../browser.mjs';

const PORT = +(process.env.DOM_PORT ?? 4185);
const { check, failures } = checker();
const server = await previewServer(PORT);
const { browser, page, pageErrors } = await openApp(PORT);

// "Page 1 of 4" in the status bar is the editor's own count, after its settle loop.
const pageCount = () => page.evaluate(() => {
  const m = /of (\d+)/.exec(document.querySelector('.statusbar')?.textContent ?? '');
  return m ? +m[1] : 0;
});
const settled = async (want) => {
  await page.waitForFunction((n) => {
    const m = /of (\d+)/.exec(document.querySelector('.statusbar')?.textContent ?? '');
    return m && (n ? +m[1] === n : +m[1] > 1);
  }, want, { timeout: 30_000 }).catch(() => {});
  return pageCount();
};
// The status bar's spell-check language: 'sel' is the text at the cursor, 'doc' all text.
const pickSpellLanguage = async (scope, label) => {
  await page.click('.statusbar .lang-picker');
  const layer = page.locator('.statusbar .menu-layer');
  if (scope === 'sel') return layer.getByRole('menuitemcheckbox', { name: label, exact: true }).click();
  await layer.locator('.cm-subwrap > button').click();
  await layer.locator('.cm-sub').getByRole('menuitem', { name: label, exact: true }).click();
};

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });

  // What the browser asks before closing the tab: a beforeunload nobody cancels lets it go.
  const holdsOn = () => page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  check(!(await holdsOn()), 'an empty document lets the tab close');

  // Save on a document with no file behind it settles the format first: the download
  // route cannot read one back from the browser's own dialog.
  await page.evaluate(() => { window.showSaveFilePicker = undefined; });
  await page.click('.tiptap');
  await page.keyboard.type('Format first');
  check(await holdsOn(), 'a document that was never saved warns before the tab closes');
  await page.keyboard.press(`${MOD}+s`);
  const [firstSave] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.locator('dialog[open] button', { hasText: '(.docx)' }).first().click(),
  ]);
  check(firstSave.suggestedFilename().endsWith('.docx'),
    `Ctrl+S on an unsaved document asks for the format (${firstSave.suggestedFilename()})`);
  check(!(await holdsOn()), 'the saved document lets the tab close again');

  // A multi-page corpus document, through the file input (no picker in headless).
  await page.setInputFiles('input.file-input[accept*=".odt"]', join(ROOT, 'tests/corpus/05-breaks.odt'));
  await page.waitForFunction(() => (document.querySelector('.tiptap')?.textContent ?? '').length > 200,
    null, { timeout: 30_000 });
  const opened = await settled();
  check(opened > 1, `corpus document opens and paginates (${opened} pages)`);

  // The settle loop re-measures for a while after the last change; the count it lands
  // on has to be the one it keeps.
  await page.waitForTimeout(2000);
  const still = await pageCount();
  check(still === opened, `the page count holds still after the settle (${opened} → ${still})`);

  // The same document out of the autosave paginates the same way.
  await page.waitForFunction(() => (localStorage.getItem('edentext-doc') ?? '').length > 1000,
    null, { timeout: 15_000 });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });
  const restored = await settled(opened);
  check(restored === opened, `the restored document keeps its page count (${restored})`);

  // Zoom is a transform over the same layout, so it must not move a page break.
  await page.evaluate(() => localStorage.setItem('edentext-zoom', '50'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });
  const zoomed = await settled(opened);
  check(zoomed === opened, `zooming out keeps the page count (${zoomed} at 50%)`);

  // The ruler's marks between the cm and its numbers thin out with the zoom: whatever
  // is drawn keeps clear of its neighbours, and at 100% the quarter marks are there.
  const ruler = () => page.evaluate(() => {
    const marks = Array.from(document.querySelectorAll('.ruler .sub'), (m) => m.getBoundingClientRect().left).sort((a, b) => a - b);
    const labels = Array.from(document.querySelectorAll('.ruler .tick span'), (s) => s.getBoundingClientRect()).sort((a, b) => a.left - b.left);
    const gaps = marks.slice(1).map((x, i) => x - marks[i]);
    const crowded = labels.slice(1).some((r, i) => r.left < labels[i].right + 2)
      || marks.some((x) => labels.some((r) => x > r.left - 2 && x < r.right + 2));
    return { count: marks.length, minGap: gaps.length ? Math.min(...gaps) : Infinity, crowded };
  });
  const rulerClear = async (zoom) => {
    const r = await ruler();
    check(r.minGap >= 6 && !r.crowded, `the ruler's marks and numbers keep clear at ${zoom}% (${r.count} marks)`);
    return r;
  };
  await rulerClear(50);
  await page.evaluate(() => localStorage.setItem('edentext-zoom', '20'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.ruler .strip', { timeout: 15_000 });
  await rulerClear(20);

  await page.evaluate(() => localStorage.setItem('edentext-zoom', '100'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });
  await settled(opened);
  const full = await rulerClear(100);
  check(full.count >= 3 * 15, `the ruler shows quarter-cm marks at 100% (${full.count})`);

  // A language for all text rewrites every block's attrs, the blocks on both sides of each
  // page break included; the breaks have to stay where they were, and through the undo.
  // Kept-together paragraphs break between blocks, and a language of their own first
  // gives clearing it something to change. Every step is undone again after.
  const breaks = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-page-break-spacer]'),
    (s) => Math.round(s.getBoundingClientRect().top)).join(','));
  // A slow runner may still be paginating after a fixed pause: read until two reads agree.
  const relabel = async (how) => {
    await page.evaluate(how);
    await page.waitForTimeout(1500);
    let prev, cur = await breaks();
    for (let i = 0; i < 20 && cur !== prev; i++) { await page.waitForTimeout(750); [prev, cur] = [cur, await breaks()]; }
    return cur;
  };
  const undo = () => document.querySelector('.tiptap').editor.commands.undo();
  const breaksKept = await relabel(() => document.querySelector('.tiptap').editor.chain()
    .selectAll().updateAttributes('paragraph', { keepLines: true }).setTextSelection(1).run());
  const breaksLabelled = await relabel(() => document.querySelector('.tiptap').editor.chain()
    .selectAll().setBlockLanguage('fr-FR').setTextSelection(1).run());
  // The caret stays at the top, and the view scrolled away from it stays where it is.
  const scrolled = () => page.evaluate(() => Math.round(document.querySelector('.editor').scrollTop));
  await page.evaluate(() => { const ed = document.querySelector('.editor'); ed.scrollTop = ed.scrollHeight; });
  const scrollBefore = await scrolled();
  await pickSpellLanguage('doc', 'Deutsch');
  await page.waitForTimeout(300);
  const scrollAfter = await scrolled();
  await page.evaluate(() => { document.querySelector('.editor').scrollTop = 0; });
  const breaksCleared = await relabel(() => {});
  const breaksUndone = await relabel(undo);
  check(breaksKept.includes(',') && [breaksLabelled, breaksCleared, breaksUndone].every((b) => b === breaksKept),
    `a language for all text keeps the page breaks (${breaksKept} → ${breaksLabelled} → ${breaksCleared} → ${breaksUndone})`);
  check(scrollBefore > 0 && scrollAfter === scrollBefore,
    `a language for all text leaves the view where it was (scrollTop ${scrollBefore} → ${scrollAfter})`);
  await page.evaluate(undo);
  await page.evaluate(undo);
  await settled(opened);

  // The caret is placed through the editor: a click lands wherever the element's centre
  // happens to be. The focus itself arrives on the next animation frame, so a key sent
  // before it is lost — wait for it.
  const caretTo = async (pos) => {
    await page.evaluate((p) => document.querySelector('.tiptap').editor.commands.focus(p), pos);
    await page.waitForFunction(() => document.activeElement === document.querySelector('.tiptap'), null, { timeout: 5000 });
  };
  const firstParagraphEnd = () => page.evaluate(() => document.querySelector('.tiptap').editor.state.doc.firstChild.nodeSize - 1);

  // A page break after the first paragraph pushes the rest down a page, and undo takes
  // it back. (A break before the empty last paragraph yields no page.)
  await caretTo(await firstParagraphEnd());
  await page.keyboard.press(`${MOD}+Enter`);
  const broken = await settled(opened + 1);
  await caretTo('end');
  await page.keyboard.press(`${MOD}+z`);
  const undone = await settled(opened);
  check(broken === opened + 1 && undone === opened,
    `a page break adds a page and undo takes it back (${opened} → ${broken} → ${undone})`);

  // A plugin view rebuilt while a pass is pending (plugins reconfigured) paginates on.
  await page.evaluate(() => {
    const ed = document.querySelector('.tiptap').editor;
    const plugin = ed.state.plugins.find((p) => p.key.startsWith('pageBreaks$'));
    ed.view.dispatch(ed.state.tr.setMeta('addToHistory', false).setMeta('forcePageBreakRecalc', true));
    ed.unregisterPlugin('pageBreaks');
    ed.registerPlugin(plugin);
  });
  await caretTo(await firstParagraphEnd());
  await page.keyboard.press(`${MOD}+Enter`);
  const rebuilt = await settled(opened + 1);
  await caretTo('end');
  await page.keyboard.press(`${MOD}+z`);
  check(rebuilt === opened + 1 && await settled(opened) === opened,
    `pagination survives its plugin view being rebuilt mid-pass (${opened} → ${rebuilt})`);

  // The unsaved dot: an edit raises it, an undo back to the saved text clears it
  // again (it is a checksum, not the document's identity), and so does opening a file.
  // It follows on the next idle beat, so wait for the state rather than a fixed pause.
  const dot = async (want) => {
    await page.waitForFunction((w) => !!document.querySelector('.doc-dirty') === w, want, { timeout: 10_000 })
      .catch(() => {});
    return page.evaluate(() => !!document.querySelector('.doc-dirty'));
  };
  await caretTo('end');
  await page.keyboard.type('nachtrag');
  const marked = await dot(true);
  await page.keyboard.press(`${MOD}+z`);
  const backToSaved = await dot(false);
  await page.setInputFiles('input.file-input[accept*=".odt"]', join(ROOT, 'tests/corpus/04-table.odt'));
  await page.waitForFunction(() => document.querySelector('.tiptap table td')?.textContent.trim(),
    null, { timeout: 30_000 });
  const opened2 = await dot(false);
  check(marked && !backToSaved && !opened2,
    `the dot follows the text (edit: ${marked}, undone: ${backToSaved}, after open: ${opened2})`);

  // The page setup is in the file too, so a margin preset marks it as much as text does.
  await page.locator('.ribbon-tab', { hasText: 'Layout' }).first().click();
  await page.locator('.rb-label', { hasText: 'Margins' }).first().click();
  await page.locator('.ribbon-menu button', { hasText: 'Narrow' }).first().click();
  const afterMargins = await dot(true);
  check(afterMargins, `a margin preset marks the document unsaved (${afterMargins})`);

  // The page setup is on the one undo stack too: the preset is taken back and redone.
  const margins = () => page.evaluate(() => localStorage.getItem('edentext-page-margins') ?? '');
  const narrow = await margins();
  await page.waitForTimeout(600);
  await caretTo('end');
  await page.keyboard.press(`${MOD}+z`);
  const wideAgain = await page.waitForFunction((n) => (localStorage.getItem('edentext-page-margins') ?? '') !== n, narrow, { timeout: 5000 })
    .then(() => true, () => false);
  await page.keyboard.press(`${MOD}+Shift+z`);
  const narrowAgain = await page.waitForFunction((n) => (localStorage.getItem('edentext-page-margins') ?? '') === n, narrow, { timeout: 5000 })
    .then(() => true, () => false);
  check(wideAgain && narrowAgain, `undo and redo reach a margin preset (undone: ${wideAgain}, redone: ${narrowAgain}, now ${await margins()})`);

  // And so does the name the file is saved under. The file comes back in first, so the
  // rename is the only thing standing between the document and its clean state.
  await page.setInputFiles('input.file-input[accept*=".odt"]', join(ROOT, 'tests/corpus/04-table.odt'));
  await page.waitForFunction(() => document.querySelector('.tiptap table td')?.textContent.trim(),
    null, { timeout: 30_000 });
  const reopened = await dot(false);
  await page.fill('.doc-name-input', 'Umbenannt');
  const afterRename = await dot(true);
  check(!reopened && afterRename, `a rename marks the document unsaved (${afterRename})`);

  // Without the File System Access API (Brave ships with it off) a save is a download, so
  // the format is settled before the bytes are built: Save As (.docx) hands over a DOCX.
  // An engine without the API from the start asks for the name first, a download being
  // unable to report one; its dialog offers the document's name.
  await page.evaluate(() => { window.showSaveFilePicker = undefined; });
  await page.click('.ribbon-tab-file');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.locator('.ribbon-menu button', { hasText: '(.docx)' }).first().click()
      .then(() => page.locator('dialog[open] button.primary').click({ timeout: 2_000 }).catch(() => {})),
  ]);
  const saved = await readFile(await download.path());
  const isDocx = saved[0] === 0x50 && saved[1] === 0x4b && saved.includes('word/document.xml');
  check(isDocx, `Save As (.docx) without a picker downloads a DOCX (${download.suggestedFilename()}, ${saved.length} bytes)`);

  // The whole margin band is the zone's double-click target, and an empty zone's
  // placeholder sits where the first typed character lands — not a line below it.
  await page.keyboard.press('Escape');
  await page.locator('.hf-zone.hf-footer').first().scrollIntoViewIfNeeded();
  const fb = await page.locator('.hf-zone.hf-footer').first().boundingBox();
  await page.mouse.dblclick(fb.x - 40, fb.y + fb.height + 20);
  await page.waitForSelector('.hf-active.hf-footer .tiptap', { timeout: 5000 });
  check(true, 'a double-click below and left of the footer zone still opens it');
  const lineTop = () => page.evaluate(() => document.querySelector('.hf-active .tiptap p').getBoundingClientRect().top);
  const emptyTop = await lineTop();
  await page.keyboard.type('x');
  const typedTop = await lineTop();
  check(Math.abs(emptyTop - typedTop) < 1,
    `the footer placeholder sits on the typed line (${emptyTop.toFixed(1)} → ${typedTop.toFixed(1)})`);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');

  // The header/footer switches live in the ribbon's Insert tab. A ticked "different
  // first page" makes page 1 a second zone, so what is typed there lands beside the
  // running one — and the distance travels to the app's own storage.
  await page.keyboard.press('Escape');
  await page.locator('.ribbon-tab', { hasText: 'Insert' }).first().click();
  const hfOptions = page.locator('button.rb', { hasText: 'Options' }).first();
  await hfOptions.click();
  await page.locator('.ribbon-menu .check-row input').first().check();
  const dist = page.locator('.ribbon-menu .num-row input').first();
  await dist.fill('1.8');
  await dist.dispatchEvent('change');
  await hfOptions.click();
  const zone = page.locator('.hf-zone.hf-header').first();
  await zone.dblclick({ timeout: 5000 }).catch(() => zone.dispatchEvent('dblclick'));
  await page.waitForSelector('.hf-active .tiptap', { timeout: 5000 });
  await page.waitForFunction(() => document.activeElement?.closest?.('.hf-active'), null, { timeout: 5000 });
  await page.keyboard.type('Titelseite');
  // A zone opened empty starts on the centre/right stops, so name-tab-tab-number is one
  // line with the number on the right margin. Measured: a pass that read its own advance
  // back off the DOM counted it twice and broke the second tab onto a line of its own.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.type('7');
  await page.waitForTimeout(1500);
  const head = await page.evaluate(() => {
    const p = document.querySelector('.hf-active .tiptap p');
    const r = p.getBoundingClientRect();
    const last = document.createRange();
    last.setStart(p, p.childNodes.length - 1);
    last.setEnd(p, p.childNodes.length);
    const num = last.getBoundingClientRect();
    return { height: r.height, gap: r.right - num.right, stops: p.getAttribute('data-tab-stops') };
  });
  check(head.height < 25 && Math.abs(head.gap) < 4,
    `two tabs in a running head stay on its line, the number on the right margin (height ${head.height.toFixed(1)}px, gap ${head.gap.toFixed(1)}px, stops ${head.stops})`);
  await page.locator('.hf-bar-done').click();
  const hf = await page.evaluate(() => ({
    first: localStorage.getItem('edentext-hf-different-first'),
    running: localStorage.getItem('edentext-header'),
    firstPage: localStorage.getItem('edentext-header-first') ?? '',
    dist: localStorage.getItem('edentext-hf-distances') ?? '',
  }));
  check(hf.first === 'true' && !hf.running && hf.firstPage.includes('Titelseite') && /"header":1.8/.test(hf.dist),
    `the ribbon's header/footer switches reach the document (first page: ${hf.first}, running zone: ${hf.running}, distances: ${hf.dist})`);

  // One history for body and zones: undo takes back the body's typing, then the header's.
  const firstHead = () => page.evaluate(() => localStorage.getItem('edentext-header-first') ?? '');
  const headDone = await firstHead();
  await caretTo('end');
  await page.keyboard.type('Rumpf');
  await page.waitForTimeout(600);
  await page.keyboard.press(`${MOD}+z`);
  const bodyBack = await page.evaluate(() => !document.querySelector('.tiptap').textContent.includes('Rumpf'));
  await page.keyboard.press(`${MOD}+z`);
  const headUndone = await page.waitForFunction((h) => (localStorage.getItem('edentext-header-first') ?? '') !== h, headDone, { timeout: 5000 })
    .then(() => true, () => false);
  await page.keyboard.press(`${MOD}+Shift+z`);
  const headRedone = await page.waitForFunction((h) => (localStorage.getItem('edentext-header-first') ?? '') === h, headDone, { timeout: 5000 })
    .then(() => true, () => false);
  check(bodyBack && headUndone && headRedone,
    `undo reaches the header after the body's typing (body undone: ${bodyBack}, header undone: ${headUndone}, redone: ${headRedone}, now ${(await firstHead()).slice(0, 60)})`);

  // A style rename retags its paragraphs in the same step, so one undo takes back both.
  const styled = () => page.evaluate(() => {
    const names = new Set();
    document.querySelector('.tiptap').editor.state.doc.descendants((n) => { if (n.attrs.styleName) names.add(n.attrs.styleName); });
    const sheet = localStorage.getItem('edentext-styles') ?? '';
    return { doc: [...names], sheet: sheet.includes('"Umbenannt"') };
  });
  await caretTo('end');
  await page.locator('.ribbon-tab', { hasText: 'Home' }).first().click();
  await page.locator('.gallery-more').first().click();
  await page.locator('.rb-menu-foot', { hasText: 'Manage styles' }).click();
  await page.locator('dialog.styles button', { hasText: 'New from selection' }).click();
  const created = await page.evaluate(() => document.querySelector('.tiptap').editor.state.selection.$from.parent.attrs.styleName);
  await page.locator('dialog.styles .entry.active').dblclick();
  await page.locator('dialog.styles input.rename').fill('Umbenannt');
  await page.keyboard.press('Enter');
  const renamed = await styled();
  await page.keyboard.press('Escape');
  await caretTo('end');
  await page.waitForTimeout(600);
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForTimeout(300);
  const unrenamed = await styled();
  await page.keyboard.press(`${MOD}+Shift+z`);
  await page.waitForTimeout(300);
  const rerenamed = await styled();
  check(renamed.doc.includes('Umbenannt') && renamed.sheet
    && unrenamed.doc.includes(created) && !unrenamed.doc.includes('Umbenannt') && !unrenamed.sheet
    && rerenamed.doc.includes('Umbenannt') && rerenamed.sheet,
    `one undo takes back a style rename with its paragraphs (created ${created}, renamed ${JSON.stringify(renamed)}, undone ${JSON.stringify(unrenamed)}, redone ${JSON.stringify(rerenamed)})`);
  // Past the autosave's debounce: a save still pending is flushed on the reload below.
  await page.waitForTimeout(1200);

  // Typing latency in a long document. A keystroke at the top moves every page break
  // below it, so this is where a whole-document pass costs the most: blocked main-thread
  // time per keystroke in a burst, then the pass that follows the burst.
  const LOREM = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua'.split(' ');
  const long = { type: 'doc', content: [] };
  for (let i = 0; i < 1600; i++) {
    let s = '';
    for (let k = i; s.length < 300; k++) s += LOREM[k % LOREM.length] + ' ';
    long.content.push({ type: 'paragraph', content: [{ type: 'text', text: s.trim() }] });
  }
  await page.evaluate((d) => localStorage.setItem('edentext-doc', JSON.stringify(d)), long);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });
  await settle(page, true);
  const longPages = await pageCount();
  // How long the page holds the thread: a zero timeout resolves once it is free again.
  const blocked = async () => {
    const t = performance.now();
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    return performance.now() - t;
  };
  await caretTo(1);
  const keys = [];
  for (const ch of 'The quick brown fox jumps') {
    const t = performance.now();
    await page.keyboard.type(ch);
    await blocked();
    keys.push(performance.now() - t);
  }
  // A split always moves the blocks below, so the pause after it holds a whole-document
  // pass: what a layout costs, recorded for the day it goes incremental.
  await page.keyboard.press('Enter');
  let pass = 0;
  for (const until = Date.now() + 4000; Date.now() < until;) pass = Math.max(pass, await blocked());
  keys.sort((a, b) => a - b);
  const keyMedian = Math.round(keys[keys.length >> 1]);
  const keyP90 = Math.round(keys[Math.floor(keys.length * 0.9)]);
  const keyMax = Math.round(keys[keys.length - 1]);
  // Typing feels fluid under ~100 ms a key, but the three engines are that far apart on this
  // document (Gecko ~20, Blink ~40, WebKit ~55 on a laptop) and a CI runner is about twice a
  // laptop, so each gets double what CI measures — a regression here is a multiple, not a few %.
  const BUDGET = { chromium: 160, firefox: 120, webkit: 240 }[process.env.BROWSER ?? 'chromium'] ?? 240;
  // The budget is the 90th percentile, not the worst key: the first stroke of a burst warms
  // caches and a shared runner stalls once in a while, neither of which the typist feels.
  check(longPages > 100 && keyMedian < BUDGET && keyP90 < BUDGET * 1.5,
    `typing at the top of a ${longPages}-page document: ${keyMedian} ms per keystroke (p90 ${keyP90}, max ${keyMax}, budget ${BUDGET}), ${Math.round(pass)} ms pass after a split`);
  // A letter typed and taken back leaves every block as tall as it was, so no pass runs
  // (a pass that moves something ends in a pm-pagecount event), and the pause costs no more
  // than a key (the engine's budget): the spell checker re-reads the edited paragraph only.
  // A slow runner is still settling the split past the window above; its tail is not the letter's.
  await settle(page, true);
  await page.evaluate(() => {
    window.__passes = 0;
    document.querySelector('.tiptap').addEventListener('pm-pagecount', () => { window.__passes++; });
  });
  await page.keyboard.type('x');
  await blocked();
  await page.keyboard.press('Backspace');
  let idle = 0;
  for (const until = Date.now() + 1500; Date.now() < until;) idle = Math.max(idle, await blocked());
  const passes = await page.evaluate(() => window.__passes);
  check(passes === 0 && idle < BUDGET,
    `a letter typed and taken back runs no pass and its pause is free (${passes} passes, ${Math.round(idle)} ms blocked at most)`);

  // A pass that lands the layout the last one did announces nothing: every reader of the
  // event re-reads the whole document from it — the index its page numbers, the header
  // band its geometry — and a redundant round would set them all going again.
  await page.evaluate(() => {
    window.__passes = 0;
    const editor = document.querySelector('.tiptap').editor;
    editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false).setMeta('forcePageBreakRecalc', true));
  });
  for (const until = Date.now() + 1500; Date.now() < until;) await blocked();
  const quiet = await page.evaluate(() => window.__passes);
  check(quiet === 0, `a recalc that finds the same layout announces no page count (${quiet} events)`);

  // The block after a band-wrapped frame clears it; one after a page-anchored frame does
  // not. Keyed on an attribute image.ts writes (a `:has()` restyles the whole document).
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNwaDgAAAKEAYEml6crAAAAAElFTkSuQmCC';
  const frame = (attrs) => ({ type: 'image', attrs: { src: PNG, width: 120, height: 60, ...attrs } });
  const block = (...content) => ({ type: 'paragraph', content });
  const words = (t) => ({ type: 'text', text: t });
  // Out of the autosave, as a reload builds it: the anchored frame is placed while the
  // view is still being built.
  await page.evaluate((d) => localStorage.setItem('edentext-doc', JSON.stringify(d)), { type: 'doc', content: [
    block(words('above')), block(words('with '), frame({ wrap: 'topBottom' })), block(words('below')),
    block(frame({ wrap: 'topBottom', anchorPage: 1 })), block(words('after anchored')),
    block(frame({ wrap: 'topBottom' })), block(frame({ wrap: 'topBottom' })), block(words('after two')),
  ] });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });
  await settle(page, true);
  const bands = await page.evaluate(() => Array.from(document.querySelectorAll('.tiptap-host .tiptap > p'),
    (p) => `${p.getAttribute('data-wrap-band') ?? '-'}/${getComputedStyle(p).clear}`).join(' '));
  check(bands === '-/none true/none -/both anchored/none -/none true/none true/none -/both',
    `loaded from the autosave, the block after a band frame clears it, after an anchored one it does not (${bands})`);

  // A borderless table split inside its cell, its pages centred beside a landscape section
  // — under a footer taller than the bottom margin, under none, and above a footnote: the
  // mask draws no edge lines, its gap stripe sits on the sheets' gap, neither reaches past
  // the table's pages, no line of the cell lies under it and the note stays visible below
  // its top. The document's own 2cm margins: the band once took a default reach of its own.
  const cellLines = Array.from({ length: 70 }, (_, i) => block(words(`cell line ${i + 1}`)));
  const tallFooter = { type: 'doc', content: Array.from({ length: 6 }, (_, i) => block(words(`footer ${i + 1}`))) };
  for (const [label, footer, note] of [['a tall footer', tallFooter, false], ['no footer', null, false], ['a footnote', null, true]]) {
    await page.evaluate(([d, f]) => {
      localStorage.setItem('edentext-doc', JSON.stringify(d));
      if (f) localStorage.setItem('edentext-footer', JSON.stringify(f));
      else localStorage.removeItem('edentext-footer');
      localStorage.setItem('edentext-hf-sections', JSON.stringify([{ orientation: 'landscape' }]));
      localStorage.setItem('edentext-page-margins', JSON.stringify({ top: 2, bottom: 2, left: 2, right: 2 }));
    }, [{ type: 'doc', content: [
      ...(note ? [block(words('noted'), { type: 'noteRef', attrs: { id: 'n1', kind: 'footnote' } })] : []),
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell',
        attrs: { borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none' }, content: cellLines }] }] },
      { type: 'paragraph', attrs: { breakBefore: 'page', sectionBreak: true }, content: [words('landscape')] },
      ...(note ? [{ type: 'noteSection', content: [{ type: 'note', attrs: { id: 'n1', kind: 'footnote' }, content: [words('the note')] }] }] : []),
    ] }, footer]);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.tiptap', { timeout: 15_000 });
    await settle(page, true);
    const mask = await page.evaluate(() => {
      document.querySelector('.table-break-band')?.scrollIntoView({ block: 'center' });
      const stripe = document.querySelector('.page-gap-stripe');
      const sheets = Array.from(document.querySelectorAll('.page-sheet'), (s) => s.getBoundingClientRect());
      const top = stripe ? stripe.getBoundingClientRect().top + 1 : NaN;
      const page = sheets[0];
      const outside = [stripe, ...document.querySelectorAll('.table-break-band')].filter((e) => e).map((e) => e.getBoundingClientRect())
        .reduce((m, r) => Math.max(m, page.left - r.left, r.right - page.right), 0);
      const band = document.querySelector('.table-break-band')?.getBoundingClientRect();
      const under = (sel) => Array.from(document.querySelectorAll(sel), (p) => p.getBoundingClientRect())
        .filter((r) => band && r.bottom > band.top + 0.5 && r.top < band.bottom - 0.5).length;
      // A note inside the table's frame, or painted over by the mask, is the table not closing
      // above it. The overlay takes no pointer events, which a hit test would look through.
      const layer = document.querySelector('.band-layer');
      if (layer) layer.style.pointerEvents = 'auto';
      const enclosed = Array.from(document.querySelectorAll('.tiptap-host .note'), (n) => n.getBoundingClientRect())
        .filter((r) => band && (r.top < band.top - 0.5 || !document.elementFromPoint(r.left + 20, r.top + r.height / 2)?.closest('.note'))).length;
      if (layer) layer.style.pointerEvents = '';
      return { lines: document.querySelectorAll('.table-break-band.lines').length, outside, hidden: under('.tiptap-host .tiptap td p'),
        enclosed, off: Math.min(...sheets.map((r) => Math.abs(r.bottom - top))) };
    });
    check(mask.lines === 0 && mask.off <= 1 && mask.outside <= 1 && mask.hidden === 0 && mask.enclosed === 0,
      `with ${label}, a borderless table's page-break mask draws no lines and its gap on the sheets', within its pages, over no text and under no note (${mask.lines} lines, ${mask.off.toFixed(1)}px off, ${mask.outside.toFixed(1)}px outside, ${mask.hidden} lines under it, ${mask.enclosed} notes enclosed or hidden)`);
  }
  await page.evaluate(() => ['edentext-footer', 'edentext-hf-sections', 'edentext-page-margins'].forEach((k) => localStorage.removeItem(k)));

  // A row that may not break and is taller than a page starts on a fresh one.
  await page.evaluate((d) => localStorage.setItem('edentext-doc', JSON.stringify(d)), { type: 'doc', content: [
    ...Array.from({ length: 5 }, (_, i) => block(words(`before ${i + 1}`))),
    { type: 'table', content: [{ type: 'tableRow', attrs: { cantSplit: true }, content: [{ type: 'tableCell', content:
      Array.from({ length: 70 }, (_, i) => block(words(`kept line ${i + 1}`))) }] }] }] });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });
  await settle(page, true);
  const keptPage = await page.evaluate(() => {
    const p = Array.from(document.querySelectorAll('.tiptap-host .tiptap td p')).find((e) => e.textContent === 'kept line 1');
    const sheets = Array.from(document.querySelectorAll('.page-sheet'), (s) => s.getBoundingClientRect());
    const top = p ? p.getBoundingClientRect().top : NaN;
    return sheets.findIndex((r) => top >= r.top && top < r.bottom) + 1;
  });
  check(keptPage === 2, `a row that may not break, taller than a page, starts on the next one (page ${keptPage})`);

  // In the larger-of spacing model a block's space above is a margin, outside the box the
  // page break moves: a manual break must clear it too, less the space below the block before.
  await page.evaluate((d) => {
    localStorage.setItem('edentext-doc', JSON.stringify(d));
    localStorage.setItem('edentext-spacing-model', 'max');
  }, { type: 'doc', content: [{ type: 'paragraph', attrs: { spaceAfter: 6 }, content: [words('first page')] },
    { type: 'paragraph', attrs: { breakBefore: 'page', spaceBefore: 24 }, content: [words('spaced page')] }] });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });
  await settle(page, true);
  // Measured from the sheet's top: the default 2cm margin is 75.6px, the space 32 − 8px.
  const keptTop = await page.evaluate(() => {
    const sheets = Array.from(document.querySelectorAll('.page-sheet'), (s) => s.getBoundingClientRect().top);
    const r = Array.from(document.querySelectorAll('.tiptap-host .tiptap > p')).find((p) => p.textContent === 'spaced page').getBoundingClientRect().top;
    return r - sheets.filter((s) => s <= r + 1).pop();
  });
  check(Math.abs(keptTop - (75.6 + 24)) <= 1.5, `a manual break keeps the space above in the larger-of model (${keptTop.toFixed(1)}px below the sheet top)`);
  await page.evaluate(() => localStorage.removeItem('edentext-spacing-model'));

  // Two left floats in one paragraph each sit at their own x: the later one, set left of
  // where CSS queues it, is pulled back; its gap is cut at the column's edge.
  await page.evaluate((d) => localStorage.setItem('edentext-doc', JSON.stringify(d)), { type: 'doc', content: [
    block(frame({ wrap: 'left', wrapOffset: 5 }), frame({ wrap: 'left', wrapOffset: 0.5 }), words('text')),
  ] });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });
  await settle(page, true);
  const floatsX = await page.evaluate(() => {
    const p = document.querySelector('.tiptap-host .tiptap > p');
    const left = p.getBoundingClientRect().left;
    return Array.from(p.querySelectorAll(':scope > .image-node'), (f) => Math.round(f.getBoundingClientRect().left - left));
  });
  check(Math.abs(floatsX[0] - 189) <= 1 && Math.abs(floatsX[1] - 19) <= 1,
    `two left floats in one paragraph sit at their own x (${floatsX.join(', ')}px)`);

  // An index shows the rows it saved, as both word processors do, until it is updated.
  const heading = (t) => ({ type: 'heading', attrs: { level: 1 }, content: [words(t)] });
  await page.evaluate((d) => localStorage.setItem('edentext-doc', JSON.stringify(d)), { type: 'doc', content: [
    { type: 'tableOfContents', attrs: { title: '', entries: [{ text: 'Two', level: 1, page: 9 }, { text: 'Gone', level: 1, page: 7 }] } },
    heading('One'), heading('Two'),
  ] });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.toc-entry', { timeout: 15_000 });
  await settle(page, true);
  const tocRows = () => page.evaluate(() => Array.from(document.querySelectorAll('.toc-entry'),
    (r) => `${r.querySelector('.toc-text').textContent} ${r.querySelector('.toc-page').textContent}`).join(', '));
  const cachedRows = await tocRows();
  // Word's other choice: the saved rows stay, their page numbers are renewed.
  await page.evaluate(() => document.querySelector('.tiptap').editor.commands.updateIndexes('pages'));
  await settle(page, true);
  const renumbered = await tocRows();
  await page.evaluate(() => document.querySelector('.tiptap').editor.commands.updateIndexes());
  await settle(page, true);
  const updated = await tocRows();
  check(cachedRows === 'Two 9, Gone 7' && renumbered === 'Two 1, Gone 7' && updated === 'One 1, Two 1',
    `an index keeps its saved rows until updated (${cachedRows} → ${renumbered} → ${updated})`);

  // A two-column section over several pages pages in one pass: a continuation is judged
  // with a full page wherever it renders, and the split counts the blocks' margins as the
  // overflow test does — else one block moves down per pass, a pass per block.
  const lines = [];
  for (let i = 0; i < 300; i++) {
    lines.push({ type: 'paragraph', attrs: { spaceAfter: 6 }, content: [words(`Line ${i + 1}: ${LOREM.slice(0, 5 + (i % 5)).join(' ')}`)] });
  }
  await page.evaluate((d) => localStorage.setItem('edentext-doc', JSON.stringify(d)), { type: 'doc', content: [
    block(words('before the section')), { type: 'columns', attrs: { count: 2 }, content: lines }, block(words('after the section')),
  ] });
  await page.addInitScript(() => {
    window.__passes = 0;
    document.addEventListener('pm-pagecount', () => { window.__passes++; });
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });
  await settle(page, true);
  const flow = await page.evaluate(() => ({ passes: window.__passes, fragments: document.querySelectorAll('.tiptap-host .tiptap > .columns-node').length }));
  check(flow.fragments >= 3 && flow.passes <= 8,
    `a two-column section over ${flow.fragments} pages settles in ${flow.passes} passes`);

  // A section below another starts mid-page with its first paragraph's lines, and the one
  // above, followed by more than empty paragraphs, balances its columns; so does the last
  // one while the caret is not in it.
  const prose = (n) => block(words(Array.from({ length: n }, () => LOREM.join(' ')).join(' ')));
  await page.evaluate((d) => localStorage.setItem('edentext-doc', JSON.stringify(d)), { type: 'doc', content: [
    { type: 'columns', attrs: { count: 3 }, content: [prose(26)] }, block(),
    { type: 'columns', attrs: { count: 2 }, content: [prose(100)] },
  ] });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap');
  await settle(page, true);
  const stacked = await page.evaluate(() => {
    const all = document.querySelectorAll('.tiptap-host .tiptap > .columns-node');
    return { columns: all[0].firstElementChild.getClientRects().length, top: Math.round(all[1].offsetTop),
      balanced: !/column-fill:\s*auto/.test(all[all.length - 1].style.cssText) };
  });
  check(stacked.columns === 3 && stacked.top < 1123 && stacked.balanced,
    `a section below another starts on its page (${stacked.top}px), the one above fills ${stacked.columns} columns, the last balances (${stacked.balanced})`);

  // A section narrower than the sheet insets its blocks to their own page's left edge with
  // a node decoration, which the mapping drops when a style change replaces the node: the
  // heading then sat at the sheet's edge until the next pass (docs/architecture/pagination.md).
  await page.setInputFiles('input.file-input[accept*=".odt"]', join(ROOT, 'tests/corpus/17-sections.docx'));
  await page.waitForFunction(() => document.querySelector('.tiptap')?.textContent.includes('Landscape middle'),
    null, { timeout: 30_000 });
  await settle(page, true);
  // The block itself, by its text: the style change turns the h1 into an h3.
  await page.evaluate(() => { window.__heading = () => Array.from(document.querySelectorAll('.tiptap-host .tiptap > *'))
    .find((e) => e.textContent.startsWith('Portrait first')); });
  const inset = await page.evaluate(() => {
    const el = window.__heading();
    return { x: Math.round(el.getBoundingClientRect().left), left: parseFloat(getComputedStyle(el).marginLeft) };
  });
  await page.click('.tiptap h1');
  await page.evaluate(() => {
    window.__xs = [];
    const tick = () => {
      const el = window.__heading();
      if (el) window.__xs.push(Math.round(el.getBoundingClientRect().left));
      if (window.__xs.length < 60) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.keyboard.press(`${MOD}+Alt+3`);
  await page.waitForTimeout(1200);
  const drift = await page.evaluate((x) => Math.max(...window.__xs.map((s) => Math.abs(s - x))), inset.x);
  check(inset.left > 0 && drift <= 1,
    `a style change keeps the block's section inset (${inset.left}px, drifted ${drift}px)`);

  // A click on a heading in the navigator takes the page there, though the click took
  // the editor's focus, which a transaction's own scroll needs.
  await page.evaluate((d) => localStorage.setItem('edentext-doc', JSON.stringify(d)), { type: 'doc', content:
    Array.from({ length: 40 }, (_, i) => [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: `Chapter ${i + 1}` }] },
      ...Array.from({ length: 6 }, () => block(words('A paragraph of the chapter to fill its page. '.repeat(4)))),
    ]).flat().concat([{ type: 'paragraph', content: [{ type: 'text', text: 'the project site', marks: [{ type: 'link', attrs: { href: 'https://example.org' } }] }] }]) });
  await page.reload({ waitUntil: 'load' });
  await settle(page, true);
  await page.keyboard.press('F5');
  const navRow = page.locator('.navigator-pane [role="treeitem"]').last();
  const navText = (await navRow.locator('.label').textContent()).trim();
  await navRow.click();
  await page.waitForFunction((text) => {
    const h = [...document.querySelectorAll('.tiptap-host .tiptap > :is(h1,h2,h3,h4,h5,h6)')].find((e) => text.endsWith(e.textContent.trim()));
    const box = document.querySelector('.editor').getBoundingClientRect();
    const r = h?.getBoundingClientRect();
    return r && r.top >= box.top && r.bottom <= box.bottom;
  }, navText, { timeout: 5_000 }).then(() => true, () => false).then((seen) => check(seen, `a heading clicked in the navigator scrolls into view (${navText})`));

  // The pages tab draws only the tiles in view, each a copy of its own page; a click
  // takes the reader to that page and leaves no second editable copy behind.
  await page.click('.navigator-pane [role="tab"]#nav-tab-pages');
  await page.waitForFunction(() => document.querySelector('.thumbs .zoom .tiptap p'), null, { timeout: 5_000 }).catch(() => {});
  const tiles = await page.evaluate(() => ({
    drawn: document.querySelectorAll('.thumbs .tile').length,
    filled: [...document.querySelectorAll('.thumbs .zoom')].filter((z) => z.querySelector('.tiptap p')).length,
    editable: document.querySelectorAll('[contenteditable="true"]').length,
    pages: +(/of (\d+)/.exec(document.querySelector('.statusbar').textContent)?.[1] ?? 0),
  }));
  check(tiles.filled > 0 && tiles.drawn < tiles.pages && tiles.editable === 1,
    `the pages tab draws the tiles in view as copies of their pages (${tiles.filled}/${tiles.drawn} of ${tiles.pages}, ${tiles.editable} editable)`);
  await page.evaluate(() => { document.querySelector('.thumbs').scrollTop = 1e9; });
  const want = String(tiles.pages);
  await page.click(`.thumbs .tile[data-page="${want}"]`);
  await page.waitForFunction((n) => new RegExp(`^\\D*${n} of`).test(document.querySelector('.statusbar').textContent.trim()), want, { timeout: 5_000 })
    .then(() => true, () => false).then((ok) => check(ok, `a page clicked in the navigator becomes the current page (${want})`));
  // The navigator's search lists every match with its context and jumps to a clicked
  // one; its fold replaces them all.
  await page.fill('.nav-search input[type="search"]', 'Chapter 3');
  const hitCount = await page.locator('.navigator-pane .hit').count();
  await page.locator('.navigator-pane .hit').last().click();
  const hit = await page.waitForFunction(() => {
    const sel = getSelection()?.toString() || document.querySelector('.search-match-current')?.textContent;
    const r = document.querySelector('.search-match-current')?.getBoundingClientRect();
    const box = document.querySelector('.editor').getBoundingClientRect();
    return r && r.top >= box.top && r.bottom <= box.bottom && document.querySelector('.search-match-current').closest('h1')?.textContent;
  }, null, { timeout: 5_000 }).then((h) => h.jsonValue(), () => null);
  check(hitCount === 11 && hit === 'Chapter 39', `the navigator's search lists the matches and shows a clicked one (${hitCount}, ${hit})`);
  // The other tabs show where the matches are: the chapters holding one, the pages only they are on.
  await page.click('.navigator-pane [role="tab"]#nav-tab-headings');
  const foundRows = await page.locator('.navigator-pane li.found').count();
  check(foundRows === 11, `the headings tab marks the chapters a search found something in (${foundRows})`);
  await page.click('.navigator-pane [role="tab"]#nav-tab-pages');
  const onPages = await page.waitForFunction(() => {
    const tiles = [...document.querySelectorAll('.thumbs .tile')];
    const total = +(/of (\d+)/.exec(document.querySelector('.statusbar').textContent)?.[1] ?? 0);
    const filled = tiles.filter((t) => t.querySelector('.zoom .tiptap'));
    return tiles.length && tiles.length < total && filled.length === tiles.length && filled.every((t) => t.querySelector('.search-match'))
      && `${tiles.length} of ${total}`;
  }, null, { timeout: 5_000 }).then((h) => h.jsonValue(), () => null);
  check(!!onPages, `the pages tab lists only the pages with a match (${onPages})`);
  await page.fill('.nav-search input[type="search"]', 'Chapter 40');
  await page.click('.nav-search .fold');
  await page.fill('.nav-search input[type="text"]', 'Closing chapter');
  await page.click('.nav-search button.text:last-of-type');
  const replaced = await page.evaluate(() => [...document.querySelectorAll('.tiptap-host .tiptap > h1')].map((h) => h.textContent).filter((s) => /Chapter 40|Closing/.test(s)));
  check(replaced.join() === 'Closing chapter', `the navigator's search replaces its matches (${replaced.join()})`);
  // A heading dragged onto the top half of another lands before it, with its chapter.
  await page.click('.navigator-pane [role="tab"]#nav-tab-headings');
  await page.locator('.navigator-pane [role="treeitem"]', { hasText: 'Chapter 2' }).first()
    .dragTo(page.locator('.navigator-pane [role="treeitem"]').first(), { targetPosition: { x: 20, y: 2 } });
  const order = await page.evaluate(() => [...document.querySelectorAll('.tiptap-host .tiptap > h1')].slice(0, 3).map((h) => h.textContent).join());
  check(order === 'Chapter 2,Chapter 1,Chapter 3', `a heading dragged in the navigator moves its chapter (${order})`);
  await page.click('.navigator-pane [role="tab"]#nav-tab-objects');
  const link = await page.locator('.navigator-pane .jump', { hasText: 'the project site' }).count();
  check(link === 1, 'the objects tab lists the document\'s links');
  // The edit's autosave lands now, not at the next reload over the document set below.
  await page.waitForTimeout(1500);
  await page.press('.nav-search input[type="search"]', 'Escape');
  check(!(await page.locator('.search-match').count()), 'clearing the navigator\'s search drops its highlights');
  await page.click('.navigator-pane [role="tab"]#nav-tab-headings');
  await page.keyboard.press('F5');

  // Mirrored margins: every part of a block stands at its own page's sides, as in both word
  // processors — a paragraph's lines past a page break, a list's items, a table's rows.
  const lorem = 'The quick brown fox jumps over the lazy dog and keeps on running far away. ';
  await page.evaluate(([d, m]) => {
    localStorage.setItem('edentext-doc', JSON.stringify(d));
    localStorage.setItem('edentext-page-margins', JSON.stringify(m));
  }, [{ type: 'doc', content: [
    block(words(lorem.repeat(70))),
    { type: 'bulletList', content: Array.from({ length: 70 }, (_, i) => ({ type: 'listItem', content: [block(words(`item ${i}`))] })) },
    { type: 'table', content: Array.from({ length: 70 }, (_, i) => ({ type: 'tableRow', content: [0, 1].map((c) => ({
      type: 'tableCell', content: [block(words(`row ${i} cell ${c}`))] })) })) },
  ] }, { top: 2, bottom: 2, left: 1, right: 4, mirrored: true }]);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap table', { timeout: 15_000 });
  await settle(page, true);
  const sides = await page.evaluate(() => {
    const dom = document.querySelector('.tiptap-host .tiptap');
    const origin = dom.getBoundingClientRect();
    const cs = getComputedStyle(dom);
    const mirror = Number(cs.getPropertyValue('--pb-section-mirror').split(',')[0].split('|')[1]) || 0;
    // Each line's left edge against its own page's text edge: page 2 is a left page.
    const offset = (r) => {
      const page = Math.floor((r.top - origin.top) / (1123 + 20));
      return Math.round(r.left - origin.left - parseFloat(cs.paddingLeft) - (page % 2 ? mirror : 0));
    };
    const pages = (rects) => new Set(rects.map((r) => Math.floor((r.top - origin.top) / 1143))).size;
    const range = document.createRange();
    range.selectNodeContents(dom.querySelector(':scope > p'));
    // A line's start is its leftmost rect; a trailing space has one of its own.
    const starts = new Map();
    for (const r of range.getClientRects()) {
      const k = Math.round(r.top);
      if (r.width > 1 && !(starts.get(k)?.left <= r.left)) starts.set(k, r);
    }
    const lines = Array.from(starts.values());
    const firstText = (els) => els.map((el) => { range.selectNodeContents(el); return range.getClientRects()[0]; });
    const items = firstText(Array.from(dom.querySelectorAll(':scope > ul p')));
    const cells = firstText(Array.from(dom.querySelectorAll(':scope table tr > :first-child p')));
    const spread = (rects) => { const o = rects.map(offset); return { pages: pages(rects), spread: Math.max(...o) - Math.min(...o) }; };
    return { mirror, para: spread(lines), list: spread(items), table: spread(cells) };
  });
  for (const [what, s] of [['a paragraph\'s lines', sides.para], ['a list\'s items', sides.list], ['a table\'s rows', sides.table]]) {
    check(sides.mirror > 50 && s.pages > 1 && s.spread <= 1,
      `mirrored margins put ${what} at their own page's side (${s.pages} pages, spread ${s.spread}px)`);
  }
  // Typed at the end of a part moved to its page's side, text goes along with it at once,
  // not a pass later: the new letter starts where the line's last one ends.
  const typedGap = await page.evaluate(() => {
    const view = document.querySelector('.tiptap').editor.view;
    const end = view.state.doc.firstChild.nodeSize - 1;
    view.dispatch(view.state.tr.insertText('x', end));
    const walk = document.createTreeWalker(view.dom.querySelector(':scope > p'), NodeFilter.SHOW_TEXT);
    const chars = [];
    for (let n; (n = walk.nextNode());) for (let i = 0; i < n.length; i++) chars.push([n, i]);
    const [before, typed] = chars.slice(-2).map(([node, i]) => {
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      return range.getBoundingClientRect();
    });
    const page = Math.floor((typed.top - view.dom.getBoundingClientRect().top) / 1143) + 1;
    return { page, gap: Math.round(typed.left - before.right) };
  });
  check(typedGap.page % 2 === 0 && Math.abs(typedGap.gap) <= 1,
    `text typed at a mirrored part's end stays on its line (page ${typedGap.page}, gap ${typedGap.gap}px)`);
  // The reload saves the edit now, not over the next check's document.
  await page.reload({ waitUntil: 'load' });
  await page.evaluate(() => localStorage.removeItem('edentext-page-margins'));

  // A repeated header row never stays alone at a page foot: it goes down with the row
  // after it, or its copy would open the next page above that same row a second time.
  await page.evaluate((d) => localStorage.setItem('edentext-doc', JSON.stringify(d)), { type: 'doc', content: [
    ...Array.from({ length: 45 }, (_, i) => block(words(`line ${i}`))),
    { type: 'table', attrs: { repeatHeader: true }, content: [
      { type: 'tableRow', content: [{ type: 'tableHeader', content: [block(words('head'))] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: Array.from({ length: 15 }, (_, i) => block(words(`body ${i}`))) }] },
    ] },
  ] });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap table', { timeout: 15_000 });
  await settle(page, true);
  const headRow = await page.evaluate(() => {
    const top = document.querySelector('.tiptap-host .tiptap').getBoundingClientRect().top;
    const pageOf = (el) => Math.floor((el.getBoundingClientRect().top - top) / (1123 + 20));
    const rows = Array.from(document.querySelectorAll('.tiptap table tr:not([data-page-break-spacer])'));
    return { header: pageOf(rows[0]), body: pageOf(rows[1]), copies: document.querySelectorAll('.tiptap [data-page-break-spacer] table').length };
  });
  check(headRow.header === 1 && headRow.body === 1 && headRow.copies === 0,
    `a repeated header row goes down with the row after it (pages ${headRow.header + 1}/${headRow.body + 1}, ${headRow.copies} copies)`);
  // Behind the text: the frame leaves the flow (so the paragraph loses its height again)
  // and is then moved by its own offsets, since there is no text position to re-anchor to.
  await page.evaluate((d) => localStorage.setItem('edentext-doc', JSON.stringify(d)), { type: 'doc', content: [
    block(words('before '), frame({}), words(' after the picture')),
  ] });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap img', { timeout: 15_000 });
  await settle(page, true);
  const paraHeight = () => page.evaluate(() => document.querySelector('.tiptap-host .tiptap > p').getBoundingClientRect().height);
  const frameBox = () => page.evaluate(() => {
    const el = document.querySelector('.image-node');
    const r = el.getBoundingClientRect();
    return { wrap: el.dataset.wrap ?? '', z: getComputedStyle(el).zIndex, x: r.left, y: r.top };
  });
  const inlineHeight = await paraHeight();
  await page.click('.tiptap img');
  await page.waitForSelector('.image-toolbar', { timeout: 10_000 });
  await page.locator('.image-toolbar .it-btn').nth(4).click();
  await settle(page, true);
  const behindBox = await frameBox();
  check(behindBox.wrap === 'through' && Number(behindBox.z) < -1 && await paraHeight() < inlineHeight,
    `the behind-text button takes the frame out of the flow (${behindBox.wrap}, z ${behindBox.z}, ${inlineHeight}px → ${await paraHeight()}px)`);
  // setNodeMarkup replaces a leaf, so without putting the node selection back the frame
  // deselects itself on every attribute change and its toolbars close.
  check(await page.locator('.image-toolbar').count() === 1, 'setting the wrap mode leaves the frame selected');

  await page.mouse.move(behindBox.x + 60, behindBox.y + 30);
  await page.mouse.down();
  await page.mouse.move(behindBox.x + 120, behindBox.y + 70, { steps: 4 });
  await page.mouse.up();
  await settle(page, true);
  const movedBox = await frameBox();
  const dx = Math.round(movedBox.x - behindBox.x);
  const dy = Math.round(movedBox.y - behindBox.y);
  check(Math.abs(dx - 60) <= 2 && Math.abs(dy - 40) <= 2,
    `a frame out of the flow is dragged by its own offsets (moved ${dx}/${dy}, wanted 60/40)`);

  // A side float re-anchors on every line it is dragged across, and one undo takes the
  // whole drag back: a move kept out of the history left a copy at both ends.
  await page.evaluate((d) => document.querySelector('.tiptap').editor.commands.setContent(d), { type: 'doc', content: [
    block(frame({ wrap: 'right' }), words('first paragraph with its picture')),
    ...Array.from({ length: 8 }, (_, i) => block(words(`line ${i} ${'word '.repeat(30)}`))),
  ] });
  await settle(page, true);
  const floatBox = await frameBox();
  await page.mouse.move(floatBox.x + 60, floatBox.y + 30);
  await page.mouse.down();
  await page.mouse.move(floatBox.x - 200, floatBox.y + 300, { steps: 12 });
  await page.mouse.up();
  await settle(page, true);
  const frames = () => page.evaluate(() => {
    const doc = document.querySelector('.tiptap').editor.state.doc;
    const at = [];
    doc.forEach((p, _, i) => p.forEach((n) => { if (n.type.name === 'image') at.push(i); }));
    return at;
  });
  const dragged = await frames();
  await page.evaluate(() => document.querySelector('.tiptap').editor.commands.undo());
  const floatUndone = await frames();
  check(dragged.length === 1 && dragged[0] > 0 && floatUndone.join() === '0',
    `undo takes a side float's drag back as one step (dragged to ${dragged}, undone to ${floatUndone})`);

  // Space to text: a picture set to wrap by hand takes a new frame's gap, the Picture
  // Format tab's field widens it on the drawn side, and one undo takes that back.
  await page.evaluate((d) => document.querySelector('.tiptap').editor.commands.setContent(d), { type: 'doc', content: [
    block(frame({}), words('word '.repeat(80))),
  ] });
  await page.evaluate(() => {
    const ed = document.querySelector('.tiptap').editor;
    ed.chain().setNodeSelection(1).setImageWrap('right').run();
  });
  await settle(page, true);
  const gapState = () => page.evaluate(() => {
    const ed = document.querySelector('.tiptap').editor;
    return { gap: JSON.stringify(ed.state.doc.firstChild.firstChild.attrs.wrapDist), left: getComputedStyle(document.querySelector('.image-node')).marginLeft };
  });
  const wrapped = await gapState();
  await page.locator('.ribbon-tab', { hasText: 'Picture Format' }).click();
  await page.fill('[data-cmd="wrapGap-left"] input', '1');
  await page.press('[data-cmd="wrapGap-left"] input', 'Enter');
  await settle(page, true);
  const widened = await gapState();
  await page.evaluate(() => document.querySelector('.tiptap').editor.commands.undo());
  const gapUndone = await gapState();
  check(wrapped.left === '12px' && widened.left === '38px' && gapUndone.gap === wrapped.gap,
    `a picture wraps with a gap the ribbon widens and undo restores (${wrapped.left} → ${widened.left}, undone ${gapUndone.gap})`);

  // A rule set on a paragraph style in the style manager draws under its paragraphs.
  await page.evaluate(() => { const ed = document.querySelector('.tiptap').editor; ed.commands.setContent('<h2>Ruled</h2><p>x</p>'); ed.commands.setTextSelection(2); });
  await page.locator('.ribbon-tab', { hasText: 'Home' }).first().click();
  await page.click('.gallery-more');
  await page.click('.rb-menu-foot');
  const ruleBox = page.locator('.border-grid .bw input').nth(1);
  await ruleBox.fill('1');
  await ruleBox.press('Enter');
  const ruleWidth = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.tiptap h2')).borderBottomWidth));
  const ruled = await ruleWidth();
  await page.locator('footer button', { hasText: 'Reset to default' }).click();
  const unruled = await ruleWidth();
  await page.keyboard.press('Escape');
  check(ruled > 0 && unruled === 0, `a paragraph style's rule from the style manager draws and resets (${ruled} → ${unruled})`);

  // A text box in that mode moves the same way, but by its frame ring — its own drag
  // is ProseMirror's node move, which would re-anchor it instead. Past the autosave's
  // debounce, or its write puts the dragged picture back in the text box's place.
  await page.waitForTimeout(1500);
  await page.evaluate((d) => localStorage.setItem('edentext-doc', JSON.stringify(d)), { type: 'doc', content: [
    block(words('before the box '), { type: 'textBox', attrs: { width: 200, height: 80, wrap: 'through' },
      content: [block(words('in the box'))] }, words(' after it')),
  ] });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap .textbox-node[data-wrap="through"]', { timeout: 15_000 });
  await settle(page, true);
  const boxAt = () => page.evaluate(() => {
    const r = document.querySelector('.tiptap .textbox-node[data-wrap="through"]').getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
  const boxBefore = await boxAt();
  await page.mouse.move(boxBefore.x + 2, boxBefore.y + 40);
  await page.mouse.down();
  await page.mouse.move(boxBefore.x + 52, boxBefore.y + 65, { steps: 4 });
  await page.mouse.up();
  await settle(page, true);
  const boxAfter = await boxAt();
  const bdx = Math.round(boxAfter.x - boxBefore.x);
  const bdy = Math.round(boxAfter.y - boxBefore.y);
  check(Math.abs(bdx - 50) <= 2 && Math.abs(bdy - 25) <= 2,
    `a text box out of the flow is dragged by its ring (moved ${bdx}/${bdy}, wanted 50/25)`);

  // A line is dragged by its ends: the one grabbed follows the pointer past the other,
  // which stays put. A box turned into a line leaves the text, so both ends are free.
  await page.evaluate(() => {
    const ed = document.querySelector('.tiptap').editor;
    ed.chain().focus().insertTextBox().run();
    ed.commands.setTextBoxAttrs({ shapeKind: 'lineArrow' });
  });
  await page.waitForSelector('.tiptap .textbox-node.textbox-is-line[data-wrap="through"] .textbox-line-end',
    { state: 'visible', timeout: 15_000 });
  const lineEnds = () => page.evaluate(() => [...document.querySelectorAll('.tiptap .textbox-is-line .textbox-line-end')]
    .map((h) => { const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
  const [startBefore, endBefore] = await lineEnds();
  await page.mouse.move(startBefore.x, startBefore.y);
  await page.mouse.down();
  await page.mouse.move(endBefore.x + 40, endBefore.y + 30, { steps: 4 });
  await page.mouse.up();
  await settle(page, true);
  const [startAfter, endAfter] = await lineEnds();
  const near = (p, q, x, y) => Math.abs(p.x - q.x - x) <= 2 && Math.abs(p.y - q.y - y) <= 2;
  check(near(endAfter, endBefore, 0, 0) && near(startAfter, endBefore, 40, 30),
    `a line's start is dragged past its end (start ${Math.round(startAfter.x - endBefore.x)}/${Math.round(startAfter.y - endBefore.y)} from the end, wanted 40/30; end moved ${Math.round(endAfter.x - endBefore.x)}/${Math.round(endAfter.y - endBefore.y)})`);

  // The cross-reference window is modeless so the view can stay parked on the target
  // while a reference is picked. Restoring focus to the editor must therefore not scroll
  // the caret back into view: the document would move under the reader on every insert.
  // Past the autosave's debounce first, or its pending write overwrites the document
  // put here before the reload reads it back.
  await page.waitForTimeout(1500);
  await page.evaluate(() => localStorage.setItem('edentext-doc', JSON.stringify({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Public primary education' }] },
    ...Array.from({ length: 80 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Filler ${i + 1} ${'word '.repeat(14)}` }] })),
    { type: 'paragraph', content: [{ type: 'text', text: 'See ' }] },
  ] })));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('.tiptap')?.textContent.includes('Public primary education'),
    null, { timeout: 15_000 });
  await settle(page, true);
  await page.evaluate(() => {
    const ed = document.querySelector('.tiptap').editor;
    ed.commands.focus(ed.state.doc.content.size - 1);
    document.querySelector('.tiptap').firstElementChild.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(300);
  const parked = await page.evaluate(() => Math.round(document.querySelector('.editor').scrollTop));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('odf-open-cross-ref-dialog')));
  await page.waitForSelector('.xr:popover-open', { timeout: 5_000 });
  await page.selectOption('.xr select >> nth=0', 'heading');
  await page.waitForTimeout(150);
  await page.click('.xr .xr-apply');
  await page.waitForTimeout(600);
  const inserted = await page.evaluate(() => ({
    field: document.querySelector('.tiptap .cross-ref')?.textContent ?? '',
    scroll: Math.round(document.querySelector('.editor').scrollTop),
    open: document.querySelector('.xr')?.matches(':popover-open'),
  }));
  check(inserted.field === 'Public primary education' && inserted.scroll === parked && inserted.open,
    `inserting a cross-reference leaves the view where it was (${parked} \u2192 ${inserted.scroll}, field "${inserted.field}")`);
  // Its title bar captures the pointer for the drag, which retargets the click: unless a
  // press on a button is let through, the close cross does nothing.
  await page.click('.xr .xr-bar button');
  check(await page.evaluate(() => !document.querySelector('.xr')?.matches(':popover-open')),
    'the cross-reference window closes on its close cross');

  // Both windows are top-layer popovers: a `position: fixed` one resolves against the
  // island chrome's transformed toolbar stack and lands beside the viewport instead.
  // A bookmark covers a range, so the button opens only once the selection has reached
  // the chrome — one tick after the command.
  await page.evaluate(() => document.querySelector('.tiptap').editor.commands.setTextSelection({ from: 1, to: 8 }));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('odf-open-bookmark-dialog')));
  await page.waitForSelector('.bm:popover-open', { timeout: 5_000 });
  const winAt = () => page.evaluate(() => {
    const r = document.querySelector('.bm').getBoundingClientRect();
    return { x: r.left, y: r.top, right: r.right, vw: window.innerWidth };
  });
  const winBefore = await winAt();
  check(winBefore.right <= winBefore.vw && winBefore.y > 0,
    `the bookmark window opens inside the viewport (right ${Math.round(winBefore.right)} of ${winBefore.vw})`);
  const bar = await (await page.$('.bm .bm-bar')).boundingBox();
  await page.mouse.move(bar.x + 40, bar.y + 10);
  await page.mouse.down();
  await page.mouse.move(bar.x - 260, bar.y + 210, { steps: 8 });
  await page.mouse.up();
  const winAfter = await winAt();
  const wdx = Math.round(winAfter.x - winBefore.x);
  const wdy = Math.round(winAfter.y - winBefore.y);
  check(Math.abs(wdx + 300) <= 2 && Math.abs(wdy - 200) <= 2,
    `the bookmark window is dragged by its bar (moved ${wdx}/${wdy}, wanted -300/200)`);
  await page.click('.bm .bm-bar button');
  check(await page.evaluate(() => !document.querySelector('.bm')?.matches(':popover-open')),
    'the bookmark window closes on its close cross');

  // Ctrl+F keeps the focus in its own input, and ProseMirror scrolls a selection into
  // view only while the editor owns the DOM selection — so a find that does not scroll
  // the match itself never moves the page.
  await page.evaluate(() => document.querySelector('.tiptap').editor.commands.setContent(
    `<h1>Overview</h1>${Array.from({ length: 90 }, (_, i) => `<p>Filler ${i} ${'word '.repeat(12)}</p>`).join('')}<p>Zebra crossing</p>`));
  await settle(page, true);
  await page.evaluate(() => { document.querySelector('.editor').scrollTop = 0; });
  await page.keyboard.press('Control+f');
  await page.waitForTimeout(300);
  await page.keyboard.type('Zebra');
  await page.waitForTimeout(600);
  const found = await page.evaluate(() => {
    const port = document.querySelector('.editor').getBoundingClientRect();
    const box = document.querySelector('.search-match-current')?.getBoundingClientRect();
    return { top: Math.round(document.querySelector('.editor').scrollTop), active: document.activeElement?.tagName,
      inView: !!box && box.top >= port.top && box.bottom <= port.bottom };
  });
  check(found.top > 0 && found.inView && found.active === 'INPUT',
    `a find scrolls its match into view and leaves the focus in the bar (scrollTop ${found.top}, in view ${found.inView}, focus ${found.active})`);
  await page.keyboard.press('Escape');

  // The ribbon mounts only the open tab, so a dialog that lives in one hears no event:
  // the formula's double-click, Ctrl+K and the context menu fire while Home is up.
  await page.evaluate(() => document.querySelector('.tiptap').editor.chain().focus().insertFormula({ latex: 'a^2', display: false }).run());
  await page.waitForSelector('.tiptap .formula', { timeout: 15_000 });
  await settle(page, true);
  await page.dblclick('.tiptap .formula');
  const dialog = await page.waitForSelector('.formula-dialog', { timeout: 5_000 }).then(() => true).catch(() => false);
  check(dialog, `a double-click on a formula opens its dialog from the ${await page.locator('.ribbon-tab.active').textContent()} tab`);

  // A display formula stands at its paragraph's alignment; inserting one into an empty
  // paragraph centers that paragraph.
  await page.keyboard.press('Escape');
  const placed = await page.evaluate(async () => {
    const ed = document.querySelector('.tiptap').editor;
    ed.commands.setContent({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'formula', attrs: { latex: 'x', display: true } }] }, { type: 'paragraph' }] });
    ed.chain().setTextSelection(ed.state.doc.child(0).nodeSize + 1).insertFormula({ latex: 'y', display: true }).run();
    await new Promise((r) => setTimeout(r, 300));
    const [a, b] = [...document.querySelectorAll('.tiptap span.formula')].map((f) => {
      const p = f.parentElement.getBoundingClientRect(), m = f.querySelector('math').getBoundingClientRect();
      return Math.round((m.left - p.left) - (p.right - m.right));
    });
    return { a, b };
  });
  check(placed.a < -100 && Math.abs(placed.b) <= 2,
    `a display formula sits at its paragraph's alignment, an inserted one centered (left gap minus right gap: ${placed.a}, ${placed.b})`);

  // The grammar check: the 16 MB wasm has to survive Vite's build and reach the browser,
  // which only a real page can show. English document, switch on, one wrong sentence.
  await page.keyboard.press('Escape'); // the formula dialog above still covers the chrome
  await page.evaluate(() => document.querySelector('.tiptap').editor.commands.setContent('<p>He go to the store.</p>'));
  await settle(page, true);
  await pickSpellLanguage('doc', 'English (US)');
  await page.check('.statusbar .gr-toggle input');
  // The waves are CSS highlight ranges (grammarCheck.ts), not elements.
  const squiggle = await page.waitForFunction(() => CSS.highlights.get('grammar-error')?.size > 0, null, { timeout: 60_000 })
    .then(() => true).catch(() => false);
  check(squiggle, 'the grammar check flags a wrong sentence in the browser');

  // A paragraph in its own language: the picker writes a real lang attribute, which is
  // what the hyphenation and the browser's own spell check read. The sentence above keeps
  // its DOM node and highlight for a frame, so it must be gone before a wait can trust one.
  await page.evaluate(() => document.querySelector('.tiptap').editor.commands.setContent('<p></p>'));
  await page.waitForFunction(() => !CSS.highlights.get('grammar-error')?.size, null, { timeout: 30_000 });
  await page.evaluate(() => document.querySelector('.tiptap').editor.commands.setContent(
    '<p>He go to the store.</p><p>Er geht zum Laden zum Laden.</p>'));
  await page.waitForFunction(() => CSS.highlights.get('grammar-error')?.size > 0,
    null, { timeout: 30_000 }).catch(() => {});
  await page.evaluate(() => {
    const ed = document.querySelector('.tiptap').editor;
    ed.commands.setTextSelection(ed.state.doc.content.size - 2);
  });
  await pickSpellLanguage('sel', 'Deutsch');
  const langs = await page.evaluate(() => [...document.querySelectorAll('.tiptap-host .tiptap > p')].map((p) => p.getAttribute('lang')));
  check(JSON.stringify(langs) === '[null,"de-DE"]', `only the second paragraph takes a language (${JSON.stringify(langs)})`);
  const paragraphToggleOff = await page.waitForFunction(() => {
    const input = document.querySelector('.statusbar .gr-toggle input');
    return input?.disabled && !input.checked;
  }, null, { timeout: 5_000 }).then(() => true).catch(() => false);
  check(paragraphToggleOff, 'a non-English paragraph disables and clears the grammar toggle');
  // Harper reads German as broken English; the block language is what keeps it out. The
  // wait is on the outcome itself: the marks from before the language change still stand
  // until the re-check clears them.
  const countPerPara = () => [...document.querySelectorAll('.tiptap-host .tiptap > p')].map((p) =>
    [...CSS.highlights.get('grammar-error') ?? []].filter((r) => p.contains(r.startContainer)).length);
  // Predicates are functions, not strings: the built page's CSP refuses to compile a string.
  await page.waitForFunction((name) => {
    const n = [...document.querySelectorAll('.tiptap-host .tiptap > p')].map((p) =>
      [...CSS.highlights.get(name) ?? []].filter((r) => p.contains(r.startContainer)).length);
    return n[0] > 0 && n[1] === 0;
  }, 'grammar-error', { timeout: 30_000 }).catch(() => {});
  const perPara = await page.evaluate(countPerPara);
  check(perPara[0] > 0 && perPara[1] === 0, `only the English paragraph is grammar-checked (${JSON.stringify(perPara)})`);

  // The default can be Portuguese while an English paragraph still gets grammar checks.
  await pickSpellLanguage('doc', 'Português (Portugal)');
  const documentToggleOff = await page.waitForFunction(() => {
    const input = document.querySelector('.statusbar .gr-toggle input');
    return input?.disabled && !input.checked;
  }, null, { timeout: 5_000 }).then(() => true).catch(() => false);
  check(documentToggleOff, 'a non-English document disables and clears the grammar toggle');
  await page.evaluate(() => {
    const ed = document.querySelector('.tiptap').editor;
    ed.commands.setTextSelection(2);
  });
  await pickSpellLanguage('sel', 'English (US)');
  const englishToggleOn = await page.waitForFunction(() => {
    const input = document.querySelector('.statusbar .gr-toggle input');
    return !input?.disabled && input?.checked;
  }, null, { timeout: 5_000 }).then(() => true).catch(() => false);
  check(englishToggleOn, 'an English paragraph restores the grammar toggle');
  await page.waitForFunction(() => [...CSS.highlights.get('grammar-error') ?? []].some((r) =>
    r.startContainer.isConnected && r.startContainer.parentElement?.closest('.tiptap-host .tiptap > p')), null, { timeout: 30_000 })
    .then(() => check(true, 'an English paragraph in a Portuguese document is grammar-checked'))
    .catch(() => check(false, 'an English paragraph in a Portuguese document is grammar-checked'));

  // Detection: a German paragraph in an English document is checked in German without the
  // file changing, and the menu writes the detected language into it on request.
  await pickSpellLanguage('doc', 'English (US)');
  await page.evaluate(() => {
    const ed = document.querySelector('.tiptap').editor;
    ed.commands.setContent('<p>This sentence is English and has a mispeled word.</p>'
      + '<p>Dieser Absatz ist auf Deutsch geschrieben und enthält ganz gewöhnliche Wörter ohne jeden Fehler.</p>');
    ed.commands.setTextSelection(ed.state.doc.content.size - 3);
  });
  const squigglesPerPara = () => [...document.querySelectorAll('.tiptap-host .tiptap > p')].map((p) =>
    [...CSS.highlights.get('spell-error') ?? []].filter((r) => p.contains(r.startContainer)).length);
  await page.waitForFunction((name) => {
    const n = [...document.querySelectorAll('.tiptap-host .tiptap > p')].map((p) =>
      [...CSS.highlights.get(name) ?? []].filter((r) => p.contains(r.startContainer)).length);
    return n[0] > 0 && n[1] === 0;
  }, 'spell-error', { timeout: 30_000 }).catch(() => {});
  const detectedSquiggles = await page.evaluate(squigglesPerPara);
  check(detectedSquiggles[0] > 0 && detectedSquiggles[1] === 0, `a German paragraph in an English document is checked in German (${JSON.stringify(detectedSquiggles)})`);
  const detectedLabel = await page.locator('.statusbar .lang-picker').textContent();
  await page.click('.statusbar .lang-picker');
  await page.locator('.statusbar .menu-layer').getByRole('menuitem', { name: /Deutsch/ }).first().click();
  const appliedLangs = await page.evaluate(() => [...document.querySelectorAll('.tiptap-host .tiptap > p')].map((p) => p.getAttribute('lang')));
  check(/Deutsch/.test(detectedLabel ?? '') && JSON.stringify(appliedLangs) === '[null,"de-DE"]',
    `the status bar names the detected language and the menu applies it (${detectedLabel?.trim()}, ${JSON.stringify(appliedLangs)})`);

  // The page grid: every cell is a fixed window of exactly its own page, and the caret —
  // drawn only by the focused view, clipped to its cell — follows whatever moves it.
  // Last, since it replaces the document and the zoom with its own.
  await page.evaluate(() => localStorage.setItem('edentext-page-columns', '3'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.page-cell', { timeout: 15_000 });
  await page.evaluate(() => {
    const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. ';
    document.querySelector('.tiptap').editor.commands.setContent({ type: 'doc', content: Array.from({ length: 300 },
      (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `${i + 1}. ${text.repeat(1 + (i % 4))}` }] })) });
  });
  const gridPages = await settled();
  const gridState = (scrolledAway) => page.evaluate((scrolledAway) => {
    const bad = [];
    const near = (a, b) => Math.abs(a - b) < 1.5;
    const sheetAt = (c) => {
      const r = c.getBoundingClientRect();
      return [...c.querySelectorAll('.page-sheet')].findIndex((s) => {
        const q = s.getBoundingClientRect();
        return near(q.top, r.top) && near(q.left, r.left) && near(q.width, r.width) && near(q.height, r.height);
      }) + 1;
    };
    const live = [...document.querySelectorAll('.page-cell:not(.empty)')];
    const pages = live.map(sheetAt);
    if (pages.includes(0)) bad.push(`a cell shows no whole page (${pages})`);
    if (new Set(pages).size !== pages.length) bad.push(`a page shows twice (${pages})`);
    // Every row the viewport shows, even a sliver of, has its pages in cells.
    const scroller = document.querySelector('.editor-panes.grid > .editor').getBoundingClientRect();
    const canvas = document.querySelector('.grid-canvas').getBoundingClientRect();
    const total = +/of (\d+)/.exec(document.querySelector('.statusbar').textContent)[1];
    const cols = 3, rowH = canvas.height / Math.ceil(total / cols);
    for (let row = Math.max(0, Math.floor((scroller.top - canvas.top) / rowH)); row * rowH < scroller.bottom - canvas.top && row * cols < total; row++)
      for (let p = row * cols + 1; p <= Math.min(total, row * cols + cols); p++)
        if (!pages.includes(p)) bad.push(`page ${p} on screen has no cell (${pages})`);
    const cell = document.activeElement?.closest('.page-cell');
    const sel = getSelection();
    if (!cell || !sel.rangeCount) return [...bad, 'no cell has the focus'];
    // Measured in the text: a range between elements measures the spacer before it.
    let node = sel.focusNode, offset = sel.focusOffset;
    const widget = (n) => n?.nodeType === 1 && n.contentEditable === 'false';
    while (node.nodeType === 1 && node.childNodes.length) {
      const kids = node.childNodes;
      const after = offset < kids.length && !(offset > 0 && widget(kids[offset]) && !widget(kids[offset - 1]));
      node = after ? kids[offset] : kids[Math.min(offset, kids.length) - 1];
      offset = after ? 0 : node.nodeType === 3 ? node.length : node.childNodes.length;
    }
    const range = document.createRange();
    range.setStart(node, offset);
    let rect = range.getClientRects()[0];
    if (!rect || !(rect.top || rect.bottom)) rect = (node.nodeType === 1 ? node : node.parentElement).getBoundingClientRect();
    const y = (rect.top + rect.bottom) / 2;
    const r = cell.getBoundingClientRect();
    const drawn = y >= r.top - 1 && y <= r.bottom + 1 && rect.left >= r.left - 1 && rect.left <= r.right + 1;
    const page = [...cell.querySelectorAll('.page-sheet')].findIndex((s) => {
      const q = s.getBoundingClientRect();
      return y >= q.top - 12 && y <= q.bottom + 12;
    }) + 1;
    if (!drawn && pages.includes(page)) bad.push(`the caret on page ${page} is clipped away in the cell of page ${sheetAt(cell)}`);
    const view = document.querySelector('.editor-panes.grid > .editor').getBoundingClientRect();
    if (!scrolledAway && (!drawn || y < view.top || y > view.bottom)) bad.push(`the caret is off screen (${Math.round(y)})`);
    return bad;
  }, scrolledAway);
  const gridFaults = [];
  // Layout settles over a few frames, so the invariant gets until the settle is over.
  const gridStep = async (label, scrolledAway = false) => {
    let faults = [];
    for (let i = 0; i < 6 && (i === 0 || faults.length); i++) {
      await page.waitForTimeout(350);
      faults = await gridState(scrolledAway);
    }
    for (const fault of faults) gridFaults.push(`${label}: ${fault}`);
  };
  const docEnd = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
  const docStart = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home';
  // Cells are recycled as the grid scrolls and re-aimed a while after it, so the click
  // waits until a cell on screen sits at the canvas's top left, where page 1 goes. Polled
  // from here: WebKit on macOS let a wait polled in the page time out with the cell in place.
  await page.evaluate(() => document.querySelector('.editor-panes.grid > .editor').scrollTo(0, 0));
  const pageOneCell = () => page.evaluate(() => {
    const view = document.querySelector('.editor-panes.grid > .editor').getBoundingClientRect();
    const canvas = document.querySelector('.grid-canvas').getBoundingClientRect();
    const r = [...document.querySelectorAll('.page-cell:not(.empty)')].map((c) => c.getBoundingClientRect())
      .find((q) => Math.abs(q.top - canvas.top) < 1.5 && Math.abs(q.left - canvas.left) < 1.5);
    return r && r.top >= view.top - 1 && r.top + r.height / 3 < view.bottom ? { x: r.left + r.width / 2, y: r.top + r.height / 3 } : null;
  });
  let firstCell = await pageOneCell();
  for (const until = Date.now() + 15_000; !firstCell && Date.now() < until; firstCell = await pageOneCell()) await page.waitForTimeout(100);
  if (!firstCell) {
    throw new Error(`no cell shows page 1 on screen: ${await page.evaluate(() => {
      const at = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.bottom].join(','); };
      return JSON.stringify({
        scrollTop: document.querySelector('.editor-panes.grid > .editor').scrollTop,
        view: at(document.querySelector('.editor-panes.grid > .editor')),
        canvas: at(document.querySelector('.grid-canvas')),
        cells: [...document.querySelectorAll('.page-cell:not(.empty)')].map(at),
      });
    })}`);
  }
  await page.mouse.click(firstCell.x, firstCell.y);
  await gridStep('click');
  // What the click hit and where it left the selection, for a failure on an engine
  // this machine cannot run.
  if (gridFaults.length) gridFaults.push(`click hit ${await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    const ed = document.querySelector('.tiptap').editor;
    const sel = getSelection();
    return JSON.stringify({
      hit: `${hit?.tagName}.${hit?.className}`.slice(0, 60), inCell: !!hit?.closest('.page-cell'),
      focus: `${document.activeElement?.tagName}.${document.activeElement?.className}`.slice(0, 60),
      head: ed.state.selection.head, size: ed.state.doc.content.size,
      domFocus: sel.focusNode ? `${sel.focusNode.nodeName}:${sel.focusOffset}` : null,
    });
  }, firstCell)}`);
  await page.keyboard.press(docEnd);
  await gridStep('document end');
  await page.keyboard.type('x');
  await gridStep('typing');
  await page.keyboard.press(docStart);
  await gridStep('document start');
  for (let i = 1; i <= 4; i++) {
    await page.keyboard.press('PageDown');
    await gridStep(`page down ${i}`);
  }
  for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowDown');
  await gridStep('arrow down');
  await page.keyboard.press(`${MOD}+Enter`);
  await gridStep('page break');
  await page.keyboard.press('Backspace');
  await gridStep('page break removed');
  await page.mouse.move(700, 500);
  for (let i = 1; i <= 3; i++) {
    await page.mouse.wheel(0, 600);
    await gridStep(`wheel ${i}`, true);
  }
  await page.keyboard.type('y');
  await gridStep('typing after scrolling away');
  await page.keyboard.press('PageUp');
  await gridStep('page up');
  check(gridPages > 6 && gridFaults.length === 0,
    `the page grid shows each page in its own cell and the caret where it is (${gridPages} pages${gridFaults.length ? `: ${gridFaults.join('; ')}` : ''})`);

  // Cells off the caret's page catch up after a pause; one clicked at once catches up
  // first, so the click lands in the current document and every view ends up the same.
  await page.keyboard.type('caught up ');
  const otherCell = await page.evaluate(() => {
    const view = document.querySelector('.editor-panes.grid > .editor').getBoundingClientRect();
    const onScreen = (r) => r.top + r.height / 2 > view.top && r.top + r.height / 2 < view.bottom;
    const cell = [...document.querySelectorAll('.page-cell:not(.empty)')]
      .find((c) => !c.contains(document.activeElement) && onScreen(c.getBoundingClientRect()));
    const r = cell.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(otherCell.x, otherCell.y);
  await page.keyboard.type('Q');
  await page.waitForTimeout(2000);
  const gridViews = await page.evaluate(() => [...document.querySelectorAll('.page-cell .tiptap')].map((v) => v.textContent));
  // Case-blind: a typed sentence start is capitalized.
  // A failure names each cell that differs from the first and the text around where.
  const gridDiff = gridViews.flatMap((t, i) => {
    if (i && t === gridViews[0]) return [];
    let at = 0;
    while (at < t.length && t[at] === gridViews[0][at]) at++;
    return [`cell ${i} at ${at}: ${JSON.stringify(t.slice(Math.max(0, at - 20), at + 20))}`];
  });
  check(gridViews.length > 1 && gridViews.every((t) => t === gridViews[0]) && /caught up/i.test(gridViews[0]) && gridViews[0].includes('Q'),
    `every page-grid cell shows the edits after a pause, and a click right after typing lands in the current text${gridDiff.length > 1 || !/caught up/i.test(gridViews[0]) || !gridViews[0].includes('Q') ? ` (${gridViews.length} cells; ${gridDiff.join('; ')})` : ''}`);

  // Dark theme: every menu each ribbon tab opens, a text box selected so its contextual
  // tab shows too. A glyph or label barely apart from what it sits on is a colour some
  // control fixed instead of taking the theme's (a popover's black, the shape gallery's).
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('edentext-theme', 'dark'); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });

  // Zooming out step by step leaves nothing of the page's earlier edges on the dark
  // backdrop: the scaled page's clip sits on fractional pixels, which Chromium kept painted.
  await page.mouse.move(700, 500);
  await page.keyboard.down('Control');
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 60); await page.waitForTimeout(30); }
  await page.keyboard.up('Control');
  await page.waitForTimeout(600);
  const shot = (await page.screenshot()).toString('base64');
  const stale = await page.evaluate(async (png) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const ctx = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }).getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    const at = (x, y) => (y * img.width + x) * 4;
    const pane = document.querySelector('.editor').getBoundingClientRect();
    const papers = Array.from(document.querySelectorAll('.paper'), (p) => p.getBoundingClientRect());
    const top = Math.ceil(pane.top + 40), bottom = Math.floor(pane.bottom - 20), bg = at(Math.ceil(pane.left) + 20, bottom - 5);
    const columns = [];
    for (let x = Math.ceil(pane.left) + 2; x < pane.right - 20; x++) {
      if (papers.some((p) => x > p.left - 8 && x < p.right + 8)) continue;
      let n = 0;
      for (let y = top; y < bottom; y++) {
        const i = at(x, y);
        if ([0, 1, 2].some((k) => Math.abs(data[i + k] - data[bg + k]) > 2)) n++;
      }
      if (n > 20) columns.push(x);
    }
    return columns;
  }, shot);
  check(stale.length === 0, `zooming out leaves no line beside the page (${stale.length ? `at x ${stale.join(', ')}` : 'none'})`);
  await page.evaluate(() => localStorage.setItem('edentext-zoom', '100'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });

  await page.click('.tiptap');
  await page.keyboard.type('Contrast');
  await page.evaluate(() => document.querySelector('.tiptap').editor.commands.insertTextBox());
  const selectBox = () => page.evaluate(() => {
    const ed = document.querySelector('.tiptap').editor;
    ed.state.doc.descendants((n, p) => { if (n.type.name === 'textBox') ed.commands.setNodeSelection(p); });
  });
  const lowContrast = (where) => page.evaluate((where) => {
    const rgb = (c) => {
      const v = (c.match(/[\d.]+/g) ?? []).map(Number);
      return c.startsWith('color(') ? [...v.slice(0, 3).map((x) => x * 255), v[3] ?? 1] : [...v.slice(0, 3), v[3] ?? 1];
    };
    const lum = (c) => c.slice(0, 3).reduce((sum, v, i) => {
      v /= 255;
      return sum + [0.2126, 0.7152, 0.0722][i] * (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    }, 0);
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const backdrop = (el) => {
      for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length === 4 && c[3] > 0.5) return c; }
      return [255, 255, 255, 1];
    };
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || getComputedStyle(el).visibility === 'hidden') return false;
      for (let e = el; e; e = e.parentElement) if (parseFloat(getComputedStyle(e).opacity) < 0.6) return false;
      return true;
    };
    const out = [];
    // The column previews' page frame is a hairline on purpose, in every theme.
    for (const el of document.querySelectorAll('body *:not(.paper *, .col-preview > rect:first-child)')) {
      if (!shown(el)) continue;
      let fg;
      if (el instanceof SVGGeometryElement) {
        const cs = getComputedStyle(el);
        if (cs.stroke === 'none' && cs.fill === 'none') continue;
        fg = rgb(cs.stroke !== 'none' ? cs.stroke : cs.fill);
      } else if ([...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) {
        fg = rgb(getComputedStyle(el).color);
      } else continue;
      if (fg.length < 4 || fg[3] < 0.5) continue;
      const r = ratio(fg, backdrop(el instanceof SVGElement ? el.closest('svg').parentElement : el));
      const named = el.closest('[aria-label],[title]');
      if (r < 2) out.push(`${where}: ${named?.getAttribute('aria-label') || named?.title || el.textContent.trim().slice(0, 30)} (${r.toFixed(2)})`);
    }
    return out;
  }, where);
  const contrastFaults = new Set();
  for (const tab of await page.$$eval('.ribbon-tab', (els) => els.map((e) => e.textContent.trim()))) {
    await selectBox();
    const button = page.locator('.ribbon-tab', { hasText: tab }).first();
    if (!(await button.isVisible())) continue;
    await button.click();
    (await lowContrast(tab)).forEach((f) => contrastFaults.add(f));
    const menus = await page.$$eval('.ribbon-body [aria-haspopup]', (els) =>
      els.map((e, i) => { e.dataset.contrastMenu = String(i); return e.offsetParent ? i : -1; }).filter((i) => i >= 0));
    for (const i of menus) {
      const trigger = page.locator(`[data-contrast-menu="${i}"]`);
      const label = await trigger.evaluate((e) => e.getAttribute('aria-label') || e.title || e.textContent.trim());
      try { await trigger.click({ timeout: 1500 }); } catch { continue; }
      (await lowContrast(`${tab} › ${label}`)).forEach((f) => contrastFaults.add(f));
      await page.keyboard.press('Escape');
      await page.mouse.click(5, 300);
    }
  }
  check(contrastFaults.size === 0, `the dark theme draws no menu glyph or label in a colour of its own${contrastFaults.size ? `: ${[...contrastFaults].slice(0, 8).join('; ')}` : ''}`);

  // The AI assistant against a mocked provider. Switched off, none of it shows and nothing
  // goes out; switched on, a chat turn's tool call lands as the assistant's tracked change,
  // a rewrite replaces the selection, and drafting opens the chat with /draft.
  let aiRequests = 0;
  const aiFailed = [];
  page.on('requestfailed', (r) => { if (r.url().includes('mock.test')) aiFailed.push(`${r.method()} ${r.url()}: ${r.failure()?.errorText}`); });
  await page.route('http://mock.test/**', async (route) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    aiRequests++;
    const body = JSON.parse(route.request().postData() ?? '{}');
    const sse = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;
    const reply = body.messages?.at(-1)?.role === 'tool' ? { content: '<p>Done.</p>' }
      : body.tools ? { tool_calls: [{ index: 0, id: 'c1', function: { name: 'replace_text', arguments: '{"paragraph":1,"find":"quick","replace":"slow"}' } }] }
      : { content: '<p>A slow fox.</p>' };
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(reply) });
  });
  // On by default; switched off and stored, as a user would.
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('edentext-ai', JSON.stringify({ enabled: false })); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });
  await page.click('.tiptap');
  await page.keyboard.type('The quick fox');
  await page.click('.tiptap', { button: 'right' });
  await page.hover('.cm-item[aria-haspopup]');
  const offMenu = await page.$eval('.cm-item[aria-haspopup]', (e) => ({ disabled: e.getAttribute('aria-disabled'), hint: e.title, sub: !!document.querySelector('.cm-sub') }));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+i');
  check(!(await page.$('[data-cmd="aiPane"]')) && !(await page.$('.ai-pane')) && offMenu.disabled === 'true' && /Settings/.test(offMenu.hint) && !offMenu.sub
    && aiRequests === 0,
  `with the assistant off, no AI button or window shows, the menu's AI entry is greyed with a hint, and nothing is sent (${JSON.stringify(offMenu)})`);

  await page.waitForFunction(() => (localStorage.getItem('edentext-doc') ?? '').includes('quick'), null, { timeout: 15_000 });
  await page.evaluate(() => localStorage.setItem('edentext-ai', JSON.stringify({ enabled: true, provider: 'openai', endpoint: 'http://mock.test/v1', apiKey: '', model: 'm' })));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });
  await page.click('[data-cmd="aiPane"]');
  await page.fill('.ai-pane textarea', 'Make it slow');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.tiptap [data-insertion]', { timeout: 15_000 }).catch(() => {});
  const tracked = await page.evaluate(() => ({
    ins: document.querySelector('.tiptap [data-insertion]')?.textContent,
    del: document.querySelector('.tiptap [data-deletion]')?.textContent,
    author: document.querySelector('.tiptap [data-insertion]')?.getAttribute('data-rev-author'),
  }));
  // A failure says whether the mock was reached and what the pane shows.
  if (tracked.ins !== 'slow') Object.assign(tracked, { requests: aiRequests, failed: aiFailed,
    pane: await page.evaluate(() => document.querySelector('.ai-pane')?.textContent?.replace(/\s+/g, ' ').slice(-200)) });
  check(tracked.ins === 'slow' && tracked.del === 'quick' && tracked.author === 'AI',
    `a chat turn's edit is the assistant's tracked change (${JSON.stringify(tracked)})`);
  await page.waitForSelector('.ai-pane .tool', { timeout: 5_000 }).catch(() => {});
  check(!!(await page.$('.ai-pane .tool')), 'the pane lists what the assistant changed');

  await page.click('.tiptap');
  await page.keyboard.press(`${MOD}+a`);
  await page.click('.tiptap', { button: 'right' });
  await page.hover('.cm-item[aria-haspopup]');
  await page.locator('.cm-sub .cm-item', { hasText: 'Shorten' }).click();
  await page.locator('.ai-pane .act', { hasText: 'Replace' }).last().click({ timeout: 10_000 }).catch(() => {});
  const rewritten = await page.evaluate(() => document.querySelector('.tiptap')?.textContent);
  const paneEnd = rewritten === 'A slow fox.' ? '' : await page.evaluate(() => document.querySelector('.ai-pane .messages')?.textContent?.replace(/\s+/g, ' ').slice(-200));
  check(rewritten === 'A slow fox.', `a rewrite from the menu's AI submenu runs in the chat and replaces the selection (${rewritten}${paneEnd ? `; pane: ${paneEnd}` : ''})`);

  await page.click('.tiptap');
  await page.keyboard.press(`${MOD}+a`);
  await page.click('.tiptap', { button: 'right' });
  await page.hover('.cm-item[aria-haspopup]');
  await page.locator('.cm-sub .cm-item', { hasText: 'Translate' }).click();
  const offered = await page.locator('.ai-pane .menu button').allTextContents().catch(() => []);
  await page.locator('.ai-pane .menu button', { hasText: 'Deutsch' }).click({ timeout: 5_000 }).catch(() => {});
  const asked = await page.locator('.ai-pane .msg.user').last().textContent().catch(() => null);
  check(offered.some((l) => l.includes('Deutsch')) && asked?.trim() === '/translate Deutsch',
    `Translate from the menu lists the languages, and one sends at once (${offered.length} offered, sent ${JSON.stringify(asked)})`);

  await page.click('.tiptap');
  await page.keyboard.press('Alt+i');
  const prefill = await page.locator('.ai-pane textarea').inputValue().catch(() => null);
  check(prefill === '/draft ', `Alt+I opens the chat with /draft (${JSON.stringify(prefill)})`);

  // A view showing a finished text drops a block nothing is left of; a recorded mark shows.
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForSelector('.tiptap');
  const seen = await page.evaluate(async () => {
    const editor = document.querySelector('.tiptap-host .tiptap').editor;
    const rev = { id: 'r1', author: 'A', date: '2026-01-01T00:00:00Z' }, mark = [{ type: 'deletion', attrs: rev }];
    const fill = Array.from({ length: 60 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: 'gone', marks: mark }], attrs: { revMark: { deletion: rev } } }));
    editor.commands.setContent({ type: 'doc', content: [...fill, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item', marks: mark }], attrs: { revMark: { deletion: rev } } }] }] }, { type: 'paragraph', content: [{ type: 'text', text: 'stays' }] }] });
    const blocks = () => Array.from(document.querySelectorAll('.tiptap-host .tiptap p, .tiptap-host .tiptap li')).filter((el) => el.offsetParent).length;
    await new Promise((r) => setTimeout(r, 1500));
    const all = { blocks: blocks(), marks: document.querySelectorAll('.pm-para-mark').length };
    return { all };
  });
  check(seen.all.marks === 61 && seen.all.blocks === 63, `every recorded paragraph mark shows in the full view (${JSON.stringify(seen.all)})`);
  await page.evaluate(() => document.querySelector('.paper').setAttribute('data-hide-deletions', ''));
  const left = await page.evaluate(() => Array.from(document.querySelectorAll('.tiptap-host .tiptap p, .tiptap-host .tiptap li')).filter((el) => el.offsetParent).map((el) => el.textContent));
  check(left.length === 1 && left[0] === 'stays', `the blocks a hidden deletion empties go, list items too (${left.length} left)`);
  await page.evaluate(() => { const p = document.querySelector('.paper'); p.removeAttribute('data-hide-deletions'); document.querySelector('.tiptap-host .tiptap').editor.commands.setContent('<p>aa</p><p>bbbb</p><p>cc</p>'); });

  // A header's and a footer's changes are the document's: listed, jumped to, settled at once.
  const rev = (id, author) => ({ id, author, date: '2026-01-01T00:00:00Z' });
  const zoneDoc = (text, type, attrs) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'keep ' }, { type: 'text', text, marks: [{ type, attrs }] }] }] });
  await page.evaluate(([head, foot]) => {
    localStorage.clear();
    localStorage.setItem('edentext-header', JSON.stringify(head));
    localStorage.setItem('edentext-footer', JSON.stringify(foot));
    localStorage.setItem('edentext-markup-change-place', 'pane');
  }, [zoneDoc('added', 'insertion', rev('h1', 'Ann')), zoneDoc('struck', 'deletion', rev('f1', 'Ben'))]);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.revisions-pane li');
  const rows = () => page.evaluate(() => [...document.querySelectorAll('.revisions-pane li .kind')].map((e) => e.textContent));
  const reviewTab = () => page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Review').click());
  await page.waitForFunction(() => document.querySelector('.hf-header .pm-rev-ins')?.style.color !== document.querySelector('.hf-footer .pm-rev-del')?.style.color, null, { timeout: 3000 }).catch(() => {});
  const zoneColors = await page.evaluate(() => [document.querySelector('.hf-header .pm-rev-ins')?.style.color, document.querySelector('.hf-footer .pm-rev-del')?.style.color]);
  check(String(await rows()) === 'Header · Inserted,Footer · Deleted' && zoneColors[0] && zoneColors[1] && zoneColors[0] !== zoneColors[1],
    `the pane lists the zones' changes, each author in a colour of the one table (${await rows()}, ${zoneColors})`);
  await page.selectOption('.revisions-pane .filter select >> nth=0', { label: 'Ben' });
  await page.waitForFunction(() => document.querySelectorAll('.revisions-pane li').length === 1, null, { timeout: 3000 }).catch(() => {});
  check(String(await rows()) === 'Footer · Deleted' && await page.getByRole('button', { name: 'Accept shown' }).count() === 1, `the pane filters by author and offers what it shows (${await rows()})`);
  await page.selectOption('.revisions-pane .filter select >> nth=0', { label: 'All' });
  const recording = () => page.locator('[data-cmd="trackChanges"].active, [data-cmd="trackChanges"][aria-pressed="true"]').count();
  await page.keyboard.press(`${MOD}+Shift+c`);
  await page.waitForSelector('dialog[open] input');
  await page.keyboard.press('Escape');
  await reviewTab();
  check(await recording() === 0, 'declining to give a name leaves recording off');
  await page.keyboard.press(`${MOD}+Shift+c`);
  await page.fill('dialog[open] input', 'Test Autor');
  await page.keyboard.press('Enter');
  await reviewTab();
  check(await recording() > 0 && await page.evaluate(() => localStorage.getItem('edentext-user-name')) === 'Test Autor', 'the record key asks for the name, then turns recording on');
  await page.locator('.revisions-pane li .card').first().click();
  await page.waitForSelector('.hf-active.hf-header .tiptap');
  await page.waitForFunction(() => window.getSelection()?.toString() === 'added', null, { timeout: 5000 }).catch(() => {});
  check(await page.evaluate(() => window.getSelection()?.toString() === 'added'), 'a change in the pane opens its zone and selects it');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('more');
  await page.waitForFunction(() => document.querySelectorAll('.revisions-pane li').length === 3, null, { timeout: 5000 }).catch(() => {});
  check((await rows()).length === 3, `typing in the open zone is recorded (${await rows()})`);
  await reviewTab();
  await page.locator('[data-cmd="rejectAll"]').first().click({ force: true }).catch(() => {});
  await page.evaluate(() => document.querySelector('[data-cmd="rejectAll"]')?.click());
  await page.waitForFunction(() => !document.querySelector('.revisions-pane li'), null, { timeout: 5000 }).catch(() => {});
  const rejected = await page.evaluate(() => ({ live: document.querySelector('.hf-active .tiptap')?.textContent, foot: document.querySelector('.hf-footer')?.textContent, rows: document.querySelectorAll('.revisions-pane li').length }));
  check(rejected.rows === 0 && rejected.live === 'keep ' && rejected.foot === 'keep struck', `reject all reaches the open zone and the closed one (${JSON.stringify(rejected)})`);
  await page.keyboard.press('Escape');
  await page.locator('.tiptap-host .tiptap').first().click();
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForFunction(() => document.querySelectorAll('.revisions-pane li').length === 3, null, { timeout: 5000 }).catch(() => {});
  check((await rows()).length === 3, `one undo brings every settled zone back (${await rows()})`);

  // Moved text is one change in the pane, recorded from a real drag.
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('edentext-markup-change-place', 'pane');
    localStorage.setItem('edentext-user-name', 'Test Autor');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap-host .tiptap');
  await page.evaluate(() => document.querySelector('.tiptap-host .tiptap').editor.commands.setContent('<p>first words here</p><p>second line</p>'));
  await reviewTab();
  await page.locator('[data-cmd="trackChanges"]').first().click();
  const word = await page.evaluate(() => {
    const ed = document.querySelector('.tiptap-host .tiptap').editor;
    ed.chain().focus().setTextSelection({ from: 7, to: 12 }).run();
    // Firefox keeps the scroll across a reload, which leaves the line under the sticky ruler.
    document.querySelector('.editor').scrollTop = 0;
    const a = ed.view.coordsAtPos(9), b = ed.view.coordsAtPos(21);
    return { x: a.left, y: (a.top + a.bottom) / 2, tx: b.left, ty: (b.top + b.bottom) / 2 };
  });
  await page.waitForTimeout(200);
  await page.mouse.move(word.x, word.y);
  await page.mouse.down();
  await page.waitForTimeout(200);
  await page.mouse.move(word.x + 15, word.y + 8, { steps: 5 });
  await page.waitForTimeout(100);
  await page.mouse.move(word.tx, word.ty, { steps: 10 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.revisions-pane li'), null, { timeout: 5000 }).catch(() => {});
  const movedWord = await page.evaluate(() => ({ text: document.querySelector('.tiptap-host .tiptap').textContent, double: getComputedStyle(document.querySelector('.tiptap-host .pm-rev-move') ?? document.body).textDecorationStyle }));
  check(String(await rows()) === 'Moved' && movedWord.double === 'double', `a dragged word is one recorded move (${await rows()}, ${JSON.stringify(movedWord)})`);

  // A compared file's differences land here as changes of the file, in one undo step.
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    window.showOpenFilePicker = async () => [{ getFile: async () => new File([bytes], 'older.odt'), queryPermission: async () => 'granted' }];
  }, (await readFile(join(ROOT, 'tests/corpus/01-flow.odt'))).toString('base64'));
  const paneRows = () => page.evaluate(() => document.querySelectorAll('.revisions-pane li').length);
  const before = await paneRows();
  await page.locator('[data-cmd="compareDocument"]').first().click();
  // Without a save picker the app asks through its file input instead.
  if (!(await page.evaluate(() => typeof window.showSaveFilePicker === 'function')))
    await page.setInputFiles('input.file-input[accept*=".odt"]', join(ROOT, 'tests/corpus/01-flow.odt'));
  await page.waitForFunction((n) => document.querySelectorAll('.revisions-pane li').length > n, before, { timeout: 8000 }).catch(() => {});
  const compared = await paneRows();
  check(compared > before, `comparing lists the differences as changes (${before} → ${compared})`);
  await page.locator('.tiptap-host .tiptap').first().click();
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForFunction((n) => document.querySelectorAll('.revisions-pane li').length === n, before, { timeout: 5000 }).catch(() => {});
  check(await paneRows() === before, 'one undo takes the comparison back');

  // A password keeps recording on and the changes unsettled until it is given.
  const lockButton = page.locator('[data-cmd="protectChanges"]').first();
  const lockDialog = page.locator('dialog[open]');
  await lockButton.click();
  await lockDialog.locator('input').nth(0).fill('secret');
  await lockDialog.locator('input').nth(1).fill('secret');
  await lockDialog.getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction(() => document.querySelector('[data-cmd="trackChanges"]')?.disabled, null, { timeout: 3000 }).catch(() => {});
  const shut = await page.evaluate(() => ({ record: document.querySelector('[data-cmd="trackChanges"]').disabled, accept: document.querySelector('[data-cmd="accept"]')?.disabled, card: document.querySelector('.revisions-pane .actions button:last-child').disabled }));
  check(shut.record && !shut.accept && !shut.card, `protected changes cannot be turned off, and rejecting one asks instead of doing nothing (${JSON.stringify(shut)})`);
  const lockedRows = await paneRows();
  const rejectCard = page.locator('.revisions-pane .actions button:last-child').first();
  await rejectCard.click();
  await lockDialog.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(200);
  check(await paneRows() === lockedRows && await page.locator('[data-cmd="trackChanges"]').first().isDisabled(), 'declining the password settles nothing');
  await rejectCard.click();
  await lockDialog.locator('input').first().fill('wrong');
  await lockDialog.getByRole('button', { name: 'OK' }).click();
  await page.waitForSelector('dialog[open] .wrong', { timeout: 3000 }).catch(() => {});
  check(await page.locator('[data-cmd="trackChanges"]').first().isDisabled(), 'the wrong password leaves the protection');
  await lockDialog.locator('input').first().fill('secret');
  await lockDialog.getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-cmd="trackChanges"]')?.disabled, null, { timeout: 3000 }).catch(() => {});
  await page.waitForFunction((n) => document.querySelectorAll('.revisions-pane li').length < n, lockedRows, { timeout: 3000 }).catch(() => {});
  check(await page.locator('[data-cmd="trackChanges"]').first().isEnabled() && await paneRows() < lockedRows, 'the right password lifts it, and the rejection goes through');

} catch (err) {
  check(false, `dom run threw: ${err.message ?? err}`);
} finally {
  check(pageErrors.length === 0, pageErrors.length ? `no uncaught page errors — got: ${pageErrors.join(' | ')}` : 'no uncaught page errors');
  await browser.close();
  if (server) process.kill(-server.pid);
}
process.exit(failures.length ? 1 : 0);
