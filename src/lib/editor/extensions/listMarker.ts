import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { cssFontFamily, resolveStyle, type StyleSheet, type TextProps } from '../../styles/styleSheet';

// A list marker's direct formatting. CSS values, since that is what two of the three
// consumers want; the DOCX exporter converts. The family is the plain name, not a CSS
// stack — the exporters need it that way, and markerStyle builds the stack.
export interface MarkerFormat {
  fontFamily: string | null;
  fontWeight: string | null;
  fontStyle: string | null;
  fontSize: string | null;
  color: string | null;
}

type MarkLike = { type: string; attrs?: Record<string, unknown> | null };
type JsonNode = { type?: string; attrs?: Record<string, unknown> | null; marks?: MarkLike[] | null; content?: JsonNode[] };

// A named character style on the portion resolves through the registry, which neither
// the plugin nor an exporter owns — both hand in the lookup (`charProps` below).
export type CharStyleProps = (name: string) => TextProps;

export const charStyleProps = (sheet: StyleSheet): CharStyleProps =>
  (name) => resolveStyle(sheet, name, 'character').text;

// The formatting a marker takes from the item's **first text portion** — the rule
// LibreOffice numbering uses (Word takes the paragraph mark instead). Verified by
// probe: bold-then-plain gets a bold number, plain-then-bold does not.
export function markerFormat(marks: MarkLike[], blockFontSize: unknown, charProps?: CharStyleProps): MarkerFormat | null {
  const ts = marks.find((m) => m.type === 'textStyle')?.attrs ?? {};
  // The portion's character style is the base; its own marks stay on top (as in applyRuns).
  const name = marks.find((m) => m.type === 'charStyle')?.attrs?.name;
  const cs: TextProps = charProps && typeof name === 'string' && name ? charProps(name) : {};
  const size = ts.fontSize ?? (cs.fontSizePt != null ? `${cs.fontSizePt}pt` : null) ?? blockFontSize;
  const bold = marks.some((m) => m.type === 'bold') || cs.bold;
  const format: MarkerFormat = {
    fontFamily: str(ts.fontFamily) ?? cs.fontFamily ?? null,
    // An explicit fontWeight is the un-bold channel, so it outranks the bold mark.
    fontWeight: ts.fontWeight != null ? String(ts.fontWeight) : bold ? 'bold' : null,
    fontStyle: marks.some((m) => m.type === 'italic') || cs.italic ? 'italic' : null,
    fontSize: str(size),
    color: str(ts.color) ?? cs.color ?? null,
  };
  return KEYS.some((key) => format[key]) ? format : null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

const KEYS = ['fontFamily', 'fontWeight', 'fontStyle', 'fontSize', 'color'] as const;

// The format the whole list agrees on (TipTap JSON), else null — a file carries
// marker formatting per level, so only a uniform list can carry it. Left out, both
// LibreOffice (first portion) and Word (paragraph mark) fall back to their own rule.
export function listMarkerFormat(list: JsonNode, charProps?: CharStyleProps): MarkerFormat | null {
  let common: MarkerFormat | null = null;
  for (const item of list.content ?? []) {
    if (item.type !== 'listItem') continue;
    const block = item.content?.[0];
    const first = block?.content?.[0];
    const format = block && first?.type === 'text' ? markerFormat(first.marks ?? [], block.attrs?.fontSize, charProps) : null;
    if (!format || (common && !sameFormat(common, format))) return null;
    common = format;
  }
  return common;
}

function sameFormat(a: MarkerFormat, b: MarkerFormat): boolean {
  return KEYS.every((key) => a[key] === b[key]);
}

// Every item is decorated, resets included: the properties inherit, so a nested item
// would take its parent's. The reset is `initial` — guaranteed-invalid on a custom
// property, so editor.css's var() falls back; `inherit` would pull the parent's in.
function markerStyle(format: MarkerFormat | null): string {
  const family = format?.fontFamily ? cssFontFamily(format.fontFamily) : 'initial';
  return `--marker-family:${family};--marker-weight:${format?.fontWeight ?? 'initial'};`
    + `--marker-style:${format?.fontStyle ?? 'initial'};--marker-size:${format?.fontSize ?? 'initial'};`
    + `--marker-color:${format?.color ?? 'initial'}`;
}

export function listMarkerDecos(doc: ProseMirrorNode, charProps?: CharStyleProps): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'listItem') return;
    decos.push(Decoration.node(pos, pos + node.nodeSize, { style: markerStyle(itemMarkerFormat(node, charProps)) }));
  });
  return DecorationSet.create(doc, decos);
}

