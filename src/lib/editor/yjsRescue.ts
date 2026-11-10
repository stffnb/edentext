import type { Editor } from '@tiptap/core';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import type { Mark } from '@tiptap/pm/model';
import * as Y from 'yjs';
import { relativePositionToAbsolutePosition } from '@tiptap/y-tiptap';
import type { Binding } from './yjsRepair';

// Text typed into a block another client rebuilt elsewhere (heading, join, move, merged
// cell, split) follows it, as the rebuild copies only the text its author saw. Only the
// text's author moves it, so nothing races. collab-conflicts.md, "Rescue".

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
function unitsOf(text: Y.XmlText, me: number, t: Y.Transaction, isNew: (it: Y.Item) => boolean, foreign: (it: Y.Item) => boolean): Unit[] {
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
    for (let i = 0; i < str.length; i++) all.push({ ch: str[i], clock: it.id.clock + i, item: it, attrs, own: !foreign(it), live: !it.deleted });
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
    // Left behind: both sides went and the run stayed, unknown to the update that moved them.
    // At the text's edge one side will do where that update rewrote the text in place (a
    // sort) or another's block lost all but this run (its undo kept the block for it).
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
  // A rebuild copies the text around the run: each side matches whole, or up to where the new
  // text starts or ends (a cut). A replacement's text matches by chance and only in part.
  const run = textOf(u.chars);
  const needL = u.left.length - (u.left.startsWith(START) ? 1 : 0);
  const needR = u.right.length - (u.right.endsWith(END) ? 1 : 0);
  const least = Math.max(1, Math.min(needL + needR, 8));
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
      const wholeL = l >= needL, wholeR = r >= needR;
      if (!(wholeL || s[e - 1 - l] === START) || !(wholeR || s[e + k + r] === END) || (!wholeL && !wholeR)) continue;
      const score = Math.min(l, needL) + Math.min(r, needR);
      if (score < least || (best && score <= best.score)) continue;
      let any = false;
      for (let i = e - l; i < e + k + r && !any; i++) any = fresh[i];
      if (any) best = { text, offset: e - 1, skip: k, score };
    }
  }
  return best;
}

const markName = (key: string) => key.replace(/--[a-zA-Z0-9+/=]{8}$/, '');

type Plan = { unit: Unit; text: Y.XmlText; at: Y.RelativePosition; side?: 'after' | 'before'; caret: number | null; assoc: number };

