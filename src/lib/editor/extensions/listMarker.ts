import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { cssFontFamily, resolveStyle, type StyleSheet, type TextProps } from '../../styles/styleSheet';
import { FORCE_PAGE_RECALC } from './pageBreaks';

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

// Every item is decorated, resets included: the custom properties inherit, so a
// nested item would otherwise take its parent item's marker format. The reset is
// `initial` — on a custom property that is the guaranteed-invalid value, which makes
// the var() in editor.css fall back; `inherit` would pull the parent's value in.
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
    return { sheet: () => ({ paragraph: {}, character: {}, table: {} }) };
  },

  addProseMirrorPlugins() {
    const props = () => charStyleProps(this.options.sheet());
    return [
      new Plugin({
        key: listMarkerKey,
        state: {
          init: (_, state) => listMarkerDecos(state.doc, props()),
          // An edited registry can change what a character style means, and that
          // arrives as FORCE_PAGE_RECALC (Editor.svelte's stylesheet effect).
          apply: (tr, old) =>
            tr.docChanged || tr.getMeta(FORCE_PAGE_RECALC) ? listMarkerDecos(tr.doc, props()) : old,
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
