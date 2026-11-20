import type { Node as PMNode } from '@tiptap/pm/model';
import { resolveStyle } from '../styles/styleSheet';
import { styleSheet } from '../styles/sheet.svelte';
import { blockStyleName } from '../editor/extensions/paragraphStyle';
import { formatDecimal, parseDecimal } from '../i18n/number';

// The size a block renders its unmarked text at — what the toolbar's size box must show.

export const DEFAULT_FONT_SIZE = '12pt';

// The size box's steps; also the grow/shrink shortcut's ladder.
export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

// The named Chinese sizes (字号) the Simplified Chinese UI lists before the points.
export const CJK_FONT_SIZES: [string, number][] = [
  ['初号', 42], ['小初', 36], ['一号', 26], ['小一', 24], ['二号', 22], ['小二', 18],
  ['三号', 16], ['小三', 15], ['四号', 14], ['小四', 12], ['五号', 10.5], ['小五', 9],
  ['六号', 7.5], ['小六', 6.5], ['七号', 5.5], ['八号', 5],
];

// What the size box shows for a 'Npt' size: its Chinese name when `named`, else the number
// with the UI language's decimal separator.
export function sizeLabel(size: string, named: boolean): string {
  const pt = parseFloat(size);
  return (named && CJK_FONT_SIZES.find(([, p]) => p === pt)?.[0])
    || (/^[\d.]+pt$/.test(size) ? formatDecimal(pt) : size.replace('pt', ''));
}

// The size box's list: the named sizes first when `named`, then the points.
export function sizeMenu(named: boolean): [string, number][] {
  return [...(named ? CJK_FONT_SIZES : []), ...FONT_SIZES.map((s): [string, number] => [formatDecimal(s), s])];
}

// A typed size in points: a Chinese name or a number (either decimal separator, one decimal kept,
// since imported files carry fractional sizes); null when out of range or unreadable.
export function parseSize(text: string): number | null {
  const named = CJK_FONT_SIZES.find(([n]) => n === text.trim());
  if (named) return named[1];
  const pt = Math.round(parseDecimal(text) * 10) / 10;
  return pt >= 1 && pt <= 400 ? pt : null;
}

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
