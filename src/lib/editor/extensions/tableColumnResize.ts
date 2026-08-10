import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { TableMap, cellAround, pointsAtCell } from '@tiptap/pm/tables';
import { columnWeightsFromRow, columnPercents } from './tableView';
import { PX_PER_CM } from '../../storage/pageMargins';

// Column resizing: an inner border trades width between its two columns
// (table width fixed); an outer edge moves the table's `marginLeft`/`marginRight` (cm)
// and the adjacent column. Live drag pokes the DOM; release writes the attrs.

const HANDLE_WIDTH = 5; // px from a column border that activates the handle
const CELL_MIN_PX = 30; // smallest a column may be dragged to
// Resolution of the stored integer weights (percent × this). Only ratios matter.
const WEIGHT_SCALE = 100;

// Which border of the active cell is hovered: a column border, or the table's own
// left/right edge (the first/last column's outer side).
type EdgeSide = 'inner' | 'left' | 'right';

interface ResizeState {
  activeHandle: number; // doc pos of the cell owning the active border, or -1
  edge: EdgeSide;
  dragging: boolean;
}

type ResizeAction =
  | { setHandle: number; edge: EdgeSide }
  | { setDragging: boolean };

const round3 = (v: number) => Math.round(v * 1000) / 1000;

// A CSS margin (our own output is cm, pasted HTML may be px) as cm; 0 when absent.
function marginCm(value: string): number {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return value.trim().endsWith('px') ? round3(n / PX_PER_CM) : round3(n);
}

// Inline style for the static HTML paths: the wrapper-less <table> carries the margins
// itself, so its width must shrink by them (editor.css has it at width:100%).
function tableMarginStyle(attrs: Record<string, unknown>): Record<string, string> {
  const ml = Number(attrs.marginLeft) || 0;
  const mr = Number(attrs.marginRight) || 0;
  const mt = Number(attrs.marginTop) || 0;
  const mb = Number(attrs.marginBottom) || 0;
  const decls: string[] = [];
  if (ml || mr) decls.push(`margin-left: ${ml}cm`, `margin-right: ${mr}cm`, `width: calc(100% - ${round3(ml + mr)}cm)`);
  if (mt) decls.push(`margin-top: ${mt}cm`);
  if (mb) decls.push(`margin-bottom: ${mb}cm`);
  return decls.length ? { style: decls.join('; ') } : {};
}

export const tableColumnResizeKey = new PluginKey<ResizeState>('tableColumnResize');

// ─── DOM / geometry helpers (mirrors prosemirror-tables) ───────────────────

export function domCellAround(target: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = target;
  while (el && el.nodeName !== 'TD' && el.nodeName !== 'TH') {
    el = el.classList && el.classList.contains('ProseMirror') ? null : (el.parentNode as HTMLElement | null);
  }
  return el;
}

// Resolve the border near the pointer: the cell that owns it plus which border it is.
// For "right" that's the cell left of the border, for "left" the cell right of it —
// unless the border is the table's own outer edge (first/last column). cell -1 = none.
function borderAt(view: EditorView, event: MouseEvent, side: 'left' | 'right'): { cell: number; edge: EdgeSide } {
  const none = { cell: -1, edge: 'inner' as EdgeSide };
  const offset = side === 'right' ? -HANDLE_WIDTH : HANDLE_WIDTH;
  const found = view.posAtCoords({ left: event.clientX + offset, top: event.clientY });
  if (!found) return none;
  const $cell = cellAround(view.state.doc.resolve(found.pos));
  if (!$cell) return none;
  const map = TableMap.get($cell.node(-1));
  const start = $cell.start(-1);
  if (side === 'left') {
    const index = map.map.indexOf($cell.pos - start);
    if (index < 0) return none;
    return index % map.width === 0
      ? { cell: $cell.pos, edge: 'left' }
      : { cell: start + map.map[index - 1], edge: 'inner' };
  }
  const colspan = ($cell.nodeAfter?.attrs.colspan as number) ?? 1;
  const col = map.colCount($cell.pos - start) + colspan - 1;
  return { cell: $cell.pos, edge: col >= map.width - 1 ? 'right' : 'inner' };
}

function tableDOM(view: EditorView, tableStart: number): HTMLTableElement | null {
  let dom = view.domAtPos(tableStart).node as HTMLElement | null;
  while (dom && dom.nodeName !== 'TABLE') dom = dom.parentNode as HTMLElement | null;
  return (dom as HTMLTableElement) ?? null;
}

// ─── Event handlers ────────────────────────────────────────────────────────

