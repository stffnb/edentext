import type { Editor } from '@tiptap/core';
import { droppedFrameAttrs, wrapGap, wrapGapAttr, type WrapGap, type WrapMode } from '../editor/extensions/image';
import { t } from '../i18n/i18n.svelte';
import { parseDecimal } from '../i18n/number';

// Wrap, stacking and text gap of a picture or a shape, for the ribbon's frame tabs and
// the floating frame toolbars alike.

export type FrameKind = 'picture' | 'shape';

// The two run-through entries are one mode, told apart by which side of the text the
// frame lands on — as in Word's layout options, whose "tight" no browser can draw.
export type WrapChoice = WrapMode | 'behind' | 'front';
export const WRAP_CHOICES: WrapChoice[] = ['inline', 'left', 'right', 'topBottom', 'behind', 'front'];

export function wrapChoice(wrap: WrapMode, inFront: boolean): WrapChoice {
  return wrap === 'through' ? (inFront ? 'front' : 'behind') : wrap;
}

/** Picking a mode by hand drops the offsets of the one it replaces. */
export function setFrameWrap(editor: Editor | null, kind: FrameKind, choice: WrapChoice, current: WrapMode): void {
  const mode: WrapMode = choice === 'behind' || choice === 'front' ? 'through' : choice;
  if (kind === 'picture') editor?.chain().focus().setImageWrap(mode, choice === 'front').run();
  else editor?.chain().focus().setTextBoxAttrs({ wrap: mode, ...droppedFrameAttrs(mode, choice === 'front', current) }).run();
}

// Over or under the other free frames; only those overlap, so a frame in the flow has none.
export const ORDERS = ['forward', 'backward', 'front', 'back'] as const;
export type FrameOrder = (typeof ORDERS)[number];
export const ORDER_LABEL: Record<FrameOrder, () => string> = {
  forward: () => t().image.orderForward,
  backward: () => t().image.orderBackward,
  front: () => t().image.orderFront,
  back: () => t().image.orderBack,
};
export const ORDER_ICON = { forward: 'orderForward', backward: 'orderBackward', front: 'orderFront', back: 'orderBack' } as const;

// The space the frame keeps to the text, per side: only a frame the text wraps has one.
export const GAP_SIDES: (keyof WrapGap)[] = ['top', 'bottom', 'left', 'right'];
export const GAP_LABEL: Record<keyof WrapGap, () => string> = {
  top: () => t().image.gapTop,
  bottom: () => t().image.gapBottom,
  left: () => t().image.gapLeft,
  right: () => t().image.gapRight,
};

export function hasWrapGap(wrap: WrapMode): boolean {
  return wrap !== 'inline' && wrap !== 'through';
}

export function setFrameGap(editor: Editor | null, kind: FrameKind, wrapDist: unknown, side: keyof WrapGap, raw: string): void {
  const v = parseDecimal(raw);
  if (isNaN(v)) return;
  const next = wrapGapAttr({ ...wrapGap(wrapDist), [side]: Math.max(0, Math.min(10, v)) });
  if (kind === 'picture') editor?.chain().focus().setImageAttrs({ wrapDist: next }).run();
  else editor?.chain().focus().setTextBoxAttrs({ wrapDist: next }).run();
}
