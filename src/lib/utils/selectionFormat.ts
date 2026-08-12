// What the selection formats uniformly. Each reader returns the shared value,
// '' when the selection mixes two, and null where "no value" is meaningful.
// Framework-free, so a toolbar reads them inside its own reactive wrapper.

import type { EditorState } from '@tiptap/pm/state';
import { blockFontSize, DEFAULT_FONT_SIZE, type SizedBlock } from './fontSize';

export const DEFAULT_EDITOR_FONT = 'Liberation Serif';

type MarkedNode = {
  isText: boolean;
  isInline: boolean;
  isAtom: boolean;
  attrs: Record<string, unknown>;
  marks: readonly { type: { name: string }; attrs: Record<string, string> }[];
};

// A node that carries text formatting: a text node, or an inline atom (a date
// field, say) bearing the mark. Selecting such an atom makes a NodeSelection, so
// without this its font, size and colour would all read as the default.
export function bearsMark(node: MarkedNode, markName: string): boolean {
  return node.isText || (node.isInline && node.isAtom && node.marks.some((m) => m.type.name === markName));
}

// Walks the selection and returns the one value every node agrees on, '' if they
// disagree. `read` returns undefined for a node that carries no opinion.
function uniform<T>(state: EditorState, read: (node: MarkedNode, parent: MarkedNode | null) => T | undefined): T | '' | undefined {
  const { from, to } = state.selection;
  let value: T | undefined;
  let mixed = false;
  state.doc.nodesBetween(from, to, (node, _pos, parent) => {
    if (mixed) return;
    const v = read(node as unknown as MarkedNode, parent as unknown as MarkedNode | null);
    if (v === undefined) return;
    if (value === undefined) value = v;
    else if (value !== v) mixed = true;
  });
  return mixed ? '' : value;
}

function storedMarkAttr(state: EditorState, markName: string, attr: string): string | undefined {
  const marks = state.storedMarks ?? state.selection.$head.marks();
  return marks.find((m) => m.type.name === markName)?.attrs[attr] as string | undefined;
}

export function uniformFont(state: EditorState): string {
  if (state.selection.empty) return storedMarkAttr(state, 'textStyle', 'fontFamily') ?? DEFAULT_EDITOR_FONT;
  const v = uniform<string>(state, (node) =>
    bearsMark(node, 'textStyle')
      ? (node.marks.find((m) => m.type.name === 'textStyle')?.attrs.fontFamily ?? DEFAULT_EDITOR_FONT)
      : undefined);
  return v ?? DEFAULT_EDITOR_FONT;
}

export function uniformFontSize(state: EditorState): string {
  if (state.selection.empty) {
    const head = state.selection.$head;
    return storedMarkAttr(state, 'textStyle', 'fontSize') ?? blockFontSize(head.parent as unknown as SizedBlock);
  }
  const v = uniform<string>(state, (node, parent) => {
    if (!bearsMark(node, 'textStyle')) return undefined;
    const explicit = node.marks.find((m) => m.type.name === 'textStyle')?.attrs.fontSize;
    return explicit || blockFontSize(parent as unknown as SizedBlock);
  });
  return v ?? DEFAULT_FONT_SIZE;
}

// null = no colour anywhere. Font colour rides the textStyle mark (fontColor.ts),
// highlight its own multicolor mark.
export function uniformMarkColor(state: EditorState, markName: string): string | null {
  if (state.selection.empty) return storedMarkAttr(state, markName, 'color') ?? null;
  const v = uniform<string | null>(state, (node) =>
    bearsMark(node, markName)
      ? (node.marks.find((m) => m.type.name === markName)?.attrs.color ?? null)
      : undefined);
  return v === undefined ? null : v;
}

// A block attribute every selected block agrees on (lineHeight, spaceBefore,
// backgroundColor …). `fallback` is what a block without the attribute reports.
export function uniformBlockAttr<T>(state: EditorState, attr: string, fallback: T): T | '' {
  if (state.selection.empty) return (state.selection.$head.parent.attrs[attr] ?? fallback) as T;
  const v = uniform<T>(state, (node) => (attr in node.attrs ? ((node.attrs[attr] ?? fallback) as T) : undefined));
  return v === undefined ? fallback : v;
}
