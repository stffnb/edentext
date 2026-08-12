import type { Editor } from '@tiptap/core';

export type SavedRange = { from: number; to: number } | null;

// A popover steals focus, which collapses the ProseMirror selection. Snapshot it
// when the popover opens, replay it before the command runs.
export function saveRange(editor: Editor | null): SavedRange {
  if (!editor) return null;
  const { from, to } = editor.state.selection;
  return { from, to };
}

// Runs `fn` with the saved range restored; the chain it builds must be `.run()` by
// the caller, as usual.
export function withRange(editor: Editor | null, range: SavedRange, fn: () => void): void {
  if (!editor) return;
  if (range) editor.chain().focus().setTextSelection(range).run();
  else editor.chain().focus().run();
  fn();
}
