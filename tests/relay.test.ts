// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
// @ts-expect-error plain JavaScript module, shipped as its own container
import { startRelay } from '../relay/server.mjs';

type Relay = { port: number; rooms: Map<string, Set<unknown>>; close(): Promise<void> };
type Client = { ws: WebSocket; text: Record<string, unknown>[]; bin: Buffer[]; closed: Promise<number> };

let relay: Relay | null = null;
afterEach(async () => { await relay?.close(); relay = null; });

const ROOM_A = 'aaaaaaaaaaaaaaaaaaaaaa';
const ROOM_B = 'bbbbbbbbbbbbbbbbbbbbbb';
const tick = () => new Promise((r) => setTimeout(r, 60));

async function join(room: string, id?: number): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${relay!.port}/relay`);
  const c: Client = { ws, text: [], bin: [], closed: new Promise((r) => ws.on('close', (code) => r(code))) };
  ws.on('message', (d, binary) => (binary ? c.bin.push(d as Buffer) : c.text.push(JSON.parse(String(d)))));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ t: 'hello', v: 1, room, token: null, ...(id ? { id } : {}) }));
  await tick();
  return c;
}

describe('collaboration relay', () => {
  it('passes frames within a room only, announces peers and forgets an empty room', async () => {
    relay = await startRelay({ port: 0 });
    const a = await join(ROOM_A), b = await join(ROOM_A), c = await join(ROOM_B);
    expect(a.text).toContainEqual({ t: 'welcome', peers: 1, frame: 16 << 20, beat: 15_000 });
    expect(b.text).toContainEqual({ t: 'welcome', peers: 2, frame: 16 << 20, beat: 15_000 });
    expect(a.text).toContainEqual({ t: 'peers', n: 2 });

    a.ws.send(Buffer.from([1, 2, 3]));
    a.ws.send('not a frame');
    await tick();
    expect(b.bin.map((x) => [...x])).toEqual([[1, 2, 3]]);
    expect(a.bin.length + c.bin.length).toBe(0);

    b.ws.close();
    await tick();
    expect(a.text.at(-1)).toEqual({ t: 'peers', n: 1 });
    a.ws.close();
    c.ws.close();
    await tick();
    expect(relay!.rooms.size).toBe(0);
  });

  it('passes a frame with a receiver in front to that client alone, and says who left', async () => {
    relay = await startRelay({ port: 0 });
    const a = await join(ROOM_A, 1), b = await join(ROOM_A, 2), c = await join(ROOM_A, 3), old = await join(ROOM_A);
    expect(a.text[0]).toEqual({ t: 'welcome', peers: 1, frame: 16 << 20, beat: 15_000, to: true });
    expect(old.text[0]).not.toHaveProperty('to');
    const to = (id: number, ...bytes: number[]) => Buffer.from([0, 0, 0, id, ...bytes]);
    a.ws.send(to(2, 7));
    a.ws.send(to(0, 8));
    a.ws.send(to(9, 9));
    await tick();
    expect(b.bin.map((x) => [...x])).toEqual([[7], [8]]);
    expect(c.bin.map((x) => [...x])).toEqual([[8]]);
    expect(old.bin.map((x) => [...x])).toEqual([[8]]);
    // A client dialling again takes its id over; its old line closing is no departure.
    const b2 = await join(ROOM_A, 2);
    a.ws.send(to(2, 6));
    b.ws.close();
    await tick();
    expect(b2.bin.map((x) => [...x])).toEqual([[6]]);
    expect(a.text.at(-1)).toEqual({ t: 'peers', n: 4 });
    c.ws.close();
    await tick();
    expect(a.text.at(-1)).toEqual({ t: 'peers', n: 3, gone: 3 });
    for (const x of [a, b2, old]) x.ws.close();
    expect(await (await join(ROOM_B, 2 ** 32)).closed).toBe(4000);
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

  it('refuses a full room, an oversized frame and a missing hello', async () => {
    relay = await startRelay({ port: 0, maxPeers: 1, maxFrame: 64 });
    const a = await join(ROOM_A);
    const b = await join(ROOM_A);
    expect(b.text).toContainEqual({ t: 'full' });
    expect(await b.closed).toBe(4001);

    a.ws.send(Buffer.alloc(65));
    expect(await a.closed).toBe(1009);

    const bad = await join('short');
    expect(await bad.closed).toBe(4000);
  });
});
