import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import * as Y from 'yjs';
import { ySyncPluginKey, type ProsemirrorBinding } from '@tiptap/y-tiptap';

// What the plugins repair after a transaction the binding dispatched (another client's
// update, an undo) reaches the shared doc too: y-tiptap writes nothing while it applies one.
// docs/architecture/collab-conflicts.md, "Repairs".

/** Origin of a repair written into the shared doc; no undo manager tracks it. */
export const REPAIR_ORIGIN = Symbol('repair');

// A repair's items carry a client id derived from the doc it starts from and the doc it
// makes, so two clients repairing the same state write the same items and Yjs keeps one.
// The low byte marks the id as a repair's, which a real client's id never has.
const MARK = 0xa5;
export const isRepairClient = (id: number) => (id & 0xff) === MARK;
/** Gives a fresh doc a client id without the mark. */
export function ownClientId(ydoc: Y.Doc): void {
  if (isRepairClient(ydoc.clientID) && !ydoc.store.clients.has(ydoc.clientID)) ydoc.clientID ^= 0x100;
}

function fnv(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619);
  return h;
}
function repairClient(ydoc: Y.Doc, json: string): number {
  let h = 2166136261;
  const sv = Y.encodeStateVector(ydoc);
  h = fnv(h, sv);
  h = fnv(h, Y.encodeStateAsUpdate(ydoc, sv));
  h = fnv(h, new TextEncoder().encode(json));
  return (((h >>> 8) << 8) | MARK) >>> 0;
}

export type Binding = ProsemirrorBinding & { _observeFunction: (events: Y.YEvent<Y.AbstractType<unknown>>[], t: Y.Transaction) => void };

/** The binding inside a sync plugin, before the plugin is registered. */
export const bindingOf = (plugin: { spec: { state?: { init: (...a: never[]) => unknown } } }): Binding =>
  (plugin.spec.state!.init() as { binding: Binding }).binding;

/**
 * Writes the plugins' repairs after a binding-dispatched transaction into the shared doc, and
 * turns a binding that cannot restore the caret into a full redraw instead of a throw.
 */
export function attachRepair(editor: Editor, ydoc: Y.Doc, binding: Binding): () => void {
  // An update holding only repairs gets none in reply: two clients whose repairs differ (a
  // value read from their own settings) would otherwise answer each other for ever.
  let repairOnly = false;
  const before = (t: Y.Transaction) => {
    repairOnly = false;
    if (t.local) return;
    let mine = 0, theirs = 0;
    t.afterState.forEach((clock, client) => {
      if (clock === (t.beforeState.get(client) ?? 0)) return;
      if (isRepairClient(client)) mine++;
      else theirs++;
    });
    repairOnly = mine > 0 && theirs === 0;
  };

  let pending = false;
  const write = () => {
    pending = false;
    if (destroyed || !binding.prosemirrorView) return;
    const doc = editor.state.doc;
    const own = ydoc.clientID;
    const id = repairClient(ydoc, JSON.stringify(doc.toJSON()));
    binding.mux(() => ydoc.transact((t) => {
      t.meta.set('addToHistory', false);
      ydoc.clientID = id;
      try { binding._prosemirrorChanged(doc); } finally { ydoc.clientID = own; }
    }, REPAIR_ORIGIN));
  };
  const onTransaction = ({ transaction, appendedTransactions }: { transaction: Transaction; appendedTransactions: Transaction[] }) => {
    if (!(transaction.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin) return;
    if (repairOnly || pending || !appendedTransactions.some((t) => t.docChanged)) return;
    // After the updates arriving together: a repair one of them brings is not written twice.
    pending = true;
    queueMicrotask(write);
  };

  // y-tiptap restores the caret by walking the fragment; where the document drawn from it
  // differs, a position falls outside and the update would be lost with a RangeError.
  const observe = binding._observeFunction;
  const guarded: Binding['_observeFunction'] = (events, t) => {
    try { observe(events, t); } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      console.warn('collab: caret not restorable, redrawn', e.message);
      binding._forceRerender();
    }
  };
  (binding as { _observeFunction: Binding['_observeFunction'] })._observeFunction = guarded;

  let destroyed = false;
  ydoc.on('beforeObserverCalls', before);
  editor.on('transaction', onTransaction);
  return () => {
    destroyed = true;
    ydoc.off('beforeObserverCalls', before);
    editor.off('transaction', onTransaction);
  };
}
