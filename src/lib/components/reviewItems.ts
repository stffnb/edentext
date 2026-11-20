import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { commentIdAt, comments, commentRanges, pickComment, type CommentRange } from '../editor/extensions/comment';
import { changesAt, revisions, settledRange, type Revision, type RevisionKind } from '../editor/extensions/trackChanges';
import { countText, type TextStats } from '../utils/wordCount';
import { flushPending } from '../editor/extensions/stateHistory';
import { bodyEditor, commentZones, liveZone, openZone, settleZones, zoneRevisions } from '../editor/zoneReview';
import { markupView, showResolved } from '../storage/markup.svelte';
import { recordChanges, recordLock, setRecordChanges, whenUnlocked } from '../storage/trackChanges.svelte';
import { setUserName, userName } from '../storage/userName.svelte';
import { t } from '../i18n/i18n.svelte';
import { askText } from './PromptDialog.svelte';
import { coordsAt } from '../editor/extensions/overlay';

// What the review views may show, in one place: bars, balloons, leader line and both
// panes ask here instead of each carrying its own reading of the markup settings.
// A resolved comment shows while `showResolved` is on, else only the one the caret is in
// (`activeId`), so its grey underline still leads to a card that can reopen it.

export function visibleComments(doc: PMNode, activeId: string | null = null): CommentRange[] {
  if (!markupView().comments) return [];
  const all = comments(doc);
  return showResolved() ? all : all.filter((c) => !c.resolved || c.id === activeId);
}

/** Asks for the name first where there is none: what is recorded keeps it for good.
 *  False when it was not given, and the caller leaves what it was about to do. */
export async function ensureUserName(): Promise<boolean> {
  if (userName()) return true;
  const name = (await askText(t().settings.userName, '', t().settings.userNameAsk))?.trim();
  if (name) setUserName(name);
  return !!name;
}

export async function toggleRecordChanges(): Promise<void> {
  if (recordChanges() || await ensureUserName()) setRecordChanges(!recordChanges());
}

export function visibleCommentRanges(doc: PMNode): CommentRange[] {
  return markupView().comments ? commentRanges(doc) : [];
}

export function visibleRevisions(doc: PMNode): Revision[] {
  return markupView().changes ? revisions(doc) : [];
}

/** The statistics of a range as the view reads: what it hides does not count. */
export function shownStats(doc: PMNode, from = 0, to = doc.content.size): TextStats {
  const { hideDeletions, hideInsertions } = markupView();
  if (!hideDeletions && !hideInsertions) return countText(doc, from, to);
  const shown = settledRange(doc, hideDeletions, from, to);
  return countText(shown.doc, shown.from, shown.to);
}

/** What the pane lists: the body's changes, then the headers' and footers'. */
export function listedRevisions(doc: PMNode): Revision[] {
  return markupView().changes ? [...revisions(doc), ...zoneRevisions()] : [];
}

/** Whether the document holds a change, wherever `editor` is working. */
export function hasRevisions(editor: Editor): boolean {
  return revisions((bodyEditor() ?? editor).state.doc).length > 0 || zoneRevisions().length > 0;
}

/** Accepts or rejects what the selection touches; with nothing there no password is asked. */
export function settleHere(editor: Editor, accept: boolean): void {
  if (!changesAt(editor.state)) return;
  whenUnlocked(() => {
    const chain = editor.chain().focus();
    (accept ? chain.acceptRevisions() : chain.rejectRevisions()).run();
  });
}

/** Accepts or rejects every change, zones included, in one undo step. */
export function settleAll(editor: Editor, accept: boolean): void {
  if (recordLock()) return whenUnlocked(() => settleAll(editor, accept));
  flushPending();
  const chain = (bodyEditor() ?? editor).chain().command(({ tr }) => { settleZones(tr, accept); return true; });
  (accept ? chain.acceptRevisions(true) : chain.rejectRevisions(true)).run();
  editor.commands.focus();
}

/** Accepts or rejects these changes, wherever each is, in one undo step. */
export function settleRevisions(editor: Editor, list: Revision[], accept: boolean): void {
  if (recordLock()) return whenUnlocked(() => settleRevisions(editor, list, accept));
  flushPending();
  const body = bodyEditor() ?? editor, zones = list.flatMap((r) => (r.zone ? [r.id] : [])), inBody = list.flatMap((r) => (r.zone ? [] : [r.id]));
  let chain = body === editor ? body.chain().focus(null, { scrollIntoView: false }) : body.chain();
  if (zones.length) chain = chain.command(({ tr }) => { settleZones(tr, accept, zones); return true; });
  if (inBody.length) chain = accept ? chain.acceptRevision(inBody) : chain.rejectRevision(inBody);
  chain.run();
}

