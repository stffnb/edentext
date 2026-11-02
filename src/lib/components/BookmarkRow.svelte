<script lang="ts">
  import { t } from '../i18n/i18n.svelte';
  // One bookmark in a list — the bookmark window's and the navigator's: its name jumps to
  // it, and rename and delete show on the row under the pointer.
  let { name, onGoTo, onRemove, onRename }: {
    name: string;
    onGoTo: () => void;
    onRemove: () => void;
    /** False where the document refuses the name (taken, or nothing left once sanitized). */
    onRename: (to: string) => boolean;
  } = $props();

  let editing = $state(false);
  let draft = $state('');
  let refused = $state(false);
  let input = $state<HTMLInputElement | null>(null);

  function startRename() {
    draft = name;
    refused = false;
    editing = true;
    queueMicrotask(() => { input?.focus(); input?.select(); });
  }

  function commit() {
    if (!draft.trim() || draft === name) { editing = false; return; }
    if (onRename(draft)) editing = false;
    else refused = true;
  }

  function onKeydown(e: KeyboardEvent) {
    // Kept from the window around it: Enter would add a bookmark, Escape close the window.
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); editing = false; }
  }
</script>

<div class="bm-row">
  {#if editing}
    <input
      bind:this={input}
      bind:value={draft}
      class="bm-edit"
      type="text"
      spellcheck="false"
      autocomplete="off"
      aria-label={t().bookmark.rename}
      aria-invalid={refused}
      title={refused ? t().bookmark.nameTaken : undefined}
      oninput={() => (refused = false)}
      onkeydown={onKeydown}
      onblur={() => (editing = false)}
    />
  {:else}
    <button class="bm-name" onclick={onGoTo} title={t().bookmark.goTo}>{name}</button>
    <button class="bm-op" onclick={startRename} aria-label={`${t().bookmark.rename} ${name}`} title={t().bookmark.rename}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 10l.6-2.4L8.2 2a1 1 0 0 1 1.4 0l.4.4a1 1 0 0 1 0 1.4L4.4 9.4 2 10z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>
    </button>
    <button class="bm-op bm-drop" onclick={onRemove} aria-label={`${t().common.remove} ${name}`} title={t().common.remove}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
    </button>
  {/if}
</div>

<style>
  .bm-row { display: flex; align-items: center; }
  .bm-row:hover { background: var(--color-hover, rgba(0, 0, 0, 0.06)); }

  .bm-name {
    flex: 1;
    min-width: 0;
    padding: 0.3rem 0.5rem;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-size: 0.8rem;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }

  .bm-edit {
    flex: 1;
    min-width: 0;
    margin: 0.1rem 0.2rem;
    padding: 0.2rem 0.3rem;
    border: 1px solid var(--color-accent, #1a56db);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.8rem;
  }
  .bm-edit[aria-invalid='true'] { border-color: #c0392b; }

  .bm-op {
    display: flex;
    padding: 0.25rem 0.4rem;
    border: none;
    background: transparent;
    color: var(--color-text);
    opacity: 0;
    cursor: pointer;
  }

  /* The buttons only show on the row under the pointer, so a long list reads as names
     rather than as columns of icons; the keyboard still reaches every one. */
  .bm-row:hover .bm-op, .bm-op:focus-visible { opacity: 0.75; }
  .bm-op:hover { opacity: 1; }
  .bm-drop:hover { color: #c0392b; }
</style>