// Set on the transaction Editor.svelte's stylesheet effect dispatches: an edited registry
// changes what a character or list style means, which no document change shows.
export const SHEET_CHANGED = 'sheetChanged';

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'listItem']);

// Whether a transaction's changes reach into a list. A step is taken by its own range
// (`from`/`to` or `pos`, which is all a mark step has — its position map is empty) and
// by what its map moved, in the document before and after it. Anything else leaves every
// marker as it was, so the old decorations are mapped instead of rebuilt.
export function touchesList(tr: Transaction): boolean {
  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i] as unknown as { from?: number; to?: number; pos?: number };
    const before = tr.docs[i];
    const after = tr.docs[i + 1] ?? tr.doc;
    if (typeof step.from === 'number' && inList(before, step.from, step.to ?? step.from)) return true;
    if (typeof step.pos === 'number' && inList(before, step.pos, step.pos + 1)) return true;
    let hit = false;
    tr.steps[i].getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
      hit ||= inList(before, oldStart, oldEnd) || inList(after, newStart, newEnd);
    });
    if (hit) return true;
  }
  return false;
}

// A list node in the range, or one around it — a marker's format is read from the item's
// first text portion, so a change inside an item counts as much as one to the list.
function inList(doc: ProseMirrorNode, from: number, to: number): boolean {
  if (from > doc.content.size) return true; // out of this document: rebuild rather than miss
  const $from = doc.resolve(from);
  for (let d = $from.depth; d > 0; d--) if (LIST_TYPES.has($from.node(d).type.name)) return true;
  let hit = false;
  doc.nodesBetween(from, Math.min(to, doc.content.size), (node) => { hit ||= LIST_TYPES.has(node.type.name); return !hit; });
  return hit;
}

function itemMarkerFormat(item: ProseMirrorNode, charProps?: CharStyleProps): MarkerFormat | null {
  const block = item.firstChild;
  const first = block?.firstChild;
  if (!block || !first?.isText) return null;
  return markerFormat(first.marks.map((m) => ({ type: m.type.name, attrs: m.attrs })), block.attrs.fontSize, charProps);
}

const listMarkerKey = new PluginKey<DecorationSet>('listMarkerFormat');

export const ListMarker = Extension.create<{ sheet: () => StyleSheet }>({
  name: 'listMarker',

  addOptions() {
    return { sheet: () => ({ paragraph: {}, character: {}, table: {}, list: {} }) };
  },

  // Which end of the hanging indent the label is set against (Word's w:lvlJc, ODF's
  // fo:text-align on the level properties). `right` keeps a wide number — Roman
  // numerals — out of the text, which is what the built-in numberings use it for.
  addGlobalAttributes() {
    return [
      {
        types: ['bulletList', 'orderedList'],
        attributes: {
          markerAlign: {
            default: null,
            parseHTML: (el: HTMLElement) => (el.getAttribute('data-marker-align') === 'right' ? 'right' : null),
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.markerAlign === 'right' ? { 'data-marker-align': 'right' } : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    const props = () => charStyleProps(this.options.sheet());
    return [
      new Plugin({
        key: listMarkerKey,
        state: {
          init: (_, state) => listMarkerDecos(state.doc, props()),
          apply: (tr, old) =>
            tr.getMeta(SHEET_CHANGED) || (tr.docChanged && touchesList(tr)) ? listMarkerDecos(tr.doc, props())
            : tr.docChanged ? old.map(tr.mapping, tr.doc) : old,
        },
        props: {
          decorations(state) {
            return listMarkerKey.getState(state);
          },
        },
      }),
    ];
  },
});
