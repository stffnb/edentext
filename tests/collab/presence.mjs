// Who is in a session and where: a name asked once on starting or joining (none makes a
// guest, numbered alike everywhere), colours that differ and hold, the circles in the status
// bar, going to and following someone's caret or zone, lines on who came or went, and
// `@Name` in a comment reaching the one named. Real relay and dev server; any engine (BROWSER).
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { checker, collectErrors, devServer, openApp } from '../browser.mjs';
import { startRelay } from '../../relay/server.mjs';

const PORT = +(process.env.PRESENCE_PORT ?? 4984);
const RELAY_PORT = +(process.env.PRESENCE_RELAY_PORT ?? 4985);
process.env.RELAY_PORT = String(RELAY_PORT);
const { check, failures } = checker();
const relay = await startRelay({ port: RELAY_PORT });
const server = await devServer(PORT);
const { browser, page: a, pageErrors } = await openApp(PORT);
const URL0 = `http://localhost:${PORT}/`;

async function client(name) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'en-US', serviceWorkers: 'block' });
  if (name) await ctx.addInitScript((n) => { if (!localStorage.getItem('edentext-user-name')) localStorage.setItem('edentext-user-name', n); }, name);
  const page = await ctx.newPage();
  collectErrors(page, pageErrors, `${name || 'guest'}: `);
  page.on('dialog', (d) => d.accept().catch(() => {}));
  return page;
}
const ED = '.tiptap-host .tiptap';
const ready = (page) => page.waitForFunction((q) => document.querySelector(q)?.editor, ED, { timeout: 30_000 });
const live = (page) => page.waitForFunction(() => window.__collab?.view()?.status === 'live', null, { timeout: 20_000 });
const mod = (page, url, fn, arg) => page.evaluate(async ([u, f, x]) => (0, eval)(f)(await import(u), x), [url, fn.toString(), arg]);
const APP = '/src/lib/collab/appSession.svelte.ts';
const PRES = '/src/lib/collab/presence.svelte.ts';
// Everyone a client lists, by relay id, and itself.
const listed = (page) => page.evaluate(async (u) => {
  const v = window.__collab.view();
  const self = { id: window.__collab.session.me, color: (await import(u)).collabColor() };
  return { self, others: [...v.peers.map((p) => ({ id: p.peer, name: p.name, color: p.color })), ...v.readers.map((r) => ({ id: r.id, name: r.name, color: r.color, reader: true }))] };
}, APP);
const circles = (page) => page.evaluate(() => [...document.querySelectorAll('.collab-people .person')].map((b) => `${b.dataset.person ?? 'more'}:${b.textContent}:${b.getAttribute('aria-label')}`));
const news = (page) => page.evaluate(() => [...document.querySelectorAll('.collab-news [data-news]')].map((n) => `${n.dataset.news}:${n.textContent}`));
const sent = (page) => page.evaluate(() => [0, 1, 12, 13].map((k) => window.__collab.session.stats.sent[k]).join());
// Whether `sel` is inside the page view of the editor.
const inView = (page, sel) => page.evaluate((q) => {
  const el = document.querySelector(q);
  const box = document.querySelector('.editor')?.getBoundingClientRect();
  if (!el || !box) return false;
  const r = el.getBoundingClientRect();
  return r.top >= box.top && r.bottom <= box.bottom;
}, sel);
// Puts the caret into paragraph `n` of the long document.
const caretAt = (page, n) => page.evaluate(([q, n]) => {
  const ed = document.querySelector(q).editor;
  let at = 1;
  ed.state.doc.forEach((node, pos, i) => { if (i === n) at = pos + 2; });
  ed.commands.focus(null, { scrollIntoView: false });
  ed.commands.setTextSelection(at);
}, [ED, n]);
const selection = (page) => page.evaluate((q) => { const s = document.querySelector(q).editor.state.selection; return `${s.from}-${s.to}`; }, ED);

