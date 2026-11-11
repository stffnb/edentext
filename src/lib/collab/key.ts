import { gcm } from '@noble/ciphers/aes.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

// A session is one random secret W, carried by the write link after `#`, which no browser
// sends to a server. From W come the read key R (AES-256-GCM for every frame; the room is
// a hash of it) and an Ed25519 pair that writers sign with; the read link carries R and
// the public key only. AES and Ed25519 go through noble, so they work without `crypto.subtle`.

const NONCE = 12;
export const SIGNATURE = 64;

const b64url = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='), (c) => c.charCodeAt(0));
const B32 = /^[A-Za-z0-9_-]{43}$/;

/** `sign` is null in a read-only session: such a client can open frames but not sign them. */
export type SessionKeys = { read: Uint8Array; verify: Uint8Array; sign: Uint8Array | null; secret: string | null };

export function newKey(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The key's bytes, or null when the text is not one (a link cut short). */
export function keyBytes(text: string): Uint8Array | null {
  return B32.test(text) ? unb64(text) : null;
}

const derive = (w: Uint8Array, label: string) => hkdf(sha256, w, undefined, new TextEncoder().encode(`edentext-collab-${label}`), 32);

/** The keys a write secret gives. */
export function writeKeys(secret: string): SessionKeys | null {
  const w = keyBytes(secret);
  if (!w) return null;
  const sign = derive(w, 'sign');
  return { read: derive(w, 'read'), verify: ed25519.getPublicKey(sign), sign, secret };
}

/**
 * The keys a link's fragment names: `collab=<W>` to write, `view=<R>.<P>` to read along;
 * null when it is neither or cut short.
 */
export function linkKeys(fragment: string): SessionKeys | null {
  const m = /^(collab|view)=(.*)$/.exec(fragment);
  if (!m) return null;
  if (m[1] === 'collab') return writeKeys(m[2]);
  const [r, p, more] = m[2].split('.');
  const read = keyBytes(r ?? ''), verify = keyBytes(p ?? '');
  return read && verify && more === undefined ? { read, verify, sign: null, secret: null } : null;
}

export function roomId(key: Uint8Array): string {
  const label = new TextEncoder().encode('edentext-room\0');
  const input = new Uint8Array(label.length + key.length);
  input.set(label);
  input.set(key, label.length);
  return b64url(sha256(input).subarray(0, 16));
}

export function seal(key: Uint8Array, plain: Uint8Array): Uint8Array<ArrayBuffer> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE));
  const body = gcm(key, nonce).encrypt(plain);
  const out = new Uint8Array(NONCE + body.length);
  out.set(nonce);
  out.set(body, NONCE);
  return out;
}

/** Throws when the frame was not sealed with this key or was altered. */
export function unseal(key: Uint8Array, frame: Uint8Array): Uint8Array {
  return gcm(key, frame.subarray(0, NONCE)).decrypt(frame.subarray(NONCE));
}

/** The message with its Ed25519 signature behind it. */
export function signed(secret: Uint8Array, message: Uint8Array): Uint8Array {
  const out = new Uint8Array(message.length + SIGNATURE);
  out.set(message);
  out.set(ed25519.sign(message, secret), message.length);
  return out;
}

/** The message without its signature, or null when the signature does not hold. */
export function opened(verify: Uint8Array, data: Uint8Array): Uint8Array | null {
  if (data.length < 1 + SIGNATURE) return null;
  const message = data.subarray(0, data.length - SIGNATURE);
  try {
    return ed25519.verify(data.subarray(data.length - SIGNATURE), message, verify, { zip215: false }) ? message : null;
  } catch { return null; }
}

/** The link to write along: this page with the secret after `#collab=`. */
export function sessionLink(key: string, href = location.href): string {
  return `${href.split('#')[0]}#collab=${key}`;
}

/** The link to read along: the read key and the public key after `#view=`. */
export function viewLink(keys: SessionKeys, href = location.href): string {
  return `${href.split('#')[0]}#view=${b64url(keys.read)}.${b64url(keys.verify)}`;
}
