import type { Editor } from '@tiptap/core';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import type { Mark } from '@tiptap/pm/model';
import * as Y from 'yjs';
import { relativePositionToAbsolutePosition } from '@tiptap/y-tiptap';
import type { Binding } from './yjsRepair';

// Text this client typed into a block that another client's update rebuilt elsewhere (a
// heading made of it, a join, a move, a merged cell, a split) follows the block: Yjs cannot
// move an element, so the rebuild copies only the text its author saw. Only the author of
// the text moves it, so nothing races. docs/architecture/collab-conflicts.md, "Rescue".

/** Meta of the transaction that puts rescued text in its new place. */
export const RESCUED = 'collabRescued';

const CONTEXT = 40;
const START = '\u0002', END = '\u0003';

type Char = { ch: string; clock: number; item: Y.Item; attrs: Record<string, unknown> };
type Unit = {
  text: Y.XmlText; chars: Char[]; lost: boolean;
  left: string; right: string;
  /** Index of the run among the text's live characters, for a run still in place. */
  at: number;
  /** Everything else in the text went with the update: the block stays only for this run. */
  abandoned: boolean;
  /** A whole block of this client's text: its type and the text of the blocks around it. */
  block?: { name: string; prev: string; next: string };
};
type Site = { s: string; fresh: boolean[] };

const textOf = (chars: Char[]) => chars.map((c) => c.ch).join('');

// The runs of this client's text that the update took away (their block deleted) or left
// behind (everything around them gone), with the text around them before the update.
function unitsOf(text: Y.XmlText, me: number, t: Y.Transaction, isNew: (it: Y.Item) => boolean): Unit[] {
  const all: (Char & { own: boolean; live: boolean })[] = [];
  let attrs: Record<string, unknown> = {};
  for (let it = text._start; it; it = it.right) {
    if (isNew(it) || (it.deleted && !Y.isDeleted(t.deleteSet, it.id))) continue;
    if (it.content instanceof Y.ContentFormat) {
      const { key, value } = it.content;
      attrs = { ...attrs };
      if (value === null) delete attrs[key];
      else attrs[key] = value;
      continue;
    }
    if (!(it.content instanceof Y.ContentString)) continue;
    const str = it.content.str;
    for (let i = 0; i < str.length; i++) all.push({ ch: str[i], clock: it.id.clock + i, item: it, attrs, own: it.id.client === me, live: !it.deleted });
  }
  const textLive = !text._item?.deleted;
  let rewritten = false;
  for (let it = text._start; it && !rewritten; it = it.right) rewritten = isNew(it) && !it.deleted && it.content instanceof Y.ContentString;
  const others = all.filter((c) => !c.own);
  const abandoned = textLive && others.length > 0 && others.every((c) => !c.live);
  const owner = text.parent instanceof Y.XmlElement ? text.parent._item?.id.client : undefined;
  const foreignBlock = owner !== undefined && owner !== me;
  const out: Unit[] = [];
  for (let i = 0; i < all.length;) {
    const c = all[i];
    if (!c.own) { i++; continue; }
    let j = i;
    while (j < all.length && all[j].own && all[j].live === c.live) j++;
    const before = all[i - 1], after = all[j];
    const lost = !c.live;
    // Left behind: the text on both sides went and the run stayed, so the update moving
    // that text never knew the run (a move takes what it knows along). At the text's start
    // or end one side will do where the update also rewrote this text in place (a sort), or
    // where another client's block lost all but this run (its undo kept the block for it).
    const gone = (c: Char & { live: boolean } | undefined) => !!c && !c.live;
    const left = !lost && textLive && (gone(before) && gone(after)
      || ((rewritten || (abandoned && foreignBlock)) && ((gone(before) && !after) || (!before && gone(after)))));
    if (lost || left) {
      let l = '';
      for (let k = i - 1; k >= 0 && l.length < CONTEXT && !all[k].own; k--) l = all[k].ch + l;
      if (i - l.length === 0) l = START + l;
      let r = '';
      for (let k = j; k < all.length && r.length < CONTEXT && !all[k].own; k++) r += all[k].ch;
      if (j + r.length === all.length) r += END;
      const unit: Unit = { text, chars: all.slice(i, j), lost, left: l, right: r, at: lost ? -1 : liveIndex(text, c), abandoned };
      if (lost && l === START && r === END && text.parent instanceof Y.XmlElement) unit.block = blockOf(text.parent, t, isNew);
      out.push(unit);
    }
    i = j;
  }
  return out;
}

