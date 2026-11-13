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
const VERSION = 3;
// Ids a room remembers, live or gone; past it the oldest gone one is forgotten.
const MAX_IDS = 256;
// A receiver holding more than `hold` bytes not yet sent is announced `slow` to the others, whose
// pictures wait until it is `drained` (half of it); past `backlog` the relay stops reading the
// sender that filled it, a cap for a client that ignores the announcement.
const DRAIN_MS = 50;
// Each sender hears how many of its binary bytes arrived (`got`), at once past ACK_BYTES, else
// after ACK_MS, so it can keep little in flight on a slow uplink (`channel.ts`).
const ACK_BYTES = 32 << 10;
const ACK_MS = 20;
// A receiver held past `backlog` for `stuckMs` reads nothing and is dropped; so is the one
// furthest behind while all together hold more than `maxBuffered`. Checked every SWEEP_MS, at
// most every DRAIN_MS while a receiver holds more than `hold`, and on each frame past `backlog`.
const SWEEP_MS = 1000;

// Where a connection comes from, for the limit per address: the socket's, or behind a trusted
// proxy the `X-Real-IP` it sets. An IPv6 address counts by its /64, which one host holds whole.
function address(req, trustProxy) {
  const header = trustProxy ? req.headers['x-real-ip'] : undefined;
  let ip = String((typeof header === 'string' && header.trim()) || req.socket.remoteAddress || '');
  if (ip.startsWith('::ffff:') && ip.includes('.')) ip = ip.slice(7);
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('%')[0].toLowerCase().split('::');
  const a = head ? head.split(':') : [], b = ip.includes('::') && tail ? tail.split(':') : [];
  const groups = [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

/**
 * Starts a relay on `port` (0 picks a free one). `maxPeers` 0 means no limit per room;
 * `tap` sees every passed frame (tests check it holds no plain text); `lag` (tests only)
 * delays each frame by its ms per receiver, in order per sender, so senders overtake each
 * other. A connection that misses a `ping` round is dropped, so its client is gone within
 * two rounds. Resolves once listening, with the port and a way to close it.
 */
export function startRelay({ port = 4390, host, maxPeers = 0, maxFrame = 16 << 20, maxRooms = 10000, maxConns = 0, maxConnsPerIp = 0, trustProxy = false, stuckMs = 0, maxBuffered = 0, beat = 5000, ping: every = 5000, helloWait = 5000, path = '/relay', backlog = 16 << 20, hold = 2 << 20, tap, lag } = {}) {
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
  // Connections open, in all and per address, counted from the upgrade to the socket's end
  // (before its hello too); past either limit an upgrade gets 429 and no WebSocket.
  let open = 0;
  const perAddress = new Map();
  const admit = ({ req }, done) => {
    const ip = address(req, trustProxy);
    if ((maxConns && open >= maxConns) || (maxConnsPerIp && (perAddress.get(ip) ?? 0) >= maxConnsPerIp)) return done(false, 429);
    open++;
    perAddress.set(ip, (perAddress.get(ip) ?? 0) + 1);
    req.socket.once('close', () => {
      open--;
      const n = perAddress.get(ip) - 1;
      if (n) perAddress.set(ip, n); else perAddress.delete(ip);
    });
    done(true);
  };
  const wss = new WebSocketServer({ server: http, path, maxPayload: maxFrame, verifyClient: admit });

  const send = (ws, msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
  const announce = (peers, except, gone) => {
    for (const ws of peers) if (ws !== except) send(ws, { t: 'peers', n: peers.size, ...(gone ? { gone } : {}) });
  };
  const full = (ws, limit) => ws.readyState === ws.OPEN && ws.bufferedAmount > limit;
  const others = (ws, msg) => { for (const p of rooms.get(ws.room) ?? []) if (p !== ws) send(p, msg); };
  const slow = (to) => {
    to.slow = true;
    others(to, { t: 'slow', id: to.id });
    // A line that ended holds nothing either: its id may be back on a new one already.
    const wait = setInterval(() => {
      if (full(to, hold / 2)) return;
      clearInterval(wait);
      to.slow = false;
      others(to, { t: 'drained', id: to.id });
    }, DRAIN_MS);
  };
  // Dropped without a close handshake, which a receiver that reads nothing would never finish;
  // its client sees the line end and dials again.
  let checked = 0;
  const behind = () => {
    const now = checked = Date.now();
    let total = 0;
    const open = [];
    for (const ws of wss.clients) {
      const n = ws.readyState === ws.OPEN ? ws.bufferedAmount : 0;
      if (n <= backlog) ws.stuck = undefined;
      else if (stuckMs && now - (ws.stuck ??= now) >= stuckMs) { ws.terminate(); continue; }
      total += n;
      if (n) open.push([n, ws]);
    }
    if (!maxBuffered || total <= maxBuffered) return;
    for (const [n, ws] of open.sort((x, y) => y[0] - x[0])) {
      ws.terminate();
      if ((total -= n) <= maxBuffered) return;
    }
  };
  const deliver = (from, to, data) => {
    to.send(data, { binary: true });
    if (!to.slow && full(to, hold)) slow(to);
    if (to.slow && (stuckMs || maxBuffered) && (full(to, backlog) || Date.now() - checked >= DRAIN_MS)) behind();
    if (!full(to, backlog) || from.isPaused || from.readyState !== from.OPEN) return;
    from.pause();
    const wait = setInterval(() => {
      if (from.readyState === from.OPEN && [...(rooms.get(from.room) ?? [])].some((p) => p !== from && full(p, backlog / 2))) return;
      clearInterval(wait);
      if (from.readyState !== from.OPEN) return;
      from.alive = true;
      from.resume();
    }, DRAIN_MS);
  };
  const receipt = (ws) => { ws.ackTimer = undefined; if (ws.got !== ws.acked) send(ws, { t: 'got', n: (ws.acked = ws.got) }); };
  const counted = (ws, n) => {
    ws.got = (ws.got ?? 0) + n;
    if (ws.got - (ws.acked ?? 0) < ACK_BYTES) { ws.ackTimer ??= setTimeout(receipt, ACK_MS, ws); return; }
    clearTimeout(ws.ackTimer);
    receipt(ws);
  };
  const pass = (from, to, data) => {
    const ms = lag?.() ?? 0;
    if (!ms && !from.due?.get(to)) return deliver(from, to, data);
    // Never before an earlier frame of the same sender: one connection keeps its order.
    const at = Math.max(Date.now() + ms, (from.due ??= new Map()).get(to) ?? 0);
    from.due.set(to, at);
    setTimeout(() => { if (from.due.get(to) === at) from.due.delete(to); if (to.readyState === to.OPEN) deliver(from, to, data); }, at - Date.now());
  };

  wss.on('connection', (ws) => {
    let room = null;
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    // The hello has to come first and within a few seconds; a late one closes with 4005, not
    // 4000, so a slow line is not taken for a relay that cannot read the hello.
    const timer = setTimeout(() => { if (!room) ws.close(4005, 'late'); }, helloWait);

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
        room = ws.room = hello.room;
        peers.add(ws);
        ws.id = hello.id;
        ids.set(room, named);
        named.delete(ws.id);
        named.set(ws.id, { claim: hello.claim, ws });
        if (named.size > MAX_IDS) for (const [id, o] of named) if (!o.ws) { named.delete(id); break; }
        send(ws, { t: 'welcome', peers: peers.size, frame: maxFrame, ...(beat ? { beat } : {}) });
        for (const p of peers) if (p.slow && p !== ws) send(ws, { t: 'slow', id: p.id });
        announce(peers, ws);
        return;
      }
      if (!binary) return;
      counted(ws, data.length);
      tap?.(data);
      if (data.length < 4) return;
      // The receiver in front makes way for the sender, which no client can forge.
      const to = data.readUInt32BE(0);
      data.writeUInt32BE(ws.id, 0);
      if (to) {
        const peer = ids.get(room)?.get(to)?.ws;
        if (peer && peer !== ws && peer.readyState === peer.OPEN) pass(ws, peer, data);
        return;
      }
      for (const peer of rooms.get(room) ?? []) if (peer !== ws && peer.readyState === peer.OPEN) pass(ws, peer, data);
    });

    ws.on('close', () => {
      clearTimeout(timer);
      clearTimeout(ws.ackTimer);
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
      // A paused sender cannot answer; it is dropped only once it reads again.
      if (ws.isPaused) continue;
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, every);
  const sweep = stuckMs || maxBuffered ? setInterval(behind, Math.min(SWEEP_MS, stuckMs / 4 || SWEEP_MS)) : undefined;
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
        clearInterval(sweep);
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
    maxFrame: env('MAX_FRAME', 1 << 20),
    maxRooms: env('MAX_ROOMS', 10000),
    maxConns: env('MAX_CONNS', 2000),
    maxConnsPerIp: env('MAX_CONNS_PER_IP', 20),
    trustProxy: process.env.TRUST_PROXY === '1',
    stuckMs: env('STUCK_MS', 30_000),
    maxBuffered: env('MAX_BUFFERED', 256 << 20),
    beat: env('BEAT_MS', 5000),
    ping: env('PING_MS', 5000),
  });
  console.log(`relay listening on ${relay.port}`);
  const stop = () => relay.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
