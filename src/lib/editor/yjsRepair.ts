import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { AttrStep, ReplaceStep, Transform, type Step } from '@tiptap/pm/transform';
import { Fragment, Mark, Slice, type Node as PMNode, type NodeType } from '@tiptap/pm/model';
import * as Y from 'yjs';
import { updateYFragment, ySyncPluginKey, type ProsemirrorBinding } from '@tiptap/y-tiptap';
import { fromShared, withMarks } from './yjsMarks';

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

// What a node needs at its end to fit its content rule (an empty list: an empty item), from
// the schema alone, so every client fills alike; null where no fill makes it fit.
export function fillOf(type: NodeType, content: Fragment): Fragment | null {
  const fill = type.contentMatch.matchFragment(content)?.fillBefore(Fragment.empty, true);
  return fill && type.validContent(content.append(fill)) ? fill : null;
}

// Fills every node short of its content rule, as concurrent deletions leave a container
// empty; the container stays, so what a third client adds to it meanwhile does too.
export function fillShort(tr: Transform): boolean {
  const at: [number, Fragment][] = [];
  tr.doc.descendants((node, pos) => {
    // A textblock is entered only for an inline container in it, such as a text box.
    if (node.isTextblock) { let deep = false; node.forEach((c) => { deep ||= !c.isLeaf; }); return deep; }
    const fill = node.type.validContent(node.content) ? null : fillOf(node.type, node.content);
    if (fill?.size) at.push([pos + node.nodeSize - 1, fill]);
    return true;
  });
  // Back to front, an outer node before the ones inside it.
  for (const [pos, fill] of at.sort((x, y) => y[0] - x[0])) tr.insert(pos, fill);
  return at.length > 0;
}

// What changed between two docs, as steps from `before` to `doc`.
type Change = { before: PMNode; doc: PMNode; steps: readonly Step[]; docs: readonly PMNode[] };
type Moved = { doc: PMNode; steps: Step[]; map: (pos: number) => number };

// `tr`'s steps moved from `tr.before` onto `base` (as prosemirror-collab rebases): the shared
// doc after `tr` without the overlay, or held edits onto a redraw. Null where a step reaches
// into what only `tr.before` holds.
function move(base: PMNode, tr: Change): Moved | null {
  const over = diffSteps(base, tr.before);
  if (!over.length) return { doc: tr.doc, steps: [...tr.steps], map: (p) => p };
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
    return { doc: t.doc, steps: t.steps.slice(n + over.length), map: (p) => t.mapping.map(p) };
  } catch {
    return null;
  }
}

/**
 * `base`: the shared doc as this client knows it, when the editor's differs by an overlay.
 * `held`: this client's edits since one reached into the overlay, drawn but not written.
 */
type Held = Change & { sel: [number, number] | null };
type Overlay = { base: PMNode | null; held: Held | null };
export const repairKey = new PluginKey<Overlay>('collabRepair');
const REPLAYED = 'collabRepairReplayed';

/**
 * Keeps the plugins' repairs after a binding-dispatched transaction out of the shared doc
 * on every client but the repairer (`setRepairer`), which writes them under its own id
 * outside the history. `onPause` hears the binding pause (an error) and resume (null),
 * `onDrop` a held edit that no longer fits.
 */
