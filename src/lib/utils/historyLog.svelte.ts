// Labelled mirror of the undo/redo stacks for the toolbar dropdowns. ProseMirror's
// history exposes only depth counts, no labels, so we keep parallel best-effort
// labels fed from onTransaction and reconcile lengths to the authoritative depths.
import type { Editor } from '@tiptap/core';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { undoDepth, redoDepth, isHistoryTransaction } from '@tiptap/pm/history';
import { ReplaceStep, ReplaceAroundStep, AddMarkStep, RemoveMarkStep, AttrStep } from '@tiptap/pm/transform';

export interface HistoryEntry {
  label: string;
}

// index 0 = oldest, last element = most recent (the next thing an undo would revert).
// `redo` mirrors it: last element = the next thing a redo would re-apply.
export const historyLog = $state<{ undo: HistoryEntry[]; redo: HistoryEntry[] }>({ undo: [], redo: [] });

// Last-seen depths, so we can tell new-edit vs undo vs redo vs a merged (continued-typing)
// transaction apart by the direction the counts moved.
let prevUndo = 0;
let prevRedo = 0;

export function resetHistoryLog(): void {
  historyLog.undo = [];
  historyLog.redo = [];
  prevUndo = 0;
  prevRedo = 0;
}

// Called once per transaction with the POST-transaction state (onTransaction runs after
// state.apply, so the history depths already reflect this transaction).
export function recordTransaction(state: EditorState, tr: Transaction): void {
  const nu = undoDepth(state) as number;
  const nr = redoDepth(state) as number;

  if (isHistoryTransaction(tr)) {
    // This transaction was dispatched BY the history plugin — i.e. an undo or a redo.
    // (Reliable even in the common "undo once, then type" case, which by depth deltas
    // alone is indistinguishable from a redo.) Direction = which way the depth moved.
    if (nu > prevUndo) {
      // Redo: the top redo entry moves back onto the undo stack.
      const moved = historyLog.redo.pop();
      if (moved) historyLog.undo.push(moved);
    } else if (nu < prevUndo) {
      // Undo: the top undo entry moves onto the redo stack.
      const moved = historyLog.undo.pop();
      if (moved) historyLog.redo.push(moved);
    }
  } else if (nu > prevUndo) {
    // A fresh user edit created a new undo group; the redo branch is now discarded.
    historyLog.undo.push({ label: describeTransaction(tr) });
    historyLog.redo = [];
  }
  // else: a normal transaction that didn't add a group — a selection-only change, continued
  // typing merged into the current group, or a meta-only transaction (FORCE_PAGE_RECALC).
  // Nothing to record.

  // Reconcile lengths to the authoritative depths. This keeps COUNTS exact across the
  // edge cases the delta logic can't see precisely: the history cap (oldest group dropped),
  // or a single transaction that creates/removes more than one group.
  while (historyLog.undo.length < nu) historyLog.undo.unshift({ label: 'Edit' });
  while (historyLog.undo.length > nu) historyLog.undo.shift();
  while (historyLog.redo.length < nr) historyLog.redo.unshift({ label: 'Edit' });
  while (historyLog.redo.length > nr) historyLog.redo.shift();

  prevUndo = nu;
  prevRedo = nr;
}

// Jump multiple steps by looping the single-step commands — each dispatch fires
// onTransaction, so the log moves one entry per step and stays in sync.
export function undoSteps(editor: Editor, n: number): void {
  for (let i = 0; i < n; i++) editor.commands.undo();
  editor.commands.focus();
}

export function redoSteps(editor: Editor, n: number): void {
  for (let i = 0; i < n; i++) editor.commands.redo();
  editor.commands.focus();
}

// --- Best-effort transaction labelling (Word/LibreOffice style) -------------------------

const MARK_LABELS: Record<string, string> = {
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strike: 'Strikethrough',
  highlight: 'Highlight',
  subscript: 'Subscript',
  superscript: 'Superscript',
  link: 'Link',
  comment: 'Comment',
  bookmark: 'Bookmark',
  charStyle: 'Character style',
  trackChanges: 'Tracked change',
};

// First inserted node with a label wins; nodesBetween visits parents before children,
// so the outermost structure (a table over its paragraphs) names the entry.
const NODE_LABELS: Record<string, string> = {
  table: 'Insert table',
  bulletList: 'Bullet list',
  orderedList: 'Numbered list',
  image: 'Insert image',
  textBox: 'Text box',
  formula: 'Formula',
  pageBreak: 'Page break',
  horizontalRule: 'Horizontal rule',
  tableOfContents: 'Table of contents',
  dateTimeField: 'Date field',
  pageNumber: 'Page number',
  pageCount: 'Page count',
  chapterField: 'Chapter field',
  sequenceField: 'Caption field',
  crossRef: 'Cross-reference',
  indexEntry: 'Index entry',
  bibliographyEntry: 'Bibliography entry',
  ruby: 'Ruby text',
  columns: 'Columns',
};

function describeMark(name: string, attrs: Record<string, unknown> | undefined): string {
  if (name === 'textStyle') {
    // TextStyle carries several attrs; label by whichever this step actually set.
    if (attrs?.color) return 'Text color';
    if (attrs?.fontSize) return 'Font size';
    if (attrs?.fontFamily) return 'Font';
    if (attrs?.fontWeight) return 'Bold';
    return 'Formatting';
  }
  return MARK_LABELS[name] ?? 'Formatting';
}

function describeTransaction(tr: Transaction): string {
  let structural: string | null = null; // table / list / heading / paragraph — wins
  let insertedText = '';
  let sawText = false;
  let sawDelete = false;
  let markLabel: string | null = null;
  let sawAttr = false;

  for (const step of tr.steps) {
    if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
      const { content, size } = step.slice;
      if (size === 0) {
        sawDelete = true;
        continue;
      }
      content.nodesBetween(0, content.size, (node) => {
        const name = node.type.name;
        if (!structural) {
          if (name === 'heading') structural = `Heading ${node.attrs.level ?? ''}`.trim();
          else if (name === 'noteRef' || name === 'note')
            structural = node.attrs.kind === 'endnote' ? 'Endnote' : 'Footnote';
          else if (NODE_LABELS[name]) structural = NODE_LABELS[name];
          else if (step instanceof ReplaceAroundStep && name === 'paragraph') structural = 'Paragraph';
        }
        if (node.isText) {
          sawText = true;
          insertedText += node.text ?? '';
        }
        return true;
      });
    } else if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      if (!markLabel) markLabel = describeMark(step.mark.type.name, step.mark.attrs);
    } else if (step instanceof AttrStep) {
      sawAttr = true;
    }
  }

  if (structural) return structural;
  if (sawText) {
    const trimmed = insertedText.trim();
    if (!trimmed) return 'Typing';
    const snippet = trimmed.slice(0, 20);
    return `Typing: “${snippet}${trimmed.length > 20 ? '…' : ''}”`;
  }
  if (sawDelete) return 'Delete';
  if (markLabel) return markLabel;
  if (sawAttr) return 'Formatting';
  return 'Edit';
}
