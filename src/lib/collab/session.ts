import type { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { yCursorPlugin, yCursorPluginKey } from '@tiptap/y-tiptap';
import { attachYjsUndo, type YjsUndo } from '../editor/undoYjs';
import { openChannel, type ChannelStatus } from './channel';
import { keyBytes, newKey, sessionLink } from './key';
import { shareZones } from './zones.svelte';
import { keyPictures, picturesKey, sessionPictures, unkeyPictures } from './pictures';

// A shared session: the Yjs doc behind the body (`undoYjs.ts`) goes over a sealed channel
// to the others in the room. Frames are one kind byte and its payload; the relay sees none
// of it. Edits leave and arrive in batches of 50 ms, always as a task of their own.
// Ids are random per session; frames with a `to` that is not this client are ignored.

const ASK = 0;      // [from]: everyone offers what they have
const UPDATE = 1;   // a Yjs update for everyone
const PRESENCE = 2; // an awareness update (name, colour, cursor)
const OFFER = 3;    // [to][from][length][state vector][delete set as an update]
const PULL = 4;     // [to][from][state vector]: the receiver answers with what it lacks
const ANSWER = 5;   // [to][Yjs update]
// PICTURE and WANT carry the pictures the doc names by key (`pictures.ts`).
const BATCH_MS = 50;
const SETTLE_MS = 300;  // how long a sync waits for late offers after the first
const STALL_MS = 10_000; // a sync that hears nothing this long starts over
const EMPTY_MS = 5000;   // a joiner alone this long is told the room is empty
const REMOTE = Symbol('remote');

export type SessionStatus =
  | 'connecting'   // no line to the relay yet
  | 'waiting'      // joined, but nobody with the document is there
  | 'empty'        // still nobody there after EMPTY_MS: the session has ended
  | 'live'
  | 'version'      // the others run another EdenText version
  | 'full'
  | 'unreachable'
  | 'failing'      // the line keeps breaking off
  | 'invalid'      // the link's key is cut short or mistyped
  | 'closed';

/** `keeps`: this client stores the document (the starter); a joiner holds it in its tab only. */
export type Peer = { id: number; name: string; color: string; keeps: boolean };

/** `missing`: pictures no one here could send, shown as grey boxes. */
export type SessionView = { status: SessionStatus; peers: Peer[]; link: string; keeps: boolean; kept: boolean; missing: number };

/** What the session needs from the app. */
export type SessionHost = {
  relay: string;
  /** The open document as a file: the start every joiner loads. */
  snapshot(): Promise<Uint8Array>;
  /** Loads a start file as the open document, unasked, under the starter's name for it. */
  load(bytes: Uint8Array, name: string): Promise<boolean>;
  /** The open document's name, which a joiner's copy takes. */
  name(): string;
  user(): { name: string; color: string };
  onChange(view: SessionView): void;
};

export type Session = {
  link: string;
  awareness: Awareness;
  leave(): void;
  /** Frames sent per kind, for the tests' idle check. */
  stats: { sent: number[] };
};

type Join = () => Promise<YjsUndo | 'version' | null>;

function frame(kind: number, ...parts: (number | Uint8Array)[]): Uint8Array {
  const out = new Uint8Array(1 + parts.reduce<number>((n, p) => n + (typeof p === 'number' ? 4 : p.length), 0));
  const v = new DataView(out.buffer);
  out[0] = kind;
  let at = 1;
  for (const p of parts) {
    if (typeof p === 'number') { v.setUint32(at, p); at += 4; } else { out.set(p, at); at += p.length; }
  }
  return out;
}

function connect(editor: Editor, key: string, host: SessionHost, ydoc: Y.Doc, bound: YjsUndo | null, join: Join | null): Session {
  const awareness = new Awareness(ydoc);
  const link = sessionLink(key);
  const stats = { sent: [0, 0, 0, 0, 0, 0, 0, 0] };
  // Never 0, the PICTURE frame's address for everyone.
  const me = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  let line: ChannelStatus = 'connecting';
  let status: SessionStatus = 'connecting';
  let peerCount = 1;
  let binding: YjsUndo | null = null;
  let joining = join;
  // The others' carets and selections, drawn as decorations in their colours, and the
  // pictures put in from now on; one registration, as each rebuilds every plugin view.
  const bind = (b: YjsUndo) => {
    binding = b;
    editor.registerPlugin(yCursorPlugin(awareness), (p, plugins) => [...plugins, p, pictures.plugin]);
  };

  const keeps = !join;
  const peers = (): Peer[] => [...awareness.getStates()].filter(([id, s]) => id !== ydoc.clientID && s.user)
    .map(([id, s]) => ({ id, name: String(s.user.name ?? ''), color: String(s.user.color ?? ''), keeps: s.keeps === true }));
  const changed = () => {
    const all = peers();
    host.onChange({ status, peers: all, link, keeps, kept: keeps || all.some((p) => p.keeps), missing: pictures.missing() });
  };
  // Waiting turns into `empty` after EMPTY_MS and stays so until someone comes.
  let emptyTimer: ReturnType<typeof setTimeout> | undefined;
  const setStatus = (s: SessionStatus) => {
    if (s === 'waiting' && status === 'empty') return;
    if (s === 'waiting') emptyTimer ??= setTimeout(() => { if (status === 'waiting') { status = 'empty'; changed(); } }, EMPTY_MS);
    else { clearTimeout(emptyTimer); emptyTimer = undefined; }
    if (status !== s) { status = s; changed(); }
  };

  const settled = (): SessionStatus => binding ? 'live' : peerCount <= 1 ? 'waiting' : 'connecting';

  const send = (kind: number, ...parts: (number | Uint8Array)[]) => { stats.sent[kind]++; channel.send(frame(kind, ...parts)); };
  const present = () => send(PRESENCE, encodeAwarenessUpdate(awareness, [ydoc.clientID]));
  const pictures = sessionPictures({
    me, send, heard: () => channel.heard(), changed: () => changed(),
    peers: () => [...awareness.getStates()].filter(([id, s]) => id !== ydoc.clientID && typeof s.peer === 'number').map(([, s]) => s.peer as number),
  });

  // Outgoing: this client's own updates, merged per batch.
  let out: Uint8Array[] = [];
  let outTimer: ReturnType<typeof setTimeout> | undefined;
  const onUpdate = (u: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return;
    out.push(u);
    outTimer ??= setTimeout(() => {
      outTimer = undefined;
      const merged = Y.mergeUpdates(out);
      out = [];
      send(UPDATE, merged);
    }, BATCH_MS);
  };
  ydoc.on('update', onUpdate);
  type Change = { added: number[]; updated: number[]; removed: number[] };
  const onPresence = ({ added, updated, removed }: Change, origin: unknown) => {
    if (origin === 'local') send(PRESENCE, encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]));
    if (added.length || removed.length) pictures.recheck();
    changed();
  };
  awareness.on('update', onPresence);

  // Incoming updates gather for a batch and apply as one Yjs transaction. A joiner binds
  // the editor once the doc it received carries a start file.
  let inbox: Uint8Array[] = [];
  let inTimer: ReturnType<typeof setTimeout> | undefined;
  let answered = false;
  const receive = (u: Uint8Array) => { inbox.push(u.slice()); inTimer ??= setTimeout(flush, BATCH_MS); };
  // Before telling others what this client has, what already arrived goes in.
  const applyInbox = () => {
    if (!inbox.length) return;
    const merged = Y.mergeUpdates(inbox);
    inbox = [];
    Y.applyUpdate(ydoc, merged, REMOTE);
  };
  const flush = async () => {
    inTimer = undefined;
    applyInbox();
    if (answered) { answered = false; if (round) { round.target = null; pull(); } }
    if (joining && ydoc.getMap('meta').has('snapshot')) {
      const done = joining;
      joining = null;
      const got = await done();
      if (got === 'version') return setStatus('version');
      if (!got) return setStatus('closed');
      bind(got);
    }
    if (binding && line === 'open') setStatus('live');
  };

  // A sync, once per welcome: this client asks, everyone offers its state vector and delete
  // set, it sends what the others lack in one update and pulls what it lacks from the one
  // offer that has the most, then from any that still has more. One copy of the doc travels.
  // An offer after the settle is still pulled from, and gets what it lacks once all is in.
  type Round = {
    offers: Map<number, Map<number, number>>; pulled: Set<number>; late: Set<number>; target: number | null;
    done: boolean; over: boolean; at: number; settle?: ReturnType<typeof setTimeout>; watch?: ReturnType<typeof setInterval>;
  };
  let round: Round | null = null;
  const endRound = () => {
    clearTimeout(round?.settle);
    clearInterval(round?.watch);
    round = null;
  };
  const startRound = () => {
    endRound();
    if (peerCount <= 1) return;
    const r: Round = round = { offers: new Map(), pulled: new Set(), late: new Set(), target: null, done: false, over: false, at: Date.now() };
    r.watch = setInterval(() => { if (!r.over && Date.now() - Math.max(r.at, channel.heard()) > STALL_MS) startRound(); }, 1000);
    send(ASK, me);
  };
  // One update with what the lowest of these offers lacks. An empty offer is a joiner,
  // which pulls the doc itself, so it would only send everyone a second copy.
  const give = (from: Iterable<number>) => {
    const svs = [...from].map((id) => round?.offers.get(id)).filter((sv) => sv?.size) as Map<number, number>[];
    if (!svs.length || !ydoc.store.clients.size) return;
    const least = new Map<number, number>();
    for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVector(ydoc))) {
      least.set(client, Math.min(clock, ...svs.map((sv) => sv.get(client) ?? 0)));
    }
    send(UPDATE, Y.encodeStateAsUpdate(ydoc, Y.encodeStateVector(least)));
  };
  const settle = () => {
    if (!round || round.done) return;
    round.done = true;
    clearTimeout(round.settle);
    give(round.offers.keys());
    pull();
  };
  const pull = () => {
    if (!round?.done || round.target !== null) return;
    const mine = Y.decodeStateVector(Y.encodeStateVector(ydoc));
    let best: number | null = null, most = 0;
    for (const [from, sv] of round.offers) {
      if (round.pulled.has(from)) continue;
      let more = 0;
      for (const [client, clock] of sv) more += Math.max(0, clock - (mine.get(client) ?? 0));
      if (more > most) { most = more; best = from; }
    }
    if (best === null) {
      round.over = true;
      give(round.late);
      round.late.clear();
      return;
    }
    round.over = false;
    round.pulled.add(best);
    round.target = best;
    round.at = Date.now();
    send(PULL, best, me, Y.encodeStateVector(ydoc));
  };

  const channel = openChannel({
    url: host.relay, key: keyBytes(key)!,
    onFrame(plain) {
      if (status === 'version') return;
      const kind = plain[0], v = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
      if (kind === UPDATE) receive(plain.subarray(1));
      else if (pictures.receive(plain)) return;
      else if (kind === PRESENCE) applyAwarenessUpdate(awareness, plain.subarray(1), REMOTE);
      else if (kind === ASK) {
        applyInbox();
        const sv = Y.encodeStateVector(ydoc);
        send(OFFER, v.getUint32(1), me, sv.length, sv, Y.encodeStateAsUpdate(ydoc, sv));
      } else if (v.getUint32(1) !== me) return;
      else if (kind === OFFER && round) {
        const from = v.getUint32(5), n = v.getUint32(9);
        round.offers.set(from, Y.decodeStateVector(plain.subarray(13, 13 + n)));
        receive(plain.subarray(13 + n));
        if (round.done) { round.late.add(from); pull(); }
        else if (round.offers.size >= peerCount - 1) settle();
        else round.settle ??= setTimeout(settle, SETTLE_MS);
      } else if (kind === PULL) {
        applyInbox();
        send(ANSWER, v.getUint32(5), Y.encodeStateAsUpdate(ydoc, plain.subarray(9)));
      } else if (kind === ANSWER) {
        answered = true;
        receive(plain.subarray(5));
      }
    },
    onPeers(n) {
      // Someone came: tell them who we are; their sync sends them what they lack, and a
      // client still without the doc asks them. Someone left: a sync still waiting on
      // offers or an answer starts over with the rest, as others' traffic hides the stall.
      const came = n > peerCount, left = n < peerCount;
      if (came) { present(); pictures.retry(); }
      peerCount = n;
      if (left ? round && !round.over : came && joining && (!round || round.over)) startRound();
      if (line === 'open' && status !== 'version') setStatus(settled());
      changed();
    },
    onStatus(s: ChannelStatus) {
      line = s;
      // A sync needs an open line; the next welcome starts a new one.
      if (s !== 'open') endRound();
      if (status === 'version') return;
      setStatus(s === 'open' ? settled() : s);
    },
    onOpen(n) {
      peerCount = n;
      present();
      startRound();
    },
  });

  awareness.setLocalStateField('user', host.user());
  awareness.setLocalStateField('peer', me);
  const unshareZones = shareZones(awareness);
  if (keeps) awareness.setLocalStateField('keeps', true);
  if (bound) bind(bound);

  // Leaving tells the others at once; a closed tab drops out after awareness's timeout.
  const goodbye = () => {
    removeAwarenessStates(awareness, [ydoc.clientID], 'leave');
    send(PRESENCE, encodeAwarenessUpdate(awareness, [ydoc.clientID]));
  };
  addEventListener('pagehide', goodbye);

  return {
    link, awareness, stats,
    leave() {
      removeEventListener('pagehide', goodbye);
      clearTimeout(outTimer);
      clearTimeout(inTimer);
      clearTimeout(emptyTimer);
      endRound();
      goodbye();
      channel.close();
      awareness.off('update', onPresence);
      unshareZones();
      awareness.destroy();
      ydoc.off('update', onUpdate);
      if (binding) editor.unregisterPlugin([yCursorPluginKey, picturesKey]);
      binding?.detach();
      // Alone again, the document holds its pictures itself.
      const tr = binding && unkeyPictures(editor.state);
      if (tr) editor.view.dispatch(tr);
      pictures.close();
      binding = null;
      status = 'closed';
      changed();
    },
  };
}

