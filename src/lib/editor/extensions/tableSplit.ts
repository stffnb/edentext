import { Extension } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TableMap, selectedRect, isInTable } from '@tiptap/pm/tables';
import { columnWeightsFromRow } from './tableView';

// "Split Cells…": divide the current cell (or a clean rectangular cell selection) into
// `cols` × `rows` sub-cells; prosemirror-tables only ships splitCell (un-merge). Reads
// the grid via TableMap, inserts grid lines (crossing cells bridge), rebuilds the table.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableSplit: {
      splitCellInto: (cols: number, rows: number) => ReturnType;
    };
  }
}

const MAX_SPLIT = 50;

function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_SPLIT, Math.round(n)));
}

// Contiguous group sizes splitting `total` into `parts` (first `rem` are one larger),
// returned as prefix offsets of length parts+1.
function groupOffsets(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const rem = total % parts;
  const offsets = [0];
  for (let i = 0; i < parts; i++) offsets.push(offsets[i] + base + (i < rem ? 1 : 0));
  return offsets;
}

// Resolve the first row's proportional weights (nulls → average present, all-null → 1).
function resolveColWeights(table: PMNode, width: number): number[] {
  const raw = columnWeightsFromRow(table.firstChild);
  const present = raw.filter((w): w is number => w != null && w > 0);
  const avg = present.length ? present.reduce((a, b) => a + b, 0) / present.length : 1;
  const out: number[] = [];
  for (let c = 0; c < width; c++) {
    const w = raw[c];
    out.push(w != null && w > 0 ? w : avg);
  }
  return out;
}

