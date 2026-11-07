// ODF package encryption. Written: one AES-256-GCM `encrypted-package` entry keyed by
// Argon2id, the form LibreOffice writes by default. Read: that plus the per-entry
// AES-CBC/GCM form with PBKDF2 that every earlier version writes.

import { unzipSync, zipSync, strFromU8, strToU8, deflateSync } from 'fflate';
import { cbc, gcm } from '@noble/ciphers/aes.js';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { sha1 } from '@noble/hashes/legacy.js';
import { encryptionError, UNSUPPORTED_ENCRYPTION, WRONG_PASSWORD } from './errors';
import { IMPORT_LIMITS, ImportLimitError, inflateWithin, unzipWithinLimits } from '../import/importLimits';

const MANIFEST_NS = 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0';
const LOEXT_NS = 'urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0';

const AES_CBC = 'http://www.w3.org/2001/04/xmlenc#aes256-cbc';
const AES_GCM = 'http://www.w3.org/2009/xmlenc11#aes256-gcm';
const ARGON2ID = 'urn:org:documentfoundation:names:experimental:office:manifest:argon2id';
const SHA256_1K = `${MANIFEST_NS}#sha256-1k`;
const START_SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';
const ODT_MIME = 'application/vnd.oasis.opendocument.text';
const MANIFEST = 'META-INF/manifest.xml';
const PACKAGE = 'encrypted-package';

// LibreOffice's parameters for a whole-package key: 3 passes over 64 MiB in 4 lanes.
const ARGON2 = { t: 3, m: 65536, p: 4 };
const MAX_PBKDF2_ITERATIONS = 1_000_000;
const MAX_ARGON2_MEMORY_KIB = 262_144;
// What one document may make us derive: LibreOffice salts every entry apart, so a file
// with many pictures needs many PBKDF2 keys, but never more than one Argon2 key.
const MAX_PBKDF2_WORK = 50_000_000;
const MAX_ARGON2_KEYS = 2;

type Encryption = {
  algorithm: string;
  iv: Uint8Array;
  kdf: string;
  salt: Uint8Array;
  iterations: number;
  argon2: { t: number; m: number; p: number } | null;
  keySize: number;
  startKeySha1: boolean;
  checksum: Uint8Array | null;
};

const b64ToBytes = (s: string): Uint8Array => {
  if (s.length > 256) throw encryptionError(UNSUPPORTED_ENCRYPTION);
  try { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }
  catch { throw encryptionError(UNSUPPORTED_ENCRYPTION); }
};
const bytesToB64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function child(parent: Element, name: string): Element | null {
  return parent.getElementsByTagNameNS(MANIFEST_NS, name).item(0);
}

function attr(el: Element | null, name: string, ns = MANIFEST_NS): string | null {
  return el?.getAttributeNS(ns, name) ?? null;
}

function parseEntry(entry: Element): Encryption | null {
  const data = child(entry, 'encryption-data');
  if (!data) return null;
  const algorithm = child(data, 'algorithm');
  const derivation = child(data, 'key-derivation');
  const start = child(data, 'start-key-generation');
  const iv = attr(algorithm, 'initialisation-vector');
  const salt = attr(derivation, 'salt');
  if (!iv || !salt) throw encryptionError(UNSUPPORTED_ENCRYPTION);
  const kdf = attr(derivation, 'key-derivation-name') ?? '';
  const checksum = attr(data, 'checksum');
  const enc = {
    algorithm: attr(algorithm, 'algorithm-name') ?? '',
    iv: b64ToBytes(iv),
    kdf,
    salt: b64ToBytes(salt),
    iterations: Number(attr(derivation, 'iteration-count') ?? 0),
    argon2: kdf === ARGON2ID
      ? {
          t: Number(attr(derivation, 'argon2-iterations', LOEXT_NS) ?? ARGON2.t),
          m: Number(attr(derivation, 'argon2-memory', LOEXT_NS) ?? ARGON2.m),
          p: Number(attr(derivation, 'argon2-lanes', LOEXT_NS) ?? ARGON2.p),
        }
      : null,
    keySize: Number(attr(derivation, 'key-size') ?? 32),
    startKeySha1: attr(start, 'start-key-generation-name') === START_SHA1,
    checksum: attr(data, 'checksum-type') === SHA256_1K && checksum ? b64ToBytes(checksum) : null,
  };
  if ((enc.algorithm !== AES_CBC && enc.algorithm !== AES_GCM) || enc.keySize !== 32
    || enc.salt.length < 8 || enc.salt.length > 64
    || enc.iv.length !== (enc.algorithm === AES_GCM ? 12 : 16)
    || (!enc.argon2 && (!Number.isSafeInteger(enc.iterations) || enc.iterations < 1 || enc.iterations > MAX_PBKDF2_ITERATIONS))
    || (enc.argon2 && (!Number.isSafeInteger(enc.argon2.t) || !Number.isSafeInteger(enc.argon2.m) || !Number.isSafeInteger(enc.argon2.p)
      || enc.argon2.t < 1 || enc.argon2.t > 10 || enc.argon2.m < 8 || enc.argon2.m > MAX_ARGON2_MEMORY_KIB || enc.argon2.p < 1 || enc.argon2.p > 8))) {
    throw encryptionError(UNSUPPORTED_ENCRYPTION);
  }
  return enc;
}

