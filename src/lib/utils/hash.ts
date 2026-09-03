/**
 * FNV-1a over a string, as an unsigned 32-bit number. Fast enough to run over a
 * whole document's JSON, and the only thing asked of it is that two different
 * documents disagree.
 */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
