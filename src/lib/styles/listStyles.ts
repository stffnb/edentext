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

const levels = (n: number, make: (i: number) => ListLevelStyle): ListLevelStyle[] =>
  Array.from({ length: n }, (_, i) => make(i));

// LibreOffice's own list styles (probed from a 25.2 save; margins are its round metric
// values — List 1/2 step 0.4/0.3cm, the numberings 1.33cm then 0.7cm per level, IVX
// 1.33cm throughout with a right-set label). indentCm = the step minus the 1.27 base.
const LIST_BUILTINS: ListStyle[] = [
  { name: 'List 1', builtin: true,
    levels: levels(MAX_LIST_LEVELS, () => ({ kind: 'bullet', bulletChar: '•', indentCm: -0.87 })) },
  { name: 'List 2', builtin: true,
    levels: levels(MAX_LIST_LEVELS, () => ({ kind: 'bullet', bulletChar: '–', indentCm: -0.97 })) },
  { name: 'Numbering 123', builtin: true,
    levels: levels(MAX_LIST_LEVELS, (i) => ({ kind: 'number', numType: 'decimal', indentCm: i === 0 ? 0.06 : -0.57 })) },
  { name: 'Numbering ABC', builtin: true,
    levels: levels(MAX_LIST_LEVELS, (i) => ({ kind: 'number', numType: 'upper-alpha', indentCm: i === 0 ? 0.06 : -0.57 })) },
  { name: 'Numbering IVX', builtin: true,
    levels: levels(MAX_LIST_LEVELS, () => ({ kind: 'number', numType: 'upper-roman', markerAlign: 'right', indentCm: 0.06 })) },
];
