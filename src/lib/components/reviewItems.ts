import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { comments, commentRanges, type CommentRange } from '../editor/extensions/comment';
import { revisions, type Revision } from '../editor/extensions/trackChanges';
import { markupView } from '../storage/markup.svelte';

// What the review views may show, in one place: bars, balloons, leader line and both
// panes ask here instead of each carrying its own reading of the markup settings.
// A resolved comment is not this rule's business — every caller handles it as it did.

export function visibleComments(doc: PMNode): CommentRange[] {
  return markupView().comments ? comments(doc) : [];
}

export function visibleCommentRanges(doc: PMNode): CommentRange[] {
  return markupView().comments ? commentRanges(doc) : [];
}

export function visibleRevisions(doc: PMNode): Revision[] {
  return markupView().changes ? revisions(doc) : [];
}

/** Select a marked range and scroll it into view — what a click on any of its cards does. */
export function selectRange(editor: Editor, from: number, to: number): void {
  const { state, view } = editor;
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)).scrollIntoView());
  view.focus();
}

/** The entry after the caret, wrapping at the end — Word's Next in both review groups. */
export function step<T extends { from: number; to: number }>(
  list: T[], pos: number, dir: 1 | -1,
): T | null {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a.from - b.from);
  const hit = dir === 1
    ? sorted.find((r) => r.from > pos)
    : [...sorted].reverse().find((r) => r.from < pos);
  return hit ?? (dir === 1 ? sorted[0] : sorted[sorted.length - 1]);
}
