// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { keyBytes, linkKey, newKey, roomId, seal, sessionLink, unseal } from '../src/lib/collab/key';
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
    expect(linkKey(new URL(link).hash)).toBe(k);
    expect(keyBytes(k.slice(1))).toBeNull();
  });

  it('carries frames between two channels of one key through the relay', async () => {
    const relay = await startRelay({ port: 0 });
    const key = keyBytes(newKey())!;
    const got: string[] = [];
    const peers: number[] = [];
    const open = (name: string) => new Promise<ReturnType<typeof openChannel>>((resolve) => {
      const ch = openChannel({
        url: `ws://127.0.0.1:${relay.port}/relay`, key,
        onFrame: (p) => got.push(`${name}:${new TextDecoder().decode(p)}`),
        onPeers: (n) => peers.push(n),
        onStatus: () => {},
        onOpen: () => resolve(ch),
      });
    });
    const a = await open('a');
    const b = await open('b');
    a.send(text('hi'));
    b.send(text('ho'));
    await new Promise((r) => setTimeout(r, 100));
    expect(got.sort()).toEqual(['a:ho', 'b:hi']);
    expect(peers).toContain(2);
    a.close();
    b.close();
    await relay.close();
  });
});
