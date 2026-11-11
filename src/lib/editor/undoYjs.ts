import type { Editor } from '@tiptap/core';
import type { Plugin, Transaction } from '@tiptap/pm/state';
import type { ContentMatch, Schema } from '@tiptap/pm/model';
import { history, isHistoryTransaction } from '@tiptap/pm/history';
import * as Y from 'yjs';
import { ySyncPlugin, ySyncPluginKey, yUndoPlugin, yUndoPluginKey, prosemirrorToYXmlFragment } from '@tiptap/y-tiptap';
import { StateStep, commitState, stateValues } from './extensions/stateHistory';
import { pmUndo, setUndoBackend, STATE_RESTORED, type UndoBackend } from './undo';
import { describeTransaction, resetHistoryLog, syncHistoryLog } from '../utils/historyLog.svelte';
import { attachRepair, bindingOf, repairKey } from './yjsRepair';
import { attachRescue } from './yjsRescue';
import { withMarks } from './yjsMarks';
import './yjsRedo';
import { isSplitPane } from './extensions/pageBreaks';

// Origin of the side stores' writes into the shared doc (a `StateStep` mirrored).
const STATE_ORIGIN = Symbol('stateHistory');

// Whether a block holds another client's live text or inline object. y-tiptap's own filter
// keeps every paragraph with content, so undoing an Enter left the new paragraph behind.
// Another client's empty element (a repair's cell padding a row) holds nothing of theirs.
function holdsForeign(type: { _start: Y.Item | null }, foreign: (it: Y.Item) => boolean, leaf: (name: string) => boolean): boolean {
  for (let it = type._start; it; it = it.right) {
    if (it.deleted) continue;
    if (it.content instanceof Y.ContentType) {
      const child = it.content.type;
      if (holdsForeign(child, foreign, leaf)) return true;
      if (foreign(it) && child instanceof Y.XmlElement && leaf(child.nodeName)) return true;
    } else if (it.content instanceof Y.ContentString && foreign(it)) return true;
  }
  return false;
}

// Whether an element's live children, `gone` left out, fit its node's content; unknown
// elements count as fitting.
function fits(el: Y.XmlElement, gone: Y.Item | null, schema: Schema): boolean {
  let m: ContentMatch | null = schema.nodes[el.nodeName]?.contentMatch ?? null;
  if (!m) return true;
  for (let it = el._start; it && m; it = it.right) {
    if (it.deleted || it === gone || !(it.content instanceof Y.ContentType)) continue;
    const child = it.content.type;
    if (child instanceof Y.XmlElement) {
      const type = schema.nodes[child.nodeName];
      if (!type) return true;
      m = m.matchType(type);
    } else if (child instanceof Y.XmlText && child.length) m = m.matchType(schema.nodes.text);
  }
  return !!m?.validEnd;
}

// The parents an undo deletes along with `item`, as each would be left empty where no
// empty one fits (a list whose other items another client took out); null where a parent
// would be left holding something that no longer fits, so `item` stays.
function emptied(item: Y.Item, schema: Schema): Y.Item[] | null {
  const out: Y.Item[] = [];
  for (let it = item; ;) {
    const parent = it.parent;
    if (!(parent instanceof Y.XmlElement) || !parent._item || fits(parent, it, schema) || !fits(parent, null, schema)) return out;
    for (let x = parent._start; x; x = x.right) if (!x.deleted && x !== it && x.countable) return null;
    out.push(parent._item);
    it = parent._item;
  }
}

