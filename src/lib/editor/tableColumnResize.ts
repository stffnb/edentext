import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { TableMap, cellAround, pointsAtCell } from '@tiptap/pm/tables';
import { columnWeightsFromRow, columnPercents } from './tableView';

// Word-style column resizing.
//
// TipTap's built-in columnResizing resizes a single column and lets the table
// width grow (it has no neighbour-trade mode). Instead, this plugin keeps the
// table exactly the full text width: dragging the border between column i and i+1
// only trades width between those two columns (their sum stays constant). Live
// feedback pokes the <col> elements of the custom TableView (tableView.ts); on
// release a single transaction writes the new proportional weights into the
// `colwidth` attribute of every cell, so the document fully describes the layout
// (→ exact, deterministic ODT export).

const HANDLE_WIDTH = 5; // px from a column border that activates the handle
const CELL_MIN_PX = 30; // smallest a column may be dragged to
// Resolution of the stored integer weights (percent × this). Only ratios matter.
const WEIGHT_SCALE = 100;

interface ResizeState {
  activeHandle: number; // doc pos of the cell whose RIGHT edge is active, or -1
  dragging: boolean;
}

type ResizeAction =
  | { setHandle: number }
  | { setDragging: boolean };

export const tableColumnResizeKey = new PluginKey<ResizeState>('tableColumnResize');

// ─── DOM / geometry helpers (mirrors prosemirror-tables) ───────────────────

export function domCellAround(target: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = target;
  while (el && el.nodeName !== 'TD' && el.nodeName !== 'TH') {
    el = el.classList && el.classList.contains('ProseMirror') ? null : (el.parentNode as HTMLElement | null);
  }
  return el;
}

// Resolve the cell adjacent to a column border near the pointer. For "right" the
// returned pos is the cell on the left of the border; for "left" it's the cell
// left of the border before the pointer's cell. Returns -1 at the outer edges.
function edgeCell(view: EditorView, event: MouseEvent, side: 'left' | 'right'): number {
  const offset = side === 'right' ? -HANDLE_WIDTH : HANDLE_WIDTH;
  const found = view.posAtCoords({ left: event.clientX + offset, top: event.clientY });
  if (!found) return -1;
  const $cell = cellAround(view.state.doc.resolve(found.pos));
  if (!$cell) return -1;
  if (side === 'right') return $cell.pos;
  const map = TableMap.get($cell.node(-1));
  const start = $cell.start(-1);
  const index = map.map.indexOf($cell.pos - start);
  return index % map.width === 0 ? -1 : start + map.map[index - 1];
}

// The rightmost column index covered by the cell at `cellPos`.
function rightColOf(state: EditorState, cellPos: number): { col: number; width: number } {
  const $cell = state.doc.resolve(cellPos);
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const start = $cell.start(-1);
  const colspan = ($cell.nodeAfter?.attrs.colspan as number) ?? 1;
  return { col: map.colCount($cell.pos - start) + colspan - 1, width: map.width };
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
  if (target) {
    const { left, right } = target.getBoundingClientRect();
    if (event.clientX - left <= HANDLE_WIDTH) cell = edgeCell(view, event, 'left');
    else if (right - event.clientX <= HANDLE_WIDTH) cell = edgeCell(view, event, 'right');
  }

  // Only internal borders are draggable — the outer right edge would change the
  // table width, which we never want (the table stays full text width).
  if (cell !== -1) {
    const { col, width } = rightColOf(view.state, cell);
    if (col >= width - 1) cell = -1;
  }

  if (cell !== state.activeHandle) {
    view.dispatch(view.state.tr.setMeta(tableColumnResizeKey, { setHandle: cell } as ResizeAction));
  }
}

// Write the final per-column weights into every cell's `colwidth` attribute.
function commitColumnWidths(view: EditorView, activeHandle: number, finalPercents: number[]): void {
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
  if (tr.docChanged) view.dispatch(tr);
}

function handleMouseDown(view: EditorView, event: MouseEvent): boolean {
  if (!view.editable) return false;
  const state = tableColumnResizeKey.getState(view.state);
  if (!state || state.activeHandle === -1 || state.dragging) return false;

  const activeHandle = state.activeHandle;
  const $cell = view.state.doc.resolve(activeHandle);
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const tableStart = $cell.start(-1);
  const colspan = ($cell.nodeAfter?.attrs.colspan as number) ?? 1;
  const leftCol = map.colCount($cell.pos - tableStart) + colspan - 1;
  const rightCol = leftCol + 1;
  if (rightCol > map.width - 1) return false; // outer edge, never resizable

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

function handleDecorations(state: EditorState, cell: number): DecorationSet {
  const decorations: Decoration[] = [];
  const $cell = state.doc.resolve(cell);
  const table = $cell.node(-1);
  if (!table) return DecorationSet.empty;
  const map = TableMap.get(table);
  const start = $cell.start(-1);
  const colspan = ($cell.nodeAfter?.attrs.colspan as number) ?? 1;
  const col = map.colCount($cell.pos - start) + colspan - 1;
  const dragging = tableColumnResizeKey.getState(state)?.dragging;

  for (let row = 0; row < map.height; row++) {
    const index = col + row * map.width;
    // Skip cells that span across this border (right) or merge into the row above.
    if (
      (col === map.width - 1 || map.map[index] !== map.map[index + 1]) &&
      (row === 0 || map.map[index] !== map.map[index - map.width])
    ) {
      const cellPos = map.map[index];
      const cellNode = table.nodeAt(cellPos);
      if (!cellNode) continue;
      const pos = start + cellPos + cellNode.nodeSize - 1;
      const dom = document.createElement('div');
      dom.className = 'column-resize-handle';
      if (dragging) {
        decorations.push(
          Decoration.node(start + cellPos, start + cellPos + cellNode.nodeSize, {
            class: 'column-resize-dragging',
          }),
        );
      }
      decorations.push(Decoration.widget(pos, dom));
    }
  }
  return DecorationSet.create(state.doc, decorations);
}

// ─── Plugin / extension ──────────────────────────────────────────────────────

export const TableColumnResize = Extension.create({
  name: 'tableColumnResize',

  addProseMirrorPlugins() {
    return [
      new Plugin<ResizeState>({
        key: tableColumnResizeKey,
        state: {
          init: (): ResizeState => ({ activeHandle: -1, dragging: false }),
          apply(tr: Transaction, prev: ResizeState): ResizeState {
            const action = tr.getMeta(tableColumnResizeKey) as ResizeAction | undefined;
            if (action && 'setHandle' in action) return { activeHandle: action.setHandle, dragging: false };
            if (action && 'setDragging' in action) return { activeHandle: prev.activeHandle, dragging: action.setDragging };
            if (prev.activeHandle > -1 && tr.docChanged) {
              let handle = tr.mapping.map(prev.activeHandle, -1);
              if (!pointsAtCell(tr.doc.resolve(handle))) handle = -1;
              return { activeHandle: handle, dragging: prev.dragging };
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
                view.dispatch(view.state.tr.setMeta(tableColumnResizeKey, { setHandle: -1 } as ResizeAction));
              }
              return false;
            },
            mousedown: (view, event) => handleMouseDown(view, event as MouseEvent),
          },
          decorations: (state) => {
            const s = tableColumnResizeKey.getState(state);
            if (s && s.activeHandle > -1) return handleDecorations(state, s.activeHandle);
            return null;
          },
        },
      }),
    ];
  },
});
