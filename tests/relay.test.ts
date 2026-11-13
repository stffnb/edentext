// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
// @ts-expect-error plain JavaScript module, shipped as its own container
import { startRelay } from '../relay/server.mjs';

type Relay = { port: number; rooms: Map<string, Set<unknown>>; close(): Promise<void> };
type Client = { id: number; ws: WebSocket; text: Record<string, unknown>[]; bin: Buffer[]; got: number; closed: Promise<number> };

let relay: Relay | null = null;
afterEach(async () => { await relay?.close(); relay = null; });

const ROOM_A = 'aaaaaaaaaaaaaaaaaaaaaa';
const ROOM_B = 'bbbbbbbbbbbbbbbbbbbbbb';
const tick = () => new Promise((r) => setTimeout(r, 60));

let next = 100;
// A client with its id and the secret it claims the id by; `hello` overrides fields.
async function join(room: string, id = next++, claim = `claim-of-${id}`.padEnd(22, '-'), hello: Record<string, unknown> = {}): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${relay!.port}/relay`);
  const c: Client = { id, ws, text: [], bin: [], got: 0, closed: new Promise((r) => ws.on('close', (code) => r(code))) };
  // Receipts of the bytes sent are kept apart from the other messages.
  ws.on('message', (d, binary) => {
    const msg = binary ? null : JSON.parse(String(d));
    if (binary) c.bin.push(d as Buffer);
    else if (msg.t === 'got') c.got = msg.n;
    else c.text.push(msg);
  });
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ t: 'hello', v: 3, room, token: null, id, claim, ...hello }));
  await tick();
  return c;
}
const to = (id: number, ...bytes: number[]) => Buffer.from([0, 0, 0, id, ...bytes]);
// An upgrade with these headers: the open socket (101), or the HTTP status that refused it.
function dial(headers: Record<string, string> = {}): Promise<{ status: number; ws: WebSocket }> {
  const ws = new WebSocket(`ws://127.0.0.1:${relay!.port}/relay`, { headers });
  return new Promise((r) => {
    ws.on('open', () => r({ status: 101, ws }));
    ws.on('unexpected-response', (_req, res) => { r({ status: res.statusCode ?? 0, ws }); ws.terminate(); });
    ws.on('error', () => {});
  });
}

