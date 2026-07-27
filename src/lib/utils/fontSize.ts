import { HEADING_STYLE_OVERRIDES } from '../export/odt';

// The size a block renders its unmarked text at — what the toolbar's size box must show.
// Keep in sync with editor.css (tests/unit/font-size-display.test.ts asserts it).

export const DEFAULT_FONT_SIZE = '12pt';

export const HEADING_SIZES: Record<number, string> =
  Object.fromEntries(HEADING_STYLE_OVERRIDES.map((h, i) => [i + 1, h.fontSize]));

export type SizedBlock = { type: { name: string }; attrs?: Record<string, unknown> } | null;

// Paragraph-mark size (blockFontSize attr) wins, else the heading/body default.
export function blockFontSize(block: SizedBlock): string {
  const explicit = block?.attrs?.fontSize;
  if (typeof explicit === 'string' && explicit) return explicit;
  if (block?.type.name === 'heading') return HEADING_SIZES[Number(block.attrs?.level)] ?? DEFAULT_FONT_SIZE;
  return DEFAULT_FONT_SIZE;
}
