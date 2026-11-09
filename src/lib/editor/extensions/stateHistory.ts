import { Extension, type Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { history, undoDepth } from '@tiptap/pm/history';
import { Plugin, type Transaction } from '@tiptap/pm/state';
import { Step, StepMap, StepResult } from '@tiptap/pm/transform';
import { untrack } from 'svelte';
import { isUndoRedo } from '../undo';

// A change to what the document holds beside its text, carried on the body's undo stack:
// the value before and after, under an id ("hf:section:zoneKey" for a header/footer,
// a watched store's id otherwise). It leaves the body untouched and maps no position, so the
// body's plugins see nothing and the history keeps it a group of its own.
export class StateStep extends Step {
  constructor(readonly id: string, readonly from: unknown, readonly to: unknown) {
    super();
  }
  apply(doc: PMNode) { return StepResult.ok(doc); }
  invert() { return new StateStep(this.id, this.to, this.from); }
  getMap() { return StepMap.empty; }
  map() { return this; }
  toJSON() { return { stepType: 'state', id: this.id, from: this.from, to: this.to }; }
}

export function pushState(body: Editor, id: string, from: unknown, to: unknown): void {
  body.view.dispatch(body.state.tr.step(new StateStep(id, from, to)));
}

// Bumped whenever the body's history starts afresh (a document loaded): a change begun
// before it must not land on the new document's stack.
let epoch = 0;
export function resetStateHistory(): void { epoch++; }
export function historyEpoch(): number { return epoch; }

// Changes still being gathered into one step; every undo or redo lands them first.
const pending = new Set<() => void>();
export function addPending(commit: () => void): void { pending.add(commit); }
export function removePending(commit: () => void): void { pending.delete(commit); }
export function flushPending(): void { for (const commit of pending) commit(); }

const undoKeys = (run: (dir: 'undo' | 'redo') => boolean) => ({
  'Mod-z': () => run('undo'),
  'Shift-Mod-z': () => run('redo'),
  'Mod-y': () => run('redo'),
  'Mod-я': () => run('undo'),
  'Shift-Mod-я': () => run('redo'),
});

type Fields = Record<string, unknown>;
type Watch = {
  id: string;
  read: () => Fields;
  json: (v: Fields) => string;
  write: (v: Fields) => void;
  body: () => Editor | null;
  base: string;
  seen: unknown[];
  from: string | null;
  epoch: number;
  timer?: ReturnType<typeof setTimeout>;
};
const watches = new Map<string, Watch>();

// A store beside the text, put on the body's stack: `read` gives its values as they are
// (references, so a change shows without serializing), `toJSON` what a step keeps of them.
export function watchState(id: string, body: () => Editor | null, read: () => Fields, write: (v: Fields) => void, toJSON: (v: Fields) => unknown = (v) => v): Watch {
  const json = (v: Fields) => JSON.stringify(toJSON(v));
  const fields = untrack(read);
  const w: Watch = { id, read, json, write, body, base: json(fields), seen: Object.values(fields), from: null, epoch };
  watches.set(id, w);
  addPending(() => commitWatch(w));
  return w;
}

// Each store's value as its steps carry it, by id: what a shared session starts from.
export function stateValues(): Map<string, unknown> {
  return new Map([...watches.values()].map((w) => [w.id, JSON.parse(w.json(untrack(w.read)))]));
}

// Called from an effect, so it re-runs on any change to what `read` reaches. Changes
// gather for half a second into one step, so a value typed live is one step.
export function noteState(w: Watch): void {
  const fields = w.read();
  const now = w.json(fields);
  untrack(() => {
    w.seen = Object.values(fields);
    if (now === w.base) return;
    if (w.from === null) {
      w.from = w.base;
      w.epoch = epoch;
    }
    w.base = now;
    clearTimeout(w.timer);
    w.timer = setTimeout(() => commitWatch(w), 500);
  });
}

// A document just put in front of the reader brings its own values; that is no edit.
export function rebaseStates(): void {
  for (const w of watches.values()) {
    const fields = untrack(w.read);
    w.base = w.json(fields);
    w.seen = Object.values(fields);
    if (w.epoch !== epoch) w.from = null;
  }
}

function commitWatch(w: Watch): void {
  clearTimeout(w.timer);
  const from = w.from;
  w.from = null;
  const ed = w.body();
  if (from === null || from === w.base || w.epoch !== epoch || !ed || ed.isDestroyed) return;
  pushState(ed, w.id, JSON.parse(from), JSON.parse(w.base));
}

const sameRefs = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);