// Yjs puts what an undo or redo restores back as new items under the undoer's id; their
// ranges here keep the author of the text they restore, so the next undo still counts it
// as another client's. Per client id and sorted, as copies never overlap.
class Authors {
  private ranges = new Map<number, { clock: number; end: number; foreign: boolean }[]>();
  constructor(private ydoc: Y.Doc) {}
  // The first range of `client` that ends after `clock`.
  private from(client: number, clock: number): number {
    const rs = this.ranges.get(client) ?? [];
    let lo = 0, hi = rs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (rs[mid].end <= clock) lo = mid + 1; else hi = mid; }
    return lo;
  }
  foreign = (it: Y.Item): boolean => {
    if (it.id.client !== this.ydoc.clientID) return true;
    const rs = this.ranges.get(it.id.client) ?? [];
    for (let i = this.from(it.id.client, it.id.clock); i < rs.length && rs[i].clock < it.id.clock + it.length; i++) if (rs[i].foreign) return true;
    return false;
  };
  // Yjs merges adjacent copies into one item, and an undo deletes a copy it follows to its
  // end; split at the end of the copy the item starts in, so only that copy goes.
  trim(it: Y.Item): void {
    const r = this.ranges.get(it.id.client)?.[this.from(it.id.client, it.id.clock)];
    const tr = this.ydoc._transaction;
    if (r && tr && r.clock <= it.id.clock && it.id.clock + it.length > r.end) Y.getItemCleanStart(tr, Y.createID(it.id.client, r.end));
  }
  // After an undo or redo: every item it restored, as its copy's range and whose text it is.
  restored(deletions: { clients: Map<number, { clock: number; len: number }[]> }): void {
    deletions.clients.forEach((dels, client) => {
      const structs = this.ydoc.store.clients.get(client);
      if (!structs) return;
      for (const d of dels) {
        for (let i = Y.findIndexSS(structs, d.clock); i < structs.length && structs[i].id.clock < d.clock + d.len; i++) {
          const it = structs[i];
          if (!(it instanceof Y.Item) || !it.redone) continue;
          const rs = this.ranges.get(it.redone.client) ?? [];
          const at = rs.findIndex((r) => r.clock > it.redone!.clock);
          rs.splice(at < 0 ? rs.length : at, 0, { clock: it.redone.clock, end: it.redone.clock + it.length, foreign: this.foreign(it) });
          this.ranges.set(it.redone.client, rs);
        }
      }
    });
  }
}

