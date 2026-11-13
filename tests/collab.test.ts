// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import '../src/lib/editor/yjsRedo';
import { cipher, keyBytes, linkKeys, newKey, opened, roomId, seal, sessionLink, signed, unseal, viewLink, writeKeys } from '../src/lib/collab/key';
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

  it('seals the same frames with WebCrypto and without, so either opens the other', async () => {
    const key = keyBytes(newKey())!;
    const web = cipher(key), plain = cipher(key, undefined);
    for (const [from, to] of [[web, plain], [plain, web], [web, web]]) {
      const frame = await from.seal(text('Alpha'));
      expect(new TextDecoder().decode(await to.open(frame))).toBe('Alpha');
      expect(new TextDecoder().decode(unseal(key, frame))).toBe('Alpha');
      const bent = frame.slice();
      bent[bent.length - 1] ^= 1;
      await expect(to.open(bent)).rejects.toThrow();
    }
    await expect(web.open(seal(keyBytes(newKey())!, text('Alpha')))).rejects.toThrow();
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
    const order: string[] = [];
    const open = (name: string, id?: number) => new Promise<ReturnType<typeof openChannel>>((resolve) => {
      const ch = openChannel({
        url: `ws://127.0.0.1:${relay.port}/relay`, key, id,
        onFrame: (p) => { if (p.length > 1000) big.push(p); else got.push(`${name}:${new TextDecoder().decode(p)}`); order.push(`${name}:${p.length}`); return p[0] !== 33; },
        onPeers: (n) => peers.push(n),
        onStatus: () => {},
        onOpen: () => resolve(ch),
      });
    });
    const a = await open('a', 1);
    // Alone in the room, nothing goes to everyone.
    a.send(text('alone'));
    await new Promise((r) => setTimeout(r, 50));
    expect(frames.length).toBe(0);
    // One client without WebCrypto, as on a self-hosted http:// page, reads and is read alike.
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
    const b = await open('b', 2);
    delete (globalThis.crypto as { subtle?: unknown }).subtle;
    expect(globalThis.crypto.subtle).toBeDefined();
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
    // A short message overtakes a long one sent before it.
    expect(order.indexOf('b:2')).toBeLessThan(order.indexOf('b:50000'));
    expect(peers).toContain(3);
    // A frame the receiver calls chatter ('!') leaves the time it last heard the room unchanged.
    const before = c.heard();
    await new Promise((r) => setTimeout(r, 20));
    a.send(text('!chat'));
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toContain('c:!chat');
    expect(c.heard()).toBe(before);
    a.send(text('sync'));
    await new Promise((r) => setTimeout(r, 100));
    expect(c.heard()).toBeGreaterThan(before);
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

  it('holds a few unfinished messages per sender, so no sender keeps another\'s from arriving', async () => {
    const relay = await startRelay({ port: 0, maxFrame: 4096 });
    const key = keyBytes(newKey())!;
    const url = `ws://127.0.0.1:${relay.port}/relay`;
    const whole: [number, number][] = [];
    const open = (id: number) => new Promise<ReturnType<typeof openChannel>>((resolve) => {
      const ch = openChannel({ url, key, id, onFrame: (p, from) => whole.push([from, p.length]), onPeers: () => {}, onStatus: () => {}, onOpen: () => resolve(ch) });
    });
    await open(1);
    const writer = await open(2);
    const raw = new WebSocket(url);
    raw.binaryType = 'arraybuffer';
    await new Promise<void>((resolve) => {
      raw.onopen = () => raw.send(JSON.stringify({ t: 'hello', v: 2, room: roomId(key), token: null, id: 9, claim: newKey() }));
      raw.onmessage = () => resolve();
    });
    // Forty messages of two parts each: all first parts, then all second ones; in between,
    // another client's message in parts.
    const part = (msg: number, index: number) => {
      const env = new Uint8Array(17 + 2048);
      const v = new DataView(env.buffer);
      env[0] = 1;
      v.setUint32(5, msg);
      v.setUint32(9, index);
      v.setUint32(13, 2);
      const sealed = seal(key, env), out = new Uint8Array(4 + sealed.length);
      out.set(sealed, 4);
      return out;
    };
    for (let m = 0; m < 40; m++) raw.send(part(m, 0));
    await new Promise((r) => setTimeout(r, 100));
    writer.send(Uint8Array.from({ length: 50_000 }, (_, i) => i & 255));
    for (let m = 0; m < 40; m++) raw.send(part(m, 1));
    await new Promise((r) => setTimeout(r, 300));
    expect(whole.filter(([from]) => from === 2)).toEqual([[2, 50_000]]);
    // Each of the two others keeps the sender's last four.
    expect(whole.filter(([from]) => from === 9)).toEqual(Array(8).fill([9, 4096]));
    raw.close();
    await relay.close();
  });

  it('keeps a line whose messages wait behind a late beat tick, and drops a silent one', async () => {
    vi.useFakeTimers();
    type Sock = { onopen?: () => void; onmessage?: ((ev: { data: unknown }) => void) | null; closed?: boolean };
    const socks: Sock[] = [];
    vi.stubGlobal('WebSocket', class { constructor() { socks.push(this as Sock); } send() {} close() { (this as Sock).closed = true; } });
    try {
      const ch = openChannel({ url: 'ws://relay', key: keyBytes(newKey())!, id: 1, onFrame: () => {}, onPeers: () => {}, onStatus: () => {}, onOpen: () => {} });
      // A message is handled in order behind those before it, a few promise turns later.
      const say = async (m: object) => {
        socks[0].onmessage!({ data: JSON.stringify(m) });
        for (let i = 0; i < 5; i++) await Promise.resolve();
      };
      socks[0].onopen!();
      await say({ t: 'welcome', peers: 2, beat: 1000 });
      vi.advanceTimersByTime(1000);
      // The tab froze for ten seconds; its tick runs before the beats that came meanwhile.
      vi.setSystemTime(Date.now() + 10_000);
      vi.advanceTimersByTime(1000);
      await say({ t: 'peers', n: 2 });
      vi.advanceTimersByTime(1000);
      expect(socks.map((s) => !!s.closed)).toEqual([false]);
      vi.advanceTimersByTime(4000);
      expect(socks[0].closed).toBe(true);
      ch.close();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
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
