import type { Fragment, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { AttrStep, type Step } from '@tiptap/pm/transform';
import { IDB_SRC, distanceOf, fetchImagesWith, heldImage, holdImage, imageKey, lackedKeys, mapSrcs, untilHeld } from '../storage/imageStore';
import { bytesToBase64 } from '../import/imageFormats';
import { task } from '../utils/task';

// Pictures in a session: the shared doc names each large one by its content key, `idb:<key>`
// as autosave does, and the bytes go beside it in frames of their own, once to each client.
// Moving, resizing or undoing a picture then sends only its key.

export const PICTURE = 6; // [to, 0 for all][key length][key][head length][head][body]; neither: the sender lacks it
export const WANT = 7;    // [to][from][keys, comma-separated]
export const HAS = 14;    // [to][from][keys]: pictures the sender lacked when the receiver asked, now held
const BATCH_MS = 50;
const STALL_MS = 10_000;  // an ask whose client sends no picture or part this long goes to the next
const MAX_OWED = 256;     // keys whose askers a client remembers lacking, to tell them once it holds one
const PER_PEER = 3;       // pictures asked of one client at a time, nearest the viewport first
const BASE64 = ';base64,';

// A base64 data-URI travels as its head (`data:image/png;base64,`) and its bytes, a quarter
// shorter; any other, or one whose base64 would not come back the same, as its text alone.
function picturePayload(src: string, enc: TextEncoder): [Uint8Array, Uint8Array] {
  const comma = src.indexOf(',') + 1;
  if (src.slice(0, comma).endsWith(BASE64)) {
    try {
      const bytes = fromBase64(src.slice(comma));
      if (bytesToBase64(bytes) === src.slice(comma)) return [enc.encode(src.slice(0, comma)), bytes];
    } catch { /* not base64 after all */ }
  }
  return [new Uint8Array(), enc.encode(src)];
}
function fromBase64(b64: string): Uint8Array {
  const native = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
  if (native) return native(b64);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

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
  /** As `send`, with `done` once the frame left or was dropped. */
  post(done: () => void, kind: number, ...parts: (number | Uint8Array)[]): void;
  /** The others' session ids, as their awareness gives them. */
  peers(): number[];
  /** Whether the relay counts clients in the room that are not known yet. */
  unknown(): boolean;
  /** When the last part of a message from that client came. */
  heard(from: number): number;
  /** Whether a message in parts from that client is on its way in, which may be the picture. */
  incoming(id: number): boolean;
  changed(): void;
  /** A picture came that this client lacked. */
  arrived(key: string): void;
};

export type Pictures = {
  plugin: Plugin;
  /** Takes a PICTURE, WANT or HAS frame from the client `from`; true when it was one. */
  receive(plain: Uint8Array, from: number): boolean;
  /** The others changed: an ask to a client gone goes elsewhere, and one newly known is asked. */
  recheck(): void;
  /** A client the relay says left: a picture sent to all may not have reached it. */
  forget(id: number): void;
  /** This client is on a new line: answers coming on the old one are lost, so every ask goes again. */
  again(): void;
  /** Pictures this client is still sending to someone who asked. */
  serving(): number;
  /** Pictures no one here could send, while everyone in the room is known. */
  missing(): number;
  /** A store's value (a header, a page decoration) with its large pictures named by key and held; `share` sends new ones to all. */
  pack(value: unknown, share: boolean): unknown;
  /** A store's value with the held pictures back in place of their keys; missing ones are asked for. */
  unpack(value: unknown): unknown;
  close(): void;
};

export function sessionPictures(w: Wire): Pictures {
  const enc = new TextEncoder(), dec = new TextDecoder();
  // A lack means "not yet": a picture every known client lacks stays wanted (`short`) and is
  // asked again of a client newly known, or of one that says it holds it now (`HAS`). Asks go
  // round the clients; one whose answer was lost is asked again once the round is through.
  const wants = new Map<string, { tried: Set<number>; lacks: Set<number>; to: number | null; at: number; short: boolean }>();
  const owed = new Map<string, Set<number>>();
  // Pictures on their way to everyone, with the clients there then: their edit may arrive
  // first, and an ask of theirs, to this client or any that got it already, would send the
  // picture twice. Kept STALL_MS after the last part left or came (`until`).
  const sharing = new Map<string, { those: Set<number>; until: number }>();
  // Answers to asks still on their way out: someone loads them from this client. An ask
  // repeated meanwhile, as one gets after hearing nothing, is not answered twice.
  let serving = 0;
  const giving = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watch: ReturnType<typeof setInterval> | undefined;
  const shortOf = () => { let n = 0; for (const x of wants.values()) if (x.short) n++; return n; };
  const missing = () => (w.unknown() ? 0 : shortOf());

  const give = (to: number, key: string) => {
    const k = enc.encode(key), src = heldImage(key);
    const shared = sharing.get(key);
    if (shared && shared.until < Date.now()) sharing.delete(key);
    else if (to && shared?.those.has(to)) return;
    const [head, body] = src ? picturePayload(src, enc) : [new Uint8Array(), new Uint8Array()];
    if (!src && to && (owed.has(key) || owed.size < MAX_OWED)) owed.set(key, (owed.get(key) ?? new Set()).add(to));
    if (to && !src) return w.send(PICTURE, to, k.length, k, head.length, head, body);
    if (to) {
      const id = `${to} ${key}`;
      if (giving.has(id)) return;
      giving.add(id);
      serving++;
      return w.post(() => { serving--; giving.delete(id); }, PICTURE, to, k.length, k, head.length, head, body);
    }
    const entry = { those: new Set(w.peers()), until: Infinity };
    sharing.set(key, entry);
    w.post(() => { entry.until = Date.now() + STALL_MS; }, PICTURE, to, k.length, k, head.length, head, body);
  };
  // Each missing picture is asked of one client at a time, a few per client and those nearest
  // the viewport first; one that arrives makes room for the next.
  const ask = () => {
    timer = undefined;
    const peers = w.peers(), to = new Map<number, string[]>(), load = new Map<number, number>();
    let later = false;
    const before = missing();
    for (const [key, x] of wants) {
      if (heldImage(key)) wants.delete(key);
      else if (x.to !== null) load.set(x.to, (load.get(x.to) ?? 0) + 1);
    }
    const open = [...wants].filter(([, x]) => x.to === null).map(([key, x]) => ({ key, x, far: distanceOf(key) }));
    for (const { key, x } of open.sort((a, b) => a.far - b.far)) {
      let untried = peers.filter((p) => !x.tried.has(p));
      if (!untried.length) {
        x.tried = new Set(x.lacks);
        untried = peers.filter((p) => !x.tried.has(p));
      }
      x.short = !untried.length;
      const next = untried.find((p) => (load.get(p) ?? 0) < PER_PEER);
      if (next === undefined) continue;
      // A picture sent to all overtaken by its edit is still coming in; asking would get it twice.
      if (w.incoming(next)) { later = true; continue; }
      load.set(next, (load.get(next) ?? 0) + 1);
      x.tried.add(next);
      x.to = next;
      x.at = Date.now();
      to.set(next, [...(to.get(next) ?? []), key]);
    }
    for (const [id, keys] of to) w.send(WANT, id, w.me, enc.encode(keys.join(',')));
    if (later) soon();
    if (missing() !== before) w.changed();
    if ([...wants.values()].some((x) => x.to !== null)) watch ??= setInterval(recheck, 1000);
    else { clearInterval(watch); watch = undefined; }
  };
  const soon = () => { timer ??= setTimeout(ask, BATCH_MS); };
  // When a picture last came from each client, which shows its answers are moving.
  const came = new Map<number, number>();
  const recheck = () => {
    const peers = new Set(w.peers());
    for (const x of wants.values()) {
      if (x.to !== null && (!peers.has(x.to) || Date.now() - Math.max(x.at, w.heard(x.to), came.get(x.to) ?? 0) > STALL_MS)) x.to = null;
    }
    if ([...wants.values()].some((x) => x.to === null)) soon();
  };
  const want = (key: string) => {
    if (heldImage(key) || wants.has(key)) return;
    wants.set(key, { tried: new Set(), lacks: new Set(), to: null, at: 0, short: false });
    soon();
  };
  fetchImagesWith(want);
  // Scrolling elsewhere changes which pictures come next.
  const scrolled = () => { if ([...wants.values()].some((x) => x.to === null && !x.short)) soon(); };
  if (typeof document !== 'undefined') document.addEventListener('scroll', scrolled, { capture: true, passive: true });

  // A copy or cut naming a picture still on its way goes to the clipboard once it is here.
  const clip = (view: EditorView, e: Event, cut: boolean) => {
    const slice = view.state.selection.content();
    const keys = lackedKeys(slice.content.toJSON());
    if (!keys.length || typeof ClipboardItem === 'undefined') return false;
    e.preventDefault();
    if (cut && view.editable) view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'));
    void untilHeld(keys, () => keys.some((k) => wants.get(k)?.short)).then(async (ok) => {
      if (!ok) return;
      const { dom, text } = view.serializeForClipboard(slice);
      const blob = (s: string, type: string) => new Blob([s], { type });
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob(dom.innerHTML, 'text/html'), 'text/plain': blob(text, 'text/plain') })]);
    }).catch(() => {});
    return true;
  };

  // A picture put in during the session (inserted, pasted, a document opened) is named by its
  // key in the same dispatch, before the sync plugin writes the doc; a new one goes to all.
  const plugin = new Plugin({
    key: picturesKey,
    props: { handleDOMEvents: { copy: (view, e) => clip(view, e, false), cut: (view, e) => clip(view, e, true) } },
    appendTransaction: (trs, _old, state) => {
      if (!trs.some((t) => t.steps.some(stepBrings))) return null;
      return keyed(state, (key) => task(() => give(0, key)));
    },
  });

  return {
    plugin,
    receive(plain, from) {
      const v = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
      if (plain[0] === PICTURE) {
        came.set(from, Date.now());
        const n = v.getUint32(5), key = dec.decode(plain.subarray(9, 9 + n));
        const h = v.getUint32(9 + n), head = plain.subarray(13 + n, 13 + n + h), body = plain.subarray(13 + n + h);
        if (h || body.length) {
          const src = h ? dec.decode(head) + bytesToBase64(body) : dec.decode(body);
          // Any client may send it, so it is taken only under its own key.
          if (imageKey(src) === key && holdImage(key, src)) {
            // One sent to all reaches the others here too: an ask of theirs is not answered.
            if (!v.getUint32(1)) sharing.set(key, { those: new Set(w.peers().filter((p) => p !== from)), until: Date.now() + STALL_MS });
            const before = missing();
            if (wants.delete(key)) soon();
            if (missing() !== before) w.changed();
            w.arrived(key);
            // Those that asked while this client lacked it hear it holds it now.
            for (const p of owed.get(key) ?? []) w.send(HAS, p, w.me, enc.encode(key));
            owed.delete(key);
          }
        } else if (v.getUint32(1) === w.me && wants.get(key)?.to === from) {
          const x = wants.get(key)!;
          x.lacks.add(from);
          x.to = null;
          soon();
        }
        return true;
      }
      if (plain[0] === HAS) {
        if (v.getUint32(1) !== w.me) return true;
        for (const key of dec.decode(plain.subarray(9)).split(',')) {
          const x = wants.get(key);
          x?.lacks.delete(from);
          if (x?.tried.delete(from) && x.to === null) soon();
        }
        return true;
      }
      if (plain[0] !== WANT) return false;
      // Each key once: a frame naming one picture many times would send it as often. One
      // picture per task, so answering many keeps the page responsive, also in a hidden tab.
      const asker = v.getUint32(5);
      if (v.getUint32(1) === w.me) for (const key of new Set(dec.decode(plain.subarray(9)).split(','))) task(() => give(asker, key));
      return true;
    },
    recheck,
    forget: (id) => { for (const x of sharing.values()) x.those.delete(id); came.delete(id); },
    again: () => {
      for (const x of wants.values()) x.to = null;
      if (wants.size) soon();
    },
    serving: () => serving,
    missing,
    pack: (value, share) => mapSrcs(value, (src) => {
      const key = imageKey(src);
      if (!key) return src;
      if (holdImage(key, src) && share) task(() => give(0, key));
      return IDB_SRC + key;
    }),
    unpack: (value) => mapSrcs(value, (src) => {
      if (!src.startsWith(IDB_SRC)) return src;
      const key = src.slice(IDB_SRC.length), data = heldImage(key);
      if (!data) want(key);
      return data ?? src;
    }),
    close() {
      clearTimeout(timer);
      clearInterval(watch);
      if (typeof document !== 'undefined') document.removeEventListener('scroll', scrolled, { capture: true });
      wants.clear();
      owed.clear();
      giving.clear();
      came.clear();
      sharing.clear();
      fetchImagesWith(null);
    },
  };
}
