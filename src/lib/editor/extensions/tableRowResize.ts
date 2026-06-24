import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { cellAround } from '@tiptap/pm/tables';
import { domCellAround, tableColumnResizeKey } from './tableColumnResize';

// Word-style row-height drag: changes the row above the grid line, min-height
// semantics (stored as `rowHeight` in tableRow.ts). Live preview is a meta-only
// Decoration.node (no history); yields to column resize at a corner.

const HANDLE_WIDTH = 5; // px from a row border that activates the handle
const MIN_ROW_PX = 16; // smallest a row may be dragged to (content still protects it)

interface RowResizeState {
  activeRow: number; // doc pos directly before the active row, or -1
  dragging: boolean;
  previewHeight: number | null; // live drag height in unscaled document px
}

interface RowResizeAction {
  setActive?: number;
  setDragging?: boolean;
  setPreview?: number | null;
}

export const tableRowResizeKey = new PluginKey<RowResizeState>('tableRowResize');

// ─── Geometry helpers ────────────────────────────────────────────────────────

// Position directly before the row whose lower border is near the pointer. We
// probe just ABOVE the pointer so a border between row i and i+1 resolves to row i
// (the row that gets resized). Returns -1 above the table's first row.
function edgeRowPos(view: EditorView, event: MouseEvent): number {
  const found = view.posAtCoords({ left: event.clientX, top: event.clientY - HANDLE_WIDTH });
  if (!found) return -1;
  const $cell = cellAround(view.state.doc.resolve(found.pos));
  if (!$cell) return -1;
  return $cell.before(); // position before the row node
}

// The <tr> element for the row at `rowPos` (a before-row position).
function rowDOM(view: EditorView, rowPos: number): HTMLElement | null {
  let dom = view.domAtPos(rowPos + 1).node as HTMLElement | null;
  while (dom && dom.nodeName !== 'TR') dom = dom.parentNode as HTMLElement | null;
  return (dom as HTMLElement) ?? null;
}

// ─── Event handlers ────────────────────────────────────────────────────────

function handleMouseMove(view: EditorView, event: MouseEvent): void {
  if (!view.editable) return;
  const state = tableRowResizeKey.getState(view.state);
  if (!state || state.dragging) return;

  // Corner precedence: if a column border is active, don't claim a row border.
  const colState = tableColumnResizeKey.getState(view.state);
  if (colState && colState.activeHandle > -1) {
    if (state.activeRow !== -1) {
      view.dispatch(view.state.tr.setMeta(tableRowResizeKey, { setActive: -1 } as RowResizeAction));
    }
    return;
  }

  const target = domCellAround(event.target as HTMLElement | null);
  let row = -1;
  if (target) {
    const { top, bottom } = target.getBoundingClientRect();
    if (bottom - event.clientY <= HANDLE_WIDTH || event.clientY - top <= HANDLE_WIDTH) {
      row = edgeRowPos(view, event);
    }
  }

  if (row !== state.activeRow) {
    view.dispatch(view.state.tr.setMeta(tableRowResizeKey, { setActive: row } as RowResizeAction));
  }
}

function handleMouseDown(view: EditorView, event: MouseEvent): boolean {
  if (!view.editable) return false;
  const state = tableRowResizeKey.getState(view.state);
  if (!state || state.activeRow === -1 || state.dragging) return false;

  const activeRow = state.activeRow;
  const rowNode = view.state.doc.nodeAt(activeRow);
  if (!rowNode || rowNode.type.name !== 'tableRow') return false;

  const tr = rowDOM(view, activeRow);
  if (!tr) return false;
  const startHeight = tr.offsetHeight; // unscaled document px (ignores CSS zoom)
  if (!startHeight) return false;
  // offsetHeight is unscaled; getBoundingClientRect is scaled by the .paper zoom.
  // Their ratio is the zoom factor, so the mouse delta (viewport px) converts back
  // to document px without walking the ancestor chain.
  const zoom = tr.getBoundingClientRect().height / startHeight || 1;

  const startY = event.clientY;
  let lastHeight = startHeight;
  let pendingHeight = startHeight;
  let moved = false;
  let rafPending = false;
  const win = view.dom.ownerDocument.defaultView ?? window;

  view.dispatch(view.state.tr.setMeta(tableRowResizeKey, { setDragging: true } as RowResizeAction));

  function flush(): void {
    rafPending = false;
    const st = tableRowResizeKey.getState(view.state);
    if (!st?.dragging) return;
    view.dispatch(
      view.state.tr
        .setMeta(tableRowResizeKey, { setPreview: pendingHeight } as RowResizeAction)
        .setMeta('addToHistory', false),
    );
  }

  function move(e: MouseEvent): void {
    if (!e.buttons) {
      finish();
      return;
    }
    pendingHeight = Math.max(MIN_ROW_PX, Math.round(startHeight + (e.clientY - startY) / zoom));
    lastHeight = pendingHeight;
    moved = true;
    if (!rafPending) {
      rafPending = true;
      win.requestAnimationFrame(flush);
    }
  }

  function finish(): void {
    win.removeEventListener('mouseup', finish);
    win.removeEventListener('mousemove', move);
    const st = tableRowResizeKey.getState(view.state);
    if (!st?.dragging) return;
    const node = view.state.doc.nodeAt(activeRow);
    if (moved && node && node.type.name === 'tableRow') {
      const tx = view.state.tr.setNodeMarkup(activeRow, undefined, { ...node.attrs, rowHeight: lastHeight });
      tx.setMeta(tableRowResizeKey, { setDragging: false, setPreview: null } as RowResizeAction);
      view.dispatch(tx);
    } else {
      view.dispatch(
        view.state.tr.setMeta(tableRowResizeKey, { setDragging: false, setPreview: null } as RowResizeAction),
      );
    }
  }

  win.addEventListener('mouseup', finish);
  win.addEventListener('mousemove', move);
  event.preventDefault();
  return true;
}