// A block with nothing but this client's text has no text around it to find its place by;
// the blocks beside it before the update do.
function blockOf(el: Y.XmlElement, t: Y.Transaction, isNew: (it: Y.Item) => boolean): Unit['block'] {
  const wasLive = (it: Y.Item) => !isNew(it) && (!it.deleted || Y.isDeleted(t.deleteSet, it.id));
  const textIn = (item: Y.Item | null): string => {
    if (!item || !(item.content instanceof Y.ContentType) || !(item.content.type instanceof Y.XmlElement)) return '';
    let out = '';
    for (let it = item.content.type._start; it; it = it.right) {
      if (!wasLive(it) || !(it.content instanceof Y.ContentType) || !(it.content.type instanceof Y.XmlText)) continue;
      for (let c = it.content.type._start; c; c = c.right) if (wasLive(c) && c.content instanceof Y.ContentString) out += c.content.str;
    }
    return out;
  };
  let prev = el._item?.left ?? null, next = el._item?.right ?? null;
  while (prev && !wasLive(prev)) prev = prev.left;
  while (next && !wasLive(next)) next = next.right;
  return { name: el.nodeName, prev: textIn(prev), next: textIn(next) };
}

// A character's index among the text's live characters now.
function liveIndex(text: Y.XmlText, c: Char): number {
  let at = 0;
  for (let it = text._start; it; it = it.right) {
    if (it === c.item) return at + c.clock - it.id.clock;
    if (!it.deleted && it.content instanceof Y.ContentString) at += it.content.str.length;
  }
  return -1;
}

// Every text the update brought characters into, as it reads now, with the new ones marked.
function sitesOf(ydoc: Y.Doc, t: Y.Transaction, me: number, isNew: (it: Y.Item) => boolean): Map<Y.XmlText, Site> {
  const texts = new Set<Y.XmlText>();
  t.afterState.forEach((clock, client) => {
    const from = t.beforeState.get(client) ?? 0;
    if (client === me || clock === from) return;
    const structs = ydoc.store.clients.get(client) ?? [];
    for (let i = Y.findIndexSS(structs, from); i < structs.length; i++) {
      const s = structs[i];
      if (s instanceof Y.Item && !s.deleted && s.content instanceof Y.ContentString && s.parent instanceof Y.XmlText) texts.add(s.parent);
    }
  });
  const out = new Map<Y.XmlText, Site>();
  for (const text of texts) {
    let s = START;
    const fresh = [false];
    for (let it = text._start; it; it = it.right) {
      if (it.deleted || !(it.content instanceof Y.ContentString)) continue;
      s += it.content.str;
      for (let i = 0; i < it.content.str.length; i++) fresh.push(isNew(it));
    }
    out.set(text, { s: s + END, fresh: [...fresh, false] });
  }
  return out;
}

