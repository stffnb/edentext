<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import type { Revision } from '../editor/extensions/trackChanges';
  import { commentRevision, settleRevisions } from './reviewItems';
  import { t } from '../i18n/i18n.svelte';
  import { formatMoment } from '../storage/dateFormat.svelte';

  // One recorded change as both reviewing views show it: what it did, to which text, and
  // accept / reject, which return focus to the text without scrolling there. Shared by the
  // pane's row and the margin balloon.
  let { editor, r, color, onSelect }: {
    editor: Editor | null;
    r: Revision;
    color: string;
    onSelect: () => void;
  } = $props();

  const FORMAT_NAMES = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikethrough' } as const;
  const kind = $derived.by(() => {
    if (r.moved) return t().revisions.moved;
    if (r.kind !== 'formatChange') return r.kind === 'insertion' ? t().revisions.inserted : t().revisions.deleted;
    const names = (r.changed ?? []).flatMap((m) => (m in FORMAT_NAMES ? [t().toolbar[FORMAT_NAMES[m as keyof typeof FORMAT_NAMES]]] : []));
    return [t().revisions.formatted, names.join(', ')].filter(Boolean).join(': ');
  });

  const ZONE_NAMES = { header: 'headerLabel', footer: 'footerLabel', headerFirst: 'firstPageHeader', footerFirst: 'firstPageFooter', headerEven: 'evenPageHeader', footerEven: 'evenPageFooter' } as const;
  const place = $derived(r.zone ? t().hf[ZONE_NAMES[r.zone.split(':')[2] as keyof typeof ZONE_NAMES]] : '');

  let editing = $state(false);

  function finish(input: HTMLTextAreaElement, keep: boolean) {
    const text = input.value.trim();
    editing = false;
    if (keep && editor && text !== (r.comment ?? '')) commentRevision(editor, r, text);
  }

  // Enter ends the edit by blurring, as a click elsewhere does; Escape drops it.
  function onNoteKey(e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) {
    if (e.key === 'Escape') { e.stopPropagation(); finish(e.currentTarget, false); }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
  }

  // The stored ISO date, in the reader's locale — an imported file may carry any format.
</script>

<button class="card" onclick={onSelect}>
  <div class="meta">
    <b style:color={color}>{r.author || t().revisions.unknownAuthor}</b>
    <span>{formatMoment(r.date)}</span>
  </div>
  <div class="kind">{[place, kind].filter(Boolean).join(' · ')}</div>
  <div class="quote" class:struck={r.kind === 'deletion'} style:color={color}>{r.text.replace(/\n/g, '¶') || (r.table ? t().revisions[r.table === 'row' ? 'tableRow' : 'tableColumn'] : '¶')}</div>
</button>
{#if editing}
  <!-- svelte-ignore a11y_autofocus -->
  <textarea class="note" rows="2" aria-label={t().revisions.comment} value={r.comment ?? ''} autofocus onkeydown={onNoteKey} onblur={(e) => editing && finish(e.currentTarget, true)}></textarea>
{:else if r.comment}
  <button class="note" title={t().revisions.comment} onclick={() => (editing = true)}>{r.comment}</button>
{/if}
<div class="actions">
  {#if !editing && !r.comment}<button onclick={() => (editing = true)}>{t().revisions.comment}</button>{/if}
  <button onclick={() => editor && settleRevisions(editor, [r], true)}>{t().revisions.accept}</button>
  <button onclick={() => editor && settleRevisions(editor, [r], false)}>{t().revisions.reject}</button>
</div>

<style>
  .card {
    display: block;
    width: 100%;
    border: none;
    background: none;
    color: inherit;
    padding: 0;
    text-align: start;
    font: inherit;
    cursor: pointer;
  }

  /* Author over date, as on a comment card. */
  .meta { display: flex; flex-direction: column; color: var(--color-text-muted); }
  .kind { color: var(--color-text-muted); }

  .quote {
    margin: 3px 0;
    padding-inline-start: 6px;
    border-inline-start: 2px solid currentColor;
    /* Two lines of the changed text is enough to recognise it. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .quote.struck { text-decoration: line-through; }

  .note {
    display: block;
    box-sizing: border-box;
    width: 100%;
    margin: 3px 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: none;
    color: inherit;
    padding: 2px 4px;
    text-align: start;
    font: inherit;
    white-space: pre-wrap;
    resize: vertical;
  }
  button.note { border-color: transparent; cursor: text; }
  button.note:hover { border-color: var(--color-border); }

  /* Wraps: the balloon is 4.5cm wide and a locale's labels are as long as they are —
     an unwrapped row would push its first button out of the card. */
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
</style>
