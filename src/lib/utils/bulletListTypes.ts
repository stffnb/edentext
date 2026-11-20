// Bullet-list marker characters — single source of truth for bulletList.ts (the
// `bulletChar` attr), Toolbar.svelte, editor.css, and the ODT/DOCX import/export.
// All chars here are XML-attribute-safe (no " < > &).

// Default marker per nesting depth (0-based); matches odf-kit's BULLET_CHARS, so a
// default list needs no rewrite on export.
export const DEFAULT_BULLET_CYCLE = ['•', '◦', '▪', '▸', '–', '·'];

export function defaultBulletChar(depth0: number): string {
  return DEFAULT_BULLET_CYCLE[depth0 % DEFAULT_BULLET_CYCLE.length];
}

export interface BulletTypeDef {
  char: string;
  label: string; // tooltip in the picker grid
}

// Curated picker set (Word's bullet library), in menu order.
export const BULLET_TYPES: BulletTypeDef[] = [
  { char: '•', label: 'Disc' },
  { char: '◦', label: 'Circle' },
  { char: '▪', label: 'Square' },
  { char: '❖', label: 'Diamond' },
  { char: '➢', label: 'Arrowhead' },
  { char: '⇨', label: 'Arrow' },
  { char: '✓', label: 'Check' },
  { char: '–', label: 'Dash' },
  { char: '>', label: 'Chevron' },
];

// Attr helper: null (= inherit the default cycle) when the char is empty or equals
// the default for its depth, so round trips don't accrete explicit attrs.
export function bulletCharAttr(char: string | null | undefined, depth0: number): string | null {
  if (!char) return null;
  return char === defaultBulletChar(depth0) ? null : char;
}

// Word bullets are private-use codepoints (U+F0xx) in a symbol font; low byte =
// the glyph index. Unicode equivalents for the common Wingdings/Symbol bullets.
const WINGDINGS_MAP: Record<number, string> = {
  0x6c: '●',
  0x6e: '■',
  0x6f: '□',
  0x71: '❑',
  0x75: '◆',
  0x76: '❖',
  0x9e: '·',
  0x9f: '•',
  0xa1: '○',
  0xa4: '◉',
  0xa7: '▪',
  0xa8: '□',
  0xd8: '➢',
  // The arrows Word's bullet library draws as Wingdings 0xDF–0xE2 and 0xE8.
  0xdf: '←',
  0xe0: '→',
  0xe1: '↑',
  0xe2: '↓',
  0xe8: '➔',
  0xf0: '⇨',
  0xfc: '✓',
};

