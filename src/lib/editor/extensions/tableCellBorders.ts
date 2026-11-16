import { Extension } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { selectedRect, isInTable, TableMap } from '@tiptap/pm/tables';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

// Per-side border attrs (`borderTop/Right/Bottom/Left`) on table cells: `null` = the
// table default (0.5pt solid black), `'none'` = no border, else the canonical
// `'<W>pt <line> #RRGGBB'`, W the total width as in fo:border and CSS. Round-trips to
// ODF fo:border-* and DOCX w:tcBorders.

export const DEFAULT_BORDER_WIDTH_PT = 0.5;
export const DEFAULT_BORDER_COLOR = '#000000';

export type BorderPreset =
  | 'all' | 'outer' | 'inner' | 'innerH' | 'innerV'
  | 'top' | 'bottom' | 'left' | 'right';
// The line styles both formats and CSS share; LibreOffice draws its others alike.
export const BORDER_LINES = ['solid', 'double', 'dotted', 'dashed'] as const;
export type BorderLine = (typeof BORDER_LINES)[number];
// null = no border ('none'). line absent = solid.
export type BorderSpec = { widthPt: number; color: string; line?: BorderLine } | null;

// An ODF/CSS border style keyword's line: dash variants are dashed, the 3D kinds solid.
export function borderLineOf(style: string | null | undefined): BorderLine {
  return style === 'double' || style === 'dotted' ? style : style?.includes('dash') ? 'dashed' : 'solid';
}

// The canonical value of one drawn side.
export function borderValue(widthPt: number, color: string, line: BorderLine = 'solid'): string {
  return `${Math.round(widthPt * 100) / 100}pt ${line} ${color.toUpperCase()}`;
}

export const BORDER_SIDES = ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'] as const;
export type BorderSide = (typeof BORDER_SIDES)[number];

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableCellBorders: {
      setTableBorders: (preset: BorderPreset, spec: BorderSpec) => ReturnType;
    };
  }
}

// Canonical attr value for a spec; the editor default collapses to null.
export function borderAttrValue(spec: BorderSpec): string | null {
  if (!spec) return 'none';
  const w = Math.round(spec.widthPt * 100) / 100;
  const color = spec.color.toUpperCase();
  const line = spec.line ?? 'solid';
  if (w === DEFAULT_BORDER_WIDTH_PT && color === DEFAULT_BORDER_COLOR && line === 'solid') return null;
  return borderValue(w, color, line);
}

// null = table default, 'none' = no border, else width/color/line of a custom border.
export function parseBorderAttr(
  value: string | null | undefined,
): { widthPt: number; color: string; line: BorderLine } | 'none' | null {
  if (value == null) return null;
  if (value === 'none') return 'none';
  const m = /^([\d.]+)pt (solid|double|dotted|dashed) (#[0-9A-Fa-f]{6})$/.exec(value);
  if (!m) return null;
  return { widthPt: parseFloat(m[1]), color: m[3].toUpperCase(), line: m[2] as BorderLine };
}

// Whole pixels a side paints: at least 1, and 3 for a double line, which a browser
// draws as one solid stroke below that.
function paintedPx(b: { widthPt: number; line: BorderLine }): number {
  return Math.max(b.line === 'double' ? 3 : 1, Math.round((b.widthPt * 96) / 72));
}

// CSS value for a side. The default 0.5pt renders as 1px (editor.css); custom widths
// scale the same way (pt → px, min 1px so thin lines stay crisp).
export function cssBorder(value: string): string | null {
  const b = parseBorderAttr(value);
  if (b === null) return null;
  if (b === 'none') return 'none';
  return `${paintedPx(b)}px ${b.line} ${b.color}`;
}

// What the painted border costs the row beyond the width the file declares: Chromium
// floors every border to a whole pixel, LibreOffice reserves the declared width (a
// 0.05pt hairline is next to nothing). editor.css takes it off the cell's padding.
export function borderOvershootPx(value: string): number {
  const b = parseBorderAttr(value);
  if (b === null || b === 'none') return 0;
  const declared = (b.widthPt * 96) / 72;
  return Math.round((paintedPx(b) - declared) * 1000) / 1000;
}

// A row edge as LibreOffice spaces it, in either format: every cell of a row sits below the
// widest line along its top edge and above the widest along its bottom (probed: one cell's
// 3pt top lowers its neighbours' text 0.88mm). A collapsed CSS cell takes half its own line.
const paintedOf = (v: string | null | undefined) => {
  const b = parseBorderAttr(v);
  return b === 'none' ? 0 : b ? paintedPx(b) : 1;
};
const overOf = (v: string | null | undefined) => (v == null ? 1 - 2 / 3 : borderOvershootPx(v));
function rowEdgeDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((table, pos) => {
    if (table.type.spec.tableRole !== 'table') return true;
    const map = TableMap.get(table);
    const cellAt = (row: number, col: number) => (row < 0 || row >= map.height ? null : map.map[row * map.width + col]);
    // The collapsed line per grid line and column: the wider of the two facing sides.
    const seg = (line: number, col: number): { px: number; attr: string | null } | null => {
      const above = cellAt(line - 1, col), below = cellAt(line, col);
      if (above != null && above === below) return null;
      const a = above != null ? table.nodeAt(above)?.attrs.borderBottom ?? null : undefined;
      const b = below != null ? table.nodeAt(below)?.attrs.borderTop ?? null : undefined;
      const pa = a === undefined ? -1 : paintedOf(a), pb = b === undefined ? -1 : paintedOf(b);
      return pa > pb ? { px: pa, attr: a ?? null } : { px: pb, attr: b ?? null };
    };
    const widest = Array.from({ length: map.height + 1 }, (_, line) => {
      let best: { px: number; attr: string | null } | null = null;
      for (let col = 0; col < map.width; col++) {
        const s = seg(line, col);
        if (s && (!best || s.px > best.px)) best = s;
      }
      return best;
    });
    const seen = new Set<number>();
    map.map.forEach((offset) => {
      if (seen.has(offset)) return;
      seen.add(offset);
      const cell = table.nodeAt(offset)!;
      const rect = map.findCell(offset);
      const row = table.child(rect.top);
      if (row.attrs.fixedHeight) return;
      const own = (line: number) => Math.max(0, ...Array.from({ length: rect.right - rect.left }, (_, k) => seg(line, rect.left + k)?.px ?? 0));
      const topMax = widest[rect.top], bottomMax = widest[rect.bottom];
      const t = topMax ? (topMax.px - own(rect.top)) / 2 : 0;
      const ownB = own(rect.bottom);
      const b = bottomMax && bottomMax.px > ownB ? (bottomMax.px - ownB) / 2 + overOf(cell.attrs.borderBottom) - overOf(bottomMax.attr) : 0;
      if (t <= 0 && b <= 0) return;
      const r3 = (n: number) => Math.round(Math.max(0, n) * 1000) / 1000;
      decos.push(Decoration.node(pos + 1 + offset, pos + 1 + offset + cell.nodeSize,
        { style: `--edge-pad-t: ${r3(t)}px; --edge-pad-b: ${r3(b)}px` }));
    });
    return true;
  });
  return DecorationSet.create(doc, decos);
}
const rowEdgeKey = new PluginKey<DecorationSet>('tableRowEdges');

