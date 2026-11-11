import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { extensions } from '../../src/lib/editor/extensions';
import { attachYjsUndo, type YjsUndo } from '../../src/lib/editor/undoYjs';

// Concurrent edits that need the plugins' repairs (a ragged table, two note sections,
// notes out of anchor order), relayed in a random order: every client ends with the same
// shared doc and document, the repairs in it once, all written by the repairer.

// jsdom has no ResizeObserver; the text box's view only fits its frame with one.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

type Client = { ed: Editor; undo: YjsUndo; ydoc: Y.Doc; out: Uint8Array[] };
const live: Client[] = [];
afterEach(() => { for (const c of live.splice(0)) { c.undo.detach(); c.ed.destroy(); } });

const P = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const cell = (text: string) => ({ type: 'tableCell', content: [P(text)] });
const START = {
  type: 'doc', content: [
    P('Alpha beta.'), P('Gamma delta.'),
    { type: 'table', content: [{ type: 'tableRow', content: [cell('a1'), cell('b1')] }, { type: 'tableRow', content: [cell('a2'), cell('b2')] }] },
    P('Epsilon.'),
    { type: 'bulletList', content: [{ type: 'listItem', content: [P('Zeta.')] }] },
  ],
};

function clients(n: number, start: object = START, join?: object): Client[] {
  const first = new Editor({ extensions, content: start });
  const out: Client[] = [];
  for (let i = 0; i < n; i++) {
    const ed = i ? new Editor({ extensions, content: join ?? first.getJSON() }) : first;
    const ydoc = new Y.Doc();
    ydoc.clientID = 100 + i;
    if (i) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(out[0].ydoc), 'relay');
    const undo = attachYjsUndo(ed, ydoc);
    undo.setRepairer(() => i === 0);
    const c: Client = { ed, undo, ydoc, out: [] };
    ydoc.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== 'relay') c.out.push(u); });
    out.push(c);
    live.push(c);
  }
  return out;
}

const posOf = (ed: Editor, text: string, after = 0) => {
  let pos = -1;
  ed.state.doc.descendants((n, p) => {
    if (pos < 0 && n.isText && n.text!.includes(text)) pos = p + n.text!.indexOf(text) + after;
    return pos < 0;
  });
  return pos;
};

// Each client's updates reach each other client in its own order, in random bites, until
// nothing more is sent; microtasks run between bites, as the repairer writes in one.
async function relay(cs: Client[], rnd: () => number) {
  const inbox = cs.map(() => [] as Uint8Array[]);
  for (let round = 0; round < 200; round++) {
    await Promise.resolve();
    cs.forEach((c, i) => { for (const u of c.out.splice(0)) cs.forEach((_d, j) => { if (j !== i) inbox[j].push(u); }); });
    const waiting = inbox.map((q, j) => (q.length ? j : -1)).filter((j) => j >= 0);
    if (!waiting.length) return;
    const j = waiting[Math.floor(rnd() * waiting.length)];
    for (const u of inbox[j].splice(0, 1 + Math.floor(rnd() * inbox[j].length))) Y.applyUpdate(cs[j].ydoc, u, 'relay');
  }
  throw new Error('the clients kept sending');
}

function shape(ed: Editor) {
  const rows: number[] = [];
  let sections = 0, notes = 0, refs = 0;
  ed.state.doc.descendants((n) => {
    if (n.type.name === 'tableRow') rows.push(n.childCount);
    if (n.type.name === 'noteSection') sections++;
    if (n.type.name === 'note') notes++;
    if (n.type.name === 'noteRef') refs++;
    return true;
  });
  return { rows, sections, notes, refs };
}