// `foreign`: whose text a character is, an undo's restored copy counting as its author's.
export function attachRescue(editor: Editor, ydoc: Y.Doc, binding: Binding, um: Y.UndoManager,
  foreign = (it: Y.Item) => it.id.client !== ydoc.clientID): () => void {
  const frag = binding.type;
  // A text's characters are one run in the document, so a place in it is its start plus the
  // index; y-tiptap's own reading of a character's position second-guesses a moved one.
  const absolute = (text: Y.XmlText, index: number) => {
    const start = relativePositionToAbsolutePosition(ydoc, frag, Y.createRelativePositionFromTypeIndex(text, 0, 0), binding.mapping);
    return start === null ? null : start + index;
  };

  let queue: Plan[] = [];
  let scheduled = false, destroyed = false;
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
    const units = [...texts].flatMap((text) => unitsOf(text, me, t, isNew, foreign));
    if (!units.length) return;
    const sites = sitesOf(ydoc, t, me, isNew);
    if (!sites.size) return;
    // The caret in a moved run moves with it.
    const head = binding.beforeTransactionSelection?.head;
    const caret = head?.item && head.item.client === me ? head.item.clock : null;
    for (const u of units) {
      const place = placeOf(u, sites);
      if (!place || place.skip === u.chars.length) continue;
      const at = Y.createRelativePositionFromTypeIndex(place.text, place.offset + place.skip);
      queue.push({ unit: { ...u, chars: u.chars.slice(place.skip) }, text: place.text, at, side: place.side, caret, assoc: head?.assoc ?? 0 });
    }
    // After the repairer writes this update's repairs (a microtask its observers queued
    // first; elsewhere they stay an overlay the write leaves out): the rescue goes alone.
    if (queue.length && !scheduled) { scheduled = true; queueMicrotask(flush); }
  };

  // Not while an input method composes: moving text around its caret would break it.
  const flush = () => {
    scheduled = false;
    if (destroyed || !binding.prosemirrorView) { queue = []; return; }
    if (editor.view.composing) return;
    const plans = queue;
    queue = [];
    for (const p of plans) apply(p);
  };
  const composed = () => {
    if (queue.length && !scheduled) { scheduled = true; setTimeout(flush, 50); }
  };

  const apply = (p: Plan) => {
    const u = p.unit, schema = editor.state.schema;
    if (p.text._item?.deleted) return;
    const abs = Y.createAbsolutePositionFromRelativePosition(p.at, ydoc);
    if (!abs || abs.type !== p.text) return;
    let pos = absolute(p.text, abs.index);
    if (pos === null) return;
    if (p.side) {
      const $at = editor.state.doc.resolve(pos);
      if (!$at.parent.isTextblock || !schema.nodes[u.block!.name]) return;
      pos = p.side === 'after' ? $at.after() : $at.before();
    }
    // Each part goes in with the undo step that typed it, in a transaction of its own.
    const steps = u.chars.map((c) => um.undoStack.find((s) => Y.isDeleted(s.insertions, Y.createID(c.item.id.client, c.clock))));
    // The run left behind, read before the copy goes in: y-tiptap may write the copy's
    // paragraph anew, and the run's own text then no longer resolves.
    let from = -1;
    if (!u.lost) {
      const at = absolute(u.text, liveIndex(u.text, u.chars[0]));
      if (at === null || editor.state.doc.textBetween(at, at + u.chars.length) !== textOf(u.chars)) return;
      from = at;
    }
    let block = p.side && u.block!.name;
    for (let i = 0; i < u.chars.length;) {
      let j = i;
      while (j < u.chars.length && steps[j] === steps[i]) j++;
      const part = u.chars.slice(i, j);
      const tr = editor.state.tr;
      let at: number = pos;
      if (block) { tr.insert(at, schema.nodes[block].create()); at += 1; }
      for (let a = 0; a < part.length;) {
        let b = a;
        while (b < part.length && part[b].attrs === part[a].attrs) b++;
        const marks = Object.entries(part[a].attrs).flatMap(([k, v]) => {
          const type = schema.marks[markName(k)];
          return type ? [type.create(v as Record<string, unknown>)] : [] as Mark[];
        });
        tr.insert(at + a, schema.text(textOf(part.slice(a, b)), marks));
        a = b;
      }
      const hit = p.caret === null ? -1 : part.findIndex((c) => c.clock === p.caret);
      if (hit >= 0) {
        try { tr.setSelection(TextSelection.create(tr.doc, at + hit + (p.assoc < 0 ? 1 : 0))); } catch { /* the caret stays where the update put it */ }
      }
      const me = ydoc.clientID, c0 = Y.getState(ydoc.store, me);
      editor.view.dispatch(tr.setMeta('addToHistory', false).setMeta(RESCUED, true));
      if (from >= 0) from = tr.mapping.map(from);
      if (editor.state.doc.textBetween(at, at + part.length) !== textOf(part)) return;
      if (steps[i]) joinStep(steps[i]!, me, c0, block ? null : p.text);
      pos = at + part.length;
      block = undefined;
      i = j;
    }
    if (u.lost) return;
    // The run left behind goes; a block an undo kept only for it goes too, in a transaction
    // of its own, which y-tiptap writes as that block's removal alone.
    if (editor.state.doc.textBetween(from, from + u.chars.length) !== textOf(u.chars)) return;
    const del = editor.state.tr.delete(from, from + u.chars.length);
    editor.view.dispatch(del.setMeta('addToHistory', false).setMeta(RESCUED, true));
    if (!u.abandoned || editor.state.doc !== del.doc) return;
    const drop = editor.state.tr;
    dropEmpty(drop, from);
    if (drop.docChanged) editor.view.dispatch(drop.setMeta('addToHistory', false).setMeta(RESCUED, true));
  };

  // What the rescue wrote since `c0` joins the step: the text it put into `text`, or the
  // block it made with everything in it. Nothing else the transaction wrote does.
  const joinStep = (step: Y.UndoManager['undoStack'][number], me: number, c0: number, text: Y.XmlText | null) => {
    const structs = ydoc.store.clients.get(me);
    if (!structs || Y.getState(ydoc.store, me) === c0) return;
    const ranges: { clock: number; len: number }[] = [];
    let root: Y.AbstractType<any> | null = text;
    for (let i = Y.findIndexSS(structs, c0); i < structs.length; i++) {
      const s = structs[i];
      if (!(s instanceof Y.Item)) continue;
      if (!root && s.content instanceof Y.ContentType && s.content.type instanceof Y.XmlElement) root = s.content.type;
      let inside = s.content instanceof Y.ContentType && s.content.type === root;
      for (let t = s.parent as Y.AbstractType<any> | null; t && !inside; t = t._item?.parent as Y.AbstractType<any> | null) inside = t === root;
      // Yjs may have merged the new characters into an item written before `c0`.
      const clock = Math.max(s.id.clock, c0);
      if (inside) ranges.push({ clock, len: s.id.clock + s.length - clock });
    }
    if (!ranges.length) return;
    const added = Y.createDeleteSet();
    added.clients.set(me, ranges as never);
    step.insertions = Y.mergeDeleteSets([step.insertions, added]);
  };

  const dom = editor.view.dom;
  ydoc.on('afterTransaction', after);
  dom.addEventListener('compositionend', composed);
  return () => {
    destroyed = true;
    ydoc.off('afterTransaction', after);
    dom.removeEventListener('compositionend', composed);
  };
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
