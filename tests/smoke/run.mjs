// Browser smoke test: boots the production build in headless Chromium and checks the
// paths jsdom cannot — the bundle boots, typing works, autosave survives a reload,
// a corpus document imports and paginates, a margin balloon holds its content. Fails on
// any uncaught page error.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { ROOT, MOD, checker, previewServer, openApp } from '../browser.mjs';

const PORT = +(process.env.SMOKE_PORT ?? 4180);
const { check, failures } = checker();
const server = await previewServer(PORT);
const { browser, page, pageErrors } = await openApp(PORT);
let hostServer;

try {
  // Boot on a clean profile.
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });
  check(true, 'app boots, editor mounts');

  // Typing and a keyboard command reach ProseMirror.
  await page.click('.tiptap');
  await page.keyboard.type('Hello smoke ');
  await page.keyboard.press(`${MOD}+b`);
  await page.keyboard.type('bold');
  const strong = await page.evaluate(() => document.querySelector('.tiptap strong')?.textContent);
  check(strong === 'bold', 'typing + bold shortcut render');
  // The status-bar count follows a changed document a beat later, off the keystroke.
  await page.waitForFunction(() => /\b3 Words\b/.test(document.querySelector('.statusbar')?.textContent ?? ''),
    null, { timeout: 5_000 });
  check(true, 'word count follows the typing');

  // Field shading: every field takes the grey ground, and View ▸ Field Shadings drops
  // it. Probe spans, since the real fields need a caption and a header to exist.
  const shades = () => page.evaluate(() => {
    const host = document.createElement('p');
    host.innerHTML = ['class="cross-ref"', 'data-page-field="number"', 'data-datetime-field=""',
      'data-seq="table"', 'data-placeholder-field=""', 'class="pm-citation"']
      .map((spec) => `<span ${spec}>x</span>`).join('');
    document.querySelector('.paper').appendChild(host);
    const out = [...host.children].map((el) => getComputedStyle(el).backgroundColor);
    host.remove();
    return out;
  });
  const shadedOn = await shades();
  await page.click('button.ribbon-tab[data-tab="view"]');
  await page.click('button:has-text("Field Shadings")');
  const shadedOff = await shades();
  await page.click('button:has-text("Field Shadings")');
  await page.click('button.ribbon-tab[data-tab="home"]');
  check(shadedOn.every((c) => c !== 'rgba(0, 0, 0, 0)') && shadedOff.every((c) => c === 'rgba(0, 0, 0, 0)'),
    `field shading covers every field and switches off (${shadedOn[0]})`);

  // Autosave (1s debounce) persists the document across a reload.
  await page.waitForFunction(() => (localStorage.getItem('edentext-doc') ?? '').includes('Hello smoke'),
    null, { timeout: 10_000 });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });
  await page.waitForFunction(() => document.querySelector('.tiptap')?.textContent.includes('Hello smoke'),
    null, { timeout: 10_000 });
  check(true, 'autosave survives a reload');

  // A corpus document imports, renders its table and reports a page count.
  await page.setInputFiles('input.file-input[accept*=".odt"]', join(ROOT, 'tests/corpus/04-table.odt'));
  await page.waitForFunction(() => document.querySelector('.tiptap table td')?.textContent.trim(),
    null, { timeout: 30_000 });
  const pages = await page.evaluate(() => document.querySelector('.statusbar')?.textContent ?? '');
  check(/\d/.test(pages), 'ODT import renders table + statusbar page count');

  // Raster-PDF export over the loaded document: the seam in export/pdf.ts hands the
  // bytes to the sink instead of doc.save() (the download hangs in headless Chromium).
  await page.evaluate(() => {
    window.__edentextPdfSink = (buf) => {
      window.__pdfHead = String.fromCharCode(...new Uint8Array(buf, 0, 5));
      window.__pdfSize = buf.byteLength;
    };
  });
  await page.click('.ribbon-tab-file');
  await page.click('button:has-text("Raster PDF")');
  await page.waitForFunction(() => window.__pdfSize > 0, null, { timeout: 60_000 });
  const pdf = await page.evaluate(() => ({ head: window.__pdfHead, size: window.__pdfSize }));
  check(pdf.head === '%PDF-' && pdf.size > 20_000,
    `PDF export produces a PDF (${Math.round(pdf.size / 1024)} KB)`);

  // Margin balloons: every card's content stays inside its box and the column inside the
  // page. An unwrapped button row once pushed "Edit" clean out of the balloon, and a
  // comment of a few paragraphs pushed the cards under it off the sheet.
  // Leaving the page flushes a pending autosave over the key; let the debounce drain
  // before the key is written by hand.
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const m = (text, mark) => ({ type: 'paragraph', content: [{ type: 'text', text, marks: [mark] }] });
    const long = 'Donaudampfschifffahrtsgesellschaftskapitaenspatentpruefungsordnung';
    const essay = Array.from({ length: 16 }, (_, i) => `Absatz ${i + 1} eines sehr langen Kommentars, der ohne Deckel weit ueber das Seitenende hinaus reicht.`).join('\n\n');
    localStorage.setItem('edentext-app-language', 'de');
    localStorage.removeItem('edentext-markup-mode');
    localStorage.setItem('edentext-user-name', 'Ich Selbst');
    localStorage.setItem('edentext-doc-properties', JSON.stringify({ author: 'Fremde Autorin' }));
    // The flag the previous document's load left behind would send this one to
    // edentext-doc-broken and start the app empty.
    localStorage.removeItem('edentext-doc-loading');
    localStorage.setItem('edentext-doc', JSON.stringify({ type: 'doc', content: [
      p('Head.'),
      m('commented', { type: 'comment', attrs: { id: 'c1', author: 'Test Autor', date: '2026-03-04T05:06:07.000Z', text: 'Bitte kuerzen.', resolved: false, replies: [{ author: 'Zweiter Autor', date: '2026-03-05T05:06:07.000Z', text: 'Einverstanden, gekuerzt.' }] } }),
      m(long, { type: 'comment', attrs: { id: 'c2', author: 'Ein-Autor-Ohne-Leerzeichen-Im-Namen', date: '2026-03-04T05:06:07.000Z', text: long, resolved: false } }),
      m('lang kommentiert', { type: 'comment', attrs: { id: 'c3', author: 'Test Autor', date: '2026-03-04T05:06:07.000Z', text: essay, resolved: false } }),
      m('inserted', { type: 'insertion', attrs: { id: 'r1', author: 'Rev Autor', date: '2026-05-06T07:08:09.000Z' } }),
      m('gestrichen', { type: 'deletion', attrs: { id: 'r4', author: 'Rev Autor', date: '2026-05-06T07:08:09.000Z' } }),
      // Neither an empty block nor a row has a line at its start: their cards still show.
      { type: 'paragraph', attrs: { revMark: { insertion: { id: 'r2', author: 'Rev Autor', date: '2026-05-06T07:08:09.000Z' } } } },
      p('Zwischen.'),
      { type: 'table', content: [{ type: 'tableRow', attrs: { revMark: { insertion: { id: 'r3', author: 'Rev Autor', date: '2026-05-06T07:08:09.000Z' } } },
        content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] },
      ...Array.from({ length: 6 }, (_, i) => p(`Absatz ${i + 1}.`)),
    ] }));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tiptap', { timeout: 15_000 });
  await page.waitForFunction(() => document.querySelectorAll('.balloon').length >= 7,
    null, { timeout: 15_000 }).catch(() => {});
  check(await page.evaluate(() => document.querySelectorAll('.balloon').length) === 7,
    'every change has its balloon, an empty paragraph and a table row too');
  // The edit box opens inside the card: floating, it would be clipped by the balloon.
  const menuSpill = async () => page.evaluate(() => {
    const out = [];
    const cards = [...document.querySelectorAll('.balloon')];
    // No card scrolls: an inactive one cuts its text short, the active one grows.
    const layer = document.querySelector('.review-margin-layer')?.getBoundingClientRect();
    for (const b of cards) {
      const box = b.getBoundingClientRect();
      if (b.scrollHeight > b.clientHeight + 1) out.push('card scrolls inside');
      if (b.scrollWidth > b.clientWidth + 1) out.push('card clips its content sideways');
      for (const el of b.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        if (r.left < box.left - 0.5 || r.right > box.right + 0.5)
          out.push(`<${el.tagName.toLowerCase()}> "${el.textContent.trim().slice(0, 16)}" outside the card`);
        if (r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5)
          out.push(`<${el.tagName.toLowerCase()}> "${el.textContent.trim().slice(0, 16)}" below the card`);
      }
      if (layer && (box.top < layer.top - 0.5 || box.bottom > layer.bottom + 0.5)) out.push('balloon hangs off the page');
    }
    const rects = cards.map((e) => e.getBoundingClientRect());
    for (let i = 1; i < rects.length; i++) if (rects[i].top < rects[i - 1].bottom - 0.5) out.push(`balloon ${i} overlaps the one above`);
    // The leader belongs in the gap under its line, never across the letters.
    const anchor = document.querySelector('[data-comment="c1"]')?.getBoundingClientRect();
    const first = document.querySelector('.review-margin-layer path')?.getAttribute('d');
    if (layer && anchor && first && +first.split(' ')[2] < anchor.bottom - layer.top - 1)
      out.push('leader crosses its own line');
    return { count: cards.length, out: [...new Set(out)] };
  });
  // The stack settles on the next frame after a card is measured, so let it.
  const settle = () => page.waitForTimeout(300);
  await settle();
  const spill = await menuSpill();
  await page.click('.balloon .edit');
  await settle();
  // The card grows at once, the ones below glide after it; a slow runner is still there.
  await page.waitForFunction(() => [...document.querySelectorAll('.balloon')].map((e) => e.getBoundingClientRect())
    .every((r, i, all) => !i || r.top >= all[i - 1].bottom - 0.5), null, { timeout: 3000 }).catch(() => {});
  const opened = await menuSpill();
  check(spill.count === 7 && spill.out.length === 0 && opened.out.length === 0,
    `margin balloons hold their content (${spill.count} balloons${[...spill.out, ...opened.out].length ? ': ' + [...spill.out, ...opened.out].join(', ') : ''})`);

  // The display modes, through the ribbon: no markup takes bars and balloons off the
  // page, and the full view brings the same ones back.
  const shown = () => page.evaluate(() => ({
    balloons: document.querySelectorAll('.balloon').length,
    bars: document.querySelectorAll('.change-bar-layer *').length,
  }));
  const pickMode = async (label) => {
    await page.locator('[role=tab], .ribbon-tabs button').filter({ hasText: /Überprüfen|Review/ }).first().click();
    await page.locator('button', { hasText: /Für Überarbeitung anzeigen|Display for review/ }).first().click();
    await page.locator('.ribbon-menu button', { hasText: label }).first().click();
    await settle();
    await settle();
  };
  const full = await shown();
  await pickMode(/Einfaches Markup|Simple markup/);
  const simple = await shown();
  check(simple.balloons === full.balloons, `simple markup keeps a card for what it hides (${simple.balloons}/${full.balloons})`);
  await pickMode(/Kein Markup|No markup/);
  const bare = await shown();
  await pickMode(/Alle Markups|All markup/);
  const back = await shown();
  check(full.balloons > 0 && full.bars > 0 && bare.balloons === 0 && bare.bars === 0
    && back.balloons === full.balloons && back.bars === full.bars,
    `no markup empties the margin and all markup fills it again (${full.balloons}/${full.bars} → ${bare.balloons}/${bare.bars} → ${back.balloons}/${back.bars})`);

  // What you record is yours, whoever wrote the file.
  await page.locator('.tiptap p', { hasText: 'Absatz 3.' }).click();
  await page.keyboard.press(`${MOD}+Shift+C`);
  await page.keyboard.type('x');
  await settle();
  const signed = await page.evaluate(() => [...document.querySelectorAll('.balloon')].map((b) => b.textContent).join(' '));
  check(signed.includes('Ich Selbst') && !signed.includes('Fremde Autorin'),
    'a recorded change carries the user name, not the file author');

  // A new comment is written beside its text, which no dialog covers, in a box that grows.
  const selectWord = (word) => page.evaluate((w) => {
    const node = [...document.querySelectorAll('.tiptap p')].find((p) => p.textContent === w)?.firstChild;
    const range = document.createRange();
    range.selectNodeContents(node);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, word);
  const ask = () => page.evaluate(() => window.dispatchEvent(new Event('odf-new-comment')));
  const composer = '.balloon textarea[aria-label]';
  await page.locator('.tiptap p', { hasText: 'Absatz 5.' }).click();
  await selectWord('Absatz 5.');
  await settle();
  await ask();
  await page.waitForSelector(composer, { timeout: 5000 });
  const rows = (await page.locator(composer).boundingBox()).height;
  await page.keyboard.type('line one\nline two\nline three\nline four\nline five\nline six');
  await settle();
  const typed = await page.evaluate((sel) => {
    const box = document.querySelector(sel);
    return { focused: document.activeElement === box, scrolls: box.scrollHeight > box.clientHeight + 1, modal: !!document.querySelector('dialog[open]') };
  }, composer);
  const grown = (await page.locator(composer).boundingBox()).height;
  // The card being written lies at its line and the others deck around it, as for any active card.
  const held = (await menuSpill()).out.filter((o) => !o.includes('overlaps'));
  check(typed.focused && !typed.modal && !typed.scrolls && grown > rows && !held.length,
    `a new comment grows in the margin with no dialog (${rows}→${grown}px${held.length ? ': ' + held.join(', ') : ''})`);
  await page.keyboard.press(`${MOD}+Enter`);
  await settle();
  const added = await page.evaluate(() => ({
    open: !!document.querySelector('.balloon textarea'),
    body: [...document.querySelectorAll('.balloon .body')].some((b) => b.textContent.startsWith('line one\nline two')),
    marked: document.querySelector('.tiptap .pm-comment')?.closest('.tiptap')?.textContent.includes('Absatz 5.'),
  }));
  check(!added.open && added.body && added.marked, 'the added comment keeps its lines and its text');

  await selectWord('Absatz 6.');
  await settle();
  await ask();
  await page.waitForSelector(composer, { timeout: 5000 });
  await page.keyboard.type('never mind');
  await page.keyboard.press('Escape');
  await settle();
  check(await page.evaluate(() => !document.querySelector('.balloon textarea')
    && ![...document.querySelectorAll('.tiptap .pm-comment')].some((c) => c.textContent === 'Absatz 6.')),
  'a cancelled comment leaves nothing behind');

  // Embed mode: a host page on another origin drives the editor through public/embed.js.
  const host = await browser.newPage({ viewport: { width: 1400, height: 1000 }, locale: 'en-US', serviceWorkers: 'block' });
  host.on('pageerror', (err) => pageErrors.push(`[embed] ${err}`));
  host.on('dialog', (d) => d.accept());
  // A real server on another site (127.0.0.1 vs localhost): a routed page counts as a
  // public one, which Chromium may not let frame a loopback address.
  const hostPage = `<!doctype html><div id="c" style="height:950px"></div>
    <script type="module">
      import { EdenTextFrame } from '/embed.js';
      window.events = [];
      window.ed = new EdenTextFrame(document.getElementById('c'), { url: 'http://localhost:${PORT}/', user: 'Host', locale: 'en', accent: 'teal', ai: false });
      for (const t of ['dirty', 'saveRequest', 'warning']) ed.on(t, (m) => events.push(m));
      ed.ready.then(() => { window.isReady = true; });
    </script>`;
  const hostFiles = {
    '/embed.js': ['text/javascript', () => readFileSync(join(ROOT, 'public/embed.js'))],
    '/table.odt': ['application/octet-stream', () => readFileSync(join(ROOT, 'tests/corpus/04-table.odt'))],
    '/': ['text/html', () => hostPage],
  };
  hostServer = createServer((req, res) => {
    const [type, body] = hostFiles[new URL(req.url, 'http://x').pathname] ?? [];
    if (!type) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': type }).end(body());
  }).listen(PORT + 1, '127.0.0.1');
  await new Promise((r) => hostServer.once('listening', r));
  await host.goto(`http://127.0.0.1:${PORT + 1}/`);
  await host.waitForFunction(() => window.isReady, null, { timeout: 20_000 });
  const frame = host.frames().find((f) => f.url().includes('embed=1'));
  check(!!frame, 'embed: the editor boots in the iframe and answers init');
  const storedBefore = await frame.evaluate(() => [localStorage.getItem('edentext-doc'), sessionStorage.getItem('edentext-tab-doc')]);
  check(await frame.isVisible('.powered-by'), 'embed: "Powered by EdenText" shows in the status bar');
  const look = await frame.evaluate(() => [document.documentElement.dataset.accent, !!document.querySelector('[data-cmd="aiPane"]')]);
  check(look.join() === 'teal,false', `embed: init sets the accent and switches the assistant off (${look})`);
  await frame.click('.ribbon-tab-file');
  const fileMenu = await frame.evaluate(() => ['open', 'newDocument', 'saveAsOdt', 'saveTemplate', 'save']
    .map((c) => !!document.querySelector(`.ribbon [data-cmd="${c}"]`)));
  await host.keyboard.press('Escape');
  check(fileMenu.join() === 'false,false,false,false,true', `embed: the File menu keeps Save and drops the file commands (${fileMenu})`);

  check(await host.evaluate(async () => ed.load(await (await fetch('/table.odt')).blob(), 'table.odt')), 'embed: load answers ok');
  await frame.waitForFunction(() => document.querySelector('.tiptap table td')?.textContent.trim(), null, { timeout: 30_000 });
  check(true, 'embed: the loaded document renders');

  await frame.click('.tiptap p');
  await host.keyboard.type('Embedded ');
  await host.waitForFunction(() => events.some((m) => m.type === 'dirty' && m.dirty), null, { timeout: 5_000 });
  check(true, 'embed: an edit reports dirty');
  await frame.click('.tiptap p', { button: 'right' });
  await frame.waitForSelector('.cm-item', { timeout: 5_000 });
  const menu = await frame.$$eval('.cm-item', (items) => items.map((e) => e.textContent.trim()));
  await host.keyboard.press('Escape');
  check(menu.length > 0 && !menu.some((l) => /^AI/.test(l)), `embed: the context menu has no AI entry while the host switched it off (${menu.length} items)`);
  await host.keyboard.press(`${MOD}+s`);
  await host.waitForFunction(() => events.some((m) => m.type === 'saveRequest'), null, { timeout: 5_000 });
  check(true, 'embed: Save asks the host');

  const heads = await host.evaluate(async () => {
    const out = {};
    for (const f of ['odt', 'docx', 'pdf']) {
      const file = await ed.export(f);
      out[f] = [String.fromCharCode(...new Uint8Array(await file.slice(0, 4).arrayBuffer())), file.size, file.name];
    }
    return out;
  });
  check(heads.odt[0].startsWith('PK') && heads.docx[0].startsWith('PK') && heads.pdf[0] === '%PDF'
    && heads.odt[2].endsWith('.odt') && heads.docx[2].endsWith('.docx') && heads.pdf[2].endsWith('.pdf'),
  `embed: export returns odt, docx and pdf files (${JSON.stringify(heads)})`);
  // The exported DOCX reads back with the edit in it.
  await host.evaluate(async () => { const f = await ed.export('docx'); await ed.load(f); });
  await frame.waitForFunction(() => document.querySelector('.tiptap')?.textContent.includes('Embedded'), null, { timeout: 30_000 });
  check(true, 'embed: an exported file loads back with the edit');
  await host.evaluate(() => ed.markSaved());
  await host.waitForFunction(() => events.filter((m) => m.type === 'dirty').at(-1)?.dirty === false, null, { timeout: 5_000 });
  check(true, 'embed: markSaved clears dirty');
  await host.evaluate(() => ed.newDocument('blank.odt'));
  await frame.waitForFunction(() => !document.querySelector('.tiptap')?.textContent.trim(), null, { timeout: 10_000 });
  check(await host.evaluate(() => events.filter((m) => m.type === 'dirty').at(-1)?.dirty === false), 'embed: new starts an empty, unchanged document');

  await new Promise((r) => setTimeout(r, 1500)); // past the autosave debounce
  const storedAfter = await frame.evaluate(() => [localStorage.getItem('edentext-doc'), sessionStorage.getItem('edentext-tab-doc')]);
  check(JSON.stringify(storedAfter) === JSON.stringify(storedBefore), 'embed: the document is not kept in browser storage');
  await host.close();
} catch (err) {
  check(false, `smoke run threw: ${err.message ?? err}`);
} finally {
  check(pageErrors.length === 0, pageErrors.length ? `no uncaught page errors — got: ${pageErrors.join(' | ')}` : 'no uncaught page errors');
  await browser.close();
  hostServer?.close();
  if (server) process.kill(-server.pid);
}
process.exit(failures.length ? 1 : 0);