// Where the update put the text around a run: the place whose surroundings match the run's
// best, new characters among them. `skip` is how much of the run is there already.
type Place = { text: Y.XmlText; offset: number; skip: number; side?: 'after' | 'before' };
function placeOf(u: Unit, sites: Map<Y.XmlText, Site>): Place | null {
  if (u.block) {
    // Beside the block that holds what stood beside it, rebuilt by the update.
    for (const [side, near] of [['after', u.block.prev], ['before', u.block.next]] as const) {
      if (near.length < 2) continue;
      for (const [text, { s, fresh }] of sites) if (s === START + near + END && fresh.some(Boolean)) return { text, offset: 0, skip: 0, side };
    }
    return null;
  }
  const run = textOf(u.chars);
  let best: { text: Y.XmlText; offset: number; skip: number; score: number } | null = null;
  for (const [text, { s, fresh }] of sites) {
    if (text === u.text) continue;
    for (let e = 1; e < s.length; e++) {
      let l = 0;
      while (l < u.left.length && e - 1 - l >= 0 && s[e - 1 - l] === u.left[u.left.length - 1 - l]) l++;
      let k = 0;
      while (k < run.length && s[e + k] === run[k]) k++;
      let r = 0;
      while (r < u.right.length && s[e + k + r] === u.right[r]) r++;
      const score = l + r;
      if (score < 3 || (best && score <= best.score)) continue;
      let any = false;
      for (let i = e - l; i < e + k + r && !any; i++) any = fresh[i];
      if (any) best = { text, offset: e - 1, skip: k, score };
    }
  }
  return best;
}

const markName = (key: string) => key.replace(/--[a-zA-Z0-9+/=]{8}$/, '');

