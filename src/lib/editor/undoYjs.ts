import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { history, isHistoryTransaction } from '@tiptap/pm/history';
import * as Y from 'yjs';
import { ySyncPlugin, ySyncPluginKey, yUndoPlugin, yUndoPluginKey, prosemirrorToYXmlFragment } from '@tiptap/y-tiptap';
import { StateStep } from './extensions/stateHistory';
import { pmUndo, setUndoBackend, STATE_RESTORED, type UndoBackend } from './undo';
import { describeTransaction, resetHistoryLog, syncHistoryLog } from '../utils/historyLog.svelte';

// Origin of the side stores' writes into the shared doc (a `StateStep` mirrored).
const STATE_ORIGIN = Symbol('stateHistory');

// Whether a block holds live content of another client. y-tiptap's own filter keeps every
// paragraph with content, so undoing an Enter left the new paragraph behind.
function holdsForeign(type: Y.AbstractType<unknown>, me: number): boolean {
  for (let it = type._start; it; it = it.right) {
    if (it.deleted) continue;
    if (it.id.client !== me) return true;
    if (it.content instanceof Y.ContentType && holdsForeign(it.content.type, me)) return true;
  }
  return false;
}

// prosemirror-history's own test: the edit touches the range the last one changed.
function adjacent(tr: Transaction, prev: number[] | null): boolean {
  if (!prev) return false;
  let hit = false;
  tr.mapping.maps[0].forEach((start, end) => {
    for (let i = 0; i < prev.length; i += 2) if (start <= prev[i + 1] && end >= prev[i]) hit = true;
  });
  return hit;
}
function rangesFor(tr: Transaction): number[] {
  const out: number[] = [];
  for (let i = tr.mapping.maps.length - 1; i >= 0 && !out.length; i--) tr.mapping.maps[i].forEach((_a, _b, from, to) => out.push(from, to));
  return out;
}
function mapRanges(ranges: number[] | null, tr: Transaction): number[] | null {
  if (!ranges || !tr.docChanged) return ranges;
  const out: number[] = [];
  for (let i = 0; i < ranges.length; i += 2) {
    const from = tr.mapping.map(ranges[i], 1), to = tr.mapping.map(ranges[i + 1], -1);
    if (from <= to) out.push(from, to);
  }
  return out;
}

export { Y };

export type YjsUndo = {
  ydoc: Y.Doc; undoManager: Y.UndoManager; detach: () => void;
  /** Puts every store the map holds into effect: a joiner's, after its start snapshot. */
  applyState: () => void;
};

/**
 * The body's undo on Yjs: the text in the fragment `body`, the stores beside it (`StateStep`
 * ids) in the map `state`, both under one manager that only takes back this client's edits.
 */
