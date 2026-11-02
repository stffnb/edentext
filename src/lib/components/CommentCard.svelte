<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import type { CommentRange } from '../editor/extensions/comment';
  import { t } from '../i18n/i18n.svelte';
  import { formatMoment } from '../storage/dateFormat.svelte';
  import { aiAnswering, aiEnabled, AI_COMMENT_EVENT } from '../storage/ai.svelte';
  import { mentionsAi } from '../ai/tools';
  import Icon from './ribbon/Icon.svelte';
  import { ensureUserName } from './reviewItems';
  import { authorColor } from '../editor/authorColors';
  import { autosize, isSubmitKey } from '../utils/autosize';

  // One comment thread as both reviewing views show it: its quote, text, answers and a reply
  // box, with resolve, edit and remove in the head. Shared by the pane and the balloon; its
  // commands return focus to the text without scrolling there, as the reader is at the card.
  let { editor, c, author, colors, onSelect, compact = false }: {
    editor: Editor | null;
    c: CommentRange;
    author: string;
    /** Author → colour (`authorColors`): each name, the comment's and its answers', in its own. */
    colors: Map<string, string>;
    onSelect: () => void;
    /** A balloon not in use: its text cut to a few lines, its answers counted. */
    compact?: boolean;
  } = $props();

  let editing = $state(false);
  let draft = $state('');
  let replying = $state(false);
  let reply = $state('');
  // Anything being done in the card shows all of it; a resolved one not in use only its
  // head and first line, as both word processors fold a handled comment.
  let full = $derived(!compact || editing || replying);
  let folded = $derived(!full && c.resolved);

  function toggleEdit() {
    draft = c.text;
    editing = !editing;
  }

  function commit() {
    editor?.chain().focus(null, { scrollIntoView: false }).updateComment(c.id, { text: draft.trim() }).run();
    editing = false;
  }

  function sendReply() {
    if (!reply.trim()) return;
    editor?.chain().focus(null, { scrollIntoView: false }).replyToComment(c.id, { author, text: reply }).run();
    if (aiEnabled() && mentionsAi(reply)) window.dispatchEvent(new CustomEvent(AI_COMMENT_EVENT, { detail: { id: c.id } }));
    reply = '';
    replying = false;
  }

  // The stored ISO date, in the reader's locale — an imported file may carry any format.

  function focus(node: HTMLTextAreaElement) {
    node.focus();
  }
</script>

<div class="head">
  <button class="card" onclick={onSelect}>
    <div class="meta">
      <b style:color={authorColor(colors, c.author)}>{c.author || t().revisions.unknownAuthor}</b>
      <span>{formatMoment(c.date)}</span>
    </div>
  </button>
  <button
    class="tool"
    class:on={c.resolved}
    aria-label={c.resolved ? t().comments.reopen : t().comments.resolve}
    title={c.resolved ? t().comments.reopen : t().comments.resolve}
    aria-pressed={c.resolved}
    onclick={() => editor?.chain().focus(null, { scrollIntoView: false }).updateComment(c.id, { resolved: !c.resolved }).run()}
  >✓</button>
  <button
    class="tool edit"
    class:on={editing}
    aria-label={t().comments.edit}
    title={t().comments.edit}
    aria-pressed={editing}
    onclick={toggleEdit}
  ><Icon name="pencil" size={14} /></button>
  <button
    class="tool remove"
    aria-label={t().common.remove}
    title={t().common.remove}
    onclick={() => editor?.chain().focus(null, { scrollIntoView: false }).removeComment(c.id).run()}
  ><Icon name="trash" size={14} /></button>
