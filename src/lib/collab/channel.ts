import { roomId, seal, unseal } from './key';

export type ChannelStatus = 'connecting' | 'open' | 'full' | 'unreachable' | 'closed';

export type Channel = {
  send(plain: Uint8Array): void;
  close(): void;
};

type Options = {
  url: string;
  key: Uint8Array;
  onFrame(plain: Uint8Array): void;
  onPeers(n: number): void;
  onStatus(s: ChannelStatus): void;
  /** Each time the socket is (re)opened, so the session can sync again. */
  onOpen(): void;
};

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

/** A sealed, self-reconnecting line to the others in the key's room. */
export function openChannel(o: Options): Channel {
  const room = roomId(o.key);
  let ws: WebSocket | null = null;
  let closed = false;
  let wait = 500;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const queue: Uint8Array<ArrayBuffer>[] = [];

  const connect = () => {
    o.onStatus('connecting');
    const sock = new WebSocket(o.url);
    sock.binaryType = 'arraybuffer';
    ws = sock;
    let welcomed = false;
    sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', v: 1, room, token: null }));
    sock.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        let msg: { t?: string; peers?: number; n?: number };
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'welcome') {
          welcomed = true;
          wait = 500;
          o.onStatus('open');
          o.onPeers(msg.peers ?? 1);
          o.onOpen();
          for (const f of queue.splice(0)) sock.send(f);
        } else if (msg.t === 'peers') o.onPeers(msg.n ?? 1);
        else if (msg.t === 'full') { closed = true; o.onStatus('full'); }
        return;
      }
      let plain: Uint8Array;
      // A frame sealed with another key or altered on the way is dropped.
      try { plain = unseal(o.key, new Uint8Array(ev.data as ArrayBuffer)); } catch { return; }
      o.onFrame(plain);
    };
    sock.onclose = () => {
      if (ws === sock) ws = null;
      if (closed) return;
      o.onStatus(welcomed ? 'connecting' : 'unreachable');
      timer = setTimeout(connect, wait);
      wait = Math.min(wait * 2, 10_000);
    };
  };
  connect();

  return {
    send(plain) {
      const frame = seal(o.key, plain);
      if (ws?.readyState === WebSocket.OPEN) ws.send(frame);
      // What was typed while the line was down goes out on the next welcome; the sync
      // that follows it would carry it too, so the queue only saves a round trip.
      else if (queue.length < 256) queue.push(frame);
    },
    close() {
      closed = true;
      clearTimeout(timer);
      ws?.close();
      o.onStatus('closed');
    },
  };
}