export function attachYjsUndo(editor: Editor, ydoc = new Y.Doc()): YjsUndo {
  const frag = ydoc.getXmlFragment('body');
  const side = ydoc.getMap('state');
  if (frag.length === 0) prosemirrorToYXmlFragment(editor.state.doc, frag);
  const um = new Y.UndoManager([frag, side], {
    trackedOrigins: new Set([ySyncPluginKey, STATE_ORIGIN]),
    captureTransaction: (t) => t.meta.get('addToHistory') !== false,
    deleteFilter: (item) => !(item.content instanceof Y.ContentType) || !holdsForeign(item.content.type, ydoc.clientID),
  });

  // y-tiptap's undo plugin destroys the manager whenever the plugin views rebuild, which
  // any later `registerPlugin` does (the session's cursors); it lives until `detach`.
  const destroy = um.destroy.bind(um);
  um.destroy = () => {};

  // Labels ride the stack items; one moved to the other stack keeps its own.
  let label = 'Edit';
  let moving: string | null = null;
  um.on('stack-item-added', ({ stackItem }: { stackItem: Y.UndoManager['undoStack'][number] }) => {
    if (!stackItem.meta.has('label')) stackItem.meta.set('label', um.undoing || um.redoing ? (moving ?? 'Edit') : label);
    syncHistoryLog();
  });
  um.on('stack-item-popped', ({ stackItem }: { stackItem: Y.UndoManager['undoStack'][number] }) => {
    moving = (stackItem.meta.get('label') as string | undefined) ?? 'Edit';
    syncHistoryLog();
  });
  um.on('stack-cleared', () => syncHistoryLog());

  // Steps are grouped as the history groups them: an edit away from the last one, or after
  // a pause, opens a new step; one composition (an image dragged along) stays one. Only
  // these rules end a step, not y-tiptap's stop on every edit outside the history.
  const stop = um.stopCapturing.bind(um);
  um.stopCapturing = () => {};
  let composition: unknown = null;
  let prev: number[] | null = null;
  const tracked = (tr: Transaction) => !tr.getMeta(ySyncPluginKey) && !tr.getMeta(STATE_RESTORED) && tr.getMeta('addToHistory') !== false;
  const before = ({ transaction: tr }: { transaction: Transaction }) => {
    if (!tr.docChanged || !tracked(tr)) return;
    label = describeTransaction(tr);
    const c = tr.getMeta('composition') ?? null;
    if (c !== null && c === composition) um.lastChange = Date.now();
    else if (!adjacent(tr, prev)) stop();
    composition = c;
  };
  const track = ({ transaction, appendedTransactions }: { transaction: Transaction; appendedTransactions: Transaction[] }) => {
    if (transaction.docChanged && tracked(transaction)) prev = rangesFor(transaction);
    else if (transaction.docChanged) prev = mapRanges(prev, transaction);
    for (const t of appendedTransactions) prev = mapRanges(prev, t);
  };

  // A store change beside the text goes into the map; on its own it is a step of its
  // own, beside a text change it joins that one (a renamed style and its paragraphs).
  const mirror = ({ transaction, appendedTransactions }: { transaction: Transaction; appendedTransactions: Transaction[] }) => {
    const trs = [transaction, ...appendedTransactions];
    if (trs.some((t) => t.getMeta(STATE_RESTORED) || t.getMeta(ySyncPluginKey))) return;
    const steps = trs.flatMap((t) => t.steps.filter((s): s is StateStep => s instanceof StateStep));
    if (!steps.length) return;
    const alone = !trs.some((t) => t.docChanged);
    // A key the map has not seen yet gets its old value first, outside the history.
    ydoc.transact(() => { for (const s of steps) if (!side.has(s.id)) side.set(s.id, s.from); });
    if (alone) stop();
    ydoc.transact(() => { for (const s of steps) side.set(s.id, s.to); }, STATE_ORIGIN);
    if (alone) { stop(); prev = []; }
  };

  // What an undo (or, later, another author) put back in the map reaches the stores as
  // a body transaction of `StateStep`s, which their own listeners already apply.
  const apply = (keys: Iterable<string>) => {
    const tr = editor.state.tr.setMeta(STATE_RESTORED, true).setMeta('addToHistory', false);
    for (const key of keys) tr.step(new StateStep(key, null, side.get(key) ?? null));
    if (tr.steps.length) editor.view.dispatch(tr);
  };
  const restore = (ev: Y.YMapEvent<unknown>, t: Y.Transaction) => {
    if (t.origin === STATE_ORIGIN || (t.local && t.origin !== um)) return;
    apply(ev.keysChanged);
  };

  const backend: UndoBackend = {
    run(dir, _state, dispatch, tr) {
      const stack = dir === 'undo' ? um.undoStack : um.redoStack;
      if (!dispatch) return stack.length > 0;
      // The manager dispatches its own transaction; the command's own must not follow.
      tr?.setMeta('preventDispatch', true);
      if (!stack.length) return false;
      um[dir]();
      return true;
    },
    depths: () => ({ undo: um.undoStack.length, redo: um.redoStack.length }),
    isUndoRedo: (tr) => isHistoryTransaction(tr) || !!tr.getMeta(STATE_RESTORED)
      || !!(tr.getMeta(ySyncPluginKey) as { isUndoRedoOperation?: boolean } | undefined)?.isUndoRedoOperation,
    closeGroup: () => stop(),
    labels: () => ({
      undo: um.undoStack.map((s) => (s.meta.get('label') as string | undefined) ?? 'Edit'),
      redo: um.redoStack.map((s) => (s.meta.get('label') as string | undefined) ?? 'Edit'),
    }),
    reset: () => { um.clear(); prev = null; },
  };

  editor.unregisterPlugin('history');
  editor.registerPlugin(ySyncPlugin(frag));
  editor.registerPlugin(yUndoPlugin({ undoManager: um }));
  editor.on('beforeTransaction', before);
  editor.on('transaction', mirror);
  editor.on('transaction', track);
  side.observe(restore);
  setUndoBackend(backend);
  resetHistoryLog();

  return {
    ydoc, undoManager: um,
    applyState: () => apply([...side.keys()]),
    detach() {
      side.unobserve(restore);
      editor.off('beforeTransaction', before);
      editor.off('transaction', mirror);
      editor.off('transaction', track);
      // Together: the undo plugin's view needs the sync plugin while the views rebuild.
      editor.unregisterPlugin([yUndoPluginKey, ySyncPluginKey]);
      editor.registerPlugin(history({ depth: 100, newGroupDelay: 500 }));
      setUndoBackend(pmUndo);
      destroy();
      resetHistoryLog();
    },
  };
}