// A footnote anchor whose note holds another client's text stays with it: the notes repair
// drops a note without its anchor, and the other's text in it.
function keepsNote(type: Y.XmlElement, frag: Y.XmlFragment, foreign: (it: Y.Item) => boolean, leaf: (name: string) => boolean): boolean {
  if (type.nodeName !== 'noteRef') return false;
  const id = String(type.getAttribute('id') ?? '');
  for (const section of frag.toArray()) {
    if (!(section instanceof Y.XmlElement) || section.nodeName !== 'noteSection') continue;
    for (const note of section.toArray()) {
      if (note instanceof Y.XmlElement && String(note.getAttribute('id') ?? '') === id && holdsForeign(note, foreign, leaf)) return true;
    }
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

// Page layout and styles lie in the map field by field and style by style, so two authors
// changing different ones keep both; any other store id is one key (a zone, the notes).
const FAMILIES = ['paragraph', 'character', 'table', 'list'];
type Fields = Record<string, unknown>;
const SPLIT = new Set(['layout', 'styles']);
const storeOf = (key: string) => (SPLIT.has(key.slice(0, key.indexOf('/'))) ? key.slice(0, key.indexOf('/')) : key);

function entries(id: string, value: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (id === 'layout') for (const [k, v] of Object.entries(value as Fields)) out.set(`layout/${k}`, v);
  else if (id === 'styles') {
    for (const [k, v] of Object.entries((value as { sheet: Fields }).sheet)) {
      out.set(`styles/${k}`, FAMILIES.includes(k) ? Object.keys(v as Fields) : v);
      // A family's own key holds its names in order; a name is encoded, as it may hold a '/'.
      if (FAMILIES.includes(k)) for (const [name, style] of Object.entries(v as Fields)) out.set(`styles/${k}/${encodeURIComponent(name)}`, style);
    }
  } else out.set(id, value);
  return out;
}

// A store as the map holds it, in an order every client builds alike: fields sorted, styles
// in their family's order, a style missing there (added by two at once) after it by name.
function assemble(id: string, side: Y.Map<unknown>): unknown {
  if (!SPLIT.has(id)) return side.get(id) ?? null;
  const own = new Map<string, unknown>();
  for (const [k, v] of side.entries()) if (k.startsWith(`${id}/`)) own.set(k.slice(id.length + 1), v);
  const fields = [...own.keys()].filter((k) => !k.includes('/')).sort();
  if (id === 'layout') return Object.fromEntries(fields.map((k) => [k, own.get(k)]));
  const sheet: Fields = {};
  for (const k of [...FAMILIES.filter((f) => own.has(f)), ...fields.filter((f) => !FAMILIES.includes(f))]) {
    if (!FAMILIES.includes(k)) { sheet[k] = own.get(k); continue; }
    const names = [...own.keys()].filter((n) => n.startsWith(`${k}/`)).map((n) => decodeURIComponent(n.slice(k.length + 1)));
    const order = (own.get(k) as string[]).filter((n) => names.includes(n));
    const rest = names.filter((n) => !order.includes(n)).sort();
    sheet[k] = Object.fromEntries([...order, ...rest].map((n) => [n, own.get(`${k}/${encodeURIComponent(n)}`)]));
  }
  return { sheet };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export { Y };

export type YjsUndo = {
  ydoc: Y.Doc; undoManager: Y.UndoManager; detach: () => void;
  /** Who writes the repairs after remote changes (yjsRepair.ts); alone, this client. */
  setRepairer: (repairs: () => boolean) => void;
  /** Puts every store the map holds into effect: a joiner's, after its start snapshot. */
  applyState: () => void;
  /** Puts into effect again each store whose entries mention `text`, as a picture they name came. */
  refresh: (text: string) => void;
  /** Hears when the shared doc stops fitting this editor (no edits, no writes) and fits again. */
  onPause: (fn: (paused: boolean) => void) => void;
  /** Hears when an edit held inside a repair not yet shared no longer fits and is dropped. */
  onDrop: (fn: () => void) => void;
};

/**
 * How store values go into the map and come out (a session names pictures by key there);
 * `pack`'s `share` is false for values every client already has from the start file.
 */
export type StoreCodec = { pack(value: unknown, share: boolean): unknown; unpack(value: unknown): unknown };
const PLAIN: StoreCodec = { pack: (v) => v, unpack: (v) => v };

// The binding and the undo manager have one view, the editor's: a split or grid pane
// would take the binding over on mount and destroy both when it closes.
function editorViewOnly(plugin: Plugin): Plugin {
  const view = plugin.spec.view;
  if (view) plugin.spec.view = (v) => (isSplitPane(v) ? {} : view(v));
  return plugin;
}

/**
 * The body's undo on Yjs: the text in the fragment `body`, the stores beside it (`StateStep`
 * ids) in the map `state`, both under one manager that only takes back this client's edits.
 */
export function attachYjsUndo(
  editor: Editor, ydoc = new Y.Doc(), codec = PLAIN, repairs: () => boolean = () => true,
): YjsUndo {
  const frag = ydoc.getXmlFragment('body');
  const side = ydoc.getMap('state');
  const packed = (id: string, value: unknown, share: boolean) => entries(id, codec.pack(value, share));
  // The client that brings the text brings every store too, entry by entry, before the
  // history starts: a first write of old values would cover another's new ones. A joiner
  // only learns the pictures its start file gave the stores.
  if (frag.length === 0) {
    prosemirrorToYXmlFragment(withMarks(editor.state.doc), frag);
    ydoc.transact(() => { for (const [id, v] of stateValues()) for (const [k, e] of packed(id, v, false)) side.set(k, e); });
  } else for (const [, v] of stateValues()) codec.pack(v, false);
  const leaf = (name: string) => !!editor.schema.nodes[name]?.isLeaf;
  const authors = new Authors(ydoc);
  const um = new Y.UndoManager([frag, side], {
    trackedOrigins: new Set([ySyncPluginKey, STATE_ORIGIN]),
    captureTransaction: (t) => t.meta.get('addToHistory') !== false,
    deleteFilter: (item) => {
      if (!(item.content instanceof Y.ContentType)) {
        authors.trim(item);
        return !authors.foreign(item);
      }
      const type = item.content.type;
      if (holdsForeign(type, authors.foreign, leaf) || (type instanceof Y.XmlElement && keepsNote(type, frag, authors.foreign, leaf))) return false;
      const parents = emptied(item, editor.schema);
      for (const p of parents ?? []) p.delete(ydoc._transaction!);
      return !!parents;
    },
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
    authors.restored(stackItem.deletions);
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

  // A store change beside the text goes into the map, only the entries it changed; on its
  // own it is a step of its own, beside a text change it joins that one (a renamed style
  // and its paragraphs).
  const mirror = ({ transaction, appendedTransactions }: { transaction: Transaction; appendedTransactions: Transaction[] }) => {
    const trs = [transaction, ...appendedTransactions];
    if (trs.some((t) => t.getMeta(STATE_RESTORED) || t.getMeta(ySyncPluginKey))) return;
    const steps = trs.flatMap((t) => t.steps.filter((s): s is StateStep => s instanceof StateStep));
    if (!steps.length) return;
    const alone = !trs.some((t) => t.docChanged);
    // A zone the map has not seen yet gets its old value first, outside the history.
    ydoc.transact(() => { for (const s of steps) if (!SPLIT.has(s.id) && !side.has(s.id)) side.set(s.id, codec.pack(s.from, false)); });
    if (alone) stop();
    ydoc.transact(() => {
      for (const s of steps) {
        const from = packed(s.id, s.from, false), to = packed(s.id, s.to, true);
        for (const [k, v] of to) if ((!from.has(k) || !same(from.get(k), v)) && !(side.has(k) && same(side.get(k), v))) side.set(k, v);
        for (const k of from.keys()) if (!to.has(k) && side.has(k)) side.delete(k);
      }
    }, STATE_ORIGIN);
    if (alone) { stop(); prev = []; }
  };

  // What an undo or another author put back in the map reaches the stores as a body
  // transaction of `StateStep`s, a whole store each, which their own listeners apply.
  const apply = (keys: Iterable<string>) => {
    const tr = editor.state.tr.setMeta(STATE_RESTORED, true).setMeta('addToHistory', false);
    for (const id of new Set([...keys].map(storeOf))) tr.step(new StateStep(id, null, codec.unpack(assemble(id, side))));
    if (tr.steps.length) editor.view.dispatch(tr);
  };
  const restore = (ev: Y.YMapEvent<unknown>, t: Y.Transaction) => {
    if (t.origin === STATE_ORIGIN || (t.local && t.origin !== um)) return;
    // One's own change still gathering goes into the map first, so both authors' entries
    // stay; its write is a transaction of its own, which Yjs runs after this observer.
    if (!t.local) for (const id of new Set([...ev.keysChanged].map(storeOf))) commitState(id);
    // The body's observer redraws the document after this one; dispatching earlier would make
    // the binding write the document as drawn before the update back over it.
    const keys = [...ev.keysChanged];
    const after = (done: Y.Transaction) => {
      if (done !== t) return;
      ydoc.off('afterTransaction', after);
      apply(keys);
    };
    ydoc.on('afterTransaction', after);
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
  // Shared content that does not fit the schema pauses editing and writing, instead of
  // y-tiptap deleting it from the shared doc; it resumes with an update that fits.
  let heard: (paused: boolean) => void = () => {};
  const paused = (e: Error | null) => {
    if (e) console.error('collab: paused,', e.message);
    else console.info('collab: resumed');
    heard(!!e);
  };
  let invalid: (e: Error) => void = paused;
  const sync = editorViewOnly(ySyncPlugin(frag, { onInvalidContent: (e) => invalid(e) }));
  const binding = bindingOf(sync);
  let dropped: () => void = () => {};
  const repair = attachRepair(editor, ydoc, binding, paused, () => dropped());
  invalid = repair.pause;
  repair.setRepairer(repairs);
  editor.registerPlugin(repair.plugin, (p, ps) => [p, ...ps]);
  editor.registerPlugin(sync);
  const detachRescue = attachRescue(editor, ydoc, binding, um, authors.foreign);
  editor.registerPlugin(editorViewOnly(yUndoPlugin({ undoManager: um })));
  editor.on('beforeTransaction', before);
  editor.on('transaction', mirror);
  editor.on('transaction', track);
  side.observe(restore);
  setUndoBackend(backend);
  resetHistoryLog();

  return {
    ydoc, undoManager: um,
    setRepairer: repair.setRepairer,
    onPause: (fn) => { heard = fn; },
    onDrop: (fn) => { dropped = fn; },
    applyState: () => apply([...side.keys()]),
    refresh(text) {
      const keys = [...side.entries()].filter(([, v]) => JSON.stringify(v).includes(text)).map(([k]) => k);
      // An open zone's own edits go into the map first, so the refresh keeps them.
      for (const id of new Set(keys.map(storeOf))) commitState(id);
      apply(keys);
    },
    detach() {
      repair.detach();
      detachRescue();
      side.unobserve(restore);
      editor.off('beforeTransaction', before);
      editor.off('transaction', mirror);
      editor.off('transaction', track);
      // Together: the undo plugin's view needs the sync plugin while the views rebuild.
      editor.unregisterPlugin([yUndoPluginKey, ySyncPluginKey, repairKey]);
      editor.registerPlugin(history({ depth: 100, newGroupDelay: 500 }));
      setUndoBackend(pmUndo);
      destroy();
      resetHistoryLog();
    },
  };
}