describe('repairs after concurrent edits in a shared doc', () => {
  for (let seed = 1; seed <= 6; seed++) {
    it(`converge without doubles, written by the repairer alone (order ${seed})`, async () => {
      let s = seed * 7919;
      const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      const cs = clients(3);
      const [a, b, c] = cs;
      // A adds a column and the first footnote; B a row and a first footnote before A's;
      // C types into a cell and into the text.
      a.ed.commands.setTextSelection(posOf(a.ed, 'b1', 1));
      a.ed.commands.addColumnAfter();
      a.ed.commands.setTextSelection(posOf(a.ed, 'Gamma delta.', 12));
      a.ed.commands.insertNote('footnote');
      b.ed.commands.setTextSelection(posOf(b.ed, 'a2', 1));
      b.ed.commands.addRowAfter();
      b.ed.commands.setTextSelection(posOf(b.ed, 'Alpha beta.', 11));
      b.ed.commands.insertNote('footnote');
      c.ed.commands.insertContentAt(posOf(c.ed, 'a1', 2), 'Z');
      c.ed.commands.insertContentAt(posOf(c.ed, 'Epsilon', 7), ' and more');

      const before = cs.map((x) => Y.encodeStateVector(x.ydoc));
      await relay(cs, rnd);

      const frag = a.ydoc.getXmlFragment('body').toString();
      for (const x of cs) {
        expect(x.ydoc.getXmlFragment('body').toString()).toBe(frag);
        expect(JSON.stringify(x.ed.getJSON())).toBe(JSON.stringify(a.ed.getJSON()));
        expect(() => x.ed.state.doc.check()).not.toThrow();
      }
      const got = shape(a.ed);
      expect(new Set(got.rows)).toEqual(new Set([3]));
      expect(got.rows.length).toBe(3);
      expect(got).toMatchObject({ sections: 1, notes: 2, refs: 2 });
      expect(a.ed.state.doc.textContent).toContain('a1Z');
      expect(a.ed.state.doc.textContent).toContain('Epsilon and more');
      // B and C wrote their own edits and nothing after: the repairs are A's.
      cs.slice(1).forEach((x, i) => {
        const was = Y.decodeStateVector(before[i + 1]).get(x.ydoc.clientID);
        expect(Y.getState(x.ydoc.store, x.ydoc.clientID)).toBe(was);
      });
    });
  }
});

// Concurrent deletions that leave a container empty where none fits: the repairer fills it
// with a minimal child, nobody pauses, and what a third client adds to it meanwhile stays.
const itemOf = (ed: Editor, text: string) => {
  const $p = ed.state.doc.resolve(posOf(ed, text, 1));
  return { from: $p.before($p.depth - 1), to: $p.after($p.depth - 1) };
};
const twoItems = (ed: Editor) => { ed.commands.setTextSelection(posOf(ed, 'Zeta.', 5)); ed.commands.splitListItem('listItem'); ed.commands.insertContent('Eta.'); };
const takeFirst = (ed: Editor) => { ed.commands.deleteRange(itemOf(ed, 'Zeta.')); };
const liftSecond = (ed: Editor) => { ed.commands.setTextSelection(posOf(ed, 'Eta.', 1)); ed.commands.liftListItem('listItem'); };
const deleteRowAt = (text: string) => (ed: Editor) => { ed.commands.setTextSelection(posOf(ed, text, 1)); ed.commands.deleteRow(); };
const lastRow = (ed: Editor) => {
  let at = -1;
  ed.state.doc.descendants((n, p) => { if (n.type.name === 'table') at = p + n.nodeSize - 1 - n.lastChild!.nodeSize + 3; return at < 0; });
  return at;
};
const boxed = (ed: Editor) => { ed.commands.insertContentAt(posOf(ed, 'Epsilon.', 8), { type: 'textBox', attrs: { width: 288, height: 96 }, content: [P('Kappa.'), P('Lambda.')] }); };
const takeBlock = (text: string) => (ed: Editor) => { const $p = ed.state.doc.resolve(posOf(ed, text, 1)); ed.commands.deleteRange({ from: $p.before(), to: $p.after() }); };
const EMPTIED: { name: string; pre?: (ed: Editor) => void; edits: ((ed: Editor) => void)[]; keep: string[]; lists: number; rows: number }[] = [
  { name: 'a list whose first item one client takes out while another lifts the second',
    pre: twoItems, edits: [takeFirst, liftSecond], keep: ['Eta.'], lists: 1, rows: 2 },
  { name: 'a table whose two rows two clients delete', edits: [deleteRowAt('a1'), deleteRowAt('a2')], keep: ['Epsilon.'], lists: 1, rows: 1 },
  { name: 'a list emptied while a third client adds an item', pre: twoItems,
    edits: [takeFirst, liftSecond, (ed) => { ed.commands.setTextSelection(posOf(ed, 'Eta.', 4)); ed.commands.splitListItem('listItem'); ed.commands.insertContent('Theta.'); }],
    keep: ['Eta.', 'Theta.'], lists: 1, rows: 2 },
  { name: 'a table emptied while a third client adds a row',
    edits: [deleteRowAt('a1'), deleteRowAt('a2'), (ed) => { ed.commands.setTextSelection(posOf(ed, 'b2', 1)); ed.commands.addRowAfter(); ed.commands.insertContentAt(lastRow(ed), 'c3'); }],
    keep: ['Epsilon.', 'c3'], lists: 1, rows: 2 },
  { name: 'a text box in a paragraph whose two paragraphs two clients delete', pre: boxed,
    edits: [takeBlock('Kappa.'), takeBlock('Lambda.')], keep: ['Epsilon.'], lists: 1, rows: 2 },
];

