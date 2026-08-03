import { Extension } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { selectedRect, isInTable } from '@tiptap/pm/tables';

// Word/LibreOffice "header row"/"header column" as a styling preset: the first row (or
// column) gets bold text + a light grey fill, both of which round-trip to ODF/DOCX. The
// fill doubles as the marker, so no <table:table-header-rows> and no page repetition.

export const HEADER_SHADE = '#F2F2F2';

export type HeaderAxis = 'row' | 'column';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableHeaderRow: {
      toggleHeaderRowStyle: () => ReturnType;
      toggleHeaderColumnStyle: () => ReturnType;
    };
  }
}

// Distinct cell positions (relative to tableStart) of the table's first row / first column.
function headerCellPositions(
  state: EditorState,
  axis: HeaderAxis,
): { positions: number[]; tableStart: number; corner: number } | null {
  if (!isInTable(state)) return null;
  const { map, tableStart } = selectedRect(state);
  const seen = new Set<number>();
  const positions: number[] = [];
  const n = axis === 'row' ? map.width : map.height;
  for (let i = 0; i < n; i++) {
    const pos = map.map[axis === 'row' ? i : i * map.width];
    if (!seen.has(pos)) { seen.add(pos); positions.push(pos); }
  }
  return { positions, tableStart, corner: map.map[0] };
}

// True when the cursor sits in a header-shaded cell (so the Bold button should drive the
// fontWeight override, like a heading, instead of the bold mark — see Toolbar.svelte).
export function isInHeaderCell(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const role = $from.node(d).type.spec.tableRole;
    if (role === 'cell' || role === 'header_cell') {
      return $from.node(d).attrs.backgroundColor === HEADER_SHADE;
    }
  }
  return false;
}

// True when every cell of the first row / first column carries the header fill.
export function isHeaderStyled(state: EditorState, axis: HeaderAxis): boolean {
  const info = headerCellPositions(state, axis);
  if (!info || info.positions.length === 0) return false;
  return info.positions.every(
    (p) => state.doc.nodeAt(info.tableStart + p)?.attrs.backgroundColor === HEADER_SHADE,
  );
}

export function toggleHeaderStyle(axis: HeaderAxis) {
  return ({ state, tr, dispatch }: CommandProps): boolean => {
    const info = headerCellPositions(state, axis);
    if (!info) return false;
    if (!dispatch) return true;

    const isHeader = isHeaderStyled(state, axis);
    // The corner cell belongs to both headers, so turning one off must leave it alone
    // while the other is still on.
    const keepCorner = isHeader && isHeaderStyled(state, axis === 'row' ? 'column' : 'row');
    const bold = state.schema.marks.bold;
    // The fill is the header marker; bold is presentational (CSS on `.cell-header`, keyed
    // off this fill) so it covers existing, typed, and pasted text alike. setNodeMarkup/
    // removeMark don't shift positions, so the original cell positions stay valid.
    for (const p of info.positions) {
      if (keepCorner && p === info.corner) continue;
      const cellPos = info.tableStart + p;
      const cell = tr.doc.nodeAt(cellPos);
      if (!cell) continue;
      tr.setNodeMarkup(cellPos, undefined, { ...cell.attrs, backgroundColor: isHeader ? null : HEADER_SHADE });
      // Turning off: strip any bold marks (incl. ones baked into the runs on export and
      // read back on import) so the cells truly return to normal.
      if (isHeader && bold) tr.removeMark(cellPos + 1, cellPos + cell.nodeSize - 1, bold);
    }
    dispatch(tr);
    return true;
  };
}

export const TableHeaderRow = Extension.create({
  name: 'tableHeaderRow',

  addCommands() {
    return {
      toggleHeaderRowStyle: () => toggleHeaderStyle('row'),
      toggleHeaderColumnStyle: () => toggleHeaderStyle('column'),
    };
  },
});
