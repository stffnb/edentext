// The collaboration relay: passes encrypted frames between the clients of one room. It
// never sees a key, keeps nothing on disk and logs no room or content; a room lives in
// memory while someone is in it. Protocol and limits: relay/CLAUDE.md.
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOM = /^[A-Za-z0-9_-]{16,64}$/;
const ID = (v) => Number.isInteger(v) && v > 0 && v < 2 ** 32;
const CLAIM = /^[A-Za-z0-9_-]{22,64}$/;
// The protocol this relay speaks; a hello with another `v` gets `version` and close 4002.
const VERSION = 2;
// Ids a room remembers, live or gone; past it the oldest gone one is forgotten.
const MAX_IDS = 256;

/**
 * Starts a relay on `port` (0 picks a free one). `maxPeers` 0 means no limit per room;
 * `tap` sees every passed frame (tests check it holds no plain text); `lag` (tests only)
 * delays each frame by its ms per receiver, in order per sender, so senders overtake each
 * other. A connection that misses a `ping` round is dropped, so its client is gone within
 * two rounds. Resolves once listening, with the port and a way to close it.
 */
export function startRelay({ port = 4390, host, maxPeers = 0, maxFrame = 16 << 20, maxRooms = 10000, beat = 15_000, ping: every = 5000, path = '/relay', tap, lag } = {}) {
  /** @type {Map<string, Set<import('ws').WebSocket>>} */
  const rooms = new Map();
  // Per room, each client id with the secret its first hello claimed it by, and its socket
  // while it is there: a frame's `to` finds it, and no other connection can take the id.
  /** @type {Map<string, Map<number, { claim: string, ws: import('ws').WebSocket | null }>>} */
  const ids = new Map();
  // Behind a proxy that passes `/relay` on unchanged, the app asks `/relay/health`.
  const health = new Set(['/health', `${path}/health`]);
  const http = createServer((req, res) => {
    const ok = health.has(req.url ?? '');
    res.writeHead(ok ? 200 : 404, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    res.end(ok ? 'ok' : '');
  });
  const wss = new WebSocketServer({ server: http, path, maxPayload: maxFrame });

  const send = (ws, msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
  const announce = (peers, except, gone) => {
    for (const ws of peers) if (ws !== except) send(ws, { t: 'peers', n: peers.size, ...(gone ? { gone } : {}) });
  };
  const pass = (from, to, data) => {
    const ms = lag?.() ?? 0;
    if (!ms && !from.due?.get(to)) return to.send(data, { binary: true });
    // Never before an earlier frame of the same sender: one connection keeps its order.
    const at = Math.max(Date.now() + ms, (from.due ??= new Map()).get(to) ?? 0);
    from.due.set(to, at);
    setTimeout(() => { if (from.due.get(to) === at) from.due.delete(to); if (to.readyState === to.OPEN) to.send(data, { binary: true }); }, at - Date.now());
  };

  wss.on('connection', (ws) => {
    let room = null;
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    // The hello has to come first and within a few seconds.
    const timer = setTimeout(() => { if (!room) ws.close(4000, 'hello'); }, 5000);

    ws.on('message', (data, binary) => {
      if (!room) {
        let hello;
        try { hello = binary ? null : JSON.parse(String(data)); } catch { hello = null; }
        if (hello?.t === 'hello' && hello.v !== VERSION) { send(ws, { t: 'version', v: VERSION }); return ws.close(4002, 'version'); }
        if (hello?.t !== 'hello' || !ROOM.test(hello.room ?? '') || !ID(hello.id) || !CLAIM.test(hello.claim ?? '')) return ws.close(4000, 'hello');
        let peers = rooms.get(hello.room);
        if (!peers && rooms.size >= maxRooms) return ws.close(4003, 'busy');
        // An id belongs to the hello that first claimed it; a redial with that claim takes it over.
        const named = ids.get(hello.room) ?? new Map();
        const owner = named.get(hello.id);
        if (owner && owner.claim !== hello.claim) return ws.close(4004, 'id');
        // Paid rooms will lift this limit with `hello.token`.
        if (peers && maxPeers && peers.size >= maxPeers) { send(ws, { t: 'full' }); return ws.close(4001, 'full'); }
        if (!peers) rooms.set(hello.room, (peers = new Set()));
        clearTimeout(timer);
        room = hello.room;
        peers.add(ws);
        ws.id = hello.id;
        ids.set(room, named);
        named.delete(ws.id);
        named.set(ws.id, { claim: hello.claim, ws });
        if (named.size > MAX_IDS) for (const [id, o] of named) if (!o.ws) { named.delete(id); break; }
        send(ws, { t: 'welcome', peers: peers.size, frame: maxFrame, ...(beat ? { beat } : {}) });
        announce(peers, ws);
        return;
      }
      if (!binary) return;
      tap?.(data);
      if (data.length < 4) return;
      const to = data.readUInt32BE(0), sealed = data.subarray(4);
      if (to) {
        const peer = ids.get(room)?.get(to)?.ws;
        if (peer && peer !== ws && peer.readyState === peer.OPEN) pass(ws, peer, sealed);
        return;
      }
      for (const peer of rooms.get(room) ?? []) if (peer !== ws && peer.readyState === peer.OPEN) pass(ws, peer, sealed);
    });

    ws.on('close', () => {
      clearTimeout(timer);
      const peers = room && rooms.get(room);
      if (!peers) return;
      peers.delete(ws);
      // Only the id's current socket leaving means its client is gone; a replaced one does not.
      // The id stays claimed, so only its client can come back under it.
      const owner = ids.get(room)?.get(ws.id);
      const gone = owner?.ws === ws ? ws.id : 0;
      if (gone) owner.ws = null;
      if (peers.size) announce(peers, null, gone);
      else { rooms.delete(room); ids.delete(room); }
    });
    ws.on('error', () => ws.terminate());
  });

  // A connection that misses a ping round is gone (a laptop lid closed, a dead network); a
  // pong is answered below the page's scripts, so a busy tab still gives one.
  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, every);
  // A beat to every client in a room, so a client notices a line that died without a close.
  const beats = beat ? setInterval(() => {
    for (const peers of rooms.values()) for (const ws of peers) send(ws, { t: 'beat' });
  }, beat) : undefined;

  return new Promise((resolve) => {
    http.listen(port, host, () => resolve({
      port: http.address().port,
      rooms,
      close: () => new Promise((done) => {
        clearInterval(ping);
        clearInterval(beats);
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => http.close(() => done()));
      }),
    }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = (name, fallback) => (process.env[name] ? Number(process.env[name]) : fallback);
  const relay = await startRelay({
    port: env('PORT', 4390),
    host: process.env.HOST,
    maxPeers: env('MAX_PEERS', 6),
    maxFrame: env('MAX_FRAME', 16 << 20),
    maxRooms: env('MAX_ROOMS', 10000),
    beat: env('BEAT_MS', 15_000),
    ping: env('PING_MS', 5000),
  });
  console.log(`relay listening on ${relay.port}`);
  const stop = () => relay.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
