// Fonts embedded in an opened .odt/.docx, registered via the browser FontFace API so
// text renders in its original face even when the font isn't installed locally.
export interface EmbeddedFont {
  family: string;
  weight: 'normal' | 'bold';
  style: 'normal' | 'italic';
  data: Uint8Array;
}

// De-obfuscate a Word `.odttf`: the first 32 bytes are XORed with the 16-byte fontKey
// GUID in reverse. In-place; returns the same array. No/short key ⇒ left untouched.
export function deobfuscateOdttf(data: Uint8Array, fontKey: string): Uint8Array {
  const hex = fontKey.replace(/[^0-9a-fA-F]/g, '');
  if (hex.length < 32) return data;
  const key = new Uint8Array(16);
  for (let i = 0; i < 16; i++) key[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  key.reverse();
  const n = Math.min(32, data.length);
  for (let i = 0; i < n; i++) data[i] ^= key[i % 16];
  return data;
}

// The faces this module added to document.fonts, tracked so a new document's set can
// replace the previous one (only the current document's fonts stay registered).
let registered: FontFace[] = [];

export function clearEmbeddedFonts(): void {
  if (typeof document !== 'undefined' && document.fonts) {
    for (const face of registered) {
      try { document.fonts.delete(face); } catch { /* already gone */ }
    }
  }
  registered = [];
}

// Register each font under its CSS family; an unreadable/blocked one is skipped so the
// rest still load. No-op without FontFace (jsdom/tests).
export async function registerEmbeddedFonts(fonts: EmbeddedFont[]): Promise<void> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return;
  clearEmbeddedFonts();
  for (const f of fonts) {
    try {
      const face = new FontFace(f.family, f.data as BufferSource, { weight: f.weight, style: f.style });
      await face.load();
      document.fonts.add(face);
      registered.push(face);
    } catch { /* skip an unreadable/blocked font */ }
  }
}
