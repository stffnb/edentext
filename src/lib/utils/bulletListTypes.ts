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
  0x75: '◆',
  0x76: '❖',
  0xa7: '▪',
  0xa8: '□',
  0xd8: '➢',
  0xf0: '⇨',
  0xfc: '✓',
};

const SYMBOL_MAP: Record<number, string> = {
  0xb7: '•',
  0xa8: '♦',
};

function symbolMapFor(font: string | null | undefined): Record<number, string> | null {
  const f = (font ?? '').toLowerCase();
  if (f.startsWith('wingdings')) return WINGDINGS_MAP;
  if (f.startsWith('symbol')) return SYMBOL_MAP;
  return null;
}

// One marker char (+ its declared font) → the Unicode char to store, or null when
// it can't be represented (unknown symbol glyph → default cycle).
function mapSymbolChar(char: string, font: string | null | undefined): string | null {
  const code = char.charCodeAt(0);
  const isPua = code >= 0xf000 && code <= 0xf0ff;
  const map = symbolMapFor(font);
  if (map) {
    // Symbol fonts address glyphs by low byte whether or not the PUA offset is used.
    return map[code & 0xff] ?? null;
  }
  if (isPua) return null;
  // Word's classic hollow bullet is a Courier New "o" — render it as a real circle.
  if (char === 'o' && (font ?? '').toLowerCase().startsWith('courier')) return '◦';
  return char;
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