const SIDE_META: Record<BorderSide, { data: string; css: string }> = {
  borderTop: { data: 'data-border-top', css: 'border-top' },
  borderRight: { data: 'data-border-right', css: 'border-right' },
  borderBottom: { data: 'data-border-bottom', css: 'border-bottom' },
  borderLeft: { data: 'data-border-left', css: 'border-left' },
};

// Walks every boundary a preset targets in the selected rect, reporting both facing
// (cellPos, side) pairs — writing both is what keeps collapsed borders from disagreeing.
// A pos is null at the table edge; boundaries inside a merged cell are skipped.
function forEachBoundary(
  rect: ReturnType<typeof selectedRect>,
  preset: BorderPreset,
  cb: (aPos: number | null, aSide: BorderSide, bPos: number | null, bSide: BorderSide) => void,
): void {
  const { map } = rect;
  const wants = {
    topEdge: preset === 'all' || preset === 'outer' || preset === 'top',
    bottomEdge: preset === 'all' || preset === 'outer' || preset === 'bottom',
    leftEdge: preset === 'all' || preset === 'outer' || preset === 'left',
    rightEdge: preset === 'all' || preset === 'outer' || preset === 'right',
    innerH: preset === 'all' || preset === 'inner' || preset === 'innerH',
    innerV: preset === 'all' || preset === 'inner' || preset === 'innerV',
  };

  // Horizontal boundaries: grid line y separates row y-1 (above) from row y (below).
  for (let y = rect.top; y <= rect.bottom; y++) {
    const isTop = y === rect.top;
    const isBottom = y === rect.bottom;
    if (isTop && !wants.topEdge) continue;
    if (isBottom && !wants.bottomEdge) continue;
    if (!isTop && !isBottom && !wants.innerH) continue;
    for (let x = rect.left; x < rect.right; x++) {
      const below = y < map.height ? map.map[y * map.width + x] : null;
      const above = y > 0 ? map.map[(y - 1) * map.width + x] : null;
      if (above === below) continue; // grid line runs inside a merged cell
      cb(above, 'borderBottom', below, 'borderTop');
    }
  }
  // Vertical boundaries: grid line x separates column x-1 (left) from column x (right).
  for (let x = rect.left; x <= rect.right; x++) {
    const isLeft = x === rect.left;
    const isRight = x === rect.right;
    if (isLeft && !wants.leftEdge) continue;
    if (isRight && !wants.rightEdge) continue;
    if (!isLeft && !isRight && !wants.innerV) continue;
    for (let y = rect.top; y < rect.bottom; y++) {
      const right = x < map.width ? map.map[y * map.width + x] : null;
      const left = x > 0 ? map.map[y * map.width + (x - 1)] : null;
      if (left === right) continue;
      cb(left, 'borderRight', right, 'borderLeft');
    }
  }
}

