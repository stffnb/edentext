// Two clients on one Yjs doc (src/lib/editor/undoYjs.ts), relayed by this script: each
// undo takes back only its own client's edits, in the text, the page layout and a header,
// and an undo while recording leaves no recorded change. Concurrent changes to different
// styles or layout fields both stay. Dev server, Chromium.
import { MOD, checker, devServer, openApp } from '../browser.mjs';

const PORT = +(process.env.COLLAB_PORT ?? 4391);
const { check, failures } = checker();
const server = await devServer(PORT);
const { browser, page: a, pageErrors } = await openApp(PORT);
const b = await (await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'en-US', serviceWorkers: 'block' })).newPage();
b.on('pageerror', (e) => pageErrors.push(`B: ${e}`));
b.on('dialog', (d) => d.accept());

const open = async (page, mode) => {
  await page.goto(`http://localhost:${PORT}/?undo=${mode}`, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('edentext-user-name', 'Client'); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__undoYjs && document.querySelector('.tiptap-host .tiptap')?.editor, null, { timeout: 30_000 });
  await page.waitForTimeout(1500);
};
await open(a, 'yjs');
await open(b, 'yjs-join');
await a.waitForFunction(() => window.__yjsUndo);

// Every update leaves through __yOut; the relay hands it to the other side.
const outbox = (page) => page.evaluate(() => {
  window.__yOut = [];
  window.__yjsUndo.ydoc.on('update', (u, origin) => { if (origin !== 'relay') window.__yOut.push([...u]); });
});
const state = await a.evaluate(() => [...window.__undoYjs.Y.encodeStateAsUpdate(window.__yjsUndo.ydoc)]);
await b.evaluate((s) => {
  const { Y, attachYjsUndo } = window.__undoYjs;
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, Uint8Array.from(s), 'relay');
  window.__yjsUndo = attachYjsUndo(document.querySelector('.tiptap-host .tiptap').editor, ydoc);
}, state);
await outbox(a);
await outbox(b);
const relay = async () => {
  for (const [from, to] of [[a, b], [b, a]]) {
    const out = await from.evaluate(() => window.__yOut.splice(0));
    if (out.length) await to.evaluate((us) => { for (const u of us) window.__undoYjs.Y.applyUpdate(window.__yjsUndo.ydoc, Uint8Array.from(u), 'relay'); }, out);
  }
  await a.waitForTimeout(150);
};
const pause = async () => { await a.waitForTimeout(700); await relay(); await relay(); };
const view = (page) => page.evaluate(() => ({
  text: document.querySelector('.tiptap-host .tiptap').editor.state.doc.textContent,
  width: Math.round(document.querySelector('.page, .pm-page, .paper')?.getBoundingClientRect().width ?? 0),
  header: document.querySelector('.hf-header')?.textContent ?? '',
  marks: (() => {
    let n = 0;
    document.querySelector('.tiptap-host .tiptap').editor.state.doc.descendants((node) => {
      if (node.marks.some((m) => m.type.name === 'insertion' || m.type.name === 'deletion')) n++;
    });
    return n;
  })(),
}));
const both = async () => [await view(a), await view(b)];
const body = (page) => page.locator('.tiptap-host .tiptap').first();
const undo = async (page) => { await body(page).click(); await page.keyboard.press(`${MOD}+z`); await pause(); };
const redo = async (page) => { await body(page).click(); await page.keyboard.press(`${MOD}+Shift+z`); await pause(); };
// The style sheet through the app's own store module, which the dev server shares.
const SHEET = '/src/lib/styles/sheet.svelte.ts';
const sheet = (page) => page.evaluate(async (url) => {
  const s = (await import(url)).styleSheet();
  return { json: JSON.stringify(s), h1: s.paragraph['Heading 1'].text.fontSizePt, quote: s.paragraph.Quotations.para.spaceAfter, names: Object.keys(s.paragraph) };
}, SHEET);
const putStyle = (page, name, text, para) => page.evaluate(async ([url, n, t, p]) => {
  const m = await import(url);
  const st = m.styleSheet().paragraph[n] ?? { name: n, parent: 'Standard', next: null, para: {}, text: {} };
  m.putStyle({ ...st, text: { ...st.text, ...t }, para: { ...st.para, ...p } });
}, [SHEET, name, text, para]);
const dropStyle = (page, name) => page.evaluate(async ([url, n]) => (await import(url)).deleteStyle(n), [SHEET, name]);
const margin = (page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--user-margin-left').trim());

try {
  await body(a).click();
  await a.keyboard.press(`${MOD}+End`);
  await a.keyboard.type('Alpha');
  await pause();
  await body(b).click();
  await b.keyboard.press(`${MOD}+End`);
  await b.keyboard.type(' Beta');
  await pause();
  let [va, vb] = await both();
  check(va.text === 'Alpha Beta' && vb.text === va.text, `both type into one paragraph (${va.text} | ${vb.text})`);

  const portrait = va.width;
  await a.click('[data-tab="layout"]');
  await a.click('[data-cmd="orientation"]');
  await a.click('[data-cmd="orientation-landscape"]');
  await a.waitForTimeout(900);
  const zone = a.locator('.hf-zone.hf-header').first();
  await zone.dblclick({ timeout: 5000 }).catch(() => zone.dispatchEvent('dblclick'));
  await a.waitForSelector('.hf-active .tiptap');
  await a.keyboard.type('Head');
  await a.keyboard.press('Escape');
  await pause();
  [va, vb] = await both();
  check(vb.width === va.width && va.width !== portrait && vb.header === 'Head', `layout and header reach the other client (${JSON.stringify([va, vb])})`);

  await undo(b);
  [va, vb] = await both();
  check(va.text === 'Alpha' && vb.text === 'Alpha' && vb.width === va.width && va.width !== portrait && vb.header === 'Head',
    `B's undo takes back only B's typing (${JSON.stringify([va, vb])})`);

  await undo(a);
  [va, vb] = await both();
  check(va.header === '' && vb.header === '' && va.width !== portrait, `A's first undo takes back A's header (${JSON.stringify([va, vb])})`);
  await undo(a);
  [va, vb] = await both();
  check(va.width === portrait && vb.width === portrait && vb.text === 'Alpha', `A's next undo takes back A's layout on both (${JSON.stringify([va, vb])})`);
  await undo(a);
  [va, vb] = await both();
  check(va.text === '' && vb.text === '', `A's last undo takes back A's typing (${JSON.stringify([va, vb])})`);

  await body(b).click();
  await b.keyboard.press(`${MOD}+Shift+c`);
  await b.waitForTimeout(300);
  await b.keyboard.type('Recorded');
  await pause();
  const recorded = (await view(a)).marks;
  await undo(b);
  [va, vb] = await both();
  check(recorded > 0 && va.marks === 0 && vb.marks === 0 && va.text === '' && vb.text === '', `an undo while recording leaves no change (${recorded} marked before, ${JSON.stringify([va, vb])})`);

  // A and B change different styles before either hears of the other's.
  await putStyle(a, 'Heading 1', { fontSizePt: 30 }, {});
  await putStyle(b, 'Quotations', {}, { spaceAfter: 20 });
  await pause();
  let [sa, sb] = [await sheet(a), await sheet(b)];
  check(sa.h1 === 30 && sa.quote === 20 && sa.json === sb.json, `concurrent changes to two styles both stay (${sa.h1}/${sa.quote} | ${sb.h1}/${sb.quote}, same ${sa.json === sb.json})`);
  await undo(a);
  [sa, sb] = [await sheet(a), await sheet(b)];
  check(sa.h1 === 18 && sb.h1 === 18 && sa.quote === 20 && sb.quote === 20, `A's undo takes back only A's style (${sa.h1}/${sa.quote} | ${sb.h1}/${sb.quote})`);
  await redo(a);
  [sa, sb] = [await sheet(a), await sheet(b)];
  check(sa.h1 === 30 && sb.h1 === 30 && sb.quote === 20, `A's redo brings it back on both (${sa.h1} | ${sb.h1})`);

  await putStyle(b, 'Gone', { bold: true }, {});
  await pause();
  await putStyle(a, 'Collab/A', { italic: true }, {});
  await dropStyle(b, 'Gone');
  await pause();
  [sa, sb] = [await sheet(a), await sheet(b)];
  check(sa.names.includes('Collab/A') && !sa.names.includes('Gone') && sa.json === sb.json,
    `a style added and another deleted at once both take effect (${sa.names.slice(-3)} | ${sb.names.slice(-3)})`);

  const wide = await margin(a);
  await a.click('[data-tab="layout"]');
  await a.click('[data-cmd="margins"]');
  await a.click('[data-cmd="margins-narrow"]');
  await b.click('[data-tab="layout"]');
  await b.click('[data-cmd="orientation"]');
  await b.click('[data-cmd="orientation-landscape"]');
  await pause();
  [va, vb] = await both();
  const [ma, mb] = [await margin(a), await margin(b)];
  check(ma === mb && ma !== wide && va.width === vb.width && va.width !== portrait, `margins and orientation set at once both stay (${ma} ${va.width}px | ${mb} ${vb.width}px)`);

  check(!pageErrors.length, `no uncaught page errors ${pageErrors.join(' | ')}`);
} catch (e) {
  check(false, `collab undo run threw: ${e}`);
} finally {
  await browser.close();
  server?.kill?.();
}
process.exit(failures.length ? 1 : 0);