/** Writes what a reviewer says on a change, wherever it is. */
export function commentRevision(editor: Editor, r: Revision, comment: string): void {
  flushPending();
  const body = bodyEditor() ?? editor;
  if (r.zone) body.chain().command(({ tr }) => { commentZones(tr, r.id, comment); return true; }).run();
  else body.commands.commentRevision(r.id, comment);
}

/** What the pane's filter asks for; null and '' ask for nothing. `since` is a day, YYYY-MM-DD. */
export type RevisionFilter = { author: string | null; kind: RevisionKind | 'moved' | null; since: string };

export function filterRevisions(list: Revision[], { author, kind, since }: RevisionFilter): Revision[] {
  const from = since ? new Date(`${since}T00:00`).getTime() : null;
  return list.filter((r) => (author == null || r.author === author)
    && (kind == null || (kind === 'moved' ? r.moved : !r.moved && r.kind === kind))
    && (from == null || new Date(r.date).getTime() >= from));
}

/** Select a marked range and scroll it smoothly into view — what a click on any of its
 *  cards does. `scroll: false` for a card beside the page, which stays under the pointer. */
export function selectRange(editor: Editor, from: number, to: number, scroll = true, comment?: string): void {
  const { state, view } = editor;
  // By `between`: a row's change starts between nodes, where a text selection cannot.
  const tr = state.tr.setSelection(TextSelection.between(state.doc.resolve(from), state.doc.resolve(to)));
  if (comment) pickComment(tr, comment);
  const scroller = (view.dom as HTMLElement).closest('.editor');
  view.dispatch(scroll && !scroller ? tr.scrollIntoView() : tr);
  view.focus();
  if (!scroll || !scroller) return;
  // Glides rather than jumps, and only when the line is not already well in view; it
  // lands a third of the way down, where the eye looks for it.
  const line = coordsAt(view, from);
  const box = scroller.getBoundingClientRect();
  const inY = line.top >= box.top + 40 && line.bottom <= box.bottom - 40;
  const inX = line.left >= box.left + 20 && line.right <= box.right - 20;
  if (inY && inX) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  scroller.scrollBy({
    top: inY ? 0 : line.top - (box.top + box.height / 3),
    left: inX ? 0 : line.left - (box.left + box.width / 3),
    behavior: reduce ? 'auto' : 'smooth',
  });
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

/** Selects a change where it is, opening its zone if it sits in one. */
export function jumpToRevision(editor: Editor, r: Revision): void {
  if (r.zone) openZone(r.zone, (zone) => selectRange(zone, r.from, r.to));
  else selectRange(bodyEditor() ?? editor, r.from, r.to);
}

/** Selects the next or previous comment or change; only what the view shows is a place
 *  to jump to. Changes run through the body, then the zones in the pane's order. */
export function goToMarkup(editor: Editor, kind: 'comment' | 'revision', dir: 1 | -1): void {
  if (kind === 'comment') {
    // By the list from a comment, as the next one may start where it does.
    const list = visibleComments(editor.state.doc);
    const at = list.findIndex((c) => c.id === commentIdAt(editor.state));
    const hit = at >= 0 ? list[(at + dir + list.length) % list.length] : step(list, editor.state.selection.from, dir);
    if (hit) selectRange(editor, hit.from, hit.to, true, hit.id);
    return;
  }
  const list = listedRevisions((bodyEditor() ?? editor).state.doc);
  const zones = [...new Set(list.flatMap((r) => (r.zone ? [r.zone] : [])))];
  // Past any document's size: each zone's positions follow those of the one before.
  const offset = (zone: string | null | undefined) => (zone ? zones.indexOf(zone) + 1 : 0) * 2 ** 32;
  const stops = list.map((r) => ({ r, from: offset(r.zone) + r.from, to: 0 }));
  const hit = step(stops, offset(liveZone()) + editor.state.selection.from, dir);
  if (hit) jumpToRevision(editor, hit.r);
}
