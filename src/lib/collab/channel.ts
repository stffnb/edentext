import { cipher, newKey, roomId } from './key';

/** `mismatch`: the relay speaks another protocol version than this app. */
export type ChannelStatus = 'connecting' | 'open' | 'full' | 'unreachable' | 'failing' | 'mismatch' | 'closed';

/** The relay protocol (`relay/CLAUDE.md`) this app speaks. */
export const PROTOCOL = 2;

export type Channel = {
  /** To one client by its id, or with `to` 0 to everyone; `bulk` (a picture) waits behind the
   *  rest, and `done` runs once its last part went to the socket or it was dropped. */
  send(plain: Uint8Array, to?: number, bulk?: boolean, done?: () => void): void;
  close(): void;
  /** When the last peer frame (or part of one) came in that `onFrame` did not call chatter, for a session waiting on an answer. */
  heard(): number;
  /** Whether a message in parts from the client `from` is on its way in. */
  incoming(from: number): boolean;
};

type Options = {
  url: string;
  key: Uint8Array;
  /** This client's id, never 0: the relay passes a frame to its receiver alone. */
  id: number;
  /** A message and its sender's id, which the relay puts in front of every frame. `false`
   *  marks chatter that says nothing about a sync, so it leaves `heard` as it was. */
  onFrame(plain: Uint8Array, from: number): boolean | void;
  /** The room's size; `gone` is the id of a client whose line the relay saw end. */
  onPeers(n: number, gone?: number): void;
  onStatus(s: ChannelStatus): void;
  /** Each time the relay welcomes the socket, with the room's size, so the session can sync. */
  onOpen(peers: number): void;
};

// Each sealed frame carries one envelope byte. A message longer than the relay's frame limit
// (its welcome says it) goes as numbered parts under a random id, sealed one by one, and is
// put together on arrival; frames of different senders may interleave.
const WHOLE = 0;
const PART = 1;
const PART_HEAD = 17;        // envelope, 8-byte id, index, count
const SEALING = 28;          // nonce and GCM tag
const TO = 4;                // in clear before a sealed frame: the receiver (0 for all), the sender on arrival
const OLD_RELAY = 4000;      // a relay before version 2 closes a hello it cannot read so
const MAX_PART = 256 << 10;
const MAX_MESSAGE = 256 << 20;
const PART_TTL = 60_000;
// Unfinished messages are bounded per sender, as the relay names it: a sender sends one
// message's parts in a row, so a new one ends its oldest past MAX_OPEN, and nobody fills
// another's room.
const MAX_OPEN = 4;
const MIN_PART = 1024;
// A connection that breaks within STABLE_MS of its welcome counts as failed; after FAILS in a
// row the line is `failing` until one holds. Retries back off up to MAX_WAIT.
const STABLE_MS = 5000;
const FAILS = 3;
const MAX_WAIT = 30_000;
// A relay that announces a beat sends one that often; a line silent for BEATS of them is dead.
const BEATS = 3;
// The bulk lane sends while the socket holds less than LOW (a hidden tab's timers wake once a
// second, so it fills more); otherwise it looks again after POLL ms.
const LOW = 128 << 10;
const HIDDEN_LOW = 4 << 20;
const POLL = 10;
const MAX_QUEUE = 256;
// A relay that says what arrived (`got`) paces pictures by the measured uplink rate: no more
// than AHEAD ms of them beyond the round trip are in flight, so a keystroke waits at most that.
const AHEAD = 150;
const MIN_FLIGHT = 64 << 10;
const MIN_CHUNK = 32 << 10;
const RATE_MS = 50;
const MAX_MARKS = 1024;

