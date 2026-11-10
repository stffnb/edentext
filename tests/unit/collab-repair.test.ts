import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { extensions } from '../../src/lib/editor/extensions';
import { attachYjsUndo, type YjsUndo } from '../../src/lib/editor/undoYjs';

// Clients whose concurrent edits need the plugins' repairs (a ragged table, two note
// sections, notes out of anchor order), their updates relayed in a random order: every
// client ends with the same shared doc and document, the repairs in it once, and only the
// repairer wrote any of them.

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
  ],
};

function clients(n: number): Client[] {
  const first = new Editor({ extensions, content: START });
  const out: Client[] = [];
  for (let i = 0; i < n; i++) {
    const ed = i ? new Editor({ extensions, content: first.getJSON() }) : first;
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
];

describe('an undo in a shared doc', () => {
  for (const c of UNDO_CASES) {
    it(`keeps another client's text: ${c.name}`, async () => {
      let s = 7;
      const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      const cs = clients(2);
      const [a, b] = cs;
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
});