describe('a container concurrent deletions leave empty', () => {
  for (const c of EMPTIED) for (let seed = 1; seed <= 3; seed++) {
    it(`is filled, not paused: ${c.name} (order ${seed})`, async () => {
      let s = seed * 104729;
      const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      const cs = clients(c.edits.length);
      let paused = 0;
      for (const x of cs) x.undo.onPause((p) => { if (p) paused++; });
      if (c.pre) { c.pre(cs[0].ed); await relay(cs, rnd); }
      c.edits.forEach((edit, i) => edit(cs[i].ed));
      const before = cs.map((x) => Y.getState(x.ydoc.store, x.ydoc.clientID));
      await relay(cs, rnd);
      expect(paused).toBe(0);
      const a = cs[0];
      for (const x of cs) {
        expect(x.ydoc.getXmlFragment('body').toString()).toBe(a.ydoc.getXmlFragment('body').toString());
        expect(JSON.stringify(x.ed.getJSON())).toBe(JSON.stringify(a.ed.getJSON()));
        expect(() => x.ed.state.doc.check()).not.toThrow();
      }
      for (const t of c.keep) expect(a.ed.state.doc.textContent).toContain(t);
      let lists = 0;
      a.ed.state.doc.descendants((n) => { if (n.type.name === 'bulletList') lists++; return true; });
      expect(lists).toBe(c.lists);
      // One row more where the fill went in before the third client's row came.
      const rows = shape(a.ed).rows;
      expect(new Set(rows)).toEqual(new Set([2]));
      expect(rows.length).toBeLessThanOrEqual(c.rows);
      // The fill is the repairer's write alone.
      cs.slice(1).forEach((x, i) => expect(Y.getState(x.ydoc.store, x.ydoc.clientID)).toBe(before[i + 1]));
    });
  }
});

// One client's steps around another's typing, then that client undoes them all: the other
// client's text stays on every client, and the documents agree and stay valid.
const notePos = (ed: Editor) => {
  let pos = -1;
  ed.state.doc.descendants((n, p) => { if (pos < 0 && n.type.name === 'note') pos = p + 1; return pos < 0; });
  return pos;
};
const UNDO_CASES: { name: string; a: ((ed: Editor) => void)[]; b: (ed: Editor) => void; gone?: string }[] = [
  { name: 'a footnote another client wrote into',
    a: [(ed) => { ed.commands.setTextSelection(posOf(ed, 'Gamma delta.', 12)); ed.commands.insertNote('footnote'); }],
    b: (ed) => { ed.commands.insertContentAt(notePos(ed), 'Zed'); } },
  { name: 'a block another client wrote into, rebuilt later',
    a: [(ed) => { ed.commands.setTextSelection(posOf(ed, 'Alpha beta.', 6)); ed.commands.splitBlock(); },
      (ed) => { ed.commands.setTextSelection(posOf(ed, 'betaZed', 1)); ed.commands.setParagraphStyle('Heading 1'); }],
    b: (ed) => { ed.commands.insertContentAt(posOf(ed, 'beta.', 4), 'Zed'); } },
  { name: 'beside its own text, both restored by an undo',
    a: [(ed) => { ed.commands.insertContentAt(posOf(ed, 'Gamma'), '\t'); },
      (ed) => { ed.commands.setTextSelection(posOf(ed, 'Gamma')); ed.commands.setParagraphStyle('Heading 1'); }],
    b: (ed) => { ed.commands.insertContentAt(posOf(ed, 'Gamma'), 'Zed'); } },
  { name: 'and its own text before it goes, restored with it as one item',
    a: [(ed) => { ed.commands.insertContentAt(posOf(ed, 'Gamma'), 'Qq'); },
      (ed) => { ed.commands.setTextSelection(posOf(ed, 'Gamma')); ed.commands.setParagraphStyle('Heading 1'); }],
    b: (ed) => { ed.commands.insertContentAt(posOf(ed, 'Gamma'), 'Zed'); }, gone: 'Qq' },
  { name: 'and the list item it added, the only one left in the list',
    a: [(ed) => { ed.commands.setTextSelection(posOf(ed, 'Zeta.', 5)); ed.commands.splitListItem('listItem'); ed.commands.insertContent('Qq'); }],
    b: (ed) => { ed.commands.insertContentAt(posOf(ed, 'Zeta.'), 'Zed'); ed.commands.liftListItem('listItem'); }, gone: 'Qq' },
];

