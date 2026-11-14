<script lang="ts" module>
  // Module-level: the card remounts when comments move between margin and pane, and the
  // two panes of a split view each show one.
  let text = $state('');
  let asked = $state(0);

  /** Brings the box to the writer; a fresh comment starts empty. */
  export function askComposer(fresh: boolean): void {
    if (fresh) text = '';
    asked++;
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import type { Editor } from '@tiptap/core';
  import { focusInPlace } from '../editor/extensions/overlay';
  import { comments, type CommentDraft } from '../editor/extensions/comment';
  import { t } from '../i18n/i18n.svelte';
  import { formatMoment } from '../storage/dateFormat.svelte';
  import { aiEnabled, AI_COMMENT_EVENT } from '../storage/ai.svelte';
  import { mentionsAi } from '../ai/tools';
  import { autosize, isSubmitKey } from '../utils/autosize';

  // A comment being written: the head and quote of the card it becomes, over a box that
  // grows with the text. Used by the balloons and the pane alike.
  let { editor, draft, author, takeFocus = true }: {
    editor: Editor | null;
    draft: CommentDraft;
    author: string;
    /** The split pane in use: a second box taking the focus would bounce it to the text. */
    takeFocus?: boolean;
  } = $props();

  const moment = formatMoment(new Date().toISOString());
  let box = $state<HTMLTextAreaElement | null>(null);

  $effect(() => {
    void asked;
    if (untrack(() => takeFocus)) box?.focus();
  });

  function cancel() {
    if (editor) { editor.chain().cancelCommentDraft().run(); focusInPlace(editor.view); }
  }

  function add() {
    const body = text.trim();
    if (!editor || !body) return;
    const had = new Set(comments(editor.state.doc).map((c) => c.id));
    editor.chain().submitCommentDraft({ author, text: body }).run();
    focusInPlace(editor.view);
    const id = comments(editor.state.doc).find((c) => !had.has(c.id))?.id;
    if (id && aiEnabled() && mentionsAi(body)) window.dispatchEvent(new CustomEvent(AI_COMMENT_EVENT, { detail: { id } }));
  }
</script>

<div class="meta"><b>{author || t().revisions.unknownAuthor}</b><span>{moment}</span></div>
<div class="quote">{draft.quote}</div>
<textarea
  rows="3"
  bind:this={box}
  use:autosize={text}
  bind:value={text}
  aria-label={t().comments.prompt}
  onkeydown={(e) => { if (e.key === 'Escape') cancel(); else if (isSubmitKey(e)) add(); }}
></textarea>
<div class="actions">
  <button onclick={cancel}>{t().common.cancel}</button>
  <button class="primary" disabled={!text.trim()} onclick={add}>{t().common.add}</button>
</div>

<style>
  .meta { display: flex; flex-direction: column; color: var(--color-text-muted); }
  .meta b { color: var(--color-text); }

  .quote {
    margin: 3px 0;
    padding-left: 6px;
    border-left: 2px solid var(--color-primary);
    color: var(--color-text-muted);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  textarea {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 4px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 4px 6px;
    font: inherit;
    resize: none;
    overflow: hidden;
  }

  .actions { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
  .actions button {
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--color-text-muted);
    padding: 2px 6px;
    font: inherit;
    cursor: pointer;
  }
  .actions button:hover:enabled { background: var(--color-btn-hover); color: var(--color-text); }
  .actions .primary { border-color: var(--color-primary); background: var(--color-primary); color: #fff; }
  .actions .primary:disabled { opacity: 0.5; cursor: default; }
</style>
