import type { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { yCursorPlugin, yCursorPluginKey } from '@tiptap/y-tiptap';
import { attachYjsUndo, type StoreCodec, type YjsUndo } from '../editor/undoYjs';
import { openChannel, type ChannelStatus } from './channel';
import { newKey, opened, sessionLink, signed, viewLink, writeKeys, type SessionKeys } from './key';
import { readOnlyFilter, readingKey, setReading } from './reading.svelte';
import { shareZones } from './zones.svelte';
import { HAS, PICTURE, WANT, keyPictures, picturesKey, sessionPictures, unkeyPictures } from './pictures';
import { IDB_SRC } from '../storage/imageStore';
import { cleanColor, shownName } from './names';
import { caretsKey, caretsPlugin } from './carets';

// A shared session: the Yjs doc behind the body (`undoYjs.ts`) goes over a sealed channel
// to the others in the room. Frames are one kind byte and its payload; the relay sees none
// of it. Edits leave at once when none left in the last 50 ms, else batched with the caret,
// and apply on arrival while that costs this tab little, else batched by that cost.
// Ids are random per session; frames with a `to` that is not this client are ignored, and
// a relay that knows ids passes them to that client alone (`channel.ts`). Every frame that
// changes a receiver's state is signed with the writers' key; a reader (`#view=`) can only
// ask, and others take only its name and colour (docs/architecture/collab.md).

const ASK = 0;      // [from]: everyone offers what they have
const UPDATE = 1;   // a Yjs update for everyone
const PRESENCE = 2; // an awareness update (name, colour, cursor)
const OFFER = 3;    // [to][from][length][state vector][delete set as an update]
const PULL = 4;     // [to][from][state vector]: the receiver answers with what it lacks
const ANSWER = 5;   // [to][Yjs update]
// PICTURE, WANT and HAS carry the pictures the doc names by key (`pictures.ts`).
const VIEWER = 8;   // [from][name and colour as JSON, none on leaving]: a reader's presence
const PING = 9;     // [to][from][nonce]: answer to show the sender is in the room now
const PONG = 10;    // [to][from][nonce], a writer's answer
const ECHO = 11;    // [to][from][nonce], a reader's answer
const CHAT = 12;    // [text as UTF-8]: a writer's chat message, to all; the relay's id says whose
const SAY = 13;     // [text as UTF-8]: a reader's, unsigned, counted only from a listed reader
const NOTHING = 15; // [to][from]: a reader's answer to ASK, which has nothing to offer
const DIRECTED = new Set([OFFER, PULL, ANSWER, PICTURE, WANT, HAS, PING, PONG, ECHO, NOTHING]); // the first number is `to`
// Where a frame names its sender: it must be the one the relay puts in front, so no client
// speaks for another (a reader for many readers, or asking answers sent to someone else).
const FROM_AT = new Map([[ASK, 1], [VIEWER, 1], [OFFER, 5], [PULL, 5], [WANT, 5], [HAS, 5], [PING, 5], [PONG, 5], [ECHO, 5], [NOTHING, 5]]);
const SIGNED = new Set([UPDATE, PRESENCE, OFFER, ANSWER, PICTURE, HAS, PONG, CHAT]);
const SQUEEZED = new Set([UPDATE, OFFER, ANSWER]); // deflated when long (`channel.ts`); pictures are packed already
const MAX_HELD = 8;      // presence frames held per peer until it answers a ping
const MAX_KNOWN = 32;     // readers listed, and writers awaiting a ping
const BATCH_MS = 50;
// Arriving edits apply at once while the last batch, with the page layout it set off, took
// under CHEAP_MS; dearer ones gather for twice their cost, BATCH_MS to MAX_BATCH_MS.
const CHEAP_MS = 8;
const MAX_BATCH_MS = 100;
const MAX_LATER = 64;     // carets held until the edits before them apply
const SETTLE_MS = 300;  // how long a sync waits for late offers after the first
const STALL_MS = 10_000; // a sync that hears nothing this long starts over
const EMPTY_MS = 5000;   // a joiner alone this long is told the room is empty
const DOUBT_MS = 3000;   // how long a peer has to answer once the relay counts fewer than are known
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
  | 'mismatch'     // the relay speaks another protocol version
  | 'invalid'      // the link's key is cut short or mistyped
  | 'closed';

/**
 * `keeps`: this client stores the document (the starter); a joiner holds it in its tab only.
 * `id` is the awareness client, `peer` the relay's id; `since` when they joined, by their clock.
 */
export type Peer = { id: number; peer: number; name: string; color: string; since: number; keeps: boolean };
/** Someone reading along: listed by name, with no caret and no zone; `id` is the relay's. */
export type Reader = { id: number; name: string; color: string; since: number };
/** What this client tells the others about itself. */
export type SessionUser = { name: string; color: string; since: number };
const GREY = '#808080';
/** A chat message as it arrived: `from` is the relay's id of its sender, named from the lists. */
export type ChatIn = { from: number; name: string; color: string; reading: boolean; text: string };

/**
 * `missing`: pictures no one here could send, shown as grey boxes. `paused`: the shared doc
 * does not fit this editor, which neither edits nor writes until an update fits again.
 * `dropped`: held edits that no longer fitted and went, counted for a notice. `reading`: this
 * tab only reads along; `link` is then the read link too. `peers` are the writers.
 */
export type SessionView = {
  status: SessionStatus; peers: Peer[]; readers: Reader[]; link: string; viewLink: string; reading: boolean;
  keeps: boolean; kept: boolean; missing: number; paused: boolean; dropped: number;
};

/** What the session needs from the app. */
export type SessionHost = {
  relay: string;
  /** The open document as a file without its large pictures: the start every joiner loads. */
  snapshot(): Promise<Uint8Array>;
  /** Loads a start file as the open document, unasked, under the starter's name for it. */
  load(bytes: Uint8Array, name: string): Promise<boolean>;
  /** The open document's name, which a joiner's copy takes. */
  name(): string;
  user(): SessionUser;
  onChange(view: SessionView): void;
  /** A chat message from someone listed; never stored, nor part of the doc. */
  onChat(message: ChatIn): void;
};

export type Session = {
  /** This client's relay id, which names a guest. */
  me: number;
  /** Tells the others this client's new name or colour. */
  setUser(user: SessionUser): void;
  link: string;
  viewLink: string;
  awareness: Awareness;
  leave(): void;
  /** Sends a chat message to everyone here; false when the line is not live. */
  chat(text: string): boolean;
  /** Pictures others are still loading from this client. */
  serving(): number;
  /** Frames sent per kind, for the tests' idle check. */
  stats: { sent: number[] };
  /** Dev builds: sends a frame as is and shows each arriving one, for the forged-frame test. */
  debug?: { send(plain: Uint8Array, to?: number): void; tap: ((plain: Uint8Array) => void) | null; ydoc: Y.Doc };
};

type Join = (codec: StoreCodec) => Promise<YjsUndo | 'version' | null>;
type Bind = (codec: StoreCodec) => YjsUndo;

type Deletes = ReturnType<typeof Y.createDeleteSet>;

/** Whether the deletions in `has` cover every range of `all`. */
function holds(has: Deletes, all: Deletes): boolean {
  const byClock = (x: { clock: number }, y: { clock: number }) => x.clock - y.clock;
  for (const [client, ranges] of all.clients) {
    const theirs = [...(has.clients.get(client) ?? [])].sort(byClock);
    let j = 0;
    for (const d of [...ranges].sort(byClock)) {
      for (let at = d.clock; at < d.clock + d.len; at = theirs[j].clock + theirs[j].len) {
        while (j < theirs.length && theirs[j].clock + theirs[j].len <= at) j++;
        if (j >= theirs.length || theirs[j].clock > at) return false;
      }
    }
  }
  return true;
}

/** The `peer` of each state an awareness update sets, null where one has none. */
function presencePeers(u: Uint8Array): (number | null)[] {
  let at = 0;
  const uint = () => { let n = 0, m = 1, b; do { b = u[at++]; n += (b & 127) * m; m *= 128; } while (b & 128); return n; };
  const out: (number | null)[] = [];
  for (let n = uint(); n > 0; n--) {
    uint(); uint();
    const len = uint(), state = JSON.parse(new TextDecoder().decode(u.subarray(at, at += len)));
    if (state !== null) out.push(typeof state.peer === 'number' ? state.peer : null);
  }
  return out;
}

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

function connect(editor: Editor, keys: SessionKeys, host: SessionHost, ydoc: Y.Doc, bound: Bind | null, join: Join | null): Session {
  const awareness = new Awareness(ydoc);
  const reading = !keys.sign;
  const view = viewLink(keys);
  const link = keys.secret ? sessionLink(keys.secret) : view;
  const stats = { sent: new Array<number>(NOTHING + 1).fill(0) };
  // A reader has no awareness state: no caret, no zone, never asked for a picture.
  if (reading) { awareness.setLocalState(null); setReading(editor, true); }
  // Never 0, the PICTURE frame's address for everyone.
  const me = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  let line: ChannelStatus = 'connecting';
  let status: SessionStatus = 'connecting';
  let peerCount = 1;
  let binding: YjsUndo | null = null;
  let repairer: (() => boolean) | null = null;
  let paused = false;
  let dropped = 0;
  let joining = join;
  // The others' carets and selections (`carets.ts`) and the pictures put in from now on;
  // one registration, as each rebuilds every plugin view. The cursor plugin only publishes
  // this client's selection. Each caret carries the name the lists show and its client.
  const look = (id: number) => {
    const s = awareness.getStates().get(id);
    return { name: shownName(s?.user?.name, typeof s?.peer === 'number' ? s.peer : id), color: cleanColor(s?.user?.color) ?? GREY };
  };
  const bind = (b: YjsUndo) => {
    binding = b;
    // The repairer is the client bound longest (lowest `rank`, then id): one joining later
    // ranks after everyone it sees, so the role moves only when its holder leaves.
    const ranks = [...awareness.getStates()].filter(([id]) => id !== ydoc.clientID).map(([, s]) => s.rank).filter((r) => typeof r === 'number');
    const rank = join ? Math.max(0, ...ranks) + 1 : 0;
    awareness.setLocalStateField('rank', rank);
    repairer = reading ? () => false : () => [...awareness.getStates()].every(([id, s]) =>
      id === ydoc.clientID || typeof s.rank !== 'number' || s.rank > rank || (s.rank === rank && id > ydoc.clientID));
    b.setRepairer(repairer);
    b.onPause((p) => { paused = p; changed(); });
    b.onDrop(() => { dropped++; changed(); });
    editor.registerPlugin(yCursorPlugin(awareness, { awarenessStateFilter: () => false }), (p, plugins) => [...plugins, p, caretsPlugin(awareness, look), pictures.plugin, ...(reading ? [readOnlyFilter()] : [])]);
  };

  const keeps = !join;
  const peers = (): Peer[] => [...awareness.getStates()].filter(([id, s]) => id !== ydoc.clientID && s.user && typeof s.peer === 'number')
    .map(([id, s]) => ({ id, peer: s.peer, name: shownName(s.user.name, s.peer), color: cleanColor(s.user.color) ?? GREY, since: Number(s.user.since) || 0, keeps: s.keeps === true }));
  const readers = new Map<number, Reader>();
  const changed = () => {
    const all = peers();
    host.onChange({
      status, peers: all, readers: [...readers.values()], link, viewLink: view, reading,
      keeps, kept: keeps || all.some((p) => p.keeps), missing: pictures.missing(), paused, dropped,
    });
  };
  // Waiting turns into `empty` after EMPTY_MS and stays so until someone comes.
  let emptyTimer: ReturnType<typeof setTimeout> | undefined;
  const setStatus = (s: SessionStatus) => {
    if (s === 'waiting' && status === 'empty') return;
    if (s === 'waiting') emptyTimer ??= setTimeout(() => { if (status === 'waiting') { status = 'empty'; changed(); } }, EMPTY_MS);
    else { clearTimeout(emptyTimer); emptyTimer = undefined; }
    if (status !== s) { status = s; changed(); }
  };

  // Nobody but readers here: no one can give the doc, as in an empty room.
  const settled = (): SessionStatus => binding ? 'live'
    : peerCount <= 1 || (readers.size >= peerCount - 1 && [...awareness.getStates().keys()].every((id) => id === ydoc.clientID))
      ? 'waiting' : 'connecting';

  // A reader cannot sign, so what it would sign is never sent.
  const post = (done: (() => void) | undefined, kind: number, ...parts: (number | Uint8Array)[]) => {
    if (reading && SIGNED.has(kind)) return done?.();
    stats.sent[kind]++;
    const plain = frame(kind, ...parts);
    channel.send(SIGNED.has(kind) ? signed(keys.sign!, plain) : plain, DIRECTED.has(kind) ? parts[0] as number : 0, kind === PICTURE, done, SQUEEZED.has(kind));
  };
  const send = (kind: number, ...parts: (number | Uint8Array)[]) => post(undefined, kind, ...parts);
  const enc = new TextEncoder();
  // A new clock: others that dropped this client when its line broke take it back.
  const present = () => {
    if (reading) return send(VIEWER, me, enc.encode(JSON.stringify(host.user())));
    awareness.setLocalState(awareness.getLocalState());
    ship();
  };

  // A signed presence may be replayed from a writer long gone, so it takes effect only once
  // its `peer` answered a fresh nonce (PING, signed PONG), until the relay says it is gone.
  // A reader is listed once its id answered (ECHO), so nobody lists one not in the room.
  const live = new Set<number>();
  const held = new Map<number, Uint8Array[]>();
  const asked = new Map<number, Reader>();
  const pinged = new Map<number, { nonce: Uint8Array; at: number }>();
  const ping = (p: number) => {
    const last = pinged.get(p);
    if (last && Date.now() - last.at < 5000) return;
    const nonce = crypto.getRandomValues(new Uint8Array(16));
    pinged.set(p, { nonce, at: Date.now() });
    send(PING, p, me, nonce);
  };
  const fresh = (p: number, nonce: Uint8Array) => {
    const want = pinged.get(p)?.nonce;
    if (!want || want.length !== nonce.length || want.some((b, i) => b !== nonce[i])) return false;
    pinged.delete(p);
    return true;
  };
  const presence = (u: Uint8Array, from: number) => {
    const ps = presencePeers(u);
    if (ps.some((p) => p !== from)) return;
    const waiting = (ps as number[]).filter((p) => !live.has(p));
    if (!waiting.length) return applyAwarenessUpdate(awareness, u, REMOTE);
    for (const p of new Set(waiting)) {
      if (!held.has(p) && held.size >= MAX_KNOWN) continue;
      const list = held.get(p) ?? [];
      held.set(p, [...list, u.slice()].slice(-MAX_HELD));
      ping(p);
    }
  };
  const answered = (p: number, nonce: Uint8Array) => {
    if (!fresh(p, nonce)) return;
    doubted.delete(p);
    live.add(p);
    const list = held.get(p) ?? [];
    held.delete(p);
    for (const u of list) presence(u, p);
  };
  const listed = () => {
    if (line === 'open' && status !== 'version') setStatus(settled());
    changed();
  };
  const viewer = (from: number, body: Uint8Array) => {
    if (!body.length) { asked.delete(from); readers.delete(from); return listed(); }
    const u = JSON.parse(new TextDecoder().decode(body));
    const entry = { id: from, name: shownName(u?.name, from), color: cleanColor(u?.color) ?? GREY, since: Number(u?.since) || 0 };
    if (readers.has(from)) { readers.set(from, entry); return listed(); }
    if (!asked.has(from) && asked.size >= MAX_KNOWN) return;
    asked.set(from, entry);
    ping(from);
  };
  const echoed = (from: number, nonce: Uint8Array) => {
    if (readers.has(from) && doubted.has(from)) { if (fresh(from, nonce)) doubted.delete(from); return; }
    const entry = asked.get(from);
    if (!entry || readers.size >= MAX_KNOWN || !fresh(from, nonce)) return;
    asked.delete(from);
    readers.set(from, entry);
    listed();
  };
  // A chat message counts from a writer listed under that relay id, signed, or a reader listed.
  const dec = new TextDecoder();
  const chat = (kind: number, from: number, body: Uint8Array) => {
    const who = kind === SAY ? readers.get(from) : peers().find((p) => p.peer === from);
    if (who) host.onChat({ from, name: who.name, color: who.color, reading: kind === SAY, text: dec.decode(body) });
  };
  // The relay's `gone` drops a client at once; one that went while this line was down is
  // never announced. Knowing more clients than the relay counts, each is pinged afresh and
  // those not answering go, so a reconnected tab keeps no departed peer's caret or zone.
  const drop = (p: number) => {
    pictures.forget(p);
    live.delete(p);
    held.delete(p);
    asked.delete(p);
    pinged.delete(p);
    readers.delete(p);
    removeAwarenessStates(awareness, [...awareness.getStates()].filter(([id, s]) => id !== ydoc.clientID && s.peer === p).map(([id]) => id), 'gone');
  };
  const known = () => new Set([...[...awareness.getStates()].filter(([id, s]) => id !== ydoc.clientID && typeof s.peer === 'number').map(([, s]) => s.peer as number), ...readers.keys()]);
  const doubted = new Set<number>();
  let doubtTimer: ReturnType<typeof setTimeout> | undefined;
  const recount = () => {
    if (doubtTimer || known().size < peerCount) return;
    for (const p of known()) { doubted.add(p); pinged.delete(p); ping(p); }
    doubtTimer = setTimeout(() => {
      doubtTimer = undefined;
      if (line === 'open' && known().size >= peerCount) for (const p of doubted) drop(p);
      doubted.clear();
      listed();
    }, DOUBT_MS);
  };
  const pictures = sessionPictures({
    me, send, post, heard: (id) => channel.heard(id), incoming: (id) => channel.incoming(id), changed: () => changed(), unknown: () => peerCount - 1 > known().size,
    arrived: (k) => binding?.refresh(IDB_SRC + k),
    peers: () => [...awareness.getStates()].filter(([id, s]) => id !== ydoc.clientID && typeof s.peer === 'number').map(([, s]) => s.peer as number),
  });

  // Outgoing: this client's own updates, then its caret, right after the change when the last
  // batch left BATCH_MS ago or more, else once that much passed, with what came meanwhile.
  // Anything else in its presence (zone, name, rank) goes at once, after the edits before it.
  let out: Uint8Array[] = [];
  let outTimer: ReturnType<typeof setTimeout> | undefined;
  let shipped = -Infinity, caretDue = false, told = '';
  const ship = () => {
    clearTimeout(outTimer);
    outTimer = undefined;
    if (!out.length && !caretDue) return;
    shipped = performance.now();
    if (out.length) {
      const merged = Y.mergeUpdates(out);
      out = [];
      send(UPDATE, merged);
    }
    if (caretDue) { caretDue = false; send(PRESENCE, encodeAwarenessUpdate(awareness, [ydoc.clientID])); }
  };
  // A hidden tab's timers wait up to a second, so there the edits leave at once.
  let due = false;
  const batch = () => {
    if (outTimer !== undefined || due) return;
    const wait = shipped + BATCH_MS - performance.now();
    if (wait > 0 && !document.hidden) outTimer = setTimeout(ship, wait);
    else { due = true; queueMicrotask(() => { due = false; ship(); }); }
  };
  const onUpdate = (u: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return;
    out.push(u);
    batch();
  };
  ydoc.on('update', onUpdate);
  type Change = { added: number[]; updated: number[]; removed: number[] };
  const onPresence = ({ added, updated, removed }: Change, origin: unknown) => {
    if (origin === 'local') {
      const state = awareness.getLocalState(), rest = JSON.stringify(state && { ...state, cursor: undefined });
      caretDue = true;
      if (rest === told) batch();
      else { told = rest; ship(); }
    }
    if (added.length || removed.length) pictures.recheck();
    if (binding && repairer && removed.length) binding.setRepairer(repairer);
    changed();
  };
  awareness.on('update', onPresence);

  // Incoming updates apply at once or gather for a batch, by what the last batch cost this
  // tab, as one Yjs transaction. A caret waits for the edits that came before it. A joiner
  // binds the editor once the doc it received carries a start file.
  let inbox: Uint8Array[] = [];
  let inTimer: ReturnType<typeof setTimeout> | undefined;
  let gotAnswer = false;
  let cost = 0, measuring = false;
  const after: (() => void)[] = [];
  const receive = (u: Uint8Array) => {
    inbox.push(u.slice());
    if (inTimer !== undefined) return;
    if (cost < CHEAP_MS) void flush();
    else inTimer = setTimeout(flush, Math.min(MAX_BATCH_MS, Math.max(BATCH_MS, 2 * cost)));
  };
  // Before telling others what this client has, what already arrived goes in.
  const applyInbox = () => {
    if (!inbox.length) return;
    const merged = Y.mergeUpdates(inbox);
    inbox = [];
    Y.applyUpdate(ydoc, merged, REMOTE);
    for (const f of after.splice(0)) f();
  };
  // A batch's cost includes the frame callbacks it set off (pagination), timed between one
  // asked for before it and one after.
  const timed = () => {
    const measure = !measuring && typeof requestAnimationFrame === 'function';
    let start = 0;
    if (measure) { measuring = true; requestAnimationFrame(() => { start = performance.now(); }); }
    const t0 = performance.now();
    applyInbox();
    cost = performance.now() - t0;
    if (measure) requestAnimationFrame(() => { measuring = false; if (start) cost += performance.now() - start; });
  };
  const flush = async () => {
    clearTimeout(inTimer);
    inTimer = undefined;
    if (inbox.length) timed();
    if (gotAnswer) { gotAnswer = false; if (round) { round.target = null; pull(); } }
    if (joining && ydoc.getMap('meta').has('snapshot')) {
      const done = joining;
      joining = null;
      const got = await done(pictures);
      if (got === 'version') return setStatus('version');
      if (!got) return setStatus('closed');
      bind(got);
      performance.mark('collab:bound');
    }
    if (binding && line === 'open') setStatus('live');
  };

  // A sync, once per welcome: this client asks, everyone offers its state vector and delete
  // set, it pulls from the offer with the most, then any with more (a late one too), then
  // applies the offered deletions, which may need a pulled insert, and gives what offers lack.
  type Known = { sv: Map<number, number>; ds: Deletes };
  type Round = {
    offers: Map<number, Known>; idle: Set<number>; pulled: Set<number>; target: number | null; deletes: Uint8Array[];
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
    const r: Round = round = { offers: new Map(), idle: new Set(), pulled: new Set(), target: null, deletes: [], done: false, over: false, at: Date.now() };
    r.watch = setInterval(() => { if (!r.over && Date.now() - Math.max(r.at, channel.heard()) > STALL_MS) startRound(); }, 1000);
    send(ASK, me);
  };
  // One update to all with what the offers lack, edits pulled from others included, so a
  // client's edits that reached only some still reach all. An empty offer is a joiner,
  // which pulls the doc itself. Every offer then counts as holding this client's state.
  const give = (r: Round) => {
    if (!ydoc.store.clients.size) return;
    const sv = Y.decodeStateVector(Y.encodeStateVector(ydoc)), ds = Y.createDeleteSetFromStructStore(ydoc.store);
    const lacking = [...r.offers.values()].filter((o) => o.sv.size && ([...sv].some(([client, clock]) => (o.sv.get(client) ?? 0) < clock) || !holds(o.ds, ds)));
    if (!lacking.length) return;
    const least = new Map<number, number>();
    for (const [client, clock] of sv) least.set(client, Math.min(clock, ...lacking.map((o) => o.sv.get(client) ?? 0)));
    send(UPDATE, Y.encodeStateAsUpdate(ydoc, Y.encodeStateVector(least)));
    for (const o of r.offers.values()) if (o.sv.size) { o.sv = sv; o.ds = ds; }
  };
  // Every other client answered: an offer, or a reader's NOTHING, each counted once by the relay's id.
  const heardAll = (r: Round) => new Set([...r.offers.keys(), ...r.idle]).size >= peerCount - 1;
  const settle = () => {
    if (!round || round.done) return;
    round.done = true;
    clearTimeout(round.settle);
    pull();
  };
  const pull = () => {
    if (!round?.done || round.target !== null) return;
    applyInbox();
    const mine = Y.decodeStateVector(Y.encodeStateVector(ydoc));
    let best: number | null = null, most = 0;
    for (const [from, { sv }] of round.offers) {
      if (round.pulled.has(from)) continue;
      let more = 0;
      for (const [client, clock] of sv) more += Math.max(0, clock - (mine.get(client) ?? 0));
      if (more > most) { most = more; best = from; }
    }
    if (best === null) {
      if (round.deletes.length) { inbox.push(...round.deletes.splice(0)); applyInbox(); }
      round.over = true;
      give(round);
      return;
    }
    round.over = false;
    round.pulled.add(best);
    round.target = best;
    round.at = Date.now();
    send(PULL, best, me, Y.encodeStateVector(ydoc));
  };

  let tap: ((plain: Uint8Array) => void) | null = null;
  const take = (plain: Uint8Array, from: number) => {
    const kind = plain[0], v = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
    const at = FROM_AT.get(kind);
    if (at !== undefined && v.getUint32(at) !== from) return;
    if (kind === UPDATE) receive(plain.subarray(1));
    else if (kind === CHAT || kind === SAY) chat(kind, from, plain.subarray(1));
    else if (pictures.receive(plain, from)) return;
    else if (kind === PRESENCE) {
      const u = plain.slice(1);
      if (!inbox.length) presence(u, from);
      else if (after.push(() => presence(u, from)) > MAX_LATER) after.shift();
    }
    else if (kind === VIEWER) viewer(v.getUint32(1), plain.subarray(5));
    else if (kind === ASK) {
      if (reading) return send(NOTHING, v.getUint32(1), me);
      applyInbox();
      const sv = Y.encodeStateVector(ydoc);
      send(OFFER, v.getUint32(1), me, sv.length, sv, Y.encodeStateAsUpdate(ydoc, sv));
    } else if (v.getUint32(1) !== me) return;
    else if (kind === PING) send(reading ? ECHO : PONG, v.getUint32(5), me, plain.subarray(9));
    else if (kind === PONG) answered(v.getUint32(5), plain.subarray(9));
    else if (kind === ECHO) echoed(v.getUint32(5), plain.subarray(9));
    else if (kind === OFFER && round) {
      performance.mark('collab:offer');
      const from = v.getUint32(5), n = v.getUint32(9);
      const ds = plain.subarray(13 + n);
      round.offers.set(from, { sv: Y.decodeStateVector(plain.subarray(13, 13 + n)), ds: Y.decodeUpdate(ds).ds });
      round.deletes.push(ds.slice());
      if (round.done) pull();
      else if (heardAll(round)) settle();
      else round.settle ??= setTimeout(settle, SETTLE_MS);
    } else if (kind === NOTHING && round) {
      round.idle.add(v.getUint32(5));
      if (!round.done && heardAll(round)) settle();
    } else if (kind === PULL) {
      if (reading) return;
      applyInbox();
      send(ANSWER, v.getUint32(5), Y.encodeStateAsUpdate(ydoc, plain.subarray(9)));
    } else if (kind === ANSWER) {
      performance.mark('collab:answer');
      gotAnswer = true;
      receive(plain.subarray(5));
    }
  };

  const channel = openChannel({
    url: host.relay, key: keys.read, id: me,
    onFrame(data, from) {
      if (status === 'version' || !data.length) return false;
      tap?.(data);
      // Unsigned or badly signed, a frame of a writing kind is dropped, as is one cut short.
      const plain = SIGNED.has(data[0]) ? opened(keys.verify, data) : data;
      if (!plain) return false;
      try { take(plain, from); } catch { /* malformed */ }
      // Chat goes on while a sync stalls; it must not look like the answer the sync awaits.
      return plain[0] !== CHAT && plain[0] !== SAY;
    },
    onPeers(n, gone) {
      // A client whose line the relay saw end is dropped at once: no picture is asked of it, its
      // zone frees, its repairs move on. A presence merely late drops no one (a busy repairer
      // would get a second). Back on a new line, a client presents itself anew.
      if (gone) drop(gone);
      // Someone came: tell them who we are; their sync sends them what they lack, and a
      // client still without the doc asks them. Someone left: a sync still waiting on
      // offers or an answer starts over with the rest, as others' traffic hides the stall.
      const came = n > peerCount, left = n < peerCount;
      if (came) present();
      peerCount = n;
      if (left) pictures.recheck();
      if (left ? round && !round.over : came && joining && (!round || round.over)) startRound();
      if (line === 'open' && status !== 'version') setStatus(settled());
      changed();
      recount();
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
      pictures.again();
      present();
      startRound();
      recount();
    },
  });

  // `peer` first: a presence without one is never taken.
  awareness.setLocalStateField('peer', me);
  awareness.setLocalStateField('user', host.user());
  const unshareZones = shareZones(awareness);
  if (keeps) awareness.setLocalStateField('keeps', true);
  if (bound) bind(bound(pictures));

  // Leaving tells the others at once, after the edits still batched; a closed tab drops out after awareness's timeout.
  const goodbye = () => {
    caretDue = false;
    ship();
    if (reading) return send(VIEWER, me);
    removeAwarenessStates(awareness, [ydoc.clientID], 'leave');
    send(PRESENCE, encodeAwarenessUpdate(awareness, [ydoc.clientID]));
  };
  addEventListener('pagehide', goodbye);

  return {
    me, link, viewLink: view, awareness, stats,
    serving: () => pictures.serving(),
    setUser(user) {
      if (reading) send(VIEWER, me, enc.encode(JSON.stringify(user)));
      else awareness.setLocalStateField('user', user);
    },
    chat(text) {
      if (line !== 'open' || status !== 'live') return false;
      send(reading ? SAY : CHAT, enc.encode(text));
      return true;
    },
    ...(import.meta.env.DEV ? { debug: { send: (p: Uint8Array, to = 0) => channel.send(p, to), get tap() { return tap; }, set tap(f) { tap = f; }, ydoc } } : {}),
    leave() {
      removeEventListener('pagehide', goodbye);
      clearTimeout(inTimer);
      clearTimeout(emptyTimer);
      clearTimeout(doubtTimer);
      endRound();
      goodbye();
      channel.close();
      awareness.off('update', onPresence);
      unshareZones();
      awareness.destroy();
      ydoc.off('update', onUpdate);
      if (binding) editor.unregisterPlugin([yCursorPluginKey, caretsKey, picturesKey, ...(reading ? [readingKey] : [])]);
      if (reading) setReading(editor, false);
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
  // The shared doc names the pictures by key; joiners ask for them as for any other.
  const keyed = keyPictures(editor.state);
  if (keyed) editor.view.dispatch(keyed);
  return connect(editor, writeKeys(newKey())!, host, ydoc, (codec) => attachYjsUndo(editor, ydoc, codec), null);
}

/**
 * Joins the session of `keys` (`linkKeys`): once someone in the room has sent the doc, its
 * start file is loaded, the body bound to the Yjs doc and every store changed since put into effect.
 */
export function joinSession(editor: Editor, keys: SessionKeys, host: SessionHost): Session {
  const ydoc = new Y.Doc();
  return connect(editor, keys, host, ydoc, null, async (codec) => {
    const meta = ydoc.getMap('meta');
    if (meta.get('version') !== __APP_VERSION__) return 'version';
    if (!(await host.load(meta.get('snapshot') as Uint8Array, String(meta.get('name') ?? '')))) return null;
    // Repairs wait for the rank the session gives it on binding.
    const binding = attachYjsUndo(editor, ydoc, codec, () => false);
    binding.applyState();
    return binding;
  });
}
