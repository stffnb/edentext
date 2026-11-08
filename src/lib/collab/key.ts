import { gcm } from '@noble/ciphers/aes.js';
import { sha256 } from '@noble/hashes/sha2.js';

// A session is one random key. The link carries it after `#`, which no browser sends to a
// server; the relay only learns the room, a hash of the key. Every frame is AES-256-GCM
// with a fresh nonce in front, through noble so it also works where `crypto.subtle` is absent.

const NONCE = 12;

const b64url = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function newKey(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The key's bytes, or null when the text is not one (a link cut short). */
export function keyBytes(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) return null;
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '=');
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
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

/** The link that joins a session: this page with the key after `#collab=`. */
export function sessionLink(key: string, href = location.href): string {
  return `${href.split('#')[0]}#collab=${key}`;
}

/** The key of the link this page was opened with, if any. */
export function linkKey(hash: string): string | null {
  const m = /(?:^#|&)collab=([^&]*)/.exec(hash);
  return m ? m[1] : null;
}