/** A message as envelopes of at most `size` bytes: whole, or numbered parts under a random id, each made when asked for. */
function cut(plain: Uint8Array, size: number): { count: number; size: number; at(i: number): Uint8Array } {
  if (plain.length + 1 <= size) {
    return { count: 1, size, at: () => { const out = new Uint8Array(plain.length + 1); out.set(plain, 1); return out; } };
  }
  const room = size - PART_HEAD;
  const count = Math.ceil(plain.length / room);
  const id = crypto.getRandomValues(new Uint8Array(8));
  return {
    count,
    size,
    at(i) {
      const data = plain.subarray(i * room, (i + 1) * room);
      const out = new Uint8Array(PART_HEAD + data.length);
      const v = new DataView(out.buffer);
      out[0] = PART;
      out.set(id, 1);
      v.setUint32(9, i);
      v.setUint32(13, count);
      out.set(data, PART_HEAD);
      return out;
    },
  };
}

type Pending = { parts: (Uint8Array | undefined)[]; got: number; size: number; at: number };
const sizeOf = (pending: Map<string, Pending>) => [...pending.values()].reduce((n, p) => n + p.size, 0);

/** Puts parts back together per sender; returns a message once it is whole. */
function joiner() {
  const senders = new Map<number, Map<string, Pending>>();
  const take = (env: Uint8Array, from: number): Uint8Array | null => {
    if (env[0] === WHOLE) return env.subarray(1);
    if (env[0] !== PART || env.length < PART_HEAD) return null;
    const now = Date.now();
    for (const [sender, pending] of senders) {
      for (const [id, p] of pending) if (now - p.at > PART_TTL) pending.delete(id);
      if (!pending.size) senders.delete(sender);
    }
    const v = new DataView(env.buffer, env.byteOffset, env.byteLength);
    const id = Array.from(env.subarray(1, 9)).join('.');
    const index = v.getUint32(9), count = v.getUint32(13);
    const pending = senders.get(from) ?? new Map<string, Pending>();
    let p = pending.get(id);
    if (!p) {
      // Parts come in order: one without its message's first part can never complete.
      if (index !== 0 || count < 2 || count > MAX_MESSAGE / MIN_PART + 1) return null;
      for (const old of pending.keys()) if (pending.size >= MAX_OPEN) pending.delete(old);
      pending.set(id, (p = { parts: new Array(count), got: 0, size: 0, at: now }));
      senders.set(from, pending);
    }
    if (index >= p.parts.length || p.parts[index]) return null;
    if (sizeOf(pending) + env.length - PART_HEAD > MAX_MESSAGE) { pending.delete(id); return null; }
    p.parts[index] = env.subarray(PART_HEAD);
    p.got++;
    p.size += env.length - PART_HEAD;
    p.at = now;
    if (p.got < p.parts.length) return null;
    pending.delete(id);
    const out = new Uint8Array(p.size);
    let at = 0;
    for (const part of p.parts as Uint8Array[]) { out.set(part, at); at += part.length; }
    return out;
  };
  /** A sender gone: its unfinished messages go too. */
  const forget = (from: number) => { senders.delete(from); };
  const open = (from: number) => {
    const now = Date.now();
    return [...senders.get(from)?.values() ?? []].some((p) => now - p.at <= PART_TTL);
  };
  return { take, forget, open };
}

/**
 * Where this build's relay lives: `VITE_COLLAB_RELAY` is a `ws(s)://` URL or `same-origin`
 * (`/relay` beside the app, as the image and the dev server serve it). None: no sessions.
 */
export function relayUrl(): string | null {
  const v = import.meta.env.VITE_COLLAB_RELAY ?? (import.meta.env.DEV ? 'same-origin' : '');
  if (!v) return null;
  if (v !== 'same-origin') return v;
  const u = new URL('relay', location.href);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.hash = u.search = '';
  return u.href;
}

/**
 * Whether sessions can be offered: a relay beside the app answers its health check (an
 * image served without one hides the menu entry); a relay named by URL is taken as is.
 */
export async function relayReady(url: string | null): Promise<boolean> {
  if (!url) return false;
  if (import.meta.env.VITE_COLLAB_RELAY && import.meta.env.VITE_COLLAB_RELAY !== 'same-origin') return true;
  try { return (await fetch(new URL('relay/health', location.href))).ok; } catch { return false; }
}