async function deriveKey(password: string, enc: Encryption): Promise<Uint8Array> {
  const pw = new TextEncoder().encode(password);
  const startKey = enc.startKeySha1 ? sha1(pw) : sha256(pw);
  if (enc.argon2) {
    return argon2idAsync(startKey, enc.salt, { ...enc.argon2, dkLen: enc.keySize });
  }
  if (enc.kdf !== 'PBKDF2') throw encryptionError(UNSUPPORTED_ENCRYPTION);
  // PBKDF2 with HMAC-SHA-1 as the PRF, as ODF specifies it. WebCrypto is faster but
  // missing outside a secure context (a self-hosted copy over plain HTTP).
  if (!crypto.subtle) return pbkdf2Async(sha1, startKey, enc.salt, { c: enc.iterations, dkLen: enc.keySize });
  const base = await crypto.subtle.importKey('raw', startKey, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new Uint8Array(enc.salt), iterations: enc.iterations, hash: 'SHA-1' },
    base, enc.keySize * 8);
  return new Uint8Array(bits);
}

// Decrypt one entry to its deflated form. GCM authenticates the password itself; the
// other forms are checked against the entry's digest below.
function decipher(data: Uint8Array, key: Uint8Array, enc: Encryption): Uint8Array {
  if (enc.algorithm === AES_GCM) {
    // LibreOffice repeats the nonce ahead of the ciphertext, which closes with the tag.
    const body = data.length > enc.iv.length && equal(data.subarray(0, enc.iv.length), enc.iv)
      ? data.subarray(enc.iv.length)
      : data;
    try {
      return gcm(key, enc.iv).decrypt(body);
    } catch {
      throw encryptionError(WRONG_PASSWORD);
    }
  }
  if (enc.algorithm === AES_CBC) {
    const plain = cbc(key, enc.iv, { disablePadding: true }).decrypt(data);
    // W3C padding: the last byte counts the bytes that were added.
    const pad = plain[plain.length - 1] ?? 0;
    return pad >= 1 && pad <= 16 && pad <= plain.length ? plain.subarray(0, plain.length - pad) : plain;
  }
  throw encryptionError(UNSUPPORTED_ENCRYPTION);
}

// The digest covers the first 1024 bytes of the compressed, not yet encrypted stream —
// the one place a wrong password shows before the data is unusable.
function unpack(deflated: Uint8Array, enc: Encryption, max: number): Uint8Array {
  if (enc.checksum && !equal(sha256(deflated.subarray(0, 1024)), enc.checksum)) {
    throw encryptionError(WRONG_PASSWORD);
  }
  try {
    return inflateWithin(deflated, max);
  } catch (e) {
    if (e instanceof ImportLimitError) throw e;
    throw encryptionError(WRONG_PASSWORD);
  }
}

function manifestDoc(files: Record<string, Uint8Array>): Document {
  const xml = files[MANIFEST];
  if (!xml) throw encryptionError(UNSUPPORTED_ENCRYPTION);
  if (/<!(?:DOCTYPE|ENTITY)\b/i.test(strFromU8(xml))) throw encryptionError(UNSUPPORTED_ENCRYPTION);
  return new DOMParser().parseFromString(strFromU8(xml), 'application/xml');
}

