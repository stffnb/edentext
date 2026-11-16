import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { cssFontFamily, resolveStyle, screenFontName, type StyleSheet, type TextProps } from '../../styles/styleSheet';
import { blockStyleName } from './paragraphStyle';

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

// The level's own label formatting (Word's w:lvl/w:rPr, ODF's text style on the level),
// stored on the list as `markerFormat`: each field it sets outranks the first portion's.
export function withOwnMarker(own: unknown, portion: MarkerFormat | null): MarkerFormat | null {
  const o = own && typeof own === 'object' ? own as Partial<MarkerFormat> : null;
  if (!o) return portion;
  const out = Object.fromEntries(KEYS.map((key) => [key, str(o[key]) ?? portion?.[key] ?? null])) as unknown as MarkerFormat;
  return KEYS.some((key) => out[key]) ? out : null;
}

// A level's text formatting as a marker's. A symbol font's glyph is stored as its Unicode
// character but the family stays: the label is drawn in it, and its height counts in the line.
export function markerFormatFromText(t: TextProps): Partial<MarkerFormat> | null {
  const out: Partial<MarkerFormat> = {};
  if (t.fontFamily) out.fontFamily = t.fontFamily;
  if (t.bold != null) out.fontWeight = t.bold ? 'bold' : 'normal';
  if (t.italic) out.fontStyle = 'italic';
  if (t.fontSizePt != null) out.fontSize = `${t.fontSizePt}pt`;
  if (t.color) out.color = t.color;
  return Object.keys(out).length ? out : null;
}

// Drops from every list's `markerFormat` what its items' first portions give anyway, so
// a file's own markers stay put and a round trip adds nothing.
export function pruneMarkerFormats(nodes: JsonNode[] | undefined, charProps?: CharStyleProps, sheet?: StyleSheet): void {
  for (const n of nodes ?? []) {
    const own = n.attrs?.markerFormat as Partial<MarkerFormat> | null | undefined;
    if (own && typeof own === 'object') {
      const portion = listMarkerFormat({ ...n, attrs: { ...n.attrs, markerFormat: null } }, charProps);
      // With no family of its own the text is in its block's, which a marker's need not repeat.
      const block = n.content?.[0]?.content?.[0];
      const text = portion?.fontFamily ?? (sheet && block ? resolveStyle(sheet, blockStyleName({ type: { name: String(block.type) }, attrs: block.attrs ?? undefined })).text.fontFamily : null);
      const same = (key: typeof KEYS[number]) => key === 'fontFamily' ? screenFontName(own[key]!) === (text && screenFontName(text)) : own[key] === portion?.[key];
      const kept = Object.fromEntries(KEYS.filter((key) => own[key] && !same(key)).map((key) => [key, own[key]]));
      n.attrs!.markerFormat = Object.keys(kept).length ? kept : null;
      if (!n.attrs!.markerFormat) delete n.attrs!.markerFormat;
    }
    pruneMarkerFormats(n.content, charProps, sheet);
  }
}

// The pruning over a whole import: the body and every header/footer zone, against the
// imported character styles a first portion may name.
export function pruneImportedMarkers(result: { content: unknown; styles: StyleSheet; hfSections?: unknown[] } & Record<string, unknown>): void {
  const charProps = charStyleProps(result.styles);
  const zones = [result, ...(result.hfSections ?? [])].flatMap((set) =>
    Object.values(set as Record<string, unknown>).filter((v): v is JsonNode => !!v && typeof v === 'object' && (v as JsonNode).type === 'doc'));
  for (const doc of zones) pruneMarkerFormats(doc.content, charProps, result.styles);
}

// The format the whole list agrees on (TipTap JSON), else null — a file carries
// marker formatting per level, so only a uniform list can carry it. Left out, both
// LibreOffice (first portion) and Word (paragraph mark) fall back to their own rule.
// The list's own `markerFormat` goes over it.
export function listMarkerFormat(list: JsonNode, charProps?: CharStyleProps): MarkerFormat | null {
  return withOwnMarker(list.attrs?.markerFormat, portionMarkerFormat(list, charProps));
}

function portionMarkerFormat(list: JsonNode, charProps?: CharStyleProps): MarkerFormat | null {
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
  doc.descendants((node, pos, parent) => {
    if (node.type.name !== 'listItem') return;
    const own = parent?.attrs.markerFormat as Partial<MarkerFormat> | null | undefined;
    const format = withOwnMarker(own, itemMarkerFormat(node, charProps));
    // A level sized or set in a font apart from its text counts in the item's first line,
    // as both word processors set it; editor.css puts that marker in the line, not floated.
    const cls = [own?.fontSize && 'marker-sized', own?.fontFamily && 'marker-font'].filter(Boolean).join(' ');
    decos.push(Decoration.node(pos, pos + node.nodeSize, { style: markerStyle(format), ...(cls ? { class: cls } : {}) }));
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
          // How far the label hangs left of the text (cm; w:hanging, ODF's negated
          // fo:text-indent); negative is a first-line indent. null = LIST_HANGING_CM.
          hanging: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const v = parseFloat(el.getAttribute('data-hanging') ?? '');
              return Number.isFinite(v) ? v : null;
            },
            renderHTML: (attrs: Record<string, unknown>) =>
              typeof attrs.hanging === 'number' ? { 'data-hanging': String(attrs.hanging), style: `--list-hang: ${attrs.hanging}cm` } : {},
          },
          // The level's own label formatting, over the first portion's (withOwnMarker).
          markerFormat: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              try { return JSON.parse(el.getAttribute('data-marker-format') ?? 'null'); } catch { return null; }
            },
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.markerFormat ? { 'data-marker-format': JSON.stringify(attrs.markerFormat) } : {},
          },
          // What follows the label: a space or nothing (w:suff, ODF's label-followed-by)
          // instead of the tab to the text. null = the tab.
          markerSuffix: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const v = el.getAttribute('data-marker-suffix');
              return v === 'space' || v === 'nothing' ? v : null;
            },
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.markerSuffix ? { 'data-marker-suffix': String(attrs.markerSuffix) } : {},
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
