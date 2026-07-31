import type { Node as PMNode } from '@tiptap/pm/model';
import { resolveStyle } from '../styles/styleSheet';
import { styleSheet } from '../styles/sheet.svelte';
import { blockStyleName } from '../editor/extensions/paragraphStyle';

// The size a block renders its unmarked text at — what the toolbar's size box must show.

export const DEFAULT_FONT_SIZE = '12pt';

// The size box's steps; also the grow/shrink shortcut's ladder.
export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

export type SizedBlock = { type: { name: string }; attrs?: Record<string, unknown> } | null;

// Paragraph-mark size (blockFontSize attr) wins, else the block's named style.
export function blockFontSize(block: SizedBlock): string {
  const explicit = block?.attrs?.fontSize;
  if (typeof explicit === 'string' && explicit) return explicit;
  const size = resolveStyle(styleSheet(), blockStyleName(block)).text.fontSizePt;
  return size != null ? `${size}pt` : DEFAULT_FONT_SIZE;
}

// An empty line or a fully covered block also takes the paragraph-mark size, so what
// the block renders can't diverge from the shown size (and empty lines keep it).
export function coversWholeBlock(doc: PMNode, from: number, to: number): boolean {
  const rFrom = doc.resolve(from);
  const rTo = doc.resolve(to);
  return from === to
    ? rFrom.parent.content.size === 0
    : rFrom.parentOffset === 0 && rTo.parentOffset === rTo.parent.content.size;
}