function handleMouseMove(view: EditorView, event: MouseEvent): void {
  if (!view.editable) return;
  const state = tableColumnResizeKey.getState(view.state);
  if (!state || state.dragging) return;

  const target = domCellAround(event.target as HTMLElement | null);
  let cell = -1;
  let edge: EdgeSide = 'inner';
  if (target) {
    const { left, right } = target.getBoundingClientRect();
    if (event.clientX - left <= HANDLE_WIDTH) ({ cell, edge } = borderAt(view, event, 'left'));
    else if (right - event.clientX <= HANDLE_WIDTH) ({ cell, edge } = borderAt(view, event, 'right'));
  }

  if (cell !== state.activeHandle || edge !== state.edge) {
    view.dispatch(view.state.tr.setMeta(tableColumnResizeKey, { setHandle: cell, edge } as ResizeAction));
  }
}

// Outer-edge drag: only the adjacent column gives up width, so every
// other gridline stays put. All lengths in unscaled document px; the edge stops at
// the text margin (margins never go negative) and at the column's minimum width.
export function edgeResize(
  percents: number[],
  tableWidth: number,
  marginLeftPx: number,
  marginRightPx: number,
  side: 'left' | 'right',
  dx: number,
): { marginLeftPx: number; marginRightPx: number; percents: number[] } {
  const abs = percents.map(p => (p / 100) * tableWidth);
  const i = side === 'left' ? 0 : abs.length - 1;
  const delta = side === 'left'
    ? Math.max(-marginLeftPx, Math.min(abs[i] - CELL_MIN_PX, dx))
    : Math.max(CELL_MIN_PX - abs[i], Math.min(marginRightPx, dx));
  abs[i] += side === 'left' ? -delta : delta;
  const total = abs.reduce((a, b) => a + b, 0);
  return {
    marginLeftPx: side === 'left' ? marginLeftPx + delta : marginLeftPx,
    marginRightPx: side === 'right' ? marginRightPx - delta : marginRightPx,
    percents: abs.map(w => (w / total) * 100),
  };
}

// Write the final per-column weights into every cell's `colwidth` attribute, plus the
// table's own margins when an outer edge was dragged (sizes are unchanged, so both
// markups can share one transaction).
function commitColumnWidths(
  view: EditorView,
  activeHandle: number,
  finalPercents: number[],
  tableMargins?: { marginLeft: number; marginRight: number },
): void {
  const $cell = view.state.doc.resolve(activeHandle);
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const start = $cell.start(-1);
  const weights = finalPercents.map((p) => Math.max(1, Math.round(p * WEIGHT_SCALE)));

  const tr = view.state.tr;
  const seen = new Set<number>();
  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) {
      const pos = map.map[row * map.width + col];
      if (seen.has(pos)) continue;
      seen.add(pos);
      const cellNode = table.nodeAt(pos);
      if (!cellNode) continue;
      const colStart = map.colCount(pos);
      const span = (cellNode.attrs.colspan as number) ?? 1;
      const colwidth: number[] = [];
      for (let k = 0; k < span; k++) {
        colwidth.push(weights[colStart + k] ?? weights[weights.length - 1] ?? 1);
      }
      tr.setNodeMarkup(start + pos, undefined, { ...cellNode.attrs, colwidth });
    }
  }
  if (tableMargins) tr.setNodeMarkup(start - 1, undefined, { ...table.attrs, ...tableMargins });
  if (tr.docChanged) view.dispatch(tr);
}

// Drag of the table's left/right edge: moves that edge only (margin + adjacent column).
function startEdgeDrag(view: EditorView, event: MouseEvent, cellPos: number, side: 'left' | 'right'): boolean {
  const $cell = view.state.doc.resolve(cellPos);
  const table = $cell.node(-1);
  const tableStart = $cell.start(-1);
  const startPercents = columnPercents(columnWeightsFromRow(table.firstChild));
  if (startPercents.length !== TableMap.get(table).width) return false;

  const dom = tableDOM(view, tableStart);
  const wrapper = dom?.parentElement;
  const colgroup = dom?.querySelector(':scope > colgroup') as HTMLElement | null;
  if (!dom || !wrapper || !colgroup) return false;
  const tableWidth = dom.offsetWidth; // unscaled document px
  if (!tableWidth) return false;
  // offsetWidth is unscaled, getBoundingClientRect is scaled by the .paper zoom:
  // their ratio converts the mouse delta back to document px (mirrors tableRowResize).
  const zoom = dom.getBoundingClientRect().width / tableWidth || 1;

  const ml0 = (((table.attrs.marginLeft as number) || 0)) * PX_PER_CM;
  const mr0 = (((table.attrs.marginRight as number) || 0)) * PX_PER_CM;
  const startX = event.clientX;
  let last = { marginLeftPx: ml0, marginRightPx: mr0, percents: startPercents };
  let moved = false;
  const win = view.dom.ownerDocument.defaultView ?? window;

  view.dispatch(view.state.tr.setMeta(tableColumnResizeKey, { setDragging: true } as ResizeAction));

  function move(e: MouseEvent): void {
    if (!e.buttons) {
      finish();
      return;
    }
    last = edgeResize(startPercents, tableWidth, ml0, mr0, side, (e.clientX - startX) / zoom);
    wrapper!.style.marginLeft = `${last.marginLeftPx}px`;
    wrapper!.style.marginRight = `${last.marginRightPx}px`;
    const cols = colgroup!.children as HTMLCollectionOf<HTMLElement>;
    last.percents.forEach((p, i) => { if (cols[i]) cols[i].style.width = `${p}%`; });
    moved = true;
  }

  function finish(): void {
    win.removeEventListener('mouseup', finish);
    win.removeEventListener('mousemove', move);
    const st = tableColumnResizeKey.getState(view.state);
    if (st?.dragging) {
      if (moved) {
        commitColumnWidths(view, cellPos, last.percents, {
          marginLeft: round3(last.marginLeftPx / PX_PER_CM),
          marginRight: round3(last.marginRightPx / PX_PER_CM),
        });
      }
      view.dispatch(view.state.tr.setMeta(tableColumnResizeKey, { setDragging: false } as ResizeAction));
    }
  }

  win.addEventListener('mouseup', finish);
  win.addEventListener('mousemove', move);
  event.preventDefault();
  return true;
}

