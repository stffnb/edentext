// Named list styles, the fourth family — LibreOffice's Listenformatvorlagen / Word's
// numbering styles. A style defines up to MAX_LIST_LEVELS levels; a list node's own
// attrs (bulletChar, listStyleType, indent, markerAlign) still override its level.

import { defaultBulletChar } from '../utils/bulletListTypes';
import type { OrderedListType } from '../utils/orderedListTypes';

// One level. `indentCm` is this level's extra step past the level above (signed),
// the same relative model the node attr uses; absolute margins are derived.
export type ListLevelStyle = {
  kind: 'bullet' | 'number';
  bulletChar?: string;
  numType?: Exclude<OrderedListType, 'multilevel'>;
  indentCm?: number;
  markerAlign?: 'right';
  startAt?: number;
};

export type ListStyle = {
  name: string;
  builtin?: boolean;
  // Every number level shows the parent chain (ODF text:display-levels, DOCX "%1.%2.").
  multilevel?: boolean;
  levels: ListLevelStyle[]; // levels[0] = depth 1
};

export const MAX_LIST_LEVELS = 10; // ODF's ceiling; the DOCX writer emits the first 9

// A depth past the defined levels falls back to the depth-cycle default, like the
// exporters' modulo geometry; depth is 1-based.
export function listLevelOf(style: ListStyle | null | undefined, depth: number): ListLevelStyle | null {
  return style?.levels[depth - 1] ?? null;
}

// What a list node at `depth` renders under `style` after its own attrs: node attr ??
// style level ?? null (= the depth-cycle default the walk resolves). Single source of
// truth for the decoration walk, both exporters and both importers' suppression.
export type EffectiveListLevel = {
  // What this depth renders. The node's own marker attr keeps its species; otherwise a
  // defined style level decides — in ODF the list style alone says what a depth shows,
  // whichever element the editor holds. Past the levels, the species' own cycle.
  kind: 'bullet' | 'number';
  bulletChar: string | null; // set only for kind 'bullet'; null = the depth-cycle char
  listStyleType: OrderedListType | null; // set only for kind 'number'; null = cycle
  indent: number;
  markerAlign: 'right' | null;
  startAt: number | null;
};

export function effectiveListLevel(
  attrs: Record<string, unknown> | null | undefined,
  ordered: boolean,
  style: ListStyle | null | undefined,
  depth: number,
): EffectiveListLevel {
  const level = listLevelOf(style, depth);
  const a = attrs ?? {};
  const own = (ordered ? a.listStyleType : a.bulletChar) as string | null | undefined;
  const kind: 'bullet' | 'number' = own || !level ? (ordered ? 'number' : 'bullet') : level.kind;
  const styled = !own && level != null; // the style level governs this depth
  let bulletChar: string | null = null;
  let listStyleType: OrderedListType | null = null;
  if (kind === 'bullet') {
    bulletChar = own ? (own as string) : styled ? level?.bulletChar ?? '•' : null;
  } else if (own) {
    listStyleType = own as OrderedListType;
  } else if (style?.multilevel) {
    listStyleType = 'multilevel';
  } else if (styled) {
    listStyleType = level?.numType ?? 'decimal';
  }
  return {
    kind,
    bulletChar,
    listStyleType,
    indent: typeof a.indent === 'number' ? a.indent : (level?.indentCm ?? 0),
    markerAlign: (a.markerAlign as 'right' | null) ?? (level?.markerAlign ?? null),
    startAt: kind === 'number' && styled ? level?.startAt ?? null : null,
  };
}

// Absolute left margin of a level (1-based): one 1.27cm step per level plus each
// level's own extra, the sum both file formats store.
export const LIST_LEVEL_STEP_CM = 1.27;

export function listStyleMarginCm(style: ListStyle, depth: number): number {
  let cm = 0;
  for (let d = 1; d <= depth; d++) cm += LIST_LEVEL_STEP_CM + (listLevelOf(style, d)?.indentCm ?? 0);
  return cm;
}

type JsonNode = { type?: string; attrs?: Record<string, unknown> | null; content?: JsonNode[] };

// Whether any list node in the subtree carries direct formatting over the style —
// then the export keeps the fully resolved automatic style and drops the name (ODF
// list styles have no parent chain to hang an override on). `start` is content, not
// formatting: a split list's continuation must not count.
export function listStyleOverridden(list: JsonNode): boolean {
  if (list.type === 'bulletList' || list.type === 'orderedList') {
    const a = list.attrs ?? {};
    if (a.bulletChar || a.listStyleType || a.markerAlign || (typeof a.indent === 'number' && a.indent !== 0)) return true;
  }
  return (list.content ?? []).some(listStyleOverridden);
}

// The default marker a style level would need to differ from before it must be written
// out — mirrors bulletCharAttr/orderedTypeAttr for the per-depth cycles.
export function defaultLevelBullet(depth: number): string {
  return defaultBulletChar(depth - 1);
}

export function builtinListStyles(): Record<string, ListStyle> {
  const out: Record<string, ListStyle> = {};
  for (const s of LIST_BUILTINS) out[s.name] = structuredClone(s);
  return out;
}

const num = (numType: Exclude<OrderedListType, 'multilevel'>, markerAlign?: 'right'): ListLevelStyle =>
  markerAlign ? { kind: 'number', numType, markerAlign } : { kind: 'number', numType };
const bul = (bulletChar: string): ListLevelStyle => ({ kind: 'bullet', bulletChar });

// `head` levels first, then `tail` repeated until MAX_LIST_LEVELS are filled.
const ladder = (head: ListLevelStyle[], tail: ListLevelStyle[]): ListLevelStyle[] =>
  Array.from({ length: MAX_LIST_LEVELS }, (_, i) =>
    structuredClone(i < head.length ? head[i] : tail[(i - head.length) % tail.length]));

// The gallery: outline chains, kind mixes and a bullet ladder the depth cycle can't
// produce — plus that cycle itself as Numbering 1.a.i, the way back after a switch.
// All keep the plain 1.27cm step per level (no indentCm), like an unstyled list.
const LIST_BUILTINS: ListStyle[] = [
  { name: 'Outline I.A.1', builtin: true,
    levels: ladder([num('upper-roman', 'right'), num('upper-alpha')],
      [num('decimal'), num('lower-alpha-paren'), num('lower-roman-paren')]) },
  { name: 'Outline A.I.1', builtin: true,
    levels: ladder([num('upper-alpha'), num('upper-roman', 'right')],
      [num('decimal'), num('lower-alpha-paren'), num('lower-roman-paren')]) },
  { name: 'Numbering 1.a.i', builtin: true,
    levels: ladder([], [num('decimal'), num('lower-alpha'), num('lower-roman')]) },
  { name: 'Numbering with Bullets', builtin: true,
    levels: ladder([num('decimal')], [bul('–'), bul('◦'), bul('▪')]) },
  { name: 'Diamond Bullets', builtin: true,
    levels: ladder([], [bul('❖'), bul('➢'), bul('▪')]) },
  { name: 'Checklist', builtin: true,
    levels: ladder([bul('✓')], [bul('–'), bul('◦')]) },
];