export async function decryptOdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const files = unzipWithinLimits(bytes);
  const entries = manifestDoc(files).getElementsByTagNameNS(MANIFEST_NS, 'file-entry');
  const encryptions = new Map<string, Encryption>();
  for (const entry of Array.from(entries)) {
    const path = attr(entry, 'full-path');
    const enc = parseEntry(entry);
    if (path && enc) encryptions.set(path, enc);
  }
  if (!encryptions.size) return bytes;

  // A whole-package document carries the real one inside a single entry.
  const whole = encryptions.get(PACKAGE);
  if (whole && files[PACKAGE]) {
    return unpack(decipher(files[PACKAGE], await deriveKey(password, whole), whole), whole, IMPORT_LIMITS.compressedBytes);
  }

  // Per entry: decrypt in place, then drop the encryption from the manifest.
  const out: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  if (files['mimetype']) out['mimetype'] = [files['mimetype'], { level: 0 }];
  const keys = new Map<string, Uint8Array>();
  let pbkdf2Work = 0, argon2Keys = 0, inflated = 0;
  for (const [path, data] of Object.entries(files)) {
    if (path === 'mimetype') continue;
    const enc = encryptions.get(path);
    if (!enc) {
      out[path] = [data, { level: 6 }];
      continue;
    }
    const id = JSON.stringify([bytesToB64(enc.salt), enc.kdf, enc.iterations, enc.argon2, enc.startKeySha1]);
    let key = keys.get(id);
    if (!key) {
      if (enc.argon2 ? ++argon2Keys > MAX_ARGON2_KEYS : (pbkdf2Work += enc.iterations) > MAX_PBKDF2_WORK) {
        throw new ImportLimitError('The document archive exceeds supported limits.');
      }
      keys.set(id, key = await deriveKey(password, enc));
    }
    const plain = unpack(decipher(data, key, enc), enc, IMPORT_LIMITS.zipEntryBytes);
    if ((inflated += plain.length) > IMPORT_LIMITS.zipTotalBytes) throw new ImportLimitError('The document archive exceeds supported limits.');
    out[path] = [plain, { level: 6 }];
  }
  out[MANIFEST] = [strToU8(strippedManifest(files[MANIFEST])), { level: 6 }];
  return zipSync(out);
}

// The decrypted package needs a manifest without the encryption records; `manifest:size`
// goes with them, it describes the encrypted entry.
function strippedManifest(xml: Uint8Array): string {
  return strFromU8(xml)
    .replace(/<manifest:encryption-data\b[\s\S]*?<\/manifest:encryption-data>/g, '')
    .replace(/<manifest:encryption-data\b[^>]*\/>/g, '')
    .replace(/ manifest:size="\d+"/g, '');
}

function wholesomeManifest(mediaType: string, size: number, iv: Uint8Array, salt: Uint8Array): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="${MANIFEST_NS}" manifest:version="1.4" xmlns:loext="${LOEXT_NS}">
 <manifest:file-entry manifest:full-path="${PACKAGE}" manifest:media-type="${mediaType}" manifest:size="${size}">
  <manifest:encryption-data>
   <manifest:algorithm manifest:algorithm-name="${AES_GCM}" manifest:initialisation-vector="${bytesToB64(iv)}"/>
   <manifest:start-key-generation manifest:start-key-generation-name="http://www.w3.org/2001/04/xmlenc#sha256" manifest:key-size="32"/>
   <manifest:key-derivation manifest:key-derivation-name="${ARGON2ID}" loext:argon2-iterations="${ARGON2.t}" loext:argon2-memory="${ARGON2.m}" loext:argon2-lanes="${ARGON2.p}" manifest:salt="${bytesToB64(salt)}" manifest:key-size="32"/>
  </manifest:encryption-data>
 </manifest:file-entry>
</manifest:manifest>`;
}

export async function encryptOdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const mimetype = unzipSync(bytes, { filter: (f) => f.name === 'mimetype' })['mimetype'];
  const mediaType = mimetype ? strFromU8(mimetype) : ODT_MIME;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await argon2idAsync(sha256(new TextEncoder().encode(password)), salt,
    { ...ARGON2, dkLen: 32 });
  const body = gcm(key, iv).encrypt(deflateSync(bytes, { level: 6 }));
  const entry = new Uint8Array(iv.length + body.length);
  entry.set(iv);
  entry.set(body, iv.length);
  return zipSync({
    mimetype: [strToU8(mediaType), { level: 0 }],
    [PACKAGE]: [entry, { level: 0 }],
    [MANIFEST]: [strToU8(wholesomeManifest(mediaType, bytes.length, iv, salt)), { level: 6 }],
  });
}
