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
  await page.evaluate(() => localStorage.setItem('edentext-zoom', '100'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });
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
  // the format is settled before the bytes are built: Save As (.docx) hands over a DOCX
  // whatever the browser's dialog does with the name.
  await page.evaluate(() => { window.showSaveFilePicker = undefined; });
  await page.click('.ribbon-tab-file');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.locator('.ribbon-menu button', { hasText: '(.docx)' }).first().click(),
  ]);
  const saved = await readFile(await download.path());
  const isDocx = saved[0] === 0x50 && saved[1] === 0x4b && saved.includes('word/document.xml');
  check(isDocx, `Save As (.docx) without a picker downloads a DOCX (${download.suggestedFilename()}, ${saved.length} bytes)`);

  // The whole margin band is the zone's double-click target, and an empty zone's
  // placeholder sits where the first typed character lands — not a line below it.
  await page.keyboard.press('Escape');
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
  await page.locator('.hf-bar-done').click();
  const hf = await page.evaluate(() => ({
    first: localStorage.getItem('edentext-hf-different-first'),
    running: localStorage.getItem('edentext-header'),
    firstPage: localStorage.getItem('edentext-header-first') ?? '',
    dist: localStorage.getItem('edentext-hf-distances') ?? '',
  }));
  check(hf.first === 'true' && !hf.running && hf.firstPage.includes('Titelseite') && /"header":1.8/.test(hf.dist),
    `the ribbon's header/footer switches reach the document (first page: ${hf.first}, running zone: ${hf.running}, distances: ${hf.dist})`);

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
  // than a key: the spell checker re-reads the edited paragraph, not the document.
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
  check(passes === 0 && idle < 100,
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
  const bands = await page.evaluate(() => Array.from(document.querySelectorAll('.tiptap > p'),
    (p) => `${p.getAttribute('data-wrap-band') ?? '-'}/${getComputedStyle(p).clear}`).join(' '));
  check(bands === '-/none true/none -/both anchored/none -/none true/none true/none -/both',
    `loaded from the autosave, the block after a band frame clears it, after an anchored one it does not (${bands})`);

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
  const flow = await page.evaluate(() => ({ passes: window.__passes, fragments: document.querySelectorAll('.tiptap > .columns-node').length }));
  check(flow.fragments >= 3 && flow.passes <= 8,
    `a two-column section over ${flow.fragments} pages settles in ${flow.passes} passes`);
  // Behind the text: the frame leaves the flow (so the paragraph loses its height again)
  // and is then moved by its own offsets, since there is no text position to re-anchor to.
  await page.evaluate((d) => localStorage.setItem('edentext-doc', JSON.stringify(d)), { type: 'doc', content: [
    block(words('before '), frame({}), words(' after the picture')),
  ] });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap img', { timeout: 15_000 });
  await settle(page, true);
  const paraHeight = () => page.evaluate(() => document.querySelector('.tiptap > p').getBoundingClientRect().height);
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
  check(behindBox.wrap === 'through' && behindBox.z === '-1' && await paraHeight() < inlineHeight,
    `the behind-text button takes the frame out of the flow (${behindBox.wrap}, z ${behindBox.z}, ${inlineHeight}px → ${await paraHeight()}px)`);

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

  // A text box in that mode moves the same way, but by its frame ring — its own drag
  // is ProseMirror's node move, which would re-anchor it instead.
  await page.evaluate((d) => localStorage.setItem('edentext-doc', JSON.stringify(d)), { type: 'doc', content: [
    block(words('before the box '), { type: 'textBox', attrs: { width: 200, height: 80, wrap: 'through' },
      content: [block(words('in the box'))] }, words(' after it')),
  ] });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap .image-node[data-wrap="through"]', { timeout: 15_000 });
  await settle(page, true);
  const boxAt = () => page.evaluate(() => {
    const r = document.querySelector('.tiptap .image-node[data-wrap="through"]').getBoundingClientRect();
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

} catch (err) {
  check(false, `dom run threw: ${err.message ?? err}`);
} finally {
  check(pageErrors.length === 0, pageErrors.length ? `no uncaught page errors — got: ${pageErrors.join(' | ')}` : 'no uncaught page errors');
  await browser.close();
  if (server) process.kill(-server.pid);
}
process.exit(failures.length ? 1 : 0);