// ─── Decorations: handle at the active row's bottom edge + live preview ───────

function rowDecorations(state: EditorState, activeRow: number, previewHeight: number | null): DecorationSet {
  const rowNode = state.doc.nodeAt(activeRow);
  if (!rowNode || rowNode.type.name !== 'tableRow') return DecorationSet.empty;
  const decos: Decoration[] = [];
  const dragging = tableRowResizeKey.getState(state)?.dragging;

  // Live preview: apply the dragged height through ProseMirror so it isn't reverted.
  if (dragging && previewHeight != null) {
    decos.push(
      Decoration.node(activeRow, activeRow + rowNode.nodeSize, { style: `height: ${previewHeight}px` }),
    );
  }

  // One handle per cell at the row's lower edge → a continuous line across the row.
  rowNode.forEach((cell, offset) => {
    const cellPos = activeRow + 1 + offset;
    const handle = document.createElement('div');
    handle.className = 'row-resize-handle';
    decos.push(Decoration.widget(cellPos + cell.nodeSize - 1, handle));
  });

  return DecorationSet.create(state.doc, decos);
}

// ─── Plugin / extension ──────────────────────────────────────────────────────

export const TableRowResize = Extension.create({
  name: 'tableRowResize',

  addProseMirrorPlugins() {
    return [
      new Plugin<RowResizeState>({
        key: tableRowResizeKey,
        state: {
          init: (): RowResizeState => ({ activeRow: -1, dragging: false, previewHeight: null }),
          apply(tr: Transaction, prev: RowResizeState): RowResizeState {
            const action = tr.getMeta(tableRowResizeKey) as RowResizeAction | undefined;
            if (action) {
              const next: RowResizeState = { ...prev };
              if ('setActive' in action) {
                next.activeRow = action.setActive ?? -1;
                next.dragging = false;
                next.previewHeight = null;
              }
              if ('setDragging' in action) next.dragging = !!action.setDragging;
              if ('setPreview' in action) next.previewHeight = action.setPreview ?? null;
              return next;
            }
            if (prev.activeRow > -1 && tr.docChanged) {
              const mapped = tr.mapping.map(prev.activeRow, -1);
              const node = tr.doc.nodeAt(mapped);
              if (!node || node.type.name !== 'tableRow') {
                return { activeRow: -1, dragging: false, previewHeight: null };
              }
              return { ...prev, activeRow: mapped };
            }
            return prev;
          },
        },
        props: {
          attributes: (state): Record<string, string> => {
            const s = tableRowResizeKey.getState(state);
            return s && s.activeRow > -1 ? { class: 'row-resize-cursor' } : {};
          },
          handleDOMEvents: {
            mousemove: (view, event) => {
              handleMouseMove(view, event as MouseEvent);
              return false;
            },
            mouseleave: (view) => {
              const s = tableRowResizeKey.getState(view.state);
              if (s && s.activeRow > -1 && !s.dragging) {
                view.dispatch(view.state.tr.setMeta(tableRowResizeKey, { setActive: -1 } as RowResizeAction));
              }
              return false;
            },
            mousedown: (view, event) => handleMouseDown(view, event as MouseEvent),
          },
          decorations: (state) => {
            const s = tableRowResizeKey.getState(state);
            if (s && s.activeRow > -1) return rowDecorations(state, s.activeRow, s.previewHeight);
            return null;
          },
        },
      }),
    ];
  },
});
