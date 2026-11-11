// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import '../src/lib/editor/yjsRedo';
import { keyBytes, linkKeys, newKey, opened, roomId, seal, sessionLink, signed, unseal, viewLink, writeKeys } from '../src/lib/collab/key';
import { openChannel } from '../src/lib/collab/channel';
import { WebSocketServer } from 'ws';
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

  it('gives a read link that reaches the same room and opens frames but cannot sign', () => {
    const k = newKey();
    const w = linkKeys(`collab=${k}`)!;
    expect(w).toEqual(writeKeys(k));
    const view = viewLink(w, 'https://example.org/app/#x');
    const r = linkKeys(view.slice(view.indexOf('#') + 1))!;
    expect(r.sign).toBeNull();
    expect(r.secret).toBeNull();
    expect(roomId(r.read)).toBe(roomId(w.read));
    // Neither key in the read link is the secret or the signing seed.
    const shown = [...view.slice(view.indexOf('=') + 1).split('.')].map((t) => keyBytes(t)!);
    for (const t of shown) for (const hidden of [keyBytes(k)!, w.sign!]) expect(Buffer.from(t).equals(Buffer.from(hidden))).toBe(false);
    expect(new TextDecoder().decode(unseal(r.read, seal(w.read, text('Alpha'))))).toBe('Alpha');
    for (const bad of ['view=', `view=${k}`, `view=${k}.${k}.${k}`, `collab=${k.slice(1)}`, `other=${k}`]) expect(linkKeys(bad)).toBeNull();

    // A signed message opens as itself; unsigned, altered or signed by another key it does not.
    const message = Uint8Array.from({ length: 3000 }, (_, i) => i & 255);
    const sealed = signed(w.sign!, message);
    expect(opened(r.verify, sealed)).toEqual(message);
    expect(opened(r.verify, message)).toBeNull();
    for (const at of [0, 1500, sealed.length - 1]) {
      const bent = sealed.slice();
      bent[at] ^= 1;
      expect(opened(r.verify, bent)).toBeNull();
    }
    expect(opened(r.verify, signed(writeKeys(newKey())!.sign!, message))).toBeNull();
    expect(opened(r.verify, new Uint8Array(10))).toBeNull();
  });

  it('carries messages of any size between channels of one key through the relay, to one or all', async () => {
    // Frames the relay passes stay under its limit; longer messages arrive whole.
    const frames: number[] = [];
    const relay = await startRelay({ port: 0, maxFrame: 4096, tap: (d: Buffer) => frames.push(d.length) });
    const writer = writeKeys(newKey())!;
    const key = writer.read;
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
    // Signed whole, split into parts and put together again, the signature still holds.
    a.send(signed(writer.sign!, long(11)), 3);
    c.send(text('to a'), 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(got.sort()).toEqual(['a:ho', 'a:to a', 'b:hi', 'c:hi', 'c:ho']);
    const sig = big.filter((m) => m.length > 50_000);
    expect(sig.length).toBe(1);
    expect(opened(writer.verify, sig[0])).toEqual(long(11));
    const plain = big.filter((m) => m.length === 50_000);
    expect(plain.map((m) => m[1]).sort((x, y) => x - y)).toEqual([7, 7, 9, 13, 13]);
    expect(plain.every((m) => m[2] === ((2 * m[1]) & 255))).toBe(true);
    expect(Math.max(...frames)).toBeLessThanOrEqual(4096);
    expect(peers).toContain(3);
    a.close();
    b.close();
    c.close();
    await relay.close();
  });

  it('says so instead of redialling when the relay speaks another protocol version', async () => {
    // A relay before version 2 closes every hello it cannot read with 4000.
    const old = new WebSocketServer({ port: 0 });
    let hellos = 0;
    old.on('connection', (ws) => ws.on('message', () => { hellos++; ws.close(4000, 'hello'); }));
    const port = (old.address() as { port: number }).port;
    const seen: string[] = [];
    const ch = openChannel({ url: `ws://127.0.0.1:${port}`, key: keyBytes(newKey())!, id: 1, onFrame: () => {}, onPeers: () => {}, onStatus: (s) => seen.push(s), onOpen: () => {} });
    await new Promise((r) => setTimeout(r, 1500));
    expect([seen.at(-1), hellos]).toEqual(['mismatch', 1]);
    ch.close();
    old.close();
  });

  it('holds only a bounded number of unfinished messages, whoever sends the parts', async () => {
    const relay = await startRelay({ port: 0 });
    const key = keyBytes(newKey())!;
    const url = `ws://127.0.0.1:${relay.port}/relay`;
    let whole = 0;
    await new Promise<void>((resolve) => openChannel({ url, key, id: 1, onFrame: () => whole++, onPeers: () => {}, onStatus: () => {}, onOpen: () => resolve() }));
    const raw = new WebSocket(url);
    raw.binaryType = 'arraybuffer';
    await new Promise<void>((resolve) => {
      raw.onopen = () => raw.send(JSON.stringify({ t: 'hello', v: 2, room: roomId(key), token: null, id: 9, claim: newKey() }));
      raw.onmessage = () => resolve();
    });
    // Forty messages of two parts each: all first parts, then all second ones.
    const part = (msg: number, index: number) => {
      const env = new Uint8Array(17 + 2048);
      const v = new DataView(env.buffer);
      env[0] = 1;
      v.setUint32(5, msg);
      v.setUint32(9, index);
      v.setUint32(13, 2);
      return seal(key, env);
    };
    const to0 = (frame: Uint8Array) => { const out = new Uint8Array(4 + frame.length); out.set(frame, 4); return out; };
    for (const index of [0, 1]) for (let m = 0; m < 40; m++) raw.send(to0(part(m, index)));
    await new Promise((r) => setTimeout(r, 300));
    expect(whole).toBe(16);
    raw.close();
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
