// Password protection of the saved file: the one module the app and saveFile.ts see.
// The format modules and their crypto libraries load only when a password is in play.

import { unzipSync } from 'fflate';
import { encryptionError, UNSUPPORTED_ENCRYPTION, WRONG_PASSWORD } from './errors';

export { UNSUPPORTED_ENCRYPTION, WRONG_PASSWORD };

export type Protection = 'odf' | 'ooxml' | null;

// An encrypted OOXML file is not a zip at all: it is a compound file, and this is its
// signature.
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function isCfb(bytes: Uint8Array): boolean {
  return bytes.length >= CFB_MAGIC.length && CFB_MAGIC.every((b, i) => bytes[i] === b);
}

export function isProtected(bytes: Uint8Array): Protection {
  if (isCfb(bytes)) return 'ooxml';
  return isEncryptedOdfSync(bytes) ? 'odf' : null;
}

// Kept here rather than imported from ./odf so that the check itself pulls in no crypto.
function isEncryptedOdfSync(bytes: Uint8Array): boolean {
  try {
    const files = unzipSync(bytes, { filter: (f) => f.name === 'META-INF/manifest.xml' });
    const manifest = files['META-INF/manifest.xml'];
    return manifest !== undefined && new TextDecoder().decode(manifest).includes('encryption-data');
  } catch {
    return false;
  }
}

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

// Which format to write is decided by the package we are handed, not by a file name.
function containerOf(bytes: Uint8Array): Protection {
  if (!isZip(bytes)) return null;
  try {
    const files = unzipSync(bytes, { filter: (f) => f.name === 'mimetype' || f.name === '[Content_Types].xml' });
    if (files['mimetype']) return 'odf';
    if (files['[Content_Types].xml']) return 'ooxml';
  } catch { /* not a package we can protect */ }
  return null;
}

export async function encryptPackage(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const container = containerOf(bytes);
  if (container === 'odf') {
    const { encryptOdf } = await import('./odf');
    return encryptOdf(bytes, password);
  }
  if (container === 'ooxml') {
    const { encryptOoxml } = await import('./ooxml');
    return encryptOoxml(bytes, password);
  }
  throw encryptionError(UNSUPPORTED_ENCRYPTION);
}

export async function decryptPackage(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  if (isProtected(bytes) === 'odf') {
    const { decryptOdf } = await import('./odf');
    return decryptOdf(bytes, password);
  }
  if (isCfb(bytes)) {
    const { decryptOoxml } = await import('./ooxml');
    return decryptOoxml(bytes, password);
  }
  throw encryptionError(UNSUPPORTED_ENCRYPTION);
}
