// OOXML document encryption (MS-OFFCRYPTO). Written: agile encryption, what Word
// 2010 and later write. Read: that plus the older standard encryption, which is what
// LibreOffice writes for .docx.

import { cbc, ecb } from '@noble/ciphers/aes.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import type { CHash } from '@noble/hashes/utils.js';
import { sha1 } from '@noble/hashes/legacy.js';
import { readCfb, writeCfb } from './cfb';
import { encryptionError, UNSUPPORTED_ENCRYPTION, WRONG_PASSWORD } from './errors';

type Hash = CHash;

const INFO = 'EncryptionInfo';
const PACKAGE = 'EncryptedPackage';
// Every segment of the package is encrypted under its own initialisation vector.
const SEGMENT = 4096;

// The fixed block keys of the agile scheme.
const BLOCK_VERIFIER_INPUT = [0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79];
const BLOCK_VERIFIER_VALUE = [0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e];
const BLOCK_KEY_VALUE = [0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6];
const BLOCK_HMAC_KEY = [0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6];
const BLOCK_HMAC_VALUE = [0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33];

// What we write, matching Word's own choice so a byte comparison stays meaningful.
const SPIN_COUNT = 100_000;
const KEY_BYTES = 32;
const BLOCK_SIZE = 16;
const SALT_SIZE = 16;

const HASHES: Record<string, Hash> = { SHA512: sha512, SHA384: sha384, SHA256: sha256, SHA1: sha1 };

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

const le32 = (value: number): Uint8Array => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
};

// Passwords go into the hash as UTF-16LE, the encoding the format was defined in.
const utf16 = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
  return out;
};

// A derived value is cut to size, or filled up with 0x36 where the hash is shorter.
function fit(value: Uint8Array, size: number): Uint8Array {
  if (value.length >= size) return value.subarray(0, size);
  const out = new Uint8Array(size).fill(0x36);
  out.set(value);
  return out;
}

function blocks(data: Uint8Array, size: number): Uint8Array {
  if (data.length % size === 0) return data;
  const out = new Uint8Array(Math.ceil(data.length / size) * size);
  out.set(data);
  return out;
}

