import { roomId, seal, unseal } from './key';

export type ChannelStatus = 'connecting' | 'open' | 'full' | 'unreachable' | 'failing' | 'closed';

export type Channel = {
  send(plain: Uint8Array): void;
  close(): void;
  /** When the last peer frame (or part of one) came in, for a session waiting on an answer. */
  heard(): number;
};

type Options = {
  url: string;
  key: Uint8Array;
  onFrame(plain: Uint8Array): void;
  onPeers(n: number): void;
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
const MAX_PART = 1 << 20;
const MAX_MESSAGE = 256 << 20;
const PART_TTL = 60_000;
// A connection that breaks within STABLE_MS of its welcome counts as failed; after FAILS in a
// row the line is `failing` until one holds. Retries back off up to MAX_WAIT.
const STABLE_MS = 5000;
const FAILS = 3;
const MAX_WAIT = 30_000;
// A relay that announces a beat sends one that often; a line silent for BEATS of them is dead.
const BEATS = 3;

function split(plain: Uint8Array, size: number): Uint8Array[] {
  if (plain.length + 1 <= size) {
    const out = new Uint8Array(plain.length + 1);
    out.set(plain, 1);
    return [out];
  }
  const room = size - PART_HEAD;
  const count = Math.ceil(plain.length / room);
  const id = crypto.getRandomValues(new Uint8Array(8));
  const parts: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const data = plain.subarray(i * room, (i + 1) * room);
    const out = new Uint8Array(PART_HEAD + data.length);
    const v = new DataView(out.buffer);
    out[0] = PART;
    out.set(id, 1);
    v.setUint32(9, i);
    v.setUint32(13, count);
    out.set(data, PART_HEAD);
    parts.push(out);
  }
  return parts;
}

type Pending = { parts: (Uint8Array | undefined)[]; got: number; size: number; at: number };

/** Puts parts back together; returns a message once it is whole. */
function joiner() {
  const pending = new Map<string, Pending>();
  return (env: Uint8Array): Uint8Array | null => {
    if (env[0] === WHOLE) return env.subarray(1);
    if (env[0] !== PART || env.length < PART_HEAD) return null;
    const now = Date.now();
    for (const [id, p] of pending) if (now - p.at > PART_TTL) pending.delete(id);
    const v = new DataView(env.buffer, env.byteOffset, env.byteLength);
    const id = Array.from(env.subarray(1, 9)).join('.');
    const index = v.getUint32(9), count = v.getUint32(13);
    let p = pending.get(id);
    if (!p) pending.set(id, (p = { parts: new Array(count), got: 0, size: 0, at: now }));
    if (index >= p.parts.length || p.parts[index]) return null;
    p.parts[index] = env.subarray(PART_HEAD);
    p.got++;
    p.size += env.length - PART_HEAD;
    p.at = now;
    if (p.size > MAX_MESSAGE) { pending.delete(id); return null; }
    if (p.got < p.parts.length) return null;
    pending.delete(id);
    const out = new Uint8Array(p.size);
    let at = 0;
    for (const part of p.parts as Uint8Array[]) { out.set(part, at); at += part.length; }
    return out;
  };
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
  const take = joiner();
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
  const queue: Uint8Array[] = [];

  const put = (sock: WebSocket, plain: Uint8Array) => {
    for (const part of split(plain, size)) sock.send(seal(o.key, part));
  };

  const connect = () => {
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
    sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', v: 1, room, token: null }));
    sock.onmessage = (ev) => {
      last = Date.now();
      if (typeof ev.data === 'string') {
        let msg: { t?: string; peers?: number; n?: number; frame?: number; beat?: number };
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'welcome') {
          welcomed = ready = true;
          down = false;
          if (msg.frame) size = Math.max(PART_HEAD + 1024, Math.min(MAX_PART, msg.frame - SEALING));
          // A half-open line never closes by itself: it is dropped and dialled again.
          const beat = msg.beat ?? 0;
          if (beat > 0) alive = setInterval(() => {
            if (Date.now() - last <= BEATS * beat) return;
            sock.onmessage = sock.onclose = null;
            sock.close();
            lost();
          }, beat);
          o.onOpen(msg.peers ?? 1);
          for (const m of queue.splice(0)) put(sock, m);
          if (fails < FAILS) o.onStatus('open');
          stable = setTimeout(() => {
            held = true;
            fails = 0;
            wait = 500;
            o.onStatus('open');
          }, STABLE_MS);
        } else if (msg.t === 'peers') o.onPeers(msg.n ?? 1);
        else if (msg.t === 'full') { closed = true; o.onStatus('full'); }
        return;
      }
      heard = last;
      let env: Uint8Array;
      // A frame sealed with another key or altered on the way is dropped.
      try { env = unseal(o.key, new Uint8Array(ev.data as ArrayBuffer)); } catch { return; }
      const plain = take(env);
      if (plain) o.onFrame(plain);
    };
    sock.onclose = lost;
  };
  connect();

  return {
    send(plain) {
      if (ws && ready && ws.readyState === WebSocket.OPEN) put(ws, plain);
      // What was typed while the line was down goes out on the next welcome; the sync
      // that follows it would carry it too, so the queue only saves a round trip.
      else if (queue.length < 256) queue.push(plain);
    },
    close() {
      closed = true;
      clearTimeout(timer);
      clearTimeout(stable);
      ws?.close();
      o.onStatus('closed');
    },
    heard: () => heard,
  };
}
