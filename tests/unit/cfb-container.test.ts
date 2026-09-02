import { describe, it, expect } from 'vitest';
import { readCfb, writeCfb, isCfb } from '../../src/lib/crypto/cfb';

const bytes = (n: number, seed = 1) =>
  Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);

describe('compound file container', () => {
  it('round-trips a mini stream and a big one in the same file', () => {
    const small = bytes(224);
    const large = bytes(9000, 7);
    const streams = readCfb(writeCfb([['EncryptionInfo', small], ['EncryptedPackage', large]]));
    expect(streams.get('EncryptionInfo')).toEqual(small);
    expect(streams.get('EncryptedPackage')).toEqual(large);
  });

  it('writes a header a reader recognizes', () => {
    const file = writeCfb([['EncryptionInfo', bytes(224)]]);
    expect(isCfb(file)).toBe(true);
    const view = new DataView(file.buffer);
    expect(view.getUint16(26, true)).toBe(3); // major version
    expect(view.getUint16(30, true)).toBe(9); // 512-byte sectors
    expect(view.getUint32(56, true)).toBe(4096); // mini stream cutoff
    expect(file.length % 512).toBe(0);
  });

  it('survives a stream past the first FAT sector', () => {
    // Over 64 KiB needs more than one FAT sector's worth of chain entries.
    const large = bytes(300_000, 3);
    expect(readCfb(writeCfb([['EncryptedPackage', large]])).get('EncryptedPackage')).toEqual(large);
  });

  it('handles an empty stream and exact sector multiples', () => {
    const streams = readCfb(writeCfb([['Empty', new Uint8Array(0)], ['Exact', bytes(4096)]]));
    expect(streams.get('Empty')!.length).toBe(0);
    expect(streams.get('Exact')).toEqual(bytes(4096));
  });

  it('refuses anything that is not a compound file', () => {
    expect(isCfb(new Uint8Array([0x50, 0x4b, 3, 4]))).toBe(false);
    expect(() => readCfb(new Uint8Array([0x50, 0x4b, 3, 4]))).toThrow();
  });
});
