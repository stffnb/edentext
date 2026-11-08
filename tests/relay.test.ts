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

async function join(room: string): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${relay!.port}/relay`);
  const c: Client = { ws, text: [], bin: [], closed: new Promise((r) => ws.on('close', (code) => r(code))) };
  ws.on('message', (d, binary) => (binary ? c.bin.push(d as Buffer) : c.text.push(JSON.parse(String(d)))));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ t: 'hello', v: 1, room, token: null }));
  await tick();
  return c;
}

describe('collaboration relay', () => {
  it('passes frames within a room only, announces peers and forgets an empty room', async () => {
    relay = await startRelay({ port: 0 });
    const a = await join(ROOM_A), b = await join(ROOM_A), c = await join(ROOM_B);
    expect(a.text).toContainEqual({ t: 'welcome', peers: 1 });
    expect(b.text).toContainEqual({ t: 'welcome', peers: 2 });
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