// The Symbol font's own encoding where it differs from ASCII (bracket and integral
// pieces left out); every other printable ASCII code is the character itself.
const SYMBOL_MAP: Record<number, string> = {
  0x22: '∀', 0x24: '∃', 0x27: '∋', 0x2a: '∗', 0x2d: '−', 0x40: '≅', 0x41: 'Α', 0x42: 'Β',
  0x43: 'Χ', 0x44: 'Δ', 0x45: 'Ε', 0x46: 'Φ', 0x47: 'Γ', 0x48: 'Η', 0x49: 'Ι', 0x4a: 'ϑ',
  0x4b: 'Κ', 0x4c: 'Λ', 0x4d: 'Μ', 0x4e: 'Ν', 0x4f: 'Ο', 0x50: 'Π', 0x51: 'Θ', 0x52: 'Ρ',
  0x53: 'Σ', 0x54: 'Τ', 0x55: 'Υ', 0x56: 'ς', 0x57: 'Ω', 0x58: 'Ξ', 0x59: 'Ψ', 0x5a: 'Ζ',
  0x5c: '∴', 0x5e: '⊥', 0x61: 'α', 0x62: 'β', 0x63: 'χ', 0x64: 'δ', 0x65: 'ε', 0x66: 'φ',
  0x67: 'γ', 0x68: 'η', 0x69: 'ι', 0x6a: 'ϕ', 0x6b: 'κ', 0x6c: 'λ', 0x6d: 'μ', 0x6e: 'ν',
  0x6f: 'ο', 0x70: 'π', 0x71: 'θ', 0x72: 'ρ', 0x73: 'σ', 0x74: 'τ', 0x75: 'υ', 0x76: 'ϖ',
  0x77: 'ω', 0x78: 'ξ', 0x79: 'ψ', 0x7a: 'ζ', 0x7e: '∼', 0xa0: '€', 0xa1: 'ϒ', 0xa2: '′',
  0xa3: '≤', 0xa4: '⁄', 0xa5: '∞', 0xa6: 'ƒ', 0xa7: '♣', 0xa8: '♦', 0xa9: '♥', 0xaa: '♠',
  0xab: '↔', 0xac: '←', 0xad: '↑', 0xae: '→', 0xaf: '↓', 0xb0: '°', 0xb1: '±', 0xb2: '″',
  0xb3: '≥', 0xb4: '×', 0xb5: '∝', 0xb6: '∂', 0xb7: '•', 0xb8: '÷', 0xb9: '≠', 0xba: '≡',
  0xbb: '≈', 0xbc: '…', 0xbf: '↵', 0xc0: 'ℵ', 0xc1: 'ℑ', 0xc2: 'ℜ', 0xc3: '℘', 0xc4: '⊗',
  0xc5: '⊕', 0xc6: '∅', 0xc7: '∩', 0xc8: '∪', 0xc9: '⊃', 0xca: '⊇', 0xcb: '⊄', 0xcc: '⊂',
  0xcd: '⊆', 0xce: '∈', 0xcf: '∉', 0xd0: '∠', 0xd1: '∇', 0xd2: '®', 0xd3: '©', 0xd4: '™',
  0xd5: '∏', 0xd6: '√', 0xd7: '⋅', 0xd8: '¬', 0xd9: '∧', 0xda: '∨', 0xdb: '⇔', 0xdc: '⇐',
  0xdd: '⇑', 0xde: '⇒', 0xdf: '⇓', 0xe0: '◊', 0xe1: '〈', 0xe5: '∑', 0xf1: '〉', 0xf2: '∫',
};
for (let c = 0x21; c < 0x7f; c++) SYMBOL_MAP[c] ??= String.fromCharCode(c);

function symbolMapFor(font: string | null | undefined): Record<number, string> | null {
  const f = (font ?? '').toLowerCase();
  if (f.startsWith('wingdings')) return WINGDINGS_MAP;
  if (f.startsWith('symbol')) return SYMBOL_MAP;
  return null;
}

export const isSymbolFont = (font: string | null | undefined): boolean => !!symbolMapFor(font);

// A stored bullet back to the private-use code its symbol font addresses it by, as Word and
// LibreOffice write it; null when that font has no glyph mapped to the char.
export function symbolFontChar(char: string, font: string | null | undefined): string | null {
  const map = symbolMapFor(font);
  const code = map && Object.keys(map).find((k) => map[+k] === char);
  return code ? String.fromCharCode(0xf000 | +code) : null;
}

// One marker char (+ its declared font) → the Unicode char to store, or null when
// it can't be represented (unknown symbol glyph → default cycle).
function mapSymbolChar(char: string, font: string | null | undefined): string | null {
  const code = char.charCodeAt(0);
  const isPua = code >= 0xf000 && code <= 0xf0ff;
  const map = symbolMapFor(font);
  // Symbol fonts address glyphs by low byte whether or not the PUA offset is used;
  // a character past that byte is already Unicode.
  if (map && (isPua || code <= 0xff)) return map[code & 0xff] ?? null;
  if (map) return char;
  if (isPua) return null;
  // A soft hyphen as the label is drawn as the hyphen it stands for, never hidden.
  return char === '\u00ad' ? '-' : char;
}

// DOCX w:lvlText + the level's w:rFonts font → Unicode char (null = default).
export function bulletCharFromDocx(lvlText: string | undefined, font: string | undefined): string | null {
  if (!lvlText) return null;
  return mapSymbolChar(lvlText.charAt(0), font);
}

// ODT text:bullet-char + the level def's font name → Unicode char (null = default).
// LibreOffice writes real Unicode chars (pass through); Word-written .odt keeps the
// PUA-plus-symbol-font pattern, which the maps resolve.
export function bulletCharFromOdf(ch: string | null, fontName: string | null): string | null {
  if (!ch) return null;
  return mapSymbolChar(ch.charAt(0), fontName);
}
