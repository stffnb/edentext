import { resolveStyle } from '../styles/styleSheet';
import { styleSheet } from '../styles/sheet.svelte';
import { blockStyleName } from '../editor/extensions/paragraphStyle';

// The size a block renders its unmarked text at — what the toolbar's size box must show.

export const DEFAULT_FONT_SIZE = '12pt';

export type SizedBlock = { type: { name: string }; attrs?: Record<string, unknown> } | null;

// Paragraph-mark size (blockFontSize attr) wins, else the block's named style.
export function blockFontSize(block: SizedBlock): string {
  const explicit = block?.attrs?.fontSize;
  if (typeof explicit === 'string' && explicit) return explicit;
  const size = resolveStyle(styleSheet(), blockStyleName(block)).text.fontSizePt;
  return size != null ? `${size}pt` : DEFAULT_FONT_SIZE;
}