describe('an undo in a shared doc', () => {
  for (const c of UNDO_CASES) {
    it(`keeps another client's text: ${c.name}`, async () => {
      let s = 7;
      const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      const cs = clients(2);
      const [a, b] = cs;
      let paused = 0;
      for (const x of cs) x.undo.onPause((p) => { if (p) paused++; });
      c.a[0](a.ed);
      await relay(cs, rnd);
      c.b(b.ed);
      await relay(cs, rnd);
      for (const step of c.a.slice(1)) {
        a.undo.undoManager.lastChange = 0;
        step(a.ed);
        await relay(cs, rnd);
      }
      for (let i = 0; i < 10 && a.undo.undoManager.undoStack.length; i++) {
        a.undo.undoManager.undo();
        await relay(cs, rnd);
      }
      for (const x of cs) {
        expect(x.ed.state.doc.textContent).toContain('Zed');
        if (c.gone) expect(x.ed.state.doc.textContent).not.toContain(c.gone);
        expect(JSON.stringify(x.ed.getJSON())).toBe(JSON.stringify(a.ed.getJSON()));
        expect(() => x.ed.state.doc.check()).not.toThrow();
      }
      const got = shape(a.ed);
      expect(got.notes).toBe(got.refs);
      expect(paused).toBe(0);
    });
  }
});

// B types into the cell only its overlay pads, before the repairer's version comes: the
// text shows at once and goes out with the repair, written by the repairer or, once that
// one is gone, by B taking over; B's undo takes back its text and leaves the repair.
describe('an edit into a repair not yet shared', () => {
  const padded = (ed: Editor) => {
    let at = -1;
    ed.state.doc.descendants((n, p) => {
      if (n.type.name === 'table') { const row = n.child(2); at = p + 1 + n.child(0).nodeSize + n.child(1).nodeSize + 1 + row.child(0).nodeSize + row.child(1).nodeSize + 2; }
      return at < 0;
    });
    return at;
  };
  const deliver = (from: Client, to: Client) => { for (const u of from.out.splice(0)) Y.applyUpdate(to.ydoc, u, 'relay'); };

  for (const gone of [false, true]) {
    it(gone ? 'is written by the next repairer once the repairer is gone' : 'goes out once the repairer has written', async () => {
      const [a, b, c] = clients(3);
      a.ed.commands.setTextSelection(posOf(a.ed, 'b1', 1));
      a.ed.commands.addColumnAfter();
      b.ed.commands.setTextSelection(posOf(b.ed, 'a2', 1));
      b.ed.commands.addRowAfter();
      const aEdit = a.out.slice();
      deliver(a, b);
      await Promise.resolve();
      expect(shape(b.ed).rows).toEqual([3, 3, 3]);
      b.ed.chain().setTextSelection(padded(b.ed)).insertContent('Q').run();
      b.ed.commands.insertContent('R');
      await Promise.resolve();
      expect(b.ed.state.doc.textContent).toContain('QR');
      for (const u of aEdit) Y.applyUpdate(c.ydoc, u, 'relay');
      if (gone) {
        // A's column reached C too, never its repair: B takes over, as C would have.
        b.undo.setRepairer(() => true);
        await relay([b, c], () => 0.5);
      } else {
        await relay([a, b, c], () => 0.5);
      }
      const all = gone ? [b, c] : [a, b, c];
      for (const x of all) {
        expect(x.ydoc.getXmlFragment('body').toString()).toBe(b.ydoc.getXmlFragment('body').toString());
        expect(shape(x.ed).rows).toEqual([3, 3, 3]);
        expect(x.ed.state.doc.textContent.split('QR').length).toBe(2);
      }
      b.undo.undoManager.undo();
      await relay(all, () => 0.5);
      for (const x of all) {
        expect(x.ed.state.doc.textContent).not.toContain('Q');
        expect(shape(x.ed).rows).toEqual([3, 3, 3]);
      }
    });
  }

  it('is dropped and told when a change around it leaves it no place', async () => {
    const [a, b] = clients(2);
    let told = 0;
    b.undo.onDrop(() => { told++; });
    a.ed.commands.setTextSelection(posOf(a.ed, 'b1', 1));
    a.ed.commands.addColumnAfter();
    b.ed.commands.setTextSelection(posOf(b.ed, 'a2', 1));
    b.ed.commands.addRowAfter();
    const aEdit = a.out.splice(0);
    for (const u of aEdit) Y.applyUpdate(b.ydoc, u, 'relay');
    await Promise.resolve();
    b.ed.chain().setTextSelection(padded(b.ed)).insertContent('Q').run();
    await Promise.resolve();
    expect(b.ed.state.doc.textContent).toContain('Q');
    // A deletes the table before B's row reaches it.
    a.ed.commands.setTextSelection(posOf(a.ed, 'a1', 1));
    a.ed.commands.deleteTable();
    deliver(a, b);
    await Promise.resolve();
    await Promise.resolve();
    expect(b.ed.state.doc.textContent).not.toContain('Q');
    expect(told).toBe(1);
  });
});