</div>
{#if !folded}
  <button class="card" onclick={onSelect}>
    <div class="quote" style:border-color={authorColor(colors, c.author)}>{c.quote}</div>
  </button>
{/if}
{#if editing}
  <textarea
    rows="2"
    use:focus
    use:autosize={draft}
    bind:value={draft}
    onkeydown={(e) => { if (e.key === 'Escape') editing = false; else if (isSubmitKey(e)) commit(); }}
  ></textarea>
  <div class="actions">
    <button onclick={() => (editing = false)}>{t().common.cancel}</button>
    <button class="primary" onclick={commit}>{t().common.ok}</button>
  </div>
{:else if full}
  <p class="body">{c.text}</p>
{:else}
  <!-- Cut to a few lines; a click opens the card, as clicking its text does. -->
  <button class="card body clamp" class:line={folded} onclick={onSelect}>{c.text}</button>
{/if}

{#if full}
  {#each c.replies as r, i (i)}
    <div class="reply">
      <div class="meta"><b style:color={authorColor(colors, r.author)}>{r.author || t().revisions.unknownAuthor}</b><span>{formatMoment(r.date)}</span></div>
      <p class="body">{r.text}</p>
    </div>
  {/each}
{:else if c.replies.length}
  <button class="card replies" onclick={onSelect}>{t().comments.replies(c.replies.length)}</button>
{/if}

{#if aiAnswering.get(c.id) === ''}
  <div class="reply ai-working" role="status"><span class="spinner" aria-hidden="true"></span>{t().ai.answering}</div>
{:else if aiAnswering.has(c.id)}
  <div class="reply ai-error" role="alert">{aiAnswering.get(c.id)}</div>
{/if}

{#if replying}
  <textarea
    rows="1"
    use:focus
    use:autosize={reply}
    bind:value={reply}
    placeholder={t().comments.reply}
    onkeydown={(e) => { if (e.key === 'Escape') replying = false; else if (isSubmitKey(e)) sendReply(); }}
  ></textarea>
  <div class="actions">
    <button onclick={() => { replying = false; reply = ''; }}>{t().common.cancel}</button>
    <button class="primary" onclick={sendReply}>{t().comments.reply}</button>
  </div>
{:else if !editing && !folded}
  <div class="actions">
    <button onclick={async () => (replying = await ensureUserName())}>{t().comments.reply}</button>
  </div>
{/if}

<style>
  .ai-error { color: #e5534b; }
  .ai-working { display: flex; align-items: center; gap: 6px; color: var(--color-text-muted); }
  .spinner { width: 10px; height: 10px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .head { display: flex; align-items: flex-start; gap: 2px; }
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

  /* Author over date: a name of any length keeps the date on a line of its own. */
  .meta { display: flex; flex-direction: column; color: var(--color-text-muted); }
  .meta b { color: var(--color-text); }
  .reply .meta { flex-direction: row; flex-wrap: wrap; column-gap: 6px; }

  /* Always drawn in the text colour: an action the reader cannot see is not offered. */
  .tool {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: none;
    color: var(--color-text);
    padding: 0;
    font: inherit;
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
  }
  .tool:hover { background: var(--color-btn-hover); }
  .tool.on { border-color: var(--color-primary); background: var(--color-primary); color: #fff; }

  .quote {
    margin: 3px 0;
    padding-left: 6px;
    border-left: 2px solid;
    color: var(--color-text-muted);
    /* Two lines of the annotated text is enough to recognise it. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .body { margin: 4px 0; white-space: pre-wrap; }
  .body.clamp {
    display: -webkit-box;
    -webkit-line-clamp: 6;
    line-clamp: 6;
    -webkit-box-orient: vertical;
    overflow: hidden;
    /* WebKit's clamp stops short of text with line breaks in it. */
    max-height: 6lh;
  }
  .body.clamp.line { -webkit-line-clamp: 1; line-clamp: 1; max-height: 1lh; }
  /* Folded answers sit where they unfold, in the text colour so the count is not overlooked. */
  .replies { width: auto; color: var(--color-text); }
  .replies:hover { text-decoration: underline; }

  /* An answer is indented under the comment it belongs to, as in a threaded pane. */
  .replies,
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
    resize: none;
    overflow: hidden;
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
