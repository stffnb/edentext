// What the selection formats uniformly. Each reader returns the shared value,
// '' when the selection mixes two, and null where "no value" is meaningful.
// Framework-free, so a toolbar reads them inside its own reactive wrapper.

import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { blockFontSize, DEFAULT_FONT_SIZE, type SizedBlock } from './fontSize';
import { resolveStyle } from '../styles/styleSheet';
import { styleSheet } from '../styles/sheet.svelte';
import { blockStyleName } from '../editor/extensions/paragraphStyle';
import { ASIAN_SCRIPT_RE } from './script';
import { asianLang, westLang } from '../storage/documentLanguage';

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

// The font the box shows: Chinese, Japanese or Korean text reads its asian font, other
// text the western one, so a selection over both shows a font only where the two agree.
// A run without one shows its block's, else the block style's. At a bare caret the
// character before it decides.
export function uniformFont(state: EditorState): string {
  type Attrs = Record<string, unknown> | undefined;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const style = (block: SizedBlock) => resolveStyle(styleSheet(), blockStyleName(block)).text;
  const west = (run: Attrs, block: SizedBlock) =>
    str(run?.fontFamily) ?? str(block?.attrs?.fontFamily) ?? style(block).fontFamily ?? DEFAULT_EDITOR_FONT;
  const asian = (run: Attrs, block: SizedBlock) =>
    str(run?.fontFamilyAsian) ?? str(run?.fontFamily) ?? str(block?.attrs?.fontFamilyAsian) ?? str(block?.attrs?.fontFamily)
    ?? style(block).fontFamilyAsian ?? style(block).fontFamily ?? DEFAULT_EDITOR_FONT;
  const { from, to, empty, $head } = state.selection;
  if (empty) {
    const attrs = (state.storedMarks ?? $head.marks()).find((m) => m.type.name === 'textStyle')?.attrs;
    const block = $head.parent as unknown as SizedBlock;
    return ASIAN_SCRIPT_RE.test($head.nodeBefore?.text?.slice(-1) ?? '') ? asian(attrs, block) : west(attrs, block);
  }
  const fonts = new Set<string>();
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!bearsMark(node as unknown as MarkedNode, 'textStyle')) return;
    const attrs = node.marks.find((m) => m.type.name === 'textStyle')?.attrs;
    const block = parent as unknown as SizedBlock;
    const text = node.text?.slice(Math.max(0, from - pos), to - pos) ?? '';
    if (!node.isText || /[^\s]/u.test(text.replace(new RegExp(ASIAN_SCRIPT_RE.source, 'gu'), ''))) fonts.add(west(attrs, block));
    if (ASIAN_SCRIPT_RE.test(text)) fonts.add(asian(attrs, block));
  });
  return fonts.size > 1 ? '' : [...fonts][0] ?? DEFAULT_EDITOR_FONT;
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

// The edge each selected paragraph is drawn at: its own alignment, else its style's, else
// the side its direction starts at (read off the rendered block, which knows the page's,
// a table's and its own direction). '' where the paragraphs differ.
export function shownAlign(view: EditorView): string {
  const { from, to } = view.state.selection;
  let value: string | undefined;
  let mixed = false;
  view.state.doc.nodesBetween(from, to, (node, pos) => {
    if (mixed || (node.type.name !== 'paragraph' && node.type.name !== 'heading')) return;
    let v = (node.attrs.textAlign as string | null) ?? resolveStyle(styleSheet(), blockStyleName(node)).para.textAlign;
    if (!v) {
      const el = view.nodeDOM(pos);
      v = el instanceof Element && getComputedStyle(el).direction === 'rtl' ? 'right' : 'left';
    }
    if (value === undefined) value = v;
    else if (value !== v) mixed = true;
  });
  return mixed ? '' : (value ?? 'left');
}

// The language in force across the selection, read like the font: East Asian text its
// asian language, other text its western one, each from the run, else its block, else
// the document's pair. '' where the selection mixes two.
export function uniformLanguage(state: EditorState, doc: { west: string | null; asian: string | null } = { west: null, asian: null }): string | null | '' {
  type Attrs = Record<string, unknown> | undefined;
  const west = (run: Attrs, block: Attrs) => westLang(run?.lang) ?? westLang(block?.lang) ?? doc.west;
  const asian = (run: Attrs, block: Attrs) =>
    (run?.langAsian as string | null) || asianLang(run?.lang) || (block?.langAsian as string | null) || asianLang(block?.lang) || doc.asian;
  const { from, to, empty, $head } = state.selection;
  if (empty) {
    const run = (state.storedMarks ?? $head.marks()).find((m) => m.type.name === 'textStyle')?.attrs;
    return ASIAN_SCRIPT_RE.test($head.nodeBefore?.text?.slice(-1) ?? '') ? asian(run, $head.parent.attrs) : west(run, $head.parent.attrs);
  }
  const langs = new Set<string | null>();
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!bearsMark(node as unknown as MarkedNode, 'textStyle')) return;
    const run = node.marks.find((m) => m.type.name === 'textStyle')?.attrs;
    const text = node.text?.slice(Math.max(0, from - pos), to - pos) ?? '';
    if (!node.isText || /[^\s]/u.test(text.replace(new RegExp(ASIAN_SCRIPT_RE.source, 'gu'), ''))) langs.add(west(run, parent?.attrs));
    if (ASIAN_SCRIPT_RE.test(text)) langs.add(asian(run, parent?.attrs));
  });
  return langs.size > 1 ? '' : langs.size ? [...langs][0] : doc.west;
}

// Whether an East Asian language is set anywhere in the selection, on a run or its block.
export function hasAsianLanguage(state: EditorState): boolean {
  const asian = (attrs?: Record<string, unknown>) => !!(attrs?.langAsian || asianLang(attrs?.lang));
  const { from, to, empty, $head } = state.selection;
  if (empty) return asian((state.storedMarks ?? $head.marks()).find((m) => m.type.name === 'textStyle')?.attrs) || asian($head.parent.attrs);
  let found = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (found) return false;
    found = asian(node.attrs) || node.marks.some((m) => m.type.name === 'textStyle' && asian(m.attrs));
  });
  return found;
}
