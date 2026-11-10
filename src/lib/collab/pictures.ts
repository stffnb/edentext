import type { Fragment, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { AttrStep, type Step } from '@tiptap/pm/transform';
import { IDB_SRC, fetchImagesWith, heldImage, holdImage, imageKey } from '../storage/imageStore';

// Pictures in a session: the shared doc names each large one by its content key, `idb:<key>`
// as autosave does, and the bytes go beside it in frames of their own, once to each client.
// Moving, resizing or undoing a picture then sends only its key.

export const PICTURE = 6; // [to, 0 for all][key length][key][data-URI]; without data the sender lacks it
export const WANT = 7;    // [to][from][keys, comma-separated]
const BATCH_MS = 50;
const STALL_MS = 10_000;  // an ask that hears nothing this long goes to the next client

export const picturesKey = new PluginKey('sessionPictures');

// Every large picture of the doc held and named by its key; null when there is none.
function keyed(state: EditorState, fresh?: (key: string) => void): Transaction | null {
  const tr = state.tr;
  state.doc.descendants((n, pos) => {
    const key = imageKey(n.attrs.src);
    if (!key) return;
    if (holdImage(key, n.attrs.src as string)) fresh?.(key);
    tr.setNodeAttribute(pos, 'src', IDB_SRC + key);
  });
  return tr.docChanged ? tr : null;
}

/** Holds the document's pictures; the transaction names them by key, outside the history. */
export const keyPictures = (state: EditorState) => keyed(state)?.setMeta('addToHistory', false) ?? null;

/** The held pictures back in place of their keys, outside the history: the session is over. */
export function unkeyPictures(state: EditorState): Transaction | null {
  const tr = state.tr;
  state.doc.descendants((n, pos) => {
    const src = n.attrs.src;
    const data = typeof src === 'string' && src.startsWith(IDB_SRC) && heldImage(src.slice(IDB_SRC.length));
    if (data) tr.setNodeAttribute(pos, 'src', data);
  });
  return tr.docChanged ? tr.setMeta('addToHistory', false) : null;
}

const bringsPicture = (content: Fragment) => {
  let found = false;
  content.descendants((n) => { found ||= imageKey(n.attrs.src) !== null; return !found; });
  return found;
};
const stepBrings = (s: Step) => {
  if (s instanceof AttrStep) return s.attr === 'src' && imageKey(s.value) !== null;
  const slice = (s as { slice?: Slice }).slice;
  return !!slice && bringsPicture(slice.content);
};

type Wire = {
  me: number;
  send(kind: number, ...parts: (number | Uint8Array)[]): void;
  /** The others' session ids, as their awareness gives them. */
  peers(): number[];
  heard(): number;
  changed(): void;
};

export type Pictures = {
  plugin: Plugin;
  /** Takes a PICTURE or a WANT frame; true when it was one. */
  receive(plain: Uint8Array): boolean;
  /** The others changed: an ask to a client gone goes elsewhere. */
  recheck(): void;
  /** Someone came: pictures nobody had are asked for again. */
  retry(): void;
  /** Pictures no one here could send. */
  missing(): number;
  close(): void;
};

export function sessionPictures(w: Wire): Pictures {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const wants = new Map<string, { tried: Set<number>; to: number | null; at: number }>();
  const lost = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watch: ReturnType<typeof setInterval> | undefined;

  const give = (to: number, key: string) => {
    const k = enc.encode(key), src = heldImage(key);
    w.send(PICTURE, to, k.length, k, src ? enc.encode(src) : new Uint8Array());
  };
  // Each missing picture is asked of one client at a time, all keys for it in one frame.
  const ask = () => {
    timer = undefined;
    const peers = w.peers(), to = new Map<number, string[]>();
    const lostBefore = lost.size;
    for (const [key, x] of wants) {
      if (heldImage(key)) { wants.delete(key); continue; }
      if (x.to !== null) continue;
      const next = peers.find((p) => !x.tried.has(p));
      // Nobody known yet waits for the others' awareness; everyone asked, it is lost.
      if (next === undefined && !peers.length && !x.tried.size) continue;
      if (next === undefined) { wants.delete(key); lost.add(key); continue; }
      x.tried.add(next);
      x.to = next;
      x.at = Date.now();
      to.set(next, [...(to.get(next) ?? []), key]);
    }
    for (const [id, keys] of to) w.send(WANT, id, w.me, enc.encode(keys.join(',')));
    if (lost.size !== lostBefore) w.changed();
    if (wants.size) watch ??= setInterval(recheck, 1000);
    else { clearInterval(watch); watch = undefined; }
  };
  const soon = () => { timer ??= setTimeout(ask, BATCH_MS); };
  const recheck = () => {
    const peers = new Set(w.peers());
    for (const x of wants.values()) {
      if (x.to !== null && (!peers.has(x.to) || Date.now() - Math.max(x.at, w.heard()) > STALL_MS)) x.to = null;
    }
    if ([...wants.values()].some((x) => x.to === null)) soon();
  };
  fetchImagesWith((key) => {
    if (heldImage(key) || wants.has(key) || lost.has(key)) return;
    wants.set(key, { tried: new Set(), to: null, at: 0 });
    soon();
  });

  // A picture put in during the session (inserted, pasted, a document opened) is named by its
  // key in the same dispatch, before the sync plugin writes the doc; a new one goes to all.
  const plugin = new Plugin({
    key: picturesKey,
    appendTransaction: (trs, _old, state) => {
      if (!trs.some((t) => t.steps.some(stepBrings))) return null;
      return keyed(state, (key) => setTimeout(() => give(0, key)));
    },
  });

  return {
    plugin,
    receive(plain) {
      const v = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
      if (plain[0] === PICTURE) {
        const n = v.getUint32(5), key = dec.decode(plain.subarray(9, 9 + n)), data = plain.subarray(9 + n);
        if (data.length) {
          const src = dec.decode(data);
          // Any client may send it, so it is taken only under its own key.
          if (imageKey(src) === key && holdImage(key, src)) {
            wants.delete(key);
            if (lost.delete(key)) w.changed();
          }
        } else if (v.getUint32(1) === w.me && wants.has(key)) {
          wants.get(key)!.to = null;
          soon();
        }
        return true;
      }
      if (plain[0] !== WANT) return false;
      if (v.getUint32(1) === w.me) for (const key of dec.decode(plain.subarray(9)).split(',')) give(v.getUint32(5), key);
      return true;
    },
    recheck,
    retry() {
      if (!lost.size) return;
      for (const key of lost) wants.set(key, { tried: new Set(), to: null, at: 0 });
      lost.clear();
      w.changed();
      soon();
    },
    missing: () => lost.size,
    close() {
      clearTimeout(timer);
      clearInterval(watch);
      wants.clear();
      lost.clear();
      fetchImagesWith(null);
    },
  };
}