function handleMouseDown(view: EditorView, event: MouseEvent): boolean {
  if (!view.editable) return false;
  const state = tableColumnResizeKey.getState(view.state);
  if (!state || state.activeHandle === -1 || state.dragging) return false;
  if (state.edge !== 'inner') return startEdgeDrag(view, event, state.activeHandle, state.edge);

  const activeHandle = state.activeHandle;
  const $cell = view.state.doc.resolve(activeHandle);
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const tableStart = $cell.start(-1);
  const colspan = ($cell.nodeAfter?.attrs.colspan as number) ?? 1;
  const leftCol = map.colCount($cell.pos - tableStart) + colspan - 1;
  const rightCol = leftCol + 1;

  const startPercents = columnPercents(columnWeightsFromRow(table.firstChild));
  if (startPercents.length !== map.width) return false;

  const dom = tableDOM(view, tableStart);
  if (!dom) return false;
  // The node view keeps a stable <colgroup> element but replaces its <col>
  // children whenever it rebuilds (e.g. on the setDragging transaction below), so
  // query the children live inside move() rather than caching them here.
  const colgroup = dom.querySelector(':scope > colgroup') as HTMLElement | null;
  if (!colgroup) return false;
  const contentWidth = dom.getBoundingClientRect().width;
  if (!contentWidth) return false;

  const startX = event.clientX;
  const minPct = (CELL_MIN_PX / contentWidth) * 100;
  const pairSum = startPercents[leftCol] + startPercents[rightCol];
  let lastLeft = startPercents[leftCol];
  let lastRight = startPercents[rightCol];
  let moved = false;
  const win = view.dom.ownerDocument.defaultView ?? window;

  // Flag the drag so hover handling pauses and the column gets a dragging class.
  view.dispatch(view.state.tr.setMeta(tableColumnResizeKey, { setDragging: true } as ResizeAction));

  function move(e: MouseEvent): void {
    if (!e.buttons) {
      finish();
      return;
    }
    let newLeft = startPercents[leftCol] + ((e.clientX - startX) / contentWidth) * 100;
    newLeft = Math.max(minPct, Math.min(pairSum - minPct, newLeft));
    const newRight = pairSum - newLeft;
    const cols = colgroup!.children as HTMLCollectionOf<HTMLElement>;
    if (cols[leftCol]) cols[leftCol].style.width = `${newLeft}%`;
    if (cols[rightCol]) cols[rightCol].style.width = `${newRight}%`;
    lastLeft = newLeft;
    lastRight = newRight;
    moved = true;
  }

  function finish(): void {
    win.removeEventListener('mouseup', finish);
    win.removeEventListener('mousemove', move);
    const st = tableColumnResizeKey.getState(view.state);
    if (st?.dragging) {
      if (moved) {
        const finalPercents = startPercents.slice();
        finalPercents[leftCol] = lastLeft;
        finalPercents[rightCol] = lastRight;
        commitColumnWidths(view, activeHandle, finalPercents);
      }
      view.dispatch(view.state.tr.setMeta(tableColumnResizeKey, { setDragging: false } as ResizeAction));
    }
  }

  win.addEventListener('mouseup', finish);
  win.addEventListener('mousemove', move);
  event.preventDefault();
  return true;
}

// ─── Decorations: the visible handle at the active column border ─────────────