describe('collaboration relay', () => {
  it('passes frames within a room only, announces peers and forgets an empty room', async () => {
    relay = await startRelay({ port: 0 });
    const a = await join(ROOM_A), b = await join(ROOM_A), c = await join(ROOM_B);
    expect(a.text).toContainEqual({ t: 'welcome', peers: 1, frame: 16 << 20, beat: 5000 });
    expect(b.text).toContainEqual({ t: 'welcome', peers: 2, frame: 16 << 20, beat: 5000 });
    expect(a.text).toContainEqual({ t: 'peers', n: 2 });

    a.ws.send(to(0, 1, 2, 3));
    a.ws.send('not a frame');
    await tick();
    // Each frame arrives with its sender in front.
    expect(b.bin.map((x) => [...x])).toEqual([[0, 0, 0, a.id, 1, 2, 3]]);
    expect(a.bin.length + c.bin.length).toBe(0);
    // The sender hears how many of its binary bytes arrived.
    expect([a.got, b.got]).toEqual([7, 0]);

    b.ws.close();
    await tick();
    expect(a.text.at(-1)).toMatchObject({ t: 'peers', n: 1 });
    a.ws.close();
    c.ws.close();
    await tick();
    expect(relay!.rooms.size).toBe(0);
  });

  it('passes a frame with a receiver in front to that client alone, and says who left', async () => {
    relay = await startRelay({ port: 0 });
    const a = await join(ROOM_A, 1), b = await join(ROOM_A, 2), c = await join(ROOM_A, 3);
    a.ws.send(to(2, 7));
    a.ws.send(to(0, 8));
    a.ws.send(to(9, 9));
    await tick();
    expect(b.bin.map((x) => [...x])).toEqual([[0, 0, 0, 1, 7], [0, 0, 0, 1, 8]]);
    expect(c.bin.map((x) => [...x])).toEqual([[0, 0, 0, 1, 8]]);
    // A client dialling again takes its id over; its old line closing is no departure.
    const b2 = await join(ROOM_A, 2);
    a.ws.send(to(2, 6));
    b.ws.close();
    await tick();
    expect(b2.bin.map((x) => [...x])).toEqual([[0, 0, 0, 1, 6]]);
    expect(a.text.at(-1)).toEqual({ t: 'peers', n: 3 });
    c.ws.close();
    await tick();
    expect(a.text.at(-1)).toEqual({ t: 'peers', n: 2, gone: 3 });
    for (const x of [a, b2]) x.ws.close();
    expect(await (await join(ROOM_B, 2 ** 32)).closed).toBe(4000);
    expect(await (await join(ROOM_B, 5, 'short')).closed).toBe(4000);
  });

  it('tells the others a receiver is behind, and holds back a sender that ignores it', async () => {
    relay = await startRelay({ port: 0, backlog: 256 << 10, hold: 64 << 10 });
    const a = await join(ROOM_A, 1), b = await join(ROOM_A, 2);
    b.ws.pause();
    const frame = Buffer.alloc(64 << 10);
    for (let i = 0; i < 400; i++) a.ws.send(frame);
    let most = 0;
    for (let i = 0; i < 20; i++) {
      await tick();
      for (const w of relay.rooms.get(ROOM_A) as Set<WebSocket>) most = Math.max(most, w.bufferedAmount);
    }
    expect(most).toBeLessThan(2 * (256 << 10));
    expect(a.text).toContainEqual({ t: 'slow', id: 2 });
    // A client coming meanwhile hears who is behind.
    const c = await join(ROOM_A, 3);
    expect(c.text).toContainEqual({ t: 'slow', id: 2 });
    b.ws.resume();
    for (let i = 0; i < 100 && b.bin.length < 400; i++) await tick();
    expect(b.bin.length).toBe(400);
    for (let i = 0; i < 20 && !a.text.some((m) => m.t === 'drained'); i++) await tick();
    expect(a.text).toContainEqual({ t: 'drained', id: 2 });
    // One whose line ends while behind is drained too: its id may be back on a new line.
    a.text.splice(0);
    b.ws.pause();
    for (let i = 0; i < 400; i++) a.ws.send(frame);
    const heard = (t: string) => a.text.some((m) => m.t === t && m.id === 2);
    for (let i = 0; i < 100 && !heard('slow'); i++) await tick();
    b.ws.terminate();
    for (let i = 0; i < 100 && !heard('drained'); i++) await tick();
    expect(a.text).toContainEqual({ t: 'slow', id: 2 });
    expect(a.text).toContainEqual({ t: 'drained', id: 2 });
    c.ws.close();
  });

  it('drops a receiver that reads nothing for too long, and the one furthest behind past the budget', async () => {
    const frame = Buffer.alloc(64 << 10);
    relay = await startRelay({ port: 0, backlog: 256 << 10, hold: 64 << 10, stuckMs: 300 });
    const a = await join(ROOM_A, 1), b = await join(ROOM_A, 2), c = await join(ROOM_A, 3);
    b.ws.pause();
    for (let i = 0; i < 400; i++) a.ws.send(frame);
    const gone = () => a.text.some((m) => m.gone === 2);
    for (let i = 0; i < 40 && !gone(); i++) await tick();
    expect(gone()).toBe(true);
    // The sender held back for it reads again, and the others get everything.
    for (let i = 0; i < 100 && c.bin.length < 400; i++) await tick();
    expect(c.bin.length).toBe(400);
    expect(a.text).toContainEqual({ t: 'drained', id: 2 });
    for (const x of [a, c]) x.ws.close();
    b.ws.terminate();
    await relay!.close();

    // Three rooms whose receivers read nothing, each sender flooding: together they stay near the budget.
    const budget = 600 << 10;
    relay = await startRelay({ port: 0, backlog: 256 << 10, hold: 64 << 10, maxBuffered: budget });
    const pairs = [];
    for (const room of [ROOM_A, ROOM_B, 'cccccccccccccccccccccc']) {
      const s = await join(room, 1), r = await join(room, 2);
      r.ws.pause();
      pairs.push([s, r]);
    }
    for (let i = 0; i < 100; i++) for (const [s] of pairs) s.ws.send(frame);
    let most = 0, dropped = 0;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 10));
      let sum = 0;
      for (const room of relay!.rooms.values()) for (const w of room as Set<WebSocket>) sum += w.bufferedAmount;
      most = Math.max(most, sum);
    }
    for (const room of relay!.rooms.values()) dropped += 2 - room.size;
    expect(most).toBeLessThan(budget + (256 << 10));
    expect(dropped).toBeGreaterThanOrEqual(1);
    expect(pairs.every(([s]) => s.ws.readyState === WebSocket.OPEN)).toBe(true);
    for (const [s, r] of pairs) { s.ws.close(); r.ws.terminate(); }
  });

  it('keeps an id for the hello that claimed it first, also after its client left', async () => {
    relay = await startRelay({ port: 0 });
    const a = await join(ROOM_A, 1), b = await join(ROOM_A, 2);
    // Another connection naming b's id is refused: b still gets its frames, and nobody hears b left.
    const posing = await join(ROOM_A, 2, 'someone-else-entirely-x');
    expect(await posing.closed).toBe(4004);
    a.ws.send(to(2, 7));
    await tick();
    expect(b.bin.map((x) => [...x])).toEqual([[0, 0, 0, 1, 7]]);
    expect(a.text.some((m) => m.gone)).toBe(false);
    b.ws.close();
    await tick();
    expect(a.text.at(-1)).toEqual({ t: 'peers', n: 1, gone: 2 });
    expect(await (await join(ROOM_A, 2, 'someone-else-entirely-x')).closed).toBe(4004);
    const back = await join(ROOM_A, 2);
    a.ws.send(to(2, 8));
    await tick();
    expect(back.bin.map((x) => [...x])).toEqual([[0, 0, 0, 1, 8]]);
    a.ws.close();
    back.ws.close();
  });

  it('tells a client speaking another protocol version so, and a late hello from that apart', async () => {
    relay = await startRelay({ port: 0, helloWait: 100 });
    const old = await join(ROOM_A, 1, undefined, { v: 1 });
    expect(old.text).toEqual([{ t: 'version', v: 3 }]);
    expect(await old.closed).toBe(4002);
    // The app takes 4000 before its welcome for a relay of version 1; a slow line is not that.
    const mute = new WebSocket(`ws://127.0.0.1:${relay!.port}/relay`);
    expect(await new Promise((r) => mute.on('close', r))).toBe(4005);
  });

  it('beats to every client in a room as often as its welcome says, and not with beat 0', async () => {
    relay = await startRelay({ port: 0, beat: 40 });
    const a = await join(ROOM_A);
    await tick();
    expect(a.text[0]).toMatchObject({ t: 'welcome', beat: 40 });
    expect(a.text.filter((m) => m.t === 'beat').length).toBeGreaterThanOrEqual(1);
    a.ws.close();
    await relay!.close();
    relay = await startRelay({ port: 0, beat: 0 });
    const b = await join(ROOM_A);
    await tick();
    await tick();
    expect(b.text).toEqual([{ t: 'welcome', peers: 1, frame: 16 << 20 }]);
    b.ws.close();
  });

  it('refuses connections past the limit per address and in all, an address from a proxy only when trusted', async () => {
    // [relay options, X-Real-IP of each upgrade, the statuses expected]
    const cases: [Record<string, unknown>, string[], number[]][] = [
      [{}, ['a', 'a', 'a', 'a'], [101, 101, 101, 101]],
      [{ maxConnsPerIp: 2 }, ['a', 'b', 'c'], [101, 101, 429]],
      [{ maxConnsPerIp: 2, trustProxy: true }, ['a', 'a', 'a', 'b', 'b'], [101, 101, 429, 101, 101]],
      [{ maxConnsPerIp: 2, maxConns: 3, trustProxy: true }, ['a', 'b', 'c', 'd'], [101, 101, 101, 429]],
      [{ maxConnsPerIp: 1, trustProxy: true }, ['2001:db8::1', '2001:db8:0:0:ffff::2', '2001:db8:0:1::1'], [101, 429, 101]],
    ];
    for (const [options, ips, want] of cases) {
      relay = await startRelay({ port: 0, ...options });
      const got = [];
      for (const ip of ips) got.push(await dial({ 'X-Real-IP': ip }));
      expect(got.map((g) => g.status), JSON.stringify(options)).toEqual(want);
      // A connection that ends frees its place, also one that never said hello.
      const refused = want.lastIndexOf(429);
      if (refused >= 0) {
        got[refused - 1].ws.close();
        await tick();
        expect((await dial({ 'X-Real-IP': ips[refused] })).status, JSON.stringify(options)).toBe(101);
      }
      await relay!.close();
      relay = null;
    }
  });

  it('refuses a full room, an oversized frame and a missing hello', async () => {
    relay = await startRelay({ port: 0, maxPeers: 1, maxFrame: 256 });
    const a = await join(ROOM_A);
    const b = await join(ROOM_A);
    expect(b.text).toContainEqual({ t: 'full' });
    expect(await b.closed).toBe(4001);

    a.ws.send(Buffer.alloc(257));
    expect(await a.closed).toBe(1009);

    const bad = await join('short');
    expect(await bad.closed).toBe(4000);
  });
});
