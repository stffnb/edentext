import { describe, it, expect } from 'vitest';
import { deobfuscateOdttf } from '../../src/lib/fonts/embeddedFonts';

const GUID = '{01020304-0506-0708-090A-0B0C0D0E0F10}';
// The XOR key is the GUID's 16 bytes in reverse order.
const REVERSED_KEY = [0x10, 0x0f, 0x0e, 0x0d, 0x0c, 0x0b, 0x0a, 0x09, 0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01];

describe('deobfuscateOdttf', () => {
  it('XORs the first 32 bytes with the reversed fontKey GUID', () => {
    const data = new Uint8Array([...REVERSED_KEY, ...REVERSED_KEY, 0xaa, 0xbb]);
    deobfuscateOdttf(data, GUID);
    expect(Array.from(data.slice(0, 32))).toEqual(new Array(32).fill(0));
    expect(Array.from(data.slice(32))).toEqual([0xaa, 0xbb]);
  });

  it('is symmetric (obfuscation and de-obfuscation are the same XOR)', () => {
    const original = Uint8Array.from({ length: 40 }, (_, i) => (i * 7) & 0xff);
    const roundTrip = deobfuscateOdttf(deobfuscateOdttf(original.slice(), GUID), GUID);
    expect(Array.from(roundTrip)).toEqual(Array.from(original));
  });

  it('leaves data untouched when the key has fewer than 32 hex chars', () => {
    const data = Uint8Array.from({ length: 32 }, (_, i) => i);
    deobfuscateOdttf(data, 'not-a-guid');
    expect(Array.from(data)).toEqual(Array.from({ length: 32 }, (_, i) => i));
  });
});
