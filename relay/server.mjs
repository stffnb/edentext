// The collaboration relay: passes encrypted frames between the clients of one room. It
// never sees a key, keeps nothing on disk and logs no room or content; a room lives in
// memory while someone is in it. Protocol and limits: relay/CLAUDE.md.
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOM = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Starts a relay on `port` (0 picks a free one). `maxPeers` 0 means no limit per room;
 * `tap` sees every passed frame (tests check it holds no plain text). Resolves once
 * listening, with the port and a way to close it.
 */
export function startRelay({ port = 4390, host, maxPeers = 0, maxFrame = 16 << 20, maxRooms = 10000, path = '/relay', tap } = {}) {
  /** @type {Map<string, Set<import('ws').WebSocket>>} */
  const rooms = new Map();
  // Behind a proxy that passes `/relay` on unchanged, the app asks `/relay/health`.
  const health = new Set(['/health', `${path}/health`]);
  const http = createServer((req, res) => {
    const ok = health.has(req.url ?? '');
    res.writeHead(ok ? 200 : 404, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    res.end(ok ? 'ok' : '');
  });
  const wss = new WebSocketServer({ server: http, path, maxPayload: maxFrame });

  const send = (ws, msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
  const announce = (peers, except) => { for (const ws of peers) if (ws !== except) send(ws, { t: 'peers', n: peers.size }); };

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
        if (hello?.t !== 'hello' || hello.v !== 1 || !ROOM.test(hello.room ?? '')) return ws.close(4000, 'hello');
        let peers = rooms.get(hello.room);
        if (!peers && rooms.size >= maxRooms) return ws.close(4003, 'busy');
        if (peers && maxPeers && peers.size >= maxPeers) { send(ws, { t: 'full' }); return ws.close(4001, 'full'); }
        if (!peers) rooms.set(hello.room, (peers = new Set()));
        clearTimeout(timer);
        room = hello.room;
        peers.add(ws);
        send(ws, { t: 'welcome', peers: peers.size });
        announce(peers, ws);
        return;
      }
      if (!binary) return;
      tap?.(data);
      for (const peer of rooms.get(room) ?? []) if (peer !== ws && peer.readyState === peer.OPEN) peer.send(data, { binary: true });
    });

    ws.on('close', () => {
      clearTimeout(timer);
      const peers = room && rooms.get(room);
      if (!peers) return;
      peers.delete(ws);
      if (peers.size) announce(peers);
      else rooms.delete(room);
    });
    ws.on('error', () => ws.terminate());
  });

  // A connection that misses a ping round is gone (a laptop lid closed, a dead network).
  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, 30_000);

  return new Promise((resolve) => {
    http.listen(port, host, () => resolve({
      port: http.address().port,
      rooms,
      close: () => new Promise((done) => {
        clearInterval(ping);
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
    maxPeers: env('MAX_PEERS', 0),
    maxFrame: env('MAX_FRAME', 16 << 20),
    maxRooms: env('MAX_ROOMS', 10000),
  });
  console.log(`relay listening on ${relay.port}`);
  const stop = () => relay.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