export function splitCellInto(colsArg: number, rowsArg: number) {
  return ({ state, tr, dispatch }: CommandProps): boolean => {
    if (!isInTable(state)) return false;
    const cols = clampCount(colsArg);
    const rows = clampCount(rowsArg);

    const rect = selectedRect(state);
    const { map, table, tableStart } = rect;
    const W = map.width;
    const H = map.height;

    // ── Build the owner grid: owner[r][c] = index into `cells` (distinct cells). ──
    const cells: { node: PMNode }[] = [];
    const posToIdx = new Map<number, number>();
    const owner: number[][] = [];
    for (let r = 0; r < H; r++) {
      const rowArr: number[] = [];
      for (let c = 0; c < W; c++) {
        const pos = map.map[r * W + c];
        let idx = posToIdx.get(pos);
        if (idx === undefined) {
          idx = cells.length;
          posToIdx.set(pos, idx);
          cells.push({ node: table.nodeAt(pos)! });
        }
        rowArr.push(idx);
      }
      owner.push(rowArr);
    }

    // Selection region (single cell for a cursor; bounding box for a CellSelection).
    const rTop = rect.top, rLeft = rect.left, rBottom = rect.bottom, rRight = rect.right;

    // Refuse a region whose border cuts a spanning cell (mergeCells does the same):
    // every distinct cell touching the region must be fully contained in it.
    const cellBounds = new Map<number, { top: number; left: number; bottom: number; right: number }>();
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const idx = owner[r][c];
        const b = cellBounds.get(idx);
        if (!b) cellBounds.set(idx, { top: r, left: c, bottom: r + 1, right: c + 1 });
        else { b.bottom = Math.max(b.bottom, r + 1); b.right = Math.max(b.right, c + 1); }
      }
    }
    for (let r = rTop; r < rBottom; r++) {
      for (let c = rLeft; c < rRight; c++) {
        const b = cellBounds.get(owner[r][c])!;
        if (b.top < rTop || b.left < rLeft || b.bottom > rBottom || b.right > rRight) return false;
      }
    }

    if (!dispatch) return true;

    // Content for the first sub-cell: all cells in the region, in row-major origin
    // order (a single cell normally; a multi-cell selection concatenates — merge).
    const targetNode = cells[owner[rTop][rLeft]].node;
    const combined: PMNode[] = [];
    const seen = new Set<number>();
    for (let r = rTop; r < rBottom; r++) {
      for (let c = rLeft; c < rRight; c++) {
        const idx = owner[r][c];
        if (seen.has(idx)) continue;
        seen.add(idx);
        cells[idx].node.content.forEach((n) => combined.push(n));
      }
    }

    // ── Expand the grid so the region is regionCols × regionRows. ──
    const regionCols = Math.max(cols, rRight - rLeft);
    const regionRows = Math.max(rows, rBottom - rTop);
    const addCols = regionCols - (rRight - rLeft);
    const addRows = regionRows - (rBottom - rTop);

    const colWeights = resolveColWeights(table, W);
    const rowSource = Array.from({ length: H }, (_, r) => r); // expanded row → original row

    // Duplicate the region's right-edge column: cells crossing it grow (bridge).
    if (addCols > 0) {
      for (let r = 0; r < H; r++) {
        const fill = Array(addCols).fill(owner[r][rRight - 1]);
        owner[r].splice(rRight, 0, ...fill);
      }
      colWeights.splice(rRight, 0, ...Array(addCols).fill(colWeights[rRight - 1]));
    }
    const W2 = W + addCols;

    // Duplicate the region's bottom-edge row: cells crossing it grow (bridge).
    if (addRows > 0) {
      const tmpl = owner[rBottom - 1];
      for (let k = 0; k < addRows; k++) {
        owner.splice(rBottom, 0, tmpl.slice());
        rowSource.splice(rBottom, 0, rowSource[rBottom - 1]);
      }
    }
    const H2 = H + addRows;

    // ── Overwrite the region with cols×rows new sub-cells. ──
    const colOff = groupOffsets(regionCols, cols);
    const rowOff = groupOffsets(regionRows, rows);
    let first = true;
    const subContent = new Map<number, PMNode[] | null>(); // idx → content (null = empty)
    for (let gj = 0; gj < rows; gj++) {
      for (let gi = 0; gi < cols; gi++) {
        const idx = cells.length;
        cells.push({ node: targetNode }); // node only used for type/attrs of the cell
        subContent.set(idx, first ? combined : null);
        first = false;
        const cStart = rLeft + colOff[gi], cEnd = rLeft + colOff[gi + 1];
        const rStart = rTop + rowOff[gj], rEnd = rTop + rowOff[gj + 1];
        for (let r = rStart; r < rEnd; r++)
          for (let c = cStart; c < cEnd; c++) owner[r][c] = idx;
      }
    }

    // Redistribute the region columns so each column-group sums to regionTotal/cols
    // (equal sub-cells, table width preserved).
    let regionTotal = 0;
    for (let c = rLeft; c < rLeft + regionCols; c++) regionTotal += colWeights[c];
    const perGroup = regionTotal / cols;
    for (let gi = 0; gi < cols; gi++) {
      const sz = colOff[gi + 1] - colOff[gi];
      for (let c = rLeft + colOff[gi]; c < rLeft + colOff[gi + 1]; c++) colWeights[c] = perGroup / sz;
    }
    // Normalize to integer basis points (ratios only; matches the colwidth contract).
    const wTotal = colWeights.reduce((a, b) => a + b, 0) || 1;
    const intWeights = colWeights.map((w) => Math.max(1, Math.round((w / wTotal) * 10000)));

    // ── Serialize the grid back into a table node. ──
    const schema = state.schema;
    const rowType = table.child(0).type;
    const newRows: PMNode[] = [];
    for (let r = 0; r < H2; r++) {
      const cellNodes: PMNode[] = [];
      for (let c = 0; c < W2; c++) {
        const idx = owner[r][c];
        const isOrigin = (r === 0 || owner[r - 1][c] !== idx) && (c === 0 || owner[r][c - 1] !== idx);
        if (!isOrigin) continue;
        let colspan = 1;
        while (c + colspan < W2 && owner[r][c + colspan] === idx) colspan++;
        let rowspan = 1;
        while (r + rowspan < H2 && owner[r + rowspan][c] === idx) rowspan++;
        const colwidth = intWeights.slice(c, c + colspan);
        const src = cells[idx].node;
        const attrs = { ...src.attrs, colspan, rowspan, colwidth };
        if (subContent.has(idx)) {
          const content = subContent.get(idx);
          cellNodes.push(content && content.length ? src.type.create(attrs, content) : src.type.createAndFill(attrs)!);
        } else {
          cellNodes.push(src.type.create(attrs, src.content));
        }
      }
      newRows.push(rowType.create(table.child(rowSource[r]).attrs, cellNodes));
    }
    const newTable = table.type.create(table.attrs, newRows);

    const tablePos = tableStart - 1;
    const tableEnd = tablePos + table.nodeSize;
    tr.replaceWith(tablePos, tableEnd, newTable);

    // Caret into the first sub-cell.
    const newMap = TableMap.get(newTable);
    const cellPos = tablePos + 1 + newMap.positionAt(rTop, rLeft, newTable);
    tr.setSelection(TextSelection.near(tr.doc.resolve(cellPos + 1)));
    dispatch(tr);
    return true;
  };
}

export const TableSplit = Extension.create({
  name: 'tableSplit',

  addCommands() {
    return {
      splitCellInto: (cols: number, rows: number) => splitCellInto(cols, rows),
    };
  },
});