/** Shares the open document: its file goes along as the start, the body as the Yjs doc. */
export async function startSession(editor: Editor, host: SessionHost): Promise<Session> {
  const ydoc = new Y.Doc();
  const meta = ydoc.getMap('meta');
  meta.set('snapshot', await host.snapshot());
  meta.set('version', __APP_VERSION__);
  meta.set('name', host.name());
  // The start file carries the pictures; the shared doc names them by key.
  const keyed = keyPictures(editor.state);
  if (keyed) editor.view.dispatch(keyed);
  return connect(editor, newKey(), host, ydoc, attachYjsUndo(editor, ydoc), null);
}

/**
 * Joins the session of `key`: once someone in the room has sent the doc, its start file
 * is loaded, the body bound to the Yjs doc and every store changed since put into effect.
 */
export function joinSession(editor: Editor, key: string, host: SessionHost): Session {
  const ydoc = new Y.Doc();
  return connect(editor, key, host, ydoc, null, async () => {
    const meta = ydoc.getMap('meta');
    if (meta.get('version') !== __APP_VERSION__) return 'version';
    if (!(await host.load(meta.get('snapshot') as Uint8Array, String(meta.get('name') ?? '')))) return null;
    // The start file's pictures are held, under the keys the shared doc names them by.
    keyPictures(editor.state);
    const binding = attachYjsUndo(editor, ydoc);
    binding.applyState();
    return binding;
  });
}
