// How much markup the page shows (Word's "Display for review") and, per kind, whether it
// shows at all and where its cards go. Reactive singletons like printMarkup.svelte.ts:
// the Review tab flips them, the page CSS, the review layers and both panes read them.

export type MarkupMode = 'all' | 'simple' | 'none' | 'original';
/** Beside the line the annotation belongs to, or listed in the pane next to the page. */
export type MarkupPlace = 'balloons' | 'pane';

const MODE_KEY = 'edentext-markup-mode';
const COMMENTS_KEY = 'edentext-markup-comments';
const CHANGES_KEY = 'edentext-markup-changes';
const COMMENT_PLACE_KEY = 'edentext-markup-comment-place';
const CHANGE_PLACE_KEY = 'edentext-markup-change-place';

export const MARKUP_MODES: MarkupMode[] = ['all', 'simple', 'none', 'original'];
export const MARKUP_PLACES: MarkupPlace[] = ['balloons', 'pane'];

const storedMode = localStorage.getItem(MODE_KEY) as MarkupMode | null;
const place = (key: string): MarkupPlace => (localStorage.getItem(key) === 'pane' ? 'pane' : 'balloons');

let mode = $state<MarkupMode>(storedMode && MARKUP_MODES.includes(storedMode) ? storedMode : 'all');
let comments = $state(localStorage.getItem(COMMENTS_KEY) !== 'false');
let changes = $state(localStorage.getItem(CHANGES_KEY) !== 'false');
let commentAt = $state<MarkupPlace>(place(COMMENT_PLACE_KEY));
let changeAt = $state<MarkupPlace>(place(CHANGE_PLACE_KEY));

/** Whether a mode has anything to show — the two that read as a finished text have not. */
const marks = (m: MarkupMode) => m === 'all' || m === 'simple';

function store(key: string, value: string, isDefault: boolean): void {
  if (isDefault) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
}

export function markupMode(): MarkupMode { return mode; }

// The mode is the coarse switch over both kinds, so it carries them with it: picking a
// view that shows nothing leaves no button behind that claims otherwise.
export function setMarkupMode(m: MarkupMode): void {
  mode = m;
  setShowComments(marks(m));
  setShowChanges(marks(m));
  store(MODE_KEY, m, m === 'all');
}

export function showComments(): boolean { return comments; }

export function setShowComments(on: boolean): void {
  comments = on;
  store(COMMENTS_KEY, 'false', on);
  if (on) liftMode();
}

export function showChanges(): boolean { return changes; }

export function setShowChanges(on: boolean): void {
  changes = on;
  store(CHANGES_KEY, 'false', on);
  if (on) liftMode();
}

// Asking for a kind in a view that hides everything means asking for the full view, as
// Word's Show comments does in No markup.
function liftMode(): void {
  if (marks(mode)) return;
  mode = 'all';
  localStorage.removeItem(MODE_KEY);
}

export function commentPlace(): MarkupPlace { return commentAt; }

export function setCommentPlace(p: MarkupPlace): void {
  commentAt = p;
  store(COMMENT_PLACE_KEY, p, p === 'balloons');
}

export function changePlace(): MarkupPlace { return changeAt; }

export function setChangePlace(p: MarkupPlace): void {
  changeAt = p;
  store(CHANGE_PLACE_KEY, p, p === 'balloons');
}

// Through markupView, so a stored flag can never outvote the mode that hides its kind.
export const commentsInMargin = (): boolean => markupView().comments && commentAt === 'balloons';
export const changesInMargin = (): boolean => markupView().changes && changeAt === 'balloons';
export const commentsInPane = (): boolean => markupView().comments && commentAt === 'pane';
export const changesInPane = (): boolean => markupView().changes && changeAt === 'pane';

/** What the mode and the two kinds come to: the one truth for the layers and the page. */
export type MarkupView = {
  /** The deleted text is out — the text as it would read. */
  hideDeletions: boolean;
  /** The inserted text is out — the text as it read before. */
  hideInsertions: boolean;
  /** No underline, strike or author colour on what is left. */
  plainRevisions: boolean;
  comments: boolean;
  changes: boolean;
};

export function markupView(): MarkupView {
  // Only the full view leaves a change marked up; the other three show a finished text.
  const marked = mode === 'all' && changes;
  return {
    hideDeletions: mode !== 'original' && !marked,
    hideInsertions: mode === 'original',
    plainRevisions: !marked,
    comments: comments && marks(mode),
    changes: changes && marks(mode),
  };
}

/** The same view as attributes, for a page the print paths build from scratch. */
export function markupAttrs(): string {
  const v = markupView();
  return [
    v.hideDeletions && 'data-hide-deletions',
    v.hideInsertions && 'data-hide-insertions',
    v.plainRevisions && 'data-plain-markup',
    !v.comments && 'data-hide-comments',
  ].filter(Boolean).map((a) => ` ${a}`).join('');
}