/** A sealed, self-reconnecting line to the others in the key's room. */
export function openChannel(o: Options): Channel {
  const room = roomId(o.key);
  const box = cipher(o.key);
  const parts = joiner();
  let ws: WebSocket | null = null;
  let ready = false;
  let closed = false;
  let wait = 500;
  let fails = 0;
  let down = false;
  let size = MAX_PART;
  let heard = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stable: ReturnType<typeof setTimeout> | undefined;
  // The relay gives the id only to a hello with this secret, so no other client can take it.
  const claim = newKey();
  // The room's size by the relay, 0 before a welcome; alone, nothing goes to everyone, as
  // whoever comes syncs and asks for pictures anyway.
  let peers = 0;
  // Receivers the relay holds much for: pictures to them wait until it says `drained`.
  const slow = new Set<number>();

  // Two lanes, each in order. The fast one (edits, carets, the sync's small frames, chat)
  // goes at once; the bulk one (pictures, any message in parts) one part at a time and only
  // while the socket holds little, so typing never waits behind it. Frames leave in the order sealed.
  type Out = { plain: Uint8Array; to: number; parts?: ReturnType<typeof cut>; next: number; done?: () => void };
  const fast: Out[] = [], bulk: Out[] = [];
  let queued = false;
  let wake: ReturnType<typeof setTimeout> | undefined;
  let tick: MessageChannel | null = null;
  const line = () => (ws && ready && ws.readyState === WebSocket.OPEN ? ws : null);
  const skip = (m: Out) => m.to === 0 && peers === 1;
  let out: Promise<unknown> = Promise.resolve(), inbound: Promise<unknown> = Promise.resolve();
  let busy = false;
  // Bytes this socket sent and the relay confirmed, the uplink rate in bytes/ms while the bulk
  // lane kept it busy, and the shortest round trip seen.
  let sent = 0, acked = 0, acking = false, rate = 0, base = Infinity, since = 0, sinceAt = 0;
  const marks: [number, number][] = [];
  const flight = () => Math.max(MIN_FLIGHT, rate * (AHEAD + (base === Infinity ? 0 : base)));
  const chunk = () => (acking ? Math.min(size, Math.max(MIN_CHUNK, flight() / 2)) : size);
  const receipt = (n: number) => {
    const now = Date.now();
    let at = 0;
    while (marks.length && marks[0][0] <= n) at = marks.shift()![1];
    if (at) base = Math.min(base, now - at);
    if (!acking || !bulk.length) [since, sinceAt] = [n, now];
    else if (now - sinceAt >= RATE_MS) {
      const r = (n - since) / (now - sinceAt);
      rate = rate ? (rate + r) / 2 : r;
      [since, sinceAt] = [n, now];
    }
    acking = true;
    acked = n;
    if (wake) { clearTimeout(wake); wake = undefined; queued = false; }
    later();
  };
  // Sealing starts at once; the socket gets each frame after those sealed before it.
  const put = (sock: WebSocket, env: Uint8Array, to: number) => {
    const body = box.seal(env);
    return (out = out.then(() => body).then((b) => {
      const frame = new Uint8Array(TO + b.length);
      new DataView(frame.buffer).setUint32(0, to);
      frame.set(b, TO);
      if (sock.readyState !== WebSocket.OPEN) return;
      sock.send(frame);
      if (sock !== ws) return;
      sent += frame.length;
      marks.push([sent, Date.now()]);
      if (marks.length > MAX_MARKS) marks.shift();
    }).catch(() => {}));
  };
  const flush = () => {
    const sock = line();
    if (!sock) return;
    for (let m = fast.shift(); m; m = fast.shift()) {
      if (m.plain.length + 1 > size) { bulk.push(m); continue; }
      if (skip(m)) m.done?.();
      else put(sock, cut(m.plain, size).at(0), m.to).then(m.done);
    }
    later();
  };
  // The next bulk part runs as a task of its own; a message channel, unlike a timer, is not
  // slowed in a hidden tab.
  const later = (ms = 0) => {
    if (!bulk.length || queued) return;
    queued = true;
    if (ms) wake = setTimeout(() => { wake = undefined; step(); }, ms);
    else {
      if (!tick) { tick = new MessageChannel(); tick.port1.onmessage = step; }
      tick.port2.postMessage(0);
    }
  };
  // The first message no receiver the relay calls slow waits for, nor an earlier message to
  // the same receiver (one to everyone waits for all); -1 when each waits.
  const pick = () => {
    const before = new Set<number>();
    for (let i = 0; i < bulk.length; i++) {
      const to = bulk[i].to;
      if (to === 0) return before.size || slow.size ? -1 : i;
      if (!before.has(to) && !slow.has(to)) return i;
      before.add(to);
    }
    return -1;
  };
  const step = () => {
    queued = false;
    const sock = line();
    if (!sock || !bulk.length || busy) return;
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (sock.bufferedAmount > (hidden ? HIDDEN_LOW : LOW)) return later(POLL);
    const i = pick(), m = bulk[i];
    // A `drained` from the relay or a receiver gone wakes the lane again.
    if (!m) return;
    if (skip(m)) { bulk.splice(i, 1); m.done?.(); return later(); }
    // A hidden tab sends no keystrokes, so it fills the line; a receipt wakes the lane.
    const ahead = sent - acked, next = Math.min(m.plain.length + PART_HEAD, m.parts?.size ?? chunk());
    if (acking && !hidden && ahead && ahead + next > flight()) return later(POLL * 5);
    m.parts ??= cut(m.plain, hidden ? size : chunk());
    const last = m.next + 1 >= m.parts.count;
    if (last) bulk.splice(i, 1);
    // The next part waits for this one in the socket, so `bufferedAmount` counts it.
    busy = true;
    put(sock, m.parts.at(m.next++), m.to).then(() => {
      busy = false;
      if (last) m.done?.();
      later();
    });
  };

  // `collab:*` performance marks let the join bench split a join into its steps.
  const connect = () => {
    performance.mark('collab:dial');
    if (fails < FAILS && !down) o.onStatus('connecting');
    const sock = new WebSocket(o.url);
    sock.binaryType = 'arraybuffer';
    ws = sock;
    ready = false;
    let welcomed = false, held = false, gone = false, last = Date.now();
    let alive: ReturnType<typeof setInterval> | undefined;
    const lost = () => {
      if (gone) return;
      gone = true;
      clearTimeout(stable);
      clearInterval(alive);
      if (ws === sock) { ws = null; ready = false; }
      if (closed) return;
      if (welcomed && !held) fails++;
      down = !welcomed;
      o.onStatus(down ? 'unreachable' : fails >= FAILS ? 'failing' : 'connecting');
      timer = setTimeout(connect, wait * (0.8 + Math.random() * 0.4));
      wait = Math.min(wait * 2, MAX_WAIT);
    };
    sock.onopen = () => { performance.mark('collab:socket'); sock.send(JSON.stringify({ t: 'hello', v: PROTOCOL, room, token: null, id: o.id, claim })); };
    const hear = async (ev: MessageEvent, at: number) => {
      if (typeof ev.data === 'string') {
        let msg: { t?: string; peers?: number; n?: number; frame?: number; beat?: number; gone?: number; id?: number };
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'welcome') {
          performance.mark('collab:welcome');
          welcomed = ready = true;
          down = false;
          if (msg.frame) size = Math.max(PART_HEAD + MIN_PART, Math.min(MAX_PART, msg.frame - SEALING - TO));
          // A half-open line never closes by itself: it is dropped and dialled again.
          // A tick that comes late (a frozen tab) waits one beat for the messages queued behind it.
          const beat = msg.beat ?? 0;
          let tick = Date.now();
          if (beat > 0) alive = setInterval(() => {
            const now = Date.now(), late = now - tick > 2 * beat;
            tick = now;
            if (late || now - last <= BEATS * beat) return;
            sock.onmessage = sock.onclose = null;
            sock.close();
            lost();
          }, beat);
          peers = msg.peers ?? 1;
          // A message cut short with the last line goes again from its start, under a new id.
          for (const m of bulk) if (m.next) { m.next = 0; m.parts = undefined; }
          slow.clear();
          sent = acked = 0;
          acking = false;
          base = Infinity;
          marks.length = 0;
          // The welcome's own frames (presence, the sync's ask) go before what waited.
          const waited = fast.splice(0);
          o.onOpen(peers);
          fast.push(...waited);
          flush();
          if (fails < FAILS) o.onStatus('open');
          stable = setTimeout(() => {
            held = true;
            fails = 0;
            wait = 500;
            o.onStatus('open');
          }, STABLE_MS);
        } else if (msg.t === 'peers') {
          peers = msg.n ?? 1;
          if (msg.gone) {
            parts.forget(msg.gone);
            if (slow.delete(msg.gone)) later();
            for (let i = bulk.length - 1; i >= 0; i--) if (bulk[i].to === msg.gone) bulk.splice(i, 1)[0].done?.();
          }
          o.onPeers(peers, msg.gone);
        }
        else if (msg.t === 'got' && typeof msg.n === 'number' && sock === ws) receipt(msg.n);
        else if (msg.t === 'slow' && msg.id) slow.add(msg.id);
        else if (msg.t === 'drained' && msg.id) { slow.delete(msg.id); later(); }
        else if (msg.t === 'full') { closed = true; o.onStatus('full'); }
        else if (msg.t === 'version') { closed = true; o.onStatus('mismatch'); }
        return;
      }
      const data = new Uint8Array(ev.data as ArrayBuffer);
      if (data.length < TO) return;
      const from = new DataView(data.buffer).getUint32(0);
      // A frame sealed with another key or altered on the way is dropped.
      const env = await box.open(data.subarray(TO)).catch(() => null);
      if (!env) return;
      // Each part of a long message counts, so one still on its way is no stall.
      if (env[0] !== WHOLE) heard = at;
      const plain = parts.take(env, from);
      if (plain && o.onFrame(plain, from) !== false) heard = at;
    };
    // What a socket hears is handled in arrival order, also while a frame is being opened.
    const inOrder = (fn: () => unknown) => { inbound = inbound.then(fn).catch((e) => queueMicrotask(() => { throw e; })); };
    sock.onmessage = (ev) => {
      const at = last = Date.now();
      inOrder(() => hear(ev, at));
    };
    sock.onclose = (ev) => inOrder(() => {
      if (!welcomed && !closed && ev.code === OLD_RELAY) { closed = true; o.onStatus('mismatch'); }
      lost();
    });
  };
  connect();

  return {
    send(plain, to = 0, slow = false, done) {
      // What was typed while the line was down goes out on the next welcome; the sync
      // that follows it would carry it too, so the queue only saves a round trip.
      const lane = slow || plain.length + 1 > size ? bulk : fast;
      if (!line() && lane.length >= MAX_QUEUE) return done?.();
      lane.push({ plain, to, next: 0, done });
      if (lane === fast) flush(); else later();
    },
    close() {
      closed = true;
      clearTimeout(timer);
      clearTimeout(stable);
      clearTimeout(wake);
      tick?.port1.close();
      for (const m of [...fast.splice(0), ...bulk.splice(0)]) m.done?.();
      // What was sealed before, a goodbye too, still goes.
      const sock = ws;
      void out.then(() => sock?.close());
      o.onStatus('closed');
    },
    heard: () => heard,
    incoming: (from) => parts.open(from),
  };
}
