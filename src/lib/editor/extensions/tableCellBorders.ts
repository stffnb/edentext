import { Extension } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { selectedRect, isInTable } from '@tiptap/pm/tables';

// Word/LibreOffice table borders: per-side attrs (`borderTop/Right/Bottom/Left`) on
// table cells. `null` = the table default (0.5pt solid black), `'none'` = no border,
// else the canonical `'<W>pt solid #RRGGBB'`. Round-trips to ODF fo:border-* and DOCX
// w:tcBorders (export/odt.ts exportTable, import/odt.ts convertTable, export/import
// docx.ts). setTableBorders applies a Word-style preset to the selected cell region,
// writing BOTH sides of every affected boundary (incl. the facing side of neighbour
// cells outside the region) so collapsed borders never disagree between two cells.

export const DEFAULT_BORDER_WIDTH_PT = 0.5;
export const DEFAULT_BORDER_COLOR = '#000000';

export type BorderPreset =
  | 'all' | 'outer' | 'inner' | 'innerH' | 'innerV'
  | 'top' | 'bottom' | 'left' | 'right';
// null = no border ('none').
export type BorderSpec = { widthPt: number; color: string } | null;

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
  if (w === DEFAULT_BORDER_WIDTH_PT && color === DEFAULT_BORDER_COLOR) return null;
  return `${w}pt solid ${color}`;
}

// null = table default, 'none' = no border, else width/color of a custom border.
export function parseBorderAttr(
  value: string | null | undefined,
): { widthPt: number; color: string } | 'none' | null {
  if (value == null) return null;
  if (value === 'none') return 'none';
  const m = /^([\d.]+)pt solid (#[0-9A-Fa-f]{6})$/.exec(value);
  if (!m) return null;
  return { widthPt: parseFloat(m[1]), color: m[2].toUpperCase() };
}

// CSS value for a side. The default 0.5pt renders as 1px (editor.css); custom widths
// scale the same way (pt → px, min 1px so thin lines stay crisp).
export function cssBorder(value: string): string | null {
  const b = parseBorderAttr(value);
  if (b === null) return null;
  if (b === 'none') return 'none';
  const px = Math.max(1, Math.round((b.widthPt * 96) / 72));
  return `${px}px solid ${b.color}`;
}

const SIDE_META: Record<BorderSide, { data: string; css: string }> = {
  borderTop: { data: 'data-border-top', css: 'border-top' },
  borderRight: { data: 'data-border-right', css: 'border-right' },
  borderBottom: { data: 'data-border-bottom', css: 'border-bottom' },
  borderLeft: { data: 'data-border-left', css: 'border-left' },
};

// Walks every boundary a preset targets in the selected rect, reporting the two
// facing (cellPos, side) pairs of each; a pos is null at the table edge. Boundaries
// running inside a merged cell are skipped. Shared by the setTableBorders command
// and the active-preset reader below.
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
type EffectiveBorder = { widthPt: number; color: string } | 'none';

// Word-like active states for the picker: a preset is active when every boundary it
// targets renders exactly the pen border (width + color) — so with the default thin
// pen a fresh table lights up every preset; picking a thicker pen turns them off.
// 'none' is active when the whole region renders borderless. null outside a table.
export function activeBorderPresets(
  state: EditorState,
  spec: Exclude<BorderSpec, null>,
): Record<BorderPreset | 'none', boolean> | null {
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);

  const sideEff = (pos: number | null, side: BorderSide): EffectiveBorder | null => {
    if (pos == null) return null;
    const b = parseBorderAttr(state.doc.nodeAt(rect.tableStart + pos)?.attrs[side] as string | null);
    return b ?? { widthPt: DEFAULT_BORDER_WIDTH_PT, color: DEFAULT_BORDER_COLOR };
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
    v !== 'none' && Math.abs(v.widthPt - spec.widthPt) < 0.01 && v.color === spec.color.toUpperCase();

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
                return { [SIDE_META[side].data]: v, style: `${SIDE_META[side].css}: ${css}` };
              },
            },
          ]),
        ),
      },
    ];
  },

  addCommands() {
    return {
      setTableBorders: (preset: BorderPreset, spec: BorderSpec) => setTableBorders(preset, spec),
    };
  },
});