export function attachRepair(editor: Editor, ydoc: Y.Doc, binding: Binding, onPause: (e: Error | null) => void, onDrop: () => void) {
  let repairs: () => boolean = () => true;
  const rebased = new WeakMap<Transaction, PMNode | null>();
  const rebaseOnce = (base: PMNode, tr: Transaction) => {
    if (!rebased.has(tr)) rebased.set(tr, move(base, tr)?.doc ?? null);
    return rebased.get(tr)!;
  };
  const stateOf = (state = editor.state) => repairKey.getState(state) ?? { base: null, held: null };
  const overlayOf = (state = editor.state) => {
    const base = stateOf(state).base;
    return base && base !== state.doc ? base : null;
  };
  const hold = (h: Held | null, tr: Transaction): Held => h
    ? { before: h.before, doc: tr.doc, steps: [...h.steps, ...tr.steps], docs: [...h.docs, ...tr.docs], sel: null }
    : { before: tr.before, doc: tr.doc, steps: tr.steps, docs: tr.docs, sel: null };

  const plugin = new Plugin<Overlay>({
    key: repairKey,
    // Ordered first, so the other plugins' repairs see the fill and the doc before it.
    appendTransaction(trs, _old, state: EditorState) {
      if (!trs.some(fromBinding)) return null;
      const tr = state.tr;
      return fillShort(tr) ? tr : null;
    },
    state: {
      init: () => ({ base: null, held: null }),
      apply(tr, value, oldState) {
        if (tr.getMeta(FLUSHED)) return { base: null, held: null };
        const held = tr.getMeta(REPLAYED) ? null : value.held;
        // The redraw drops held edits; the caret they left is where the replay puts it.
        if (fromBinding(tr)) {
          const sel: [number, number] = [oldState.selection.anchor, oldState.selection.head];
          return { base: tr.doc, held: held && held.doc === oldState.doc ? { ...held, sel } : held };
        }
        if (!tr.docChanged) return held === value.held ? value : { base: value.base, held };
        const root = tr.getMeta('appendedTransaction') as Transaction | undefined;
        // A repair after another client's change (or an undo) joins the overlay.
        if (root && fromBinding(root)) return { base: value.base ?? oldState.doc, held };
        // Once an edit is held, the ones after it wait with it, in order.
        if (held && held.doc === oldState.doc) return { base: value.base, held: hold(held, tr) };
        if (!value.base || value.base === oldState.doc) return { base: null, held };
        const next = rebaseOnce(value.base, tr);
        if (next) return { base: next === tr.doc ? null : next, held };
        // A repair after a local edit reaching into the overlay joins it; the repairer's
        // own edit there is written whole, the overlay with it. Anyone else's is held:
        // written now, it would bring the repair twice.
        if (root) return { base: value.base, held };
        return repairs() ? { base: null, held: null } : { base: value.base, held: hold(null, tr) };
      },
    },
  });

  // The projection keeps an element short of its content rule where a fill makes it fit,
  // instead of pausing; the plugin above fills it as a repair. A node's marks come from
  // their attribute (`yjsMarks.ts`).
  const schema = editor.schema;
  const node = schema.node;
  let projecting = false;
  schema.node = function (this: typeof schema, type, given, content, given2) {
    const { attrs, marks } = fromShared(this, given, given2);
    try { return node.call(this, type, attrs, content, marks); } catch (e) {
      const t = typeof type === 'string' ? this.nodes[type] : type;
      if (!projecting || !t || !fillOf(t, Fragment.from(content))) throw e;
      return t.create(attrs, content, marks);
    }
  };
  const projector = binding as unknown as { createDocumentContent: () => Fragment };
  const project = projector.createDocumentContent.bind(binding);
  projector.createDocumentContent = () => {
    projecting = true;
    try { return project(); } finally { projecting = false; }
  };

  // y-tiptap writes the whole document after a local transaction; the overlay stays out.
  const raw = binding._prosemirrorChanged;
  const write = (doc: PMNode) => raw.call(binding, withMarks(doc));
  binding._prosemirrorChanged = (doc) => write(overlayOf() ?? doc);

  let pending = false, replaying = false, destroyed = false, paused = false;
  const flush = () => {
    pending = false;
    if (destroyed || !binding.prosemirrorView || binding.invalidContentError || !overlayOf() || !repairs()) return;
    const doc = editor.state.doc;
    const held = stateOf().held;
    const repaired = held && held.doc === doc ? held.before : doc;
    binding.mux(() => {
      ydoc.transact((t) => {
        t.meta.set('addToHistory', false);
        updateYFragment(ydoc, binding.type, withMarks(repaired), binding);
      }, REPAIR_ORIGIN);
      // Edits held until now go in as this client's own, undoable.
      if (repaired !== doc) write(doc);
      editor.view.dispatch(editor.state.tr.setMeta(FLUSHED, true).setMeta('addToHistory', false));
    });
  };
  // The held edits again on the redrawn doc: written if the overlay they reached into is
  // shared now, held again if not, dropped with a warning where they no longer fit.
  const replay = () => {
    replaying = false;
    const held = stateOf().held, doc = editor.state.doc;
    if (destroyed || !held || held.doc === doc || binding.invalidContentError) return;
    const moved = move(doc, held);
    const tr = editor.state.tr.setMeta(REPLAYED, true);
    if (!moved) { console.warn('collab: edit inside a repair not yet shared, lost to a change around it'); onDrop(); }
    else {
      for (const s of moved.steps) tr.step(s);
      if (held.sel) {
        const at = (p: number) => tr.doc.resolve(Math.max(0, Math.min(moved.map(p), tr.doc.content.size)));
        tr.setSelection(TextSelection.between(at(held.sel[0]), at(held.sel[1])));
      }
    }
    editor.view.dispatch(tr);
  };
  // After the updates arriving together, so one write covers them all.
  const schedule = () => {
    if (paused && !binding.invalidContentError) { paused = false; onPause(null); }
    if (!destroyed && !replaying && stateOf().held && stateOf().held!.doc !== editor.state.doc) {
      replaying = true;
      queueMicrotask(replay);
    }
    if (pending || destroyed || !overlayOf() || !repairs()) return;
    pending = true;
    queueMicrotask(flush);
  };
  const pause = (e: Error) => { paused = true; onPause(e); };

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
      try { const t = new Transform(base); fillShort(t); t.doc.check(); } catch { fits = false; }
      if (!fits) {
        const err = new RangeError('the redrawn document is not the shared one');
        (binding as unknown as { _invalidContentError: Error })._invalidContentError = err;
        pause(err);
      }
    }
  };

  editor.on('transaction', schedule);
  return {
    plugin,
    /** The binding's `onInvalidContent`. */
    pause,
    /** Who writes repairs; a held one is written if that is now this client. */
    setRepairer(fn: () => boolean) { repairs = fn; schedule(); },
    detach() {
      destroyed = true;
      editor.off('transaction', schedule);
      binding._prosemirrorChanged = raw;
      projector.createDocumentContent = project;
      schema.node = node;
    },
  };
}