// Marks on a node (a formula's or an image's font size) reach every client as text marks
// do, through an undo or a change both make at once, and from the client that brings the
// text; the clients end with the same shared doc and document.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNwaDgAAAKEAYEml6crAAAAAElFTkSuQmCC';
const ATOMS = ['formula', 'image'];
const atomDoc = (size?: string) => {
  const marks = size ? [{ type: 'textStyle', attrs: { fontSize: size } }] : undefined;
  return { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Pre ' }, { type: 'formula', attrs: { latex: 'x^{2}' }, marks },
    { type: 'text', text: ' mid ' }, { type: 'image', attrs: { src: PNG }, marks }, { type: 'text', text: ' post.' },
  ] }] };
};
const sizes = (ed: Editor) => {
  const out: (string | null)[] = [];
  ed.state.doc.descendants((n) => { if (ATOMS.includes(n.type.name)) out.push(n.marks.find((m) => m.type.name === 'textStyle')?.attrs.fontSize ?? null); });
  return out;
};
// One transaction over both nodes, so one undo step.
const size = (ed: Editor, pt: string | null) => {
  let c = ed.chain();
  ed.state.doc.descendants((n, p) => {
    if (!ATOMS.includes(n.type.name)) return;
    c = c.setTextSelection({ from: p, to: p + 1 });
    c = pt ? c.setFontSize(pt) : c.unsetFontSize();
  });
  c.run();
};
type Pair = { a: Client; b: Client; sync: () => Promise<void> };
const MARK_CASES: { name: string; run: (p: Pair) => void | Promise<void>; want: (string | null)[]; start?: string }[] = [
  { name: 'set by one client', run: ({ a }) => size(a.ed, '14pt'), want: ['14pt'] },
  { name: 'removed by the other client', run: async ({ a, b, sync }) => { size(a.ed, '14pt'); await sync(); size(b.ed, null); }, want: [null] },
  { name: 'taken back by an undo', run: async ({ a, sync }) => { size(a.ed, '14pt'); await sync(); a.undo.undoManager.undo(); }, want: [null] },
  { name: 'set again by a redo', run: async ({ a, sync }) => { size(a.ed, '14pt'); await sync(); a.undo.undoManager.undo(); await sync(); a.undo.undoManager.redo(); }, want: ['14pt'] },
  { name: "kept from the other client's later change by an undo",
    run: async ({ a, b, sync }) => { size(a.ed, '14pt'); await sync(); size(b.ed, '18pt'); await sync(); a.undo.undoManager.undo(); }, want: ['18pt'] },
  { name: 'set by both at once', run: ({ a, b }) => { size(a.ed, '14pt'); size(b.ed, '18pt'); }, want: ['14pt', '18pt'] },
  { name: 'brought by the client that starts the session', run: () => {}, want: ['14pt'], start: '14pt' },
];

describe('marks on a node in a shared doc', () => {
  for (const c of MARK_CASES) {
    it(`converge: ${c.name}`, async () => {
      let s = 11;
      const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      const cs = clients(2, atomDoc(c.start), atomDoc());
      const [a, b] = cs;
      await c.run({ a, b, sync: () => relay(cs, rnd) });
      await relay(cs, rnd);
      const got = sizes(a.ed);
      expect(got).toHaveLength(2);
      expect(got[0]).toBe(got[1]);
      expect(c.want).toContain(got[0]);
      expect(a.undo.undoManager.undoStack.length + a.undo.undoManager.redoStack.length).toBeLessThan(2);
      for (const x of cs) {
        expect(sizes(x.ed)).toEqual(got);
        expect(x.ydoc.getXmlFragment('body').toString()).toBe(a.ydoc.getXmlFragment('body').toString());
        expect(JSON.stringify(x.ed.getJSON())).toBe(JSON.stringify(a.ed.getJSON()));
      }
    });
  }
});