export function attachRescue(editor: Editor, ydoc: Y.Doc, binding: Binding, um: Y.UndoManager): () => void {
  const frag = binding.type;
  // A text's characters are one run in the document, so a place in it is its start plus the
  // index; y-tiptap's own reading of a character's position second-guesses a moved one.
  const absolute = (text: Y.XmlText, index: number) => {
    const start = relativePositionToAbsolutePosition(ydoc, frag, Y.createRelativePositionFromTypeIndex(text, 0, 0), binding.mapping);
    return start === null ? null : start + index;
  };

  const after = (t: Y.Transaction) => {
    if (t.local || !binding.prosemirrorView) return;
    const me = ydoc.clientID;
    const isNew = (it: Y.Item) => it.id.clock >= (t.beforeState.get(it.id.client) ?? 0);
    const texts = new Set<Y.XmlText>();
    for (const type of t.changed.keys()) if (type instanceof Y.XmlText) texts.add(type);
    const mine = t.deleteSet.clients.get(me), structs = ydoc.store.clients.get(me);
    if (mine && structs) for (const { clock, len } of mine) {
      for (let i = Y.findIndexSS(structs, clock); i < structs.length && structs[i].id.clock < clock + len; i++) {
        const s = structs[i];
        if (s instanceof Y.Item && s.parent instanceof Y.XmlText) texts.add(s.parent);
      }
    }
    const units = [...texts].flatMap((text) => unitsOf(text, me, t, isNew));
    if (!units.length) return;
    const sites = sitesOf(ydoc, t, me, isNew);
    if (!sites.size) return;

    const { state } = editor;
    const schema = state.schema;
    type Op = { at: number; del?: number; insert?: Char[]; block?: string; unit: Unit; abandoned?: boolean };
    const ops: Op[] = [];
    for (const u of units) {
      const place = placeOf(u, sites);
      if (!place || place.skip === u.chars.length) continue;
      let at = absolute(place.text, place.offset);
      if (at === null) continue;
      if (place.side) {
        const $at = state.doc.resolve(at);
        if (!$at.parent.isTextblock || !schema.nodes[u.block!.name]) continue;
        at = place.side === 'after' ? $at.after() : $at.before();
      }
      ops.push({ at, insert: u.chars.slice(place.skip), block: place.side && u.block!.name, unit: u });
      if (u.lost) continue;
      const from = absolute(u.text, u.at);
      if (from === null || state.doc.textBetween(from, from + u.chars.length) !== textOf(u.chars)) { ops.pop(); continue; }
      ops.push({ at: from, del: u.chars.length, unit: u, abandoned: u.abandoned });
    }
    if (!ops.length) return;

    // The caret in a moved run moves with it.
    const head = binding.beforeTransactionSelection?.head;
    const caret = head?.item && head.item.client === me ? head.item.clock : null;

    const tr = state.tr;
    let caretAt: { pos: number; steps: number } | null = null;
    ops.sort((a, b) => b.at - a.at || (a.del ? -1 : 1));
    const emptied: { pos: number; steps: number }[] = [];
    for (const op of ops) {
      if (op.del) {
        tr.delete(op.at, op.at + op.del);
        if (op.abandoned) emptied.push({ pos: op.at, steps: tr.steps.length });
        continue;
      }
      let pos = op.at;
      if (op.block) {
        tr.insert(pos, schema.nodes[op.block].create());
        pos += 1;
      }
      for (let i = 0; i < op.insert!.length;) {
        let j = i;
        while (j < op.insert!.length && op.insert![j].attrs === op.insert![i].attrs) j++;
        const marks = Object.entries(op.insert![i].attrs).flatMap(([k, v]) => {
          const type = schema.marks[markName(k)];
          return type ? [type.create(v as Record<string, unknown>)] : [] as Mark[];
        });
        tr.insert(pos, schema.text(textOf(op.insert!.slice(i, j)), marks));
        const hit = caret === null ? -1 : op.insert!.slice(i, j).findIndex((c) => c.clock === caret);
        if (hit >= 0) caretAt = { pos: pos + hit + ((head?.assoc ?? 0) < 0 ? 1 : 0), steps: tr.steps.length };
        pos += j - i;
        i = j;
      }
    }
    const ends = emptied.map((e) => tr.mapping.slice(e.steps).map(e.pos)).sort((a, b) => b - a);
    if (caretAt) {
      const pos = tr.mapping.slice(caretAt.steps).map(caretAt.pos);
      try { tr.setSelection(TextSelection.create(tr.doc, pos)); } catch { /* the caret stays where the update put it */ }
    }
    tr.setMeta('addToHistory', false).setMeta(RESCUED, true);

    const c0 = Y.getState(ydoc.store, me);
    editor.view.dispatch(tr);
    // A block an undo kept only for this client's text goes once the text has left it; in
    // a transaction of its own, which y-tiptap writes as that block's removal alone.
    if (ends.length && editor.state.doc === tr.doc) {
      const drop = editor.state.tr;
      for (const pos of ends) dropEmpty(drop, pos);
      if (drop.docChanged) editor.view.dispatch(drop.setMeta('addToHistory', false).setMeta(RESCUED, true));
    }
    const c1 = Y.getState(ydoc.store, me);
    if (c1 === c0) return;
    // The rescued text belongs to the step that typed it, so its writer's undo takes it.
    const added = Y.createDeleteSet();
    added.clients.set(me, [{ clock: c0, len: c1 - c0 } as never]);
    for (const s of um.undoStack) {
      if (!ops.some((op) => op.insert && Y.isDeleted(s.insertions, op.unit.chars[0].item.id))) continue;
      s.insertions = Y.mergeDeleteSets([s.insertions, added]);
      break;
    }
  };

  ydoc.on('afterTransaction', after);
  return () => ydoc.off('afterTransaction', after);
}

// The emptied block at `pos`, with every ancestor it is the only child of, unless that
// would leave a table cell, a list item's parent or the document without it.
function dropEmpty(tr: Transaction, pos: number): void {
  const $pos = tr.doc.resolve(pos);
  if (!$pos.parent.isTextblock || $pos.parent.content.size) return;
  let d = $pos.depth;
  while (d > 1 && $pos.node(d - 1).childCount === 1 && !/^(tableCell|tableHeader|note)$/.test($pos.node(d - 1).type.name)) d--;
  if (d < 1 || $pos.node(d - 1).childCount < 2) return;
  tr.delete($pos.before(d), $pos.after(d));
}
