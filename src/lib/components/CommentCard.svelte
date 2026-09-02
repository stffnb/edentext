<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import type { CommentRange } from '../editor/extensions/comment';
  import { t } from '../i18n/i18n.svelte';

  // One comment thread as both reviewing views show it: the quote it hangs on, its text,
  // the answers to it and a box to add one. Edit / resolve / remove sit behind the ⋯
  // button, as they do in both word processors — a balloon has no room for a row of three. Shared by the pane's row and the margin balloon, so the commands exist once.
  let { editor, c, author, onSelect }: {
    editor: Editor | null;
    c: CommentRange;
    author: string;
    onSelect: () => void;
  } = $props();

  let editing = $state(false);
  let draft = $state('');
  let replying = $state(false);
  let reply = $state('');
  let menu = $state(false);

  function startEdit() {
    draft = c.text;
    editing = true;
    menu = false;
  }

  function commit() {
    editor?.chain().focus().updateComment(c.id, { text: draft.trim() }).run();
    editing = false;
  }

  function sendReply() {
    if (!reply.trim()) return;
    editor?.chain().focus().replyToComment(c.id, { author, text: reply }).run();
    reply = '';
    replying = false;
  }

  // The stored ISO date, in the reader's locale — an imported file may carry any format.
  function when(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  // Close the ⋯ menu on an outside click or Escape (as HistoryButton's popover does).
  function popover(node: HTMLElement) {
    const onDown = (e: MouseEvent) => { if (!node.contains(e.target as Node)) menu = false; };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') menu = false; };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return {
      destroy() {
        window.removeEventListener('mousedown', onDown);
        window.removeEventListener('keydown', onKey);
      },
    };
  }

  function focus(node: HTMLTextAreaElement) {
    node.focus();
  }
</script>

<div class="head" use:popover>
  <button class="card" onclick={onSelect}>
    <div class="meta">
      <b>{c.author || author}</b>
      <span>{when(c.date)}</span>
    </div>
  </button>
  <button
    class="more"
    aria-label={t().comments.more}
    title={t().comments.more}
    aria-expanded={menu}
    onclick={() => (menu = !menu)}
  >⋯</button>
</div>
{#if menu}
  <!-- In the flow, not floating: the balloon clips what leaves it, and a menu of three
       rows fits under the head in either view. -->
  <div class="menu">
    <button onclick={startEdit}>{t().comments.edit}</button>
    <button onclick={() => { menu = false; editor?.chain().focus().updateComment(c.id, { resolved: !c.resolved }).run(); }}>
      {c.resolved ? t().comments.reopen : t().comments.resolve}
    </button>
    <button onclick={() => { menu = false; editor?.chain().focus().removeComment(c.id).run(); }}>{t().common.remove}</button>
  </div>
{/if}
<button class="card" onclick={onSelect}>
  <div class="quote">{c.quote}</div>
</button>
{#if editing}
  <textarea
    rows="3"
    use:focus
    bind:value={draft}
    onkeydown={(e) => { if (e.key === 'Escape') editing = false; }}
  ></textarea>
  <div class="actions">
    <button onclick={() => (editing = false)}>{t().common.cancel}</button>
    <button class="primary" onclick={commit}>{t().common.ok}</button>
  </div>
{:else}
  <p class="body">{c.text}</p>
{/if}

{#each c.replies as r, i (i)}
  <div class="reply">
    <div class="meta"><b>{r.author || author}</b><span>{when(r.date)}</span></div>
    <p class="body">{r.text}</p>
  </div>
{/each}

{#if replying}
  <textarea
    rows="2"
    use:focus
    bind:value={reply}
    placeholder={t().comments.reply}
    onkeydown={(e) => { if (e.key === 'Escape') replying = false; }}
  ></textarea>
  <div class="actions">
    <button onclick={() => { replying = false; reply = ''; }}>{t().common.cancel}</button>
    <button class="primary" onclick={sendReply}>{t().comments.reply}</button>
  </div>
{:else if !editing}
  <div class="actions">
    <button onclick={() => (replying = true)}>{t().comments.reply}</button>
  </div>
{/if}

<style>
  .head { display: flex; align-items: flex-start; gap: 4px; }
  .head .card { flex: 1; min-width: 0; }

  .card {
    display: block;
    width: 100%;
    border: none;
    background: none;
    color: inherit;
    padding: 0;
    text-align: left;
    font: inherit;
    cursor: pointer;
  }

  .meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; color: var(--color-text-muted); }
  .meta b { color: var(--color-text); }

  .more {
    flex: none;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--color-text-muted);
    padding: 0 4px;
    font: inherit;
    line-height: 1.2;
    cursor: pointer;
  }
  .more:hover { background: var(--color-btn-hover); color: var(--color-text); }

  .menu { display: flex; flex-direction: column; align-items: stretch; margin: 2px 0; }
  .menu button {
    border: none;
    border-radius: var(--radius);
    background: none;
    color: var(--color-text);
    padding: 3px 6px;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .menu button:hover { background: var(--color-btn-hover); }

  .quote {
    margin: 3px 0;
    padding-left: 6px;
    border-left: 2px solid rgba(200, 140, 0, 0.7);
    color: var(--color-text-muted);
    /* Two lines of the annotated text is enough to recognise it. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .body { margin: 4px 0; white-space: pre-wrap; }

  /* An answer is indented under the comment it belongs to, as in a threaded pane. */
  .reply {
    margin-top: 4px;
    padding-left: 6px;
    border-left: 1px solid var(--color-border);
  }

  textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 4px 6px;
    font: inherit;
    resize: vertical;
  }

  /* Wraps: the balloon is as wide as it is and a locale's labels are as long as they
     are — an unwrapped row would push its first button out of the card. */
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
  .actions button:hover { background: var(--color-btn-hover); color: var(--color-text); }
  .actions .primary { border-color: var(--color-primary); background: var(--color-primary); color: #fff; }
</style>
