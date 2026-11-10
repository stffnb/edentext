import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { AttrStep, ReplaceStep, Transform, type Step } from '@tiptap/pm/transform';
import { Fragment, Mark, Slice, type Node as PMNode } from '@tiptap/pm/model';
import * as Y from 'yjs';
import { updateYFragment, ySyncPluginKey, type ProsemirrorBinding } from '@tiptap/y-tiptap';

// What the plugins repair after a transaction the binding dispatched (another client's
// update, an undo) is this client's overlay: drawn, never written, until one client, the
// repairer, writes its own. docs/architecture/collab-conflicts.md, "Repairs".

/** Origin of the repairer's writes into the shared doc; no undo manager tracks it. */
export const REPAIR_ORIGIN = Symbol('repair');
const FLUSHED = 'collabRepairFlushed';

export type Binding = ProsemirrorBinding & {
  _observeFunction: (events: Y.YEvent<Y.AbstractType<unknown>>[], t: Y.Transaction) => void;
  _prosemirrorChanged: (doc: PMNode) => void;
};
// Rebasing as prosemirror-collab does it; `setMirror` is untyped there too.
type Mirrored = { setMirror(n: number, m: number): void };

/** The binding inside a sync plugin, before the plugin is registered. */
export const bindingOf = (plugin: { spec: { state?: { init: (...a: never[]) => unknown } } }): Binding =>
  (plugin.spec.state!.init() as { binding: Binding }).binding;

