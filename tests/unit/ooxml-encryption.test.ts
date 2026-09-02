import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { ecb } from '@noble/ciphers/aes.js';
import { sha1 } from '@noble/hashes/legacy.js';
import { readCfb, writeCfb } from '../../src/lib/crypto/cfb';
import { encryptOoxml, decryptOoxml } from '../../src/lib/crypto/ooxml';
import { isProtected, WRONG_PASSWORD, UNSUPPORTED_ENCRYPTION } from '../../src/lib/crypto/protect';

const PW = 'geheim123';

function plainDocx(text = 'Hello'): Uint8Array {
  return zipSync({
    '[Content_Types].xml': [strToU8('<?xml version="1.0"?><Types/>'), { level: 6 }],
    '_rels/.rels': [strToU8('<?xml version="1.0"?><Relationships/>'), { level: 6 }],
    'word/document.xml': [strToU8(`<?xml version="1.0"?><w:document><w:body>${text}</w:body></w:document>`), { level: 6 }],
  });
}

// The older standard encryption, which is what LibreOffice writes for .docx: one
// AES-ECB key from an iterated SHA-1, and a verifier instead of an authenticated mode.
function standardEncrypted(password: string, plain: Uint8Array): Uint8Array {
  const concat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const le32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
  const utf16 = (t: string) => { const b = new Uint8Array(t.length * 2); const d = new DataView(b.buffer); for (let i = 0; i < t.length; i++) d.setUint16(i * 2, t.charCodeAt(i), true); return b; };
  const salt = new Uint8Array(16).fill(9);
  let h = sha1(concat(salt, utf16(password)));
  for (let i = 0; i < 50_000; i++) h = sha1(concat(le32(i), h));
  h = sha1(concat(h, le32(0)));
  const block = (pad: number) => { const b = new Uint8Array(64).fill(pad); for (let i = 0; i < h.length; i++) b[i] = h[i] ^ pad; return sha1(b); };
  const key = concat(block(0x36), block(0x5c)).subarray(0, 32);
  const encrypt = (data: Uint8Array) => ecb(key, { disablePadding: true }).encrypt(data);

  const verifier = new Uint8Array(16).fill(4);
  const info = new Uint8Array(8 + 4 + 32 + 4 + 16 + 16 + 4 + 32);
  const view = new DataView(info.buffer);
  view.setUint16(0, 3, true); view.setUint16(2, 2, true); view.setUint32(4, 0x24, true);
  view.setUint32(8, 32, true);          // header size
  view.setUint32(12 + 8, 0x6610, true); // AES-256
  view.setUint32(12 + 16, 256, true);   // key size in bits
  const at = 12 + 32;
  view.setUint32(at, 16, true);
  info.set(salt, at + 4);
  info.set(encrypt(verifier), at + 20);
  view.setUint32(at + 36, 20, true);
  info.set(encrypt(new Uint8Array(32).map((_, i) => sha1(verifier)[i] ?? 0)), at + 40);

  const padded = new Uint8Array(Math.ceil(plain.length / 16) * 16);
  padded.set(plain);
  const stream = new Uint8Array(8 + padded.length);
  new DataView(stream.buffer).setBigUint64(0, BigInt(plain.length), true);
  stream.set(encrypt(padded), 8);
  return writeCfb([['EncryptionInfo', info], ['EncryptedPackage', stream]]);
}

describe('OOXML standard encryption', () => {
  it('reads a package encrypted the older way', async () => {
    const plain = plainDocx('Standard');
    const files = unzipSync(await decryptOoxml(standardEncrypted(PW, plain), PW));
    expect(strFromU8(files['word/document.xml'])).toContain('Standard');
  });

  it('rejects a wrong password by its verifier', async () => {
    await expect(decryptOoxml(standardEncrypted(PW, plainDocx()), 'falsch')).rejects.toThrow(WRONG_PASSWORD);
  });
});

describe('OOXML agile encryption', () => {
  it('round-trips a package', async () => {
    const encrypted = await encryptOoxml(plainDocx('Round trip'), PW);
    const files = unzipSync(await decryptOoxml(encrypted, PW));
    expect(strFromU8(files['word/document.xml'])).toContain('Round trip');
  });

  it('writes the two streams a reader looks for', async () => {
    const streams = readCfb(await encryptOoxml(plainDocx(), PW));
    expect([...streams.keys()].sort()).toEqual(['EncryptedPackage', 'EncryptionInfo']);
    const info = streams.get('EncryptionInfo')!;
    const view = new DataView(info.buffer, info.byteOffset, info.byteLength);
    expect(view.getUint16(0, true)).toBe(4); // agile
    expect(view.getUint16(2, true)).toBe(4);
    const xml = new TextDecoder().decode(info.subarray(8));
    expect(xml).toContain('spinCount="100000"');
    expect(xml).toContain('hashAlgorithm="SHA512"');
    expect(xml).toContain('cipherChaining="ChainingModeCBC"');
    expect(xml).toContain('keyBits="256"');
    expect(xml).toContain('<dataIntegrity');
    // The stream opens with the plain package's length.
    const stream = streams.get('EncryptedPackage')!;
    const size = new DataView(stream.buffer, stream.byteOffset, stream.byteLength).getBigUint64(0, true);
    expect(Number(size)).toBe(plainDocx().length);
  });

  it('rejects a wrong password', async () => {
    const encrypted = await encryptOoxml(plainDocx(), PW);
    await expect(decryptOoxml(encrypted, 'falsch')).rejects.toThrow(WRONG_PASSWORD);
  });

  it('survives a package longer than one segment', async () => {
    const big = plainDocx('x'.repeat(20_000));
    expect(await decryptOoxml(await encryptOoxml(big, PW), PW)).toEqual(big);
  });

  it('refuses an encryption version it cannot read', async () => {
    const encrypted = await encryptOoxml(plainDocx(), PW);
    // RC4 CryptoAPI announces itself as version 4.2 with an RC4 algorithm id.
    const info = readCfb(encrypted).get('EncryptionInfo')!;
    new DataView(info.buffer, info.byteOffset, info.byteLength).setUint16(2, 3, true);
    const { writeCfb } = await import('../../src/lib/crypto/cfb');
    const broken = writeCfb([['EncryptionInfo', info], ['EncryptedPackage', readCfb(encrypted).get('EncryptedPackage')!]]);
    await expect(decryptOoxml(broken, PW)).rejects.toThrow(UNSUPPORTED_ENCRYPTION);
  });

  it('is seen as protected', async () => {
    expect(isProtected(await encryptOoxml(plainDocx(), PW))).toBe('ooxml');
    expect(isProtected(plainDocx())).toBe(null);
  });
});