export function setTableBorders(preset: BorderPreset, spec: BorderSpec) {
  return ({ state, tr, dispatch }: CommandProps): boolean => {
    if (!isInTable(state)) return false;
    if (!dispatch) return true;

    const rect = selectedRect(state);
    const value = borderAttrValue(spec);

    // pos (relative to tableStart) → attr changes, deduped across grid slots of a span.
    const changes = new Map<number, Record<string, string | null>>();
    const set = (pos: number | null, side: BorderSide) => {
      if (pos == null) return;
      const c = changes.get(pos) ?? {};
      c[side] = value;
      changes.set(pos, c);
    };
    forEachBoundary(rect, preset, (aPos, aSide, bPos, bSide) => {
      set(aPos, aSide);
      set(bPos, bSide);
    });

    // setNodeMarkup doesn't shift positions, so all cell positions stay valid.
    for (const [pos, attrs] of changes) {
      const cell = tr.doc.nodeAt(rect.tableStart + pos);
      if (!cell) continue;
      tr.setNodeMarkup(rect.tableStart + pos, undefined, { ...cell.attrs, ...attrs });
    }
    dispatch(tr);
    return true;
  };
}

export const BORDER_PRESETS: BorderPreset[] = [
  'all', 'outer', 'inner', 'innerH', 'innerV', 'top', 'bottom', 'left', 'right',
];

// What a boundary renders: the collapse winner of its two facing cell sides
// (a border beats 'none', wider beats narrower; attr null = the table default).
type EffectiveBorder = { widthPt: number; color: string; line: BorderLine } | 'none';

// Active states for the picker: a preset is active when every boundary it targets renders
// exactly the pen border (width + color), so the default thin pen lights up a fresh table
// and a thicker pen turns it off. 'none' = borderless region; null outside a table.
export function activeBorderPresets(
  state: EditorState,
  spec: Exclude<BorderSpec, null>,
): Record<BorderPreset | 'none', boolean> | null {
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);

  const sideEff = (pos: number | null, side: BorderSide): EffectiveBorder | null => {
    if (pos == null) return null;
    const b = parseBorderAttr(state.doc.nodeAt(rect.tableStart + pos)?.attrs[side] as string | null);
    return b ?? { widthPt: DEFAULT_BORDER_WIDTH_PT, color: DEFAULT_BORDER_COLOR, line: 'solid' };
  };
  const boundaryEff = (aPos: number | null, aSide: BorderSide, bPos: number | null, bSide: BorderSide): EffectiveBorder => {
    let best: EffectiveBorder = 'none';
    for (const v of [sideEff(aPos, aSide), sideEff(bPos, bSide)]) {
      if (v == null || v === 'none') continue;
      if (best === 'none' || v.widthPt > best.widthPt) best = v;
    }
    return best;
  };
  const matchesPen = (v: EffectiveBorder) =>
    v !== 'none' && Math.abs(v.widthPt - spec.widthPt) < 0.01 && v.color === spec.color.toUpperCase()
    && v.line === (spec.line ?? 'solid');

  const out = {} as Record<BorderPreset | 'none', boolean>;
  for (const preset of BORDER_PRESETS) {
    let n = 0;
    let active = true;
    forEachBoundary(rect, preset, (aPos, aSide, bPos, bSide) => {
      n++;
      if (!matchesPen(boundaryEff(aPos, aSide, bPos, bSide))) active = false;
    });
    out[preset] = n > 0 && active;
  }
  let n = 0;
  let allNone = true;
  forEachBoundary(rect, 'all', (aPos, aSide, bPos, bSide) => {
    n++;
    if (boundaryEff(aPos, aSide, bPos, bSide) !== 'none') allNone = false;
  });
  out.none = n > 0 && allNone;
  return out;
}

export const TableCellBorders = Extension.create({
  name: 'tableCellBorders',

  addGlobalAttributes() {
    return [
      {
        types: ['tableCell', 'tableHeader'],
        attributes: Object.fromEntries(
          BORDER_SIDES.map((side) => [
            side,
            {
              default: null,
              parseHTML: (element: HTMLElement) => element.getAttribute(SIDE_META[side].data),
              renderHTML: (attributes: Record<string, unknown>) => {
                const v = attributes[side] as string | null;
                if (!v) return {};
                const css = cssBorder(v);
                if (!css) return {};
                // Only the bottom one: with border-collapse a boundary draws a single
                // line, so compensating both sides of it would take the excess twice.
                // Always set, since the CSS fallback is the default line's excess.
                const style = `${SIDE_META[side].css}: ${css}` +
                  (side === 'borderBottom' ? `; --border-over: ${borderOvershootPx(v)}px` : '');
                return { [SIDE_META[side].data]: v, style };
              },
            },
          ]),
        ),
      },
    ];
  },

  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: rowEdgeKey,
      state: {
        init: (_c, state) => rowEdgeDecorations(state.doc),
        apply: (tr, old) => (tr.docChanged ? rowEdgeDecorations(tr.doc) : old),
      },
      props: { decorations: (state) => rowEdgeKey.getState(state) },
    })];
  },

  addCommands() {
    return {
      setTableBorders: (preset: BorderPreset, spec: BorderSpec) => setTableBorders(preset, spec),
    };
  },
});
