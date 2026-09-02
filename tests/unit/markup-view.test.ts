import { describe, it, expect, beforeEach } from 'vitest';
import {
  markupView, markupMode, setMarkupMode, setShowChanges, setShowComments, markupAttrs,
  showChanges, showComments, commentsInMargin, commentsInPane, setCommentPlace,
} from '../../src/lib/storage/markup.svelte';

// Word's two questions crossed: the display mode decides how much of a change the page
// shows, the two checks which kind shows at all.

describe('the markup view', () => {
  beforeEach(() => {
    setMarkupMode('all');
    setShowChanges(true);
    setShowComments(true);
  });

  it('shows every change and comment in the full view', () => {
    expect(markupView()).toEqual({
      hideDeletions: false, hideInsertions: false, plainRevisions: false,
      comments: true, changes: true,
    });
  });

  it('leaves the final text under simple and no markup', () => {
    for (const mode of ['simple', 'none'] as const) {
      setMarkupMode(mode);
      const v = markupView();
      expect([v.hideDeletions, v.hideInsertions, v.plainRevisions]).toEqual([true, false, true]);
    }
  });

  it('drops bars, balloons and lists where nothing is marked up', () => {
    setMarkupMode('simple');
    expect(markupView()).toMatchObject({ comments: true, changes: true });
    setMarkupMode('none');
    expect(markupView()).toMatchObject({ comments: false, changes: false });
    setMarkupMode('original');
    expect(markupView()).toMatchObject({ comments: false, changes: false });
  });

  it('takes the inserted text off the page in the original view', () => {
    setMarkupMode('original');
    expect(markupView()).toMatchObject({ hideInsertions: true, hideDeletions: false, plainRevisions: true });
  });

  it('carries both kinds with the mode, and a kind lifts a mode that hides it', () => {
    setMarkupMode('none');
    expect([showComments(), showChanges()]).toEqual([false, false]);
    setMarkupMode('all');
    expect([showComments(), showChanges()]).toEqual([true, true]);
    setMarkupMode('original');
    setShowComments(true);
    expect(markupMode()).toBe('all');
  });

  it('reads an unchecked kind as its own hiding, as the mode does', () => {
    setShowChanges(false);
    expect(markupView()).toMatchObject({ hideDeletions: true, plainRevisions: true, changes: false });
    setShowChanges(true);
    setShowComments(false);
    expect(markupView()).toMatchObject({ comments: false, changes: true, hideDeletions: false });
  });

  it('puts a kind where its own switch says, and nowhere while it is hidden', () => {
    expect([commentsInMargin(), commentsInPane()]).toEqual([true, false]);
    setCommentPlace('pane');
    expect([commentsInMargin(), commentsInPane()]).toEqual([false, true]);
    setMarkupMode('none');
    expect([commentsInMargin(), commentsInPane()]).toEqual([false, false]);
    setCommentPlace('balloons');
  });

  it('writes no attribute for the view that shows everything', () => {
    expect(markupAttrs()).toBe('');
    setMarkupMode('none');
    expect(markupAttrs()).toBe(' data-hide-deletions data-plain-markup data-hide-comments');
  });
});
