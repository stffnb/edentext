import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strToU8, strFromU8, deflateSync } from 'fflate';
import { cbc } from '@noble/ciphers/aes.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { encryptOdf, decryptOdf } from '../../src/lib/crypto/odf';
import { isProtected, WRONG_PASSWORD, UNSUPPORTED_ENCRYPTION } from '../../src/lib/crypto/protect';

const MIME = 'application/vnd.oasis.opendocument.text';
const PW = 'geheim123';

function plainOdt(text = 'Hello'): Uint8Array {
  return zipSync({
    mimetype: [strToU8(MIME), { level: 0 }],
    'content.xml': [strToU8(`<?xml version="1.0"?><office:document-content>${text}</office:document-content>`), { level: 6 }],
    'META-INF/manifest.xml': [strToU8(`<?xml version="1.0"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
 <manifest:file-entry manifest:full-path="/" manifest:media-type="${MIME}"/>
 <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`), { level: 6 }],
  });
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

// The per-entry form every LibreOffice up to ODF 1.3 writes: deflate, AES-256-CBC with a
// PBKDF2 key, stored, and a digest over the first 1024 compressed bytes.
async function classicEncrypted(password: string, iterations = 1000): Promise<Uint8Array> {
  const files = unzipSync(plainOdt());
  const salt = new Uint8Array(16).fill(3);
  const iv = new Uint8Array(16).fill(5);
  const base = await crypto.subtle.importKey('raw', sha256(new TextEncoder().encode(password)), 'PBKDF2', false, ['deriveBits']);
  const key = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-1' }, base, 256));
  const plain = files['content.xml'];
  const deflated = deflateSync(plain, { level: 6 });
  const pad = 16 - (deflated.length % 16);
  const padded = new Uint8Array(deflated.length + pad);
  padded.set(deflated);
  padded[padded.length - 1] = pad;
  const encrypted = cbc(key, iv, { disablePadding: true }).encrypt(padded);
  return zipSync({
    mimetype: [files['mimetype'], { level: 0 }],
    'content.xml': [encrypted, { level: 0 }],
    'META-INF/manifest.xml': [strToU8(`<?xml version="1.0"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
 <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml" manifest:size="${plain.length}">
  <manifest:encryption-data manifest:checksum-type="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0#sha256-1k" manifest:checksum="${b64(sha256(deflated.subarray(0, 1024)))}">
   <manifest:algorithm manifest:algorithm-name="http://www.w3.org/2001/04/xmlenc#aes256-cbc" manifest:initialisation-vector="${b64(iv)}"/>
   <manifest:start-key-generation manifest:start-key-generation-name="http://www.w3.org/2000/09/xmldsig#sha256" manifest:key-size="32"/>
   <manifest:key-derivation manifest:key-derivation-name="PBKDF2" manifest:iteration-count="${iterations}" manifest:salt="${b64(salt)}" manifest:key-size="32"/>
  </manifest:encryption-data>
 </manifest:file-entry>
</manifest:manifest>`), { level: 6 }],
  });
}

describe('ODF package encryption', () => {
  it('round-trips a package through encryptOdf/decryptOdf', async () => {
    const plain = plainOdt('Round trip');
    const decrypted = await decryptOdf(await encryptOdf(plain, PW), PW);
    expect(strFromU8(unzipSync(decrypted)['content.xml'])).toContain('Round trip');
  });

  it('writes the package LibreOffice expects', async () => {
    const encrypted = await encryptOdf(plainOdt(), PW);
    const names = Object.keys(unzipSync(encrypted));
    expect(names[0]).toBe('mimetype');
    expect(names).toContain('encrypted-package');
    const files = unzipSync(encrypted);
    expect(strFromU8(files['mimetype'])).toBe(MIME);
    const manifest = strFromU8(files['META-INF/manifest.xml']);
    expect(manifest).toContain('xmlenc11#aes256-gcm');
    expect(manifest).toContain('argon2id');
    expect(manifest).toContain('loext:argon2-memory="65536"');
    // The nonce is repeated ahead of the ciphertext, and the tag closes it.
    expect(files['encrypted-package'].length).toBe(12 + 16 + (files['encrypted-package'].length - 28));
    expect(manifest).toContain(`manifest:size="${plainOdt().length}"`);
  });

  it('keeps a template media type', async () => {
    const OTT = 'application/vnd.oasis.opendocument.text-template';
    const template = zipSync({ mimetype: [strToU8(OTT), { level: 0 }], 'content.xml': [strToU8('<x/>'), { level: 6 }] });
    const files = unzipSync(await encryptOdf(template, PW));
    expect(strFromU8(files['mimetype'])).toBe(OTT);
    expect(strFromU8(files['META-INF/manifest.xml'])).toContain(OTT);
  });

  it('rejects a wrong password', async () => {
    const encrypted = await encryptOdf(plainOdt(), PW);
    await expect(decryptOdf(encrypted, 'falsch')).rejects.toThrow(WRONG_PASSWORD);
  });

  it('reads the per-entry form with PBKDF2 and AES-CBC', async () => {
    const decrypted = await decryptOdf(await classicEncrypted(PW), PW);
    const files = unzipSync(decrypted);
    expect(strFromU8(files['content.xml'])).toContain('Hello');
    expect(strFromU8(files['META-INF/manifest.xml'])).not.toContain('encryption-data');
    expect(strFromU8(files['mimetype'])).toBe(MIME);
  });

  it('catches a wrong password on the per-entry form by its digest', async () => {
    await expect(decryptOdf(await classicEncrypted(PW), 'falsch')).rejects.toThrow(WRONG_PASSWORD);
  });

  it('refuses an algorithm it cannot read', async () => {
    const blowfish = strFromU8(unzipSync(await classicEncrypted(PW))['META-INF/manifest.xml'])
      .replace('http://www.w3.org/2001/04/xmlenc#aes256-cbc', 'Blowfish CFB');
    const files = unzipSync(await classicEncrypted(PW));
    files['META-INF/manifest.xml'] = strToU8(blowfish);
    const repacked = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: 0 }] as [Uint8Array, { level: 0 }]])));
    await expect(decryptOdf(repacked, PW)).rejects.toThrow(UNSUPPORTED_ENCRYPTION);
  });
});

describe('isProtected', () => {
  it('recognizes an encrypted ODF package', async () => {
    expect(isProtected(await encryptOdf(plainOdt(), PW))).toBe('odf');
    expect(isProtected(await classicEncrypted(PW))).toBe('odf');
  });

  it('leaves plain and unreadable files alone', () => {
    expect(isProtected(plainOdt())).toBe(null);
    expect(isProtected(new Uint8Array([1, 2, 3, 4]))).toBe(null);
  });

  it('recognizes a compound file as an encrypted OOXML document', () => {
    expect(isProtected(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).toBe('ooxml');
  });
});