// The body's undo keys, ahead of UndoRedo's: pending changes land before the step back.
// Typing lands them first too, and a store set in the same task as a text change (a
// renamed style and its retagged paragraphs) joins that change's step.
export const StateHistory = Extension.create({
  name: 'stateHistory',
  priority: 101,

  addProseMirrorPlugins() {
    const flush = () => { flushPending(); return false; };
    return [new Plugin({
      props: { handleDOMEvents: { keydown: flush, beforeinput: flush, paste: flush, drop: flush } },
      appendTransaction(trs, _old, state) {
        if (!trs.some((tr) => tr.docChanged && tr.getMeta('addToHistory') !== false && !isUndoRedo(tr))) return null;
        let out: Transaction | null = null;
        for (const w of watches.values()) {
          if (w.from !== null) continue;
          const fields = untrack(w.read);
          const refs = Object.values(fields);
          if (sameRefs(refs, w.seen)) continue;
          w.seen = refs;
          const now = w.json(fields);
          if (now === w.base) continue;
          (out ??= state.tr).step(new StateStep(w.id, JSON.parse(w.base), JSON.parse(now)));
          w.base = now;
        }
        return out;
      },
    })];
  },

  onTransaction({ transaction: tr }) {
    if (!isUndoRedo(tr)) return;
    for (const step of tr.steps) {
      const w = step instanceof StateStep ? watches.get(step.id) : undefined;
      if (!w) continue;
      w.write((step as StateStep).to as Fields);
      const fields = untrack(w.read);
      w.base = w.json(fields);
      w.seen = Object.values(fields);
    }
  },

  addKeyboardShortcuts() {
    return undoKeys((dir) => {
      flushPending();
      return this.editor.commands[dir]();
    });
  },
});

type Options = { body: () => Editor | null; id: string };
type Storage = { from: PMNode | null; epoch: number; depth: number; flush: () => void };

// The live zone editor's undo: one history for the whole document, as in both word
// processors. The zone's own history only groups its edits (same rules as the body's);
// each finished group lands on the body's stack, and undo/redo run there.
export const ZoneHistory = Extension.create<Options, Storage>({
  name: 'zoneHistory',

  addOptions() {
    return { body: () => null, id: '' };
  },

  addStorage() {
    return { from: null, epoch: 0, depth: 0, flush: () => {} };
  },

  addProseMirrorPlugins() {
    return [history()];
  },

  onTransaction({ transaction: tr }) {
    if (!tr.docChanged || tr.getMeta('addToHistory') === false) return;
    const s = this.storage;
    // A new group closes the last; past the zone history's depth groups simply merge.
    const depth = undoDepth(this.editor.state);
    if (depth > s.depth) commit(this.options, s, tr.before);
    s.depth = depth;
    if (!s.from) {
      s.from = tr.before;
      s.epoch = epoch;
      s.flush = () => commit(this.options, s, this.editor.state.doc);
      addPending(s.flush);
    }
  },

  onDestroy() {
    this.storage.flush();
  },

  addCommands() {
    const run = (dir: 'undo' | 'redo') => () => ({ dispatch }: { dispatch?: unknown }) => {
      const body = this.options.body();
      // Pending zone edits are an undo step, and once committed they end the redo branch.
      if (!dispatch) return dir === 'undo' ? !!this.storage.from || !!body?.can().undo() : !this.storage.from && !!body?.can().redo();
      flushPending();
      return !!body?.commands[dir]();
    };
    return { undo: run('undo'), redo: run('redo') };
  },

  addKeyboardShortcuts() {
    return undoKeys((dir) => this.editor.commands[dir]());
  },
});

// A document loaded since the group began has a history of its own; it is not added there.
function commit({ body, id }: Options, s: Storage, to: PMNode): void {
  const from = s.from;
  s.from = null;
  removePending(s.flush);
  const ed = body();
  if (!from || !ed || ed.isDestroyed || s.epoch !== epoch || from.eq(to)) return;
  pushState(ed, id, from.toJSON(), to.toJSON());
}