try {
  // A starts without a name: the dialog asks once, and left empty A is a guest.
  await a.goto(URL0, { waitUntil: 'load' });
  await a.evaluate(() => localStorage.clear());
  await a.reload({ waitUntil: 'load' });
  await ready(a);
  await a.evaluate((q) => document.querySelector(q).editor.commands.setContent({ type: 'doc', content: Array.from({ length: 420 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Line ${i} of a long document` }] })) }), ED);
  await a.waitForTimeout(1500);
  await a.click('.ribbon-tab-file');
  await a.click('.ribbon [data-cmd="collab"]');
  const askedA = await a.isVisible('dialog[open] [data-field="collabName"]');
  await a.click('dialog[open] [data-cmd="collabStart"]');
  await live(a);
  const link = await a.inputValue('dialog[open] [data-link="edit"] input');
  const viewLink = await a.inputValue('dialog[open] [data-link="view"] input');
  await a.click('dialog[open] .actions .primary');

  const b = await client('Ben');
  await b.goto(link, { waitUntil: 'load' });
  await ready(b);
  await live(b);
  const askedB = await b.isVisible('dialog[open] [data-cmd="collabJoin"]');
  await caretAt(a, 3);
  await a.waitForTimeout(3500);

  const c = await client('');
  await c.goto(link, { waitUntil: 'load' });
  await ready(c);
  await c.waitForSelector('dialog[open] [data-cmd="collabJoin"]', { timeout: 20_000 });
  await c.click('dialog[open] [data-cmd="collabJoin"]');
  await live(c);
  const cameA = await a.waitForSelector('.collab-news [data-news="came"]', { timeout: 10_000 }).then(() => news(a), () => []);
  const focusA = await a.evaluate(() => !!document.activeElement?.closest('.tiptap-host'));
  await c.waitForTimeout(2500);
  const [la, lb, lc] = [await listed(a), await listed(b), await listed(c)];
  const guest = (l, id) => l.others.find((o) => o.id === id)?.name;
  check(askedA && !askedB && !(await c.isVisible('dialog[open] [data-cmd="collabJoin"]')),
    `without a name the dialog asks on starting and joining, once; with one it does not (${askedA}, ${askedB})`);
  check(/^Guest \d{3}$/.test(guest(lb, la.self.id)) && /^Guest \d{3}$/.test(guest(lb, lc.self.id)) && guest(lb, la.self.id) !== guest(lb, lc.self.id)
    && guest(la, lc.self.id) === guest(lb, lc.self.id) && guest(lc, la.self.id) === guest(lb, la.self.id),
    `two who skipped are guests, told apart and named alike everywhere (${guest(lb, la.self.id)}, ${guest(lb, lc.self.id)})`);
  check(cameA.length === 1 && /^came:Guest \d{3} joined$/.test(cameA[0]) && focusA && !(await news(c)).length,
    `one line says who came, none for oneself or those already there, and the focus stays in the text (${cameA}; ${focusA})`);

  // Ben reloads: nobody hears he went or came.
  await b.reload({ waitUntil: 'load' });
  await ready(b);
  await live(b);
  await a.waitForTimeout(9500);
  const reload = (await news(a)).filter((n) => /Ben/.test(n));
  check(!reload.length, `a reload says nothing (${reload})`);

  // A second Ben and Dora join at once: one line. Then Rhea reads along.
  const [d, f] = [await client('Ben'), await client('Dora')];
  await Promise.all([d.goto(link, { waitUntil: 'load' }), f.goto(link, { waitUntil: 'load' })]);
  await Promise.all([live(d), live(f)]);
  const both = await a.waitForSelector('.collab-news [data-news="came"]', { timeout: 10_000 }).then(() => news(a), () => []);
  check(both.length === 1 && /Ben and Dora joined|Dora and Ben joined/.test(both[0]), `two at once make one line (${both})`);
  const four = await circles(a);
  const e = await client('Rhea');
  await e.goto(viewLink, { waitUntil: 'load' });
  await live(e);
  const reads = await a.waitForSelector('.collab-news [data-news="came"]:has-text("reading")', { timeout: 10_000 }).then(() => news(a), () => []);
  await a.waitForTimeout(2500);
  const five = await circles(a);
  check(four.length === 4 && four.every((x) => x.startsWith('writer:')) && five.length === 5 && five[4].startsWith('more:+1') && reads.some((n) => /Rhea is reading along/.test(n)),
    `four others are four circles, a fifth makes "+1", a reader is told as reading along (${four.join(' | ')} → ${five.at(-1)}; ${reads})`);

  // Colours: six people, two named Ben, six colours, the same on every client.
  const all = [a, b, c, d, f, e];
  const colours = async () => {
    const lists = await Promise.all(all.map(listed));
    const by = new Map();
    let agree = true;
    for (const l of lists) for (const p of [l.self, ...l.others]) { if (by.has(p.id) && by.get(p.id) !== p.color) agree = false; by.set(p.id, p.color); }
    return { agree, by };
  };
  const c6 = await colours();
  check(c6.agree && c6.by.size === 6 && new Set(c6.by.values()).size === 6, `six people have six colours, alike on every client (${[...c6.by.values()]})`);
  await d.context().close();
  await a.waitForTimeout(2500);
  all.splice(all.indexOf(d), 1);
  const c5b = await colours();
  check(c5b.agree && [...c5b.by].every(([id, col]) => c6.by.get(id) === col), `when one goes the others keep their colours (${[...c5b.by.values()]})`);
  const ring = await circles(a);
  check(ring.some((x) => x.startsWith('reader:') && /reading along/.test(x)) && ring.filter((x) => x.startsWith('writer:')).length === 3,
    `a reader shows as a ring, labelled as reading along (${ring.join(' | ')})`);

  // C names itself in the session: the others' circle, list and caret label follow.
  await c.click('.collab-btn');
  await c.fill('dialog[open] [data-field="collabName"]', 'Cleo');
  await c.press('dialog[open] [data-field="collabName"]', 'Enter');
  await c.click('dialog[open] .actions .primary');
  await caretAt(c, 1);
  await a.waitForTimeout(1500);
  const cleo = { circle: (await circles(a)).some((x) => /^writer:C:Cleo/.test(x)), list: (await listed(b)).others.some((o) => o.name === 'Cleo'),
    caret: await b.evaluate(() => [...document.querySelectorAll('.ProseMirror-yjs-cursor > div')].some((x) => x.textContent === 'Cleo')) };
  check(cleo.circle && cleo.list && cleo.caret, `a new name reaches the circle, the list and the caret label (${JSON.stringify(cleo)})`);

  // Going to Ben on page five: his caret shows, A's selection and the doc stay as they were.
  await caretAt(b, 230);
  await a.waitForTimeout(1200);
  const benId = await b.evaluate(() => window.__collab.session.awareness.clientID);
  const caretSel = `.tiptap-host .ProseMirror-yjs-cursor[data-client="${benId}"]`;
  const [selA, sentA] = [await selection(a), await sent(a)];
  const hiddenBefore = !(await inView(a, caretSel));
  await a.click('.collab-people .person[aria-label^="Ben"]');
  await a.waitForTimeout(1200);
  check(hiddenBefore && await inView(a, caretSel) && await selection(a) === selA && await sent(a) === sentA && await a.isVisible('.collab-people .menu'),
    `a click on Ben's circle shows his caret on page five, offers to follow, and leaves A's selection and the doc alone (${hiddenBefore}, ${selA})`);
  await a.keyboard.press('Escape');

  // Ben in the header: the jump goes to the header on his page.
  await b.evaluate(() => document.querySelector('.editor').scrollTo(0, 0));
  await b.locator('.hf-layer .hf-zone.hf-header:not(.hf-active)').first().dblclick({ timeout: 5000 });
  await a.waitForTimeout(1200);
  await a.evaluate(() => document.querySelector('.editor').scrollTo(0, 99999));
  await a.waitForTimeout(400);
  const zoneLabel = (await circles(a)).find((x) => /:Ben/.test(x)) ?? '';
  await a.click('.collab-people .person[aria-label^="Ben"]');
  await a.waitForTimeout(1200);
  check(/in the header/.test(zoneLabel) && await inView(a, `[data-zone-peer="${benId}"]`), `with Ben in the header the circle says so and the jump goes there (${zoneLabel})`);
  await a.keyboard.press('Escape');
  await b.keyboard.press('Escape');
  await b.waitForTimeout(600);

  // A follows Ben over three pages, then scrolls and stops following; Rhea follows too.
  await caretAt(b, 100);
  await a.waitForTimeout(800);
  await a.click('.collab-people .person[aria-label^="Ben"]');
  await a.click('.collab-people [data-cmd="collabFollow"]');
  const followed = [];
  for (const n of [160, 210, 260]) {
    await caretAt(b, n);
    await a.waitForTimeout(1500);
    followed.push(await inView(a, caretSel));
  }
  const marked = await a.isVisible('.collab-people .person.followed');
  const q0 = await sent(a);
  await a.waitForTimeout(4000);
  const q1 = await sent(a);
  await a.mouse.move(600, 500);
  await a.mouse.wheel(0, 400);
  await a.waitForTimeout(300);
  const stopped = await mod(a, PRES, (m) => m.following());
  check(followed.every(Boolean) && marked && stopped === null && q0 === q1,
    `following keeps Ben's caret in view over three pages, marks his circle, sends nothing, and ends on A's own scroll (${followed}, ${marked}, ${stopped}, ${q0} → ${q1})`);
  await e.click('.collab-people .person[aria-label^="Ben"]');
  await e.click('.collab-people [data-cmd="collabFollow"]');
  await caretAt(b, 40);
  await e.waitForTimeout(1500);
  check(await inView(e, caretSel), 'a reader can go to and follow a writer');

  // `@Ben` in A's comment: Ben gets a notice, the card marked and a count; Cleo nothing.
  await a.evaluate((q) => { const ed = document.querySelector(q).editor; ed.commands.setTextSelection({ from: 3, to: 9 }); ed.commands.startCommentDraft(); }, ED);
  await a.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA', null, { timeout: 5000 });
  await a.keyboard.type('Please @Be');
  const offered = await a.locator('.mention-list').textContent({ timeout: 3000 }).catch(() => '');
  await a.keyboard.press('Enter');
  await a.keyboard.type('check this');
  const typed = await a.evaluate(() => document.activeElement.value);
  await a.locator('button.primary', { hasText: 'Add' }).first().click();
  const told = await b.waitForSelector('.collab-news [data-news="mention"]', { timeout: 10_000 }).then(() => true, () => false);
  const benSide = await b.evaluate(async () => ({ unseen: (await import('/src/lib/collab/mentions.svelte.ts')).unseenMentions().length, marked: !!document.querySelector('.mentioned') }));
  const cleoSide = await c.evaluate(async () => (await import('/src/lib/collab/mentions.svelte.ts')).unseenMentions().length + document.querySelectorAll('.collab-news [data-news="mention"]').length);
  await b.click('.collab-news [data-news="mention"]');
  await b.waitForTimeout(800);
  const went = await b.evaluate(async (q) => ({ sel: document.querySelector(q).editor.state.selection.from, unseen: (await import('/src/lib/collab/mentions.svelte.ts')).unseenMentions().length }), ED);
  check(/@Ben/.test(offered) && typed === 'Please @Ben check this' && told && benSide.unseen === 1 && benSide.marked && cleoSide === 0 && went.unseen === 0 && went.sel >= 3 && went.sel <= 9,
    `@ offers the people here, Enter takes one; Ben is told, his card marked, the notice leads to it; Cleo hears nothing (${offered}; "${typed}"; ${JSON.stringify({ told, benSide, cleoSide, went })})`);
  const ai = await mod(a, '/src/lib/ai/tools.ts', (m) => [m.mentionsAi('@AI fix'), m.mentionsAi('@Ben fix'), m.mentions('@ben, look', ['Ben'])].join());
  check(ai === 'true,false,true', `the assistant's @ is as before, and a name is found in any case (${ai})`);
  await a.evaluate(() => { window.showSaveFilePicker = undefined; });
  await a.click('.ribbon-tab-file');
  const [file] = await Promise.all([
    a.waitForEvent('download', { timeout: 30_000 }),
    a.locator('.ribbon-menu button', { hasText: '(.odt)' }).first().click()
      .then(() => a.locator('dialog[open] button.primary').click({ timeout: 2_000 }).catch(() => {})),
  ]);
  const content = strFromU8(unzipSync(new Uint8Array(await readFile(await file.path())))['content.xml']);
  await a.keyboard.press('Escape');
  check(/<office:annotation\b(?:(?!<\/office:annotation>)[\s\S])*Please @Ben check this/.test(content), 'the saved .odt has the comment as plain text');

  // Hostile names are text, cut and initialled sensibly.
  const names = {};
  for (const [k, n] of Object.entries({ html: '<img src=x onerror="window.__pwned=1">', long: 'x'.repeat(500), blank: '     ', emoji: '🦊 Fox', rtl: 'علي حسن' })) {
    await mod(c, APP, (m, x) => m.renameCollab(x), n);
    await a.waitForTimeout(900);
    const l = await listed(a);
    names[k] = { name: l.others.find((o) => o.id === (l.others.find((p) => !['Ben', 'Dora', 'Rhea'].includes(p.name))?.id))?.name, circle: (await circles(a)).find((x) => !/Ben|Dora|Rhea|more/.test(x)) };
  }
  const pwned = await a.evaluate(() => !!window.__pwned || !!document.querySelector('.collab-people img, .ProseMirror-yjs-cursor img'));
  check(!pwned && names.html.name.startsWith('<img') && names.long.name.length === 40 && /^Guest \d{3}$/.test(names.blank.name)
    && /^writer:🦊:/.test(names.emoji.circle) && /^writer:عح:/.test(names.rtl.circle), `names with markup, 500 characters, only spaces, an emoji or Arabic stay text, cut and initialled (${JSON.stringify(names)})`);

  // Ben leaves: following him ends.
  await a.click('.collab-people .person[aria-label^="Ben"]');
  await a.click('.collab-people [data-cmd="collabFollow"]');
  await b.context().close();
  await a.waitForTimeout(2500);
  check(await mod(a, PRES, (m) => m.following()) === null && await mod(e, PRES, (m) => m.following()) === null, 'following ends when the one followed leaves');

  check(!pageErrors.length, `no uncaught page errors ${pageErrors.join(' | ')}`);
} catch (err) {
  check(false, `presence run threw: ${err.stack ?? err}`);
} finally {
  await browser.close();
  await relay.close();
  if (server) process.kill(-server.pid);
}
process.exit(failures.length ? 1 : 0);
