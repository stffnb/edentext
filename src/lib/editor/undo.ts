import type { EditorState, Transaction } from '@tiptap/pm/state';
import { closeHistory, isHistoryTransaction, redo, redoDepth, undo, undoDepth } from '@tiptap/pm/history';

// The body's undo, behind one interface: ProseMirror's history alone, Yjs's undo manager
// in a shared session (only the user's own edits go back there). Everything reading the
// history goes through the backend in use.
export type UndoBackend = {
  run(dir: 'undo' | 'redo', state: EditorState, dispatch?: (tr: Transaction) => void, tr?: Transaction): boolean;
  depths(state: EditorState): { undo: number; redo: number };
  /** An undo or redo itself, and a side store put back by one (STATE_RESTORED). */
  isUndoRedo(tr: Transaction): boolean;
  /** This transaction starts a step of its own. */
  closeGroup(tr: Transaction): void;
  /** The stacks' labels, oldest first, where the backend keeps them itself. */
  labels?(): { undo: string[]; redo: string[] };
  /** A document loaded: nothing before it can be undone. */
  reset?(): void;
};

/** Meta of a body transaction carrying the side stores an undo put back (`StateStep`s). */
export const STATE_RESTORED = 'stateRestored';

export const pmUndo: UndoBackend = {
  run: (dir, state, dispatch) => (dir === 'undo' ? undo : redo)(state, dispatch),
  depths: (state) => ({ undo: undoDepth(state), redo: redoDepth(state) }),
  isUndoRedo: (tr) => isHistoryTransaction(tr) || !!tr.getMeta(STATE_RESTORED),
  closeGroup: (tr) => { closeHistory(tr); },
};

let active: UndoBackend = pmUndo;
export const undoBackend = (): UndoBackend => active;
export function setUndoBackend(b: UndoBackend): void { active = b; }

export const isUndoRedo = (tr: Transaction): boolean => active.isUndoRedo(tr);
export const closeGroup = (tr: Transaction): void => active.closeGroup(tr);
