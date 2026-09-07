// Browser DOM run: the layout the vitest suite cannot see. A corpus document is
// opened and its pagination watched through a settle, a reload, a zoom and an edit —
// the page count is what every layer on the page is measured against. Fails on any
// uncaught page error.
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT, MOD, checker, previewServer, openApp } from '../browser.mjs';

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
} catch (err) {
  check(false, `dom run threw: ${err.message ?? err}`);
} finally {
  check(pageErrors.length === 0, pageErrors.length ? `no uncaught page errors — got: ${pageErrors.join(' | ')}` : 'no uncaught page errors');
  await browser.close();
  if (server) process.kill(-server.pid);
}
process.exit(failures.length ? 1 : 0);