const fromBinding = (tr: Transaction) => !!(tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin;

// Steps that turn `a` into `b`, as narrow as the two allow: a changed attribute is an
// AttrStep, a changed child among as many children is replaced alone. Children run back to
// front, so the positions ahead of each step stay put.
export function diffSteps(a: PMNode, b: PMNode): Step[] {
  const out: Step[] = [];
  const walk = (x: PMNode, y: PMNode, pos: number) => {
    if (x.content.eq(y.content)) return;
    if (x.childCount !== y.childCount) {
      let i = 0, from = pos;
      while (i < x.childCount && i < y.childCount && x.child(i).eq(y.child(i))) from += x.child(i++).nodeSize;
      let ja = x.childCount, jb = y.childCount, to = pos + x.content.size;
      while (ja > i && jb > i && x.child(ja - 1).eq(y.child(jb - 1))) { to -= x.child(--ja).nodeSize; jb--; }
      const kids: PMNode[] = [];
      for (let k = i; k < jb; k++) kids.push(y.child(k));
      out.push(new ReplaceStep(from, to, new Slice(Fragment.from(kids), 0, 0)));
      return;
    }
    const at: number[] = [];
    for (let i = 0, p = pos; i < x.childCount; i++) { at.push(p); p += x.child(i).nodeSize; }
    for (let i = x.childCount - 1; i >= 0; i--) {
      const cx = x.child(i), cy = y.child(i);
      if (cx === cy || cx.eq(cy)) continue;
      if (cx.isText || cx.type !== cy.type || !Mark.sameSet(cx.marks, cy.marks)) {
        out.push(new ReplaceStep(at[i], at[i] + cx.nodeSize, new Slice(Fragment.from(cy), 0, 0)));
        continue;
      }
      for (const key of Object.keys(cy.attrs)) {
        if (JSON.stringify(cx.attrs[key]) !== JSON.stringify(cy.attrs[key])) out.push(new AttrStep(at[i], key, cy.attrs[key]));
      }
      walk(cx, cy, at[i] + 1);
    }
  };
  walk(a, b, 0);
  return out;
}

// The shared doc after `tr` without the overlay: `tr`'s steps moved from `base` + overlay
// onto `base`. Null where a step reaches into what only the overlay holds.
function rebase(base: PMNode, tr: Transaction): PMNode | null {
  const over = diffSteps(base, tr.before);
  if (!over.length) return tr.doc;
  try {
    const ot = new Transform(base);
    for (const s of over) ot.step(s);
    if (!ot.doc.eq(tr.before)) return null;
    const t = new Transform(tr.doc);
    const n = tr.steps.length;
    for (let i = n - 1; i >= 0; i--) t.step(tr.steps[i].invert(tr.docs[i]));
    for (let i = over.length - 1; i >= 0; i--) t.step(over[i].invert(ot.docs[i]));
    for (let i = 0; i < n; i++) {
      const mapped = tr.steps[i].map(t.mapping.slice(n - i));
      if (!mapped || t.maybeStep(mapped).failed) return null;
      (t.mapping as unknown as Mirrored).setMirror(n - 1 - i, t.steps.length - 1);
    }
    return t.doc;
  } catch {
    return null;
  }
}

/** `base`: the shared doc as this client knows it, when the editor's differs by an overlay. */
type Overlay = { base: PMNode | null };
export const repairKey = new PluginKey<Overlay>('collabRepair');

/**
 * Keeps the plugins' repairs after a binding-dispatched transaction out of the shared doc
 * on every client but the repairer (`setRepairer`), which writes them under its own id
 * outside the history. Pauses the binding when what it drew is not the fragment.
 */
export function attachRepair(editor: Editor, ydoc: Y.Doc, binding: Binding, onInvalid: (e: Error) => void) {
  let repairs: () => boolean = () => true;
  const rebased = new WeakMap<Transaction, PMNode | null>();
  const rebaseOnce = (base: PMNode, tr: Transaction) => {
    if (!rebased.has(tr)) rebased.set(tr, rebase(base, tr));
    return rebased.get(tr)!;
  };
  const overlayOf = (state = editor.state) => {
    const base = repairKey.getState(state)?.base ?? null;
    return base && base !== state.doc ? base : null;
  };

  const plugin = new Plugin<Overlay>({
    key: repairKey,
    state: {
      init: () => ({ base: null }),
      apply(tr, value, oldState) {
        if (tr.getMeta(FLUSHED)) return { base: null };
        if (fromBinding(tr)) return { base: tr.doc };
        if (!tr.docChanged) return value;
        const root = tr.getMeta('appendedTransaction') as Transaction | undefined;
        // A repair after another client's change (or an undo) joins the overlay.
        if (root && fromBinding(root)) return { base: value.base ?? oldState.doc };
        if (!value.base || value.base === oldState.doc) return { base: null };
        const next = rebaseOnce(value.base, tr);
        if (next) return { base: next === tr.doc ? null : next };
        // A repair after a local edit reaching into the overlay joins it; the repairer's
        // own edit there is written whole, the overlay with it.
        return root ? { base: value.base } : { base: null };
      },
    },
    // This client's edit reaching into what only its overlay holds waits for the
    // repairer's version: written now, it would bring the repair twice.
    filterTransaction(tr, state) {
      const base = overlayOf(state);
      if (!base || !tr.docChanged || fromBinding(tr) || tr.getMeta('appendedTransaction') || repairs()) return true;
      if (rebaseOnce(base, tr)) return true;
      console.warn('collab: edit inside a repair not yet shared, refused');
      return false;
    },
  });

  // y-tiptap writes the whole document after a local transaction; the overlay stays out.
  const write = binding._prosemirrorChanged.bind(binding);
  binding._prosemirrorChanged = (doc) => write(overlayOf() ?? doc);

  let pending = false, destroyed = false;
  const flush = () => {
    pending = false;
    if (destroyed || !binding.prosemirrorView || binding.invalidContentError || !overlayOf() || !repairs()) return;
    const doc = editor.state.doc;
    binding.mux(() => {
      ydoc.transact((t) => {
        t.meta.set('addToHistory', false);
        updateYFragment(ydoc, binding.type, doc, binding);
      }, REPAIR_ORIGIN);
      editor.view.dispatch(editor.state.tr.setMeta(FLUSHED, true).setMeta('addToHistory', false));
    });
  };
  // After the updates arriving together, so one write covers them all.
  const schedule = () => {
    if (pending || destroyed || !overlayOf() || !repairs()) return;
    pending = true;
    queueMicrotask(flush);
  };

  // y-tiptap restores the caret by walking the fragment; where the document drawn from it
  // differs, a position falls outside and the update would be lost with a RangeError. The
  // redraw must then be the fragment; where it is not, nothing more is written.
  const observe = binding._observeFunction;
  binding._observeFunction = (events, t) => {
    try { observe(events, t); } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      console.warn('collab: caret not restorable, redrawn', e.message);
      binding._forceRerender();
      if (binding.invalidContentError) return;
      const base = repairKey.getState(editor.state)?.base ?? editor.state.doc;
      const drawn = binding.type.toArray().map((type) => binding.mapping.get(type));
      let fits = drawn.every((n) => n && !Array.isArray(n)) && base.content.eq(Fragment.from(drawn as PMNode[]));
      try { base.check(); } catch { fits = false; }
      if (!fits) {
        const err = new RangeError('the redrawn document is not the shared one');
        (binding as unknown as { _invalidContentError: Error })._invalidContentError = err;
        onInvalid(err);
      }
    }
  };

  editor.on('transaction', schedule);
  return {
    plugin,
    /** Who writes repairs; a held one is written if that is now this client. */
    setRepairer(fn: () => boolean) { repairs = fn; schedule(); },
    detach() {
      destroyed = true;
      editor.off('transaction', schedule);
      binding._prosemirrorChanged = write;
    },
  };
}