function handleDecorations(state: EditorState, cell: number, edge: EdgeSide): DecorationSet {
  const decorations: Decoration[] = [];
  const $cell = state.doc.resolve(cell);
  const table = $cell.node(-1);
  if (!table) return DecorationSet.empty;
  const map = TableMap.get(table);
  const start = $cell.start(-1);
  const colspan = ($cell.nodeAfter?.attrs.colspan as number) ?? 1;
  const col = edge === 'left' ? 0 : map.colCount($cell.pos - start) + colspan - 1;
  const dragging = tableColumnResizeKey.getState(state)?.dragging;

  for (let row = 0; row < map.height; row++) {
    const index = col + row * map.width;
    // Skip cells that span across this border (irrelevant at the left edge) or that
    // merge into the row above.
    const spansBorder = edge !== 'left' && col < map.width - 1 && map.map[index] === map.map[index + 1];
    const mergedUp = row > 0 && map.map[index] === map.map[index - map.width];
    if (spansBorder || mergedUp) continue;

    const cellPos = map.map[index];
    const cellNode = table.nodeAt(cellPos);
    if (!cellNode) continue;
    // Widgets sit INSIDE the cell (which is the handle's positioning context).
    const pos = edge === 'left' ? start + cellPos + 1 : start + cellPos + cellNode.nodeSize - 1;
    const dom = document.createElement('div');
    dom.className = edge === 'left' ? 'column-resize-handle left' : 'column-resize-handle';
    if (dragging) {
      decorations.push(
        Decoration.node(start + cellPos, start + cellPos + cellNode.nodeSize, {
          class: 'column-resize-dragging',
        }),
      );
    }
    decorations.push(Decoration.widget(pos, dom));
  }
  return DecorationSet.create(state.doc, decorations);
}

// ─── Plugin / extension ──────────────────────────────────────────────────────

export const TableColumnResize = Extension.create({
  name: 'tableColumnResize',

  // The table's own margins (cm, 0 = flush with the text area), set by the outer-edge
  // drag. Rendered on the wrapper by TableView; the inline style here serves the
  // static HTML paths (generateHTML → PDF export, clipboard round trip).
  addGlobalAttributes() {
    return [
      {
        types: ['table'],
        attributes: {
          marginLeft: {
            default: 0,
            parseHTML: (element: HTMLElement) => marginCm(element.style.marginLeft),
            renderHTML: (attributes: Record<string, unknown>) => tableMarginStyle(attributes),
          },
          marginRight: {
            default: 0,
            parseHTML: (element: HTMLElement) => marginCm(element.style.marginRight),
            renderHTML: () => ({}),
          },
          // The space above/below the table (ODF fo:margin-top/-bottom on the table
          // style). Word has no equivalent, so it only round-trips through ODF.
          marginTop: {
            default: 0,
            parseHTML: (element: HTMLElement) => marginCm(element.style.marginTop),
            renderHTML: () => ({}),
          },
          marginBottom: {
            default: 0,
            parseHTML: (element: HTMLElement) => marginCm(element.style.marginBottom),
            renderHTML: () => ({}),
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<ResizeState>({
        key: tableColumnResizeKey,
        state: {
          init: (): ResizeState => ({ activeHandle: -1, edge: 'inner', dragging: false }),
          apply(tr: Transaction, prev: ResizeState): ResizeState {
            const action = tr.getMeta(tableColumnResizeKey) as ResizeAction | undefined;
            if (action && 'setHandle' in action) return { activeHandle: action.setHandle, edge: action.edge, dragging: false };
            if (action && 'setDragging' in action) return { ...prev, dragging: action.setDragging };
            if (prev.activeHandle > -1 && tr.docChanged) {
              let handle = tr.mapping.map(prev.activeHandle, -1);
              if (!pointsAtCell(tr.doc.resolve(handle))) handle = -1;
              return { activeHandle: handle, edge: prev.edge, dragging: prev.dragging };
            }
            return prev;
          },
        },
        props: {
          // Whole-editor cursor while a border is active (matches the handle).
          attributes: (state): Record<string, string> => {
            const s = tableColumnResizeKey.getState(state);
            return s && s.activeHandle > -1 ? { class: 'resize-cursor' } : {};
          },
          handleDOMEvents: {
            mousemove: (view, event) => {
              handleMouseMove(view, event as MouseEvent);
              return false;
            },
            mouseleave: (view) => {
              const s = tableColumnResizeKey.getState(view.state);
              if (s && s.activeHandle > -1 && !s.dragging) {
                view.dispatch(view.state.tr.setMeta(tableColumnResizeKey, { setHandle: -1, edge: 'inner' } as ResizeAction));
              }
              return false;
            },
            mousedown: (view, event) => handleMouseDown(view, event as MouseEvent),
          },
          decorations: (state) => {
            const s = tableColumnResizeKey.getState(state);
            if (s && s.activeHandle > -1) return handleDecorations(state, s.activeHandle, s.edge);
            return null;
          },
        },
      }),
    ];
  },
});
