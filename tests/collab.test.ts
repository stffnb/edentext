// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { keyBytes, newKey, roomId, seal, sessionLink, unseal } from '../src/lib/collab/key';
import { openChannel } from '../src/lib/collab/channel';
// @ts-expect-error plain JavaScript module, shipped as its own container
import { startRelay } from '../relay/server.mjs';

const text = (s: string) => new TextEncoder().encode(s);

describe('collaboration key', () => {
  it('seals frames only the same key opens, and names a room that does not reveal it', () => {
    const k = newKey();
    const key = keyBytes(k)!;
    const other = keyBytes(newKey())!;
    const frame = seal(key, text('Alpha'));
    expect(new TextDecoder().decode(unseal(key, frame))).toBe('Alpha');
    expect(Buffer.from(frame).includes(Buffer.from('Alpha'))).toBe(false);
    expect(() => unseal(other, frame)).toThrow();
    const bent = frame.slice();
    bent[bent.length - 1] ^= 1;
    expect(() => unseal(key, bent)).toThrow();

    expect(roomId(key)).toBe(roomId(keyBytes(k)!));
    expect(roomId(key)).not.toBe(roomId(other));
    expect(k.includes(roomId(key))).toBe(false);

    const link = sessionLink(k, 'https://example.org/app/?x=1#old');
    expect(link).toBe(`https://example.org/app/?x=1#collab=${k}`);
    expect(keyBytes(k.slice(1))).toBeNull();
  });

  it('carries messages of any size between two channels of one key through the relay', async () => {
    // Frames the relay passes stay under its limit; longer messages arrive whole.
    const frames: number[] = [];
    const relay = await startRelay({ port: 0, maxFrame: 4096, tap: (d: Buffer) => frames.push(d.length) });
    const key = keyBytes(newKey())!;
    const got: string[] = [];
    const big: Uint8Array[] = [];
    const peers: number[] = [];
    const open = (name: string) => new Promise<ReturnType<typeof openChannel>>((resolve) => {
      const ch = openChannel({
        url: `ws://127.0.0.1:${relay.port}/relay`, key,
        onFrame: (p) => (p.length > 1000 ? big.push(p) : got.push(`${name}:${new TextDecoder().decode(p)}`)),
        onPeers: (n) => peers.push(n),
        onStatus: () => {},
        onOpen: () => resolve(ch),
      });
    });
    const a = await open('a');
    const b = await open('b');
    const long = (seed: number) => Uint8Array.from({ length: 50_000 }, (_, i) => (i * seed) & 255);
    a.send(long(7));
    b.send(text('ho'));
    b.send(long(13));
    a.send(text('hi'));
    await new Promise((r) => setTimeout(r, 300));
    expect(got.sort()).toEqual(['a:ho', 'b:hi']);
    expect(big.map((m) => m[1]).sort((x, y) => x - y)).toEqual([7, 13]);
    expect(big.every((m) => m.length === 50_000 && m[2] === ((2 * m[1]) & 255))).toBe(true);
    expect(Math.max(...frames)).toBeLessThanOrEqual(4096);
    expect(peers).toContain(2);
    a.close();
    b.close();
    await relay.close();
  });
});
