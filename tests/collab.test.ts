// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import '../src/lib/editor/yjsRedo';
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

  it('carries messages of any size between channels of one key through the relay, to one or all', async () => {
    // Frames the relay passes stay under its limit; longer messages arrive whole.
    const frames: number[] = [];
    const relay = await startRelay({ port: 0, maxFrame: 4096, tap: (d: Buffer) => frames.push(d.length) });
    const key = keyBytes(newKey())!;
    const got: string[] = [];
    const big: Uint8Array[] = [];
    const peers: number[] = [];
    const open = (name: string, id?: number) => new Promise<ReturnType<typeof openChannel>>((resolve) => {
      const ch = openChannel({
        url: `ws://127.0.0.1:${relay.port}/relay`, key, id,
        onFrame: (p) => (p.length > 1000 ? big.push(p) : got.push(`${name}:${new TextDecoder().decode(p)}`)),
        onPeers: (n) => peers.push(n),
        onStatus: () => {},
        onOpen: () => resolve(ch),
      });
    });
    const a = await open('a', 1);
    const b = await open('b', 2);
    const c = await open('c', 3);
    const long = (seed: number) => Uint8Array.from({ length: 50_000 }, (_, i) => (i * seed) & 255);
    a.send(long(7));
    b.send(text('ho'));
    b.send(long(13));
    a.send(text('hi'));
    a.send(long(9), 2);
    c.send(text('to a'), 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(got.sort()).toEqual(['a:ho', 'a:to a', 'b:hi', 'c:hi', 'c:ho']);
    expect(big.map((m) => m[1]).sort((x, y) => x - y)).toEqual([7, 7, 9, 13, 13]);
    expect(big.every((m) => m.length === 50_000 && m[2] === ((2 * m[1]) & 255))).toBe(true);
    expect(Math.max(...frames)).toBeLessThanOrEqual(4096);
    expect(peers).toContain(3);
    a.close();
    b.close();
    c.close();
    await relay.close();
  });
});

// A Y.Text holding "xdog." inside a list, edited; `undo` takes back the last edit. Each run
// ends by deleting the Y.Text and undoing that, which must bring back the text it held.
type Edit = (list: Y.Array<Y.Text>, undo: () => void) => void;
const restore: [string, Edit][] = [
  ['a copy split by a deletion', (l, undo) => { l.get(0).delete(1, 4); undo(); l.get(0).delete(2, 3); undo(); }],
  ['a copy split by typing', (l, undo) => { l.get(0).delete(1, 4); undo(); l.get(0).insert(2, '++'); }],
];

describe('shared undo', () => {
  it.each(restore)('restores text the same on its own doc, a peer and a reload: %s', (_name, edits) => {
    for (const gc of [true, false]) {
      const a = new Y.Doc({ gc }), b = new Y.Doc({ gc });
      a.on('update', (u: Uint8Array) => Y.applyUpdate(b, u));
      const list = a.getArray<Y.Text>('root');
      list.insert(0, [new Y.Text('xdog.')]);
      const um = new Y.UndoManager(list, { captureTimeout: 0 });
      const undo = () => { um.stopCapturing(); um.undo(); };
      edits(list, undo);
      const before = list.get(0).toString();
      list.delete(0, 1);
      undo();
      const reload = new Y.Doc();
      Y.applyUpdate(reload, Y.encodeStateAsUpdate(a));
      const text = (d: Y.Doc) => d.getArray<Y.Text>('root').get(0).toString();
      expect([text(b), text(reload)]).toEqual([text(a), text(a)]);
      expect(text(a)).toBe(before);
    }
  });
});