const b64 = (data: Uint8Array): string => btoa(String.fromCharCode(...data));
const unb64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const encryptCbc = (key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array =>
  cbc(key, iv, { disablePadding: true }).encrypt(blocks(data, BLOCK_SIZE));
const decryptCbc = (key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array =>
  cbc(key, iv, { disablePadding: true }).decrypt(blocks(data, BLOCK_SIZE));

// The password is stretched by a long chain of hashes, one per iteration.
function spin(hash: Hash, salt: Uint8Array, password: string, spinCount: number): Uint8Array {
  let h = hash(concat(salt, utf16(password)));
  for (let i = 0; i < spinCount; i++) h = hash(concat(le32(i), h));
  return h;
}

const derive = (hash: Hash, base: Uint8Array, block: number[], size: number): Uint8Array =>
  fit(hash(concat(base, Uint8Array.from(block))), size);

type Agile = {
  hash: Hash;
  keySalt: Uint8Array;
  blockSize: number;
  keyBytes: number;
  hashSize: number;
  spinCount: number;
  passwordSalt: Uint8Array;
  verifierInput: Uint8Array;
  verifierValue: Uint8Array;
  keyValue: Uint8Array;
};

function parseAgile(info: Uint8Array): Agile {
  const xml = new TextDecoder().decode(info.subarray(8));
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const keyData = doc.getElementsByTagName('keyData').item(0);
  const encryptedKey = doc.getElementsByTagNameNS(
    'http://schemas.microsoft.com/office/2006/keyEncryptor/password', 'encryptedKey').item(0);
  if (!keyData || !encryptedKey) throw encryptionError(UNSUPPORTED_ENCRYPTION);
  const hash = HASHES[encryptedKey.getAttribute('hashAlgorithm') ?? 'SHA512'];
  if (!hash || encryptedKey.getAttribute('cipherAlgorithm') !== 'AES') {
    throw encryptionError(UNSUPPORTED_ENCRYPTION);
  }
  return {
    hash,
    keySalt: unb64(keyData.getAttribute('saltValue') ?? ''),
    blockSize: Number(keyData.getAttribute('blockSize') ?? BLOCK_SIZE),
    keyBytes: Number(encryptedKey.getAttribute('keyBits') ?? 256) / 8,
    hashSize: Number(encryptedKey.getAttribute('hashSize') ?? 64),
    spinCount: Number(encryptedKey.getAttribute('spinCount') ?? SPIN_COUNT),
    passwordSalt: unb64(encryptedKey.getAttribute('saltValue') ?? ''),
    verifierInput: unb64(encryptedKey.getAttribute('encryptedVerifierHashInput') ?? ''),
    verifierValue: unb64(encryptedKey.getAttribute('encryptedVerifierHashValue') ?? ''),
    keyValue: unb64(encryptedKey.getAttribute('encryptedKeyValue') ?? ''),
  };
}

// The package key itself, once the password has been shown to be the right one.
function agileSecret(agile: Agile, password: string): Uint8Array {
  const base = spin(agile.hash, agile.passwordSalt, password, agile.spinCount);
  const key = (block: number[]) => derive(agile.hash, base, block, agile.keyBytes);
  const input = decryptCbc(key(BLOCK_VERIFIER_INPUT), agile.passwordSalt, agile.verifierInput);
  const expected = agile.hash(input.subarray(0, agile.blockSize));
  const actual = decryptCbc(key(BLOCK_VERIFIER_VALUE), agile.passwordSalt, agile.verifierValue);
  if (!expected.every((b, i) => b === actual[i])) throw encryptionError(WRONG_PASSWORD);
  return decryptCbc(key(BLOCK_KEY_VALUE), agile.passwordSalt, agile.keyValue).subarray(0, agile.keyBytes);
}

function segmentIv(agile: Agile, index: number): Uint8Array {
  return fit(agile.hash(concat(agile.keySalt, le32(index))), agile.blockSize);
}

function decryptAgilePackage(agile: Agile, secret: Uint8Array, stream: Uint8Array): Uint8Array {
  const size = Number(new DataView(stream.buffer, stream.byteOffset, stream.byteLength).getBigUint64(0, true));
  const body = stream.subarray(8);
  const out = new Uint8Array(Math.ceil(body.length / BLOCK_SIZE) * BLOCK_SIZE);
  for (let at = 0, i = 0; at < body.length; at += SEGMENT, i++) {
    out.set(decryptCbc(secret, segmentIv(agile, i), body.subarray(at, at + SEGMENT)), at);
  }
  return out.subarray(0, size);
}

export async function encryptOoxml(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const hash = sha512;
  const keySalt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
  const passwordSalt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
  const secret = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  const verifier = crypto.getRandomValues(new Uint8Array(BLOCK_SIZE));
  const hmacKey = crypto.getRandomValues(new Uint8Array(hash.outputLen));

  const base = spin(hash, passwordSalt, password, SPIN_COUNT);
  const key = (block: number[]) => derive(hash, base, block, KEY_BYTES);
  const agile: Agile = {
    hash, keySalt, blockSize: BLOCK_SIZE, keyBytes: KEY_BYTES, hashSize: hash.outputLen,
    spinCount: SPIN_COUNT, passwordSalt, verifierInput: new Uint8Array(0),
    verifierValue: new Uint8Array(0), keyValue: new Uint8Array(0),
  };

  const encryptedPackage = new Uint8Array(8 + Math.ceil(bytes.length / BLOCK_SIZE) * BLOCK_SIZE);
  new DataView(encryptedPackage.buffer).setBigUint64(0, BigInt(bytes.length), true);
  for (let at = 0, i = 0; at < bytes.length; at += SEGMENT, i++) {
    encryptedPackage.set(encryptCbc(secret, segmentIv(agile, i), bytes.subarray(at, at + SEGMENT)), 8 + at);
  }

  const hmacIv = (block: number[]) => derive(hash, keySalt, block, BLOCK_SIZE);
  const encryptedHmacKey = encryptCbc(secret, hmacIv(BLOCK_HMAC_KEY), hmacKey);
  const encryptedHmacValue = encryptCbc(secret, hmacIv(BLOCK_HMAC_VALUE),
    hmac(hash, hmacKey, encryptedPackage));

  const info = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password" xmlns:c="http://schemas.microsoft.com/office/2006/keyEncryptor/certificate"><keyData saltSize="${SALT_SIZE}" blockSize="${BLOCK_SIZE}" keyBits="${KEY_BYTES * 8}" hashSize="${hash.outputLen}" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="${b64(keySalt)}"/><dataIntegrity encryptedHmacKey="${b64(encryptedHmacKey)}" encryptedHmacValue="${b64(encryptedHmacValue)}"/><keyEncryptors><keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password"><p:encryptedKey spinCount="${SPIN_COUNT}" saltSize="${SALT_SIZE}" blockSize="${BLOCK_SIZE}" keyBits="${KEY_BYTES * 8}" hashSize="${hash.outputLen}" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="${b64(passwordSalt)}" encryptedVerifierHashInput="${b64(encryptCbc(key(BLOCK_VERIFIER_INPUT), passwordSalt, verifier))}" encryptedVerifierHashValue="${b64(encryptCbc(key(BLOCK_VERIFIER_VALUE), passwordSalt, hash(verifier)))}" encryptedKeyValue="${b64(encryptCbc(key(BLOCK_KEY_VALUE), passwordSalt, secret))}"/></keyEncryptor></keyEncryptors></encryption>`;

  const header = new Uint8Array(8);
  const view = new DataView(header.buffer);
  view.setUint16(0, 4, true); // major: agile
  view.setUint16(2, 4, true); // minor
  view.setUint32(4, 0x40, true);

  // ponytail: no \x06DataSpaces streams — LibreOffice writes none either and its files
  // open elsewhere; add them if a reader ever refuses ours.
  return writeCfb([
    [INFO, concat(header, new TextEncoder().encode(info))],
    [PACKAGE, encryptedPackage],
  ]);
}

// Standard encryption, the older scheme: one AES-ECB key from an iterated SHA-1.
function decryptStandard(info: Uint8Array, stream: Uint8Array, password: string): Uint8Array {
  const view = new DataView(info.buffer, info.byteOffset, info.byteLength);
  const headerSize = view.getUint32(8, true);
  const algId = view.getUint32(12 + 8, true);
  const keyBytes = view.getUint32(12 + 16, true) / 8;
  // 0x660E/0x660F/0x6610 are AES-128/192/256; anything else (RC4) we do not read.
  if (algId < 0x660e || algId > 0x6610) throw encryptionError(UNSUPPORTED_ENCRYPTION);
  const verifierAt = 12 + headerSize;
  const saltSize = view.getUint32(verifierAt, true);
  const salt = info.subarray(verifierAt + 4, verifierAt + 4 + saltSize);
  const encryptedVerifier = info.subarray(verifierAt + 4 + saltSize, verifierAt + 20 + saltSize);
  const hashSize = view.getUint32(verifierAt + 20 + saltSize, true);
  const encryptedHash = info.subarray(verifierAt + 24 + saltSize, verifierAt + 24 + saltSize + 32);

  let h = sha1(concat(salt, utf16(password)));
  for (let i = 0; i < 50_000; i++) h = sha1(concat(le32(i), h));
  h = sha1(concat(h, le32(0)));
  const block = (pad: number) => {
    const buf = new Uint8Array(64).fill(pad);
    for (let i = 0; i < h.length; i++) buf[i] = h[i] ^ pad;
    return sha1(buf);
  };
  const key = concat(block(0x36), block(0x5c)).subarray(0, keyBytes);

  const cipher = ecb(key, { disablePadding: true });
  const verifier = cipher.decrypt(encryptedVerifier);
  const expected = sha1(verifier);
  const actual = cipher.decrypt(encryptedHash).subarray(0, Math.min(hashSize, 20));
  if (!expected.every((b, i) => b === actual[i])) throw encryptionError(WRONG_PASSWORD);

  const size = Number(new DataView(stream.buffer, stream.byteOffset, stream.byteLength).getBigUint64(0, true));
  return cipher.decrypt(blocks(stream.subarray(8), BLOCK_SIZE)).subarray(0, size);
}

export async function decryptOoxml(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const streams = readCfb(bytes);
  const info = streams.get(INFO);
  const stream = streams.get(PACKAGE);
  if (!info || !stream) throw encryptionError(UNSUPPORTED_ENCRYPTION);
  const view = new DataView(info.buffer, info.byteOffset, info.byteLength);
  const major = view.getUint16(0, true);
  const minor = view.getUint16(2, true);
  if (major === 4 && minor === 4) {
    const agile = parseAgile(info);
    return decryptAgilePackage(agile, agileSecret(agile, password), stream);
  }
  if (minor === 2 && (major === 2 || major === 3 || major === 4)) {
    return decryptStandard(info, stream, password);
  }
  throw encryptionError(UNSUPPORTED_ENCRYPTION);
}
