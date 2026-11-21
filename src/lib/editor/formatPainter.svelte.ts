import type { EditorState } from '@tiptap/pm/state';
import { pickFormat, type PaintedFormat } from '../utils/formatPainter';

// The format painter's brush: the picked format and whether it stays on after a stroke.
// One for the whole app, so a format picked in the body paints a header or a cell, and
// local to this tab: nothing of it reaches a document or a shared session.

let format = $state.raw<PaintedFormat | null>(null);
let keep = $state(false);
// The click that picked the format: the second click of a double click keeps the brush on.
let picked = false;

export const painting = (): boolean => format !== null;
export const paintedFormat = (): PaintedFormat | null => format;
export const paintingOn = (): boolean => keep;

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  stopPainting();
}

function reflect(on: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('format-painting', on);
  window.removeEventListener('keydown', onKey, true);
  if (on) window.addEventListener('keydown', onKey, true);
}

export function startPainting(state: EditorState, stay = false): void {
  format = pickFormat(state);
  keep = stay;
  reflect(true);
}

export function stopPainting(): void {
  format = null;
  keep = false;
  picked = false;
  reflect(false);
}

/** The painter button: a click picks the format or puts the brush down, a double click keeps it on. */
export function painterClick(state: EditorState | undefined, e?: MouseEvent): void {
  if ((e?.detail ?? 0) >= 2) {
    if (picked && state) startPainting(state, true);
    return;
  }
  if (painting()) { stopPainting(); return; }
  if (!state) return;
  startPainting(state);
  picked = true;
}
