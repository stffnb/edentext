<script lang="ts">
  import { listDocuments, openDocument, type BrowserDocument } from '../storage/docScope';
  import { t } from '../i18n/i18n.svelte';

  // A fresh tab starts on an empty page; while it stays empty this card offers the
  // documents used last, as a word processor's start screen lists its recent files.
  let { show, onShowAll }: { show: boolean; onShowAll: () => void } = $props();

  const RECENT = 3;
  let docs = $state<BrowserDocument[]>([]);
  void listDocuments().then((all) => (docs = all.filter((d) => !d.mine && !d.held)));
  let dismissed = $state(false);
</script>

{#if show && !dismissed && docs.length}
  <aside class="resume" aria-label={t().browserDocs.resume}>
    <div class="head">
      <span>{t().browserDocs.resume}</span>
      <button class="close" onclick={() => (dismissed = true)} aria-label={t().common.close} title={t().common.close}>×</button>
    </div>
    <div class="list">
      {#each docs.slice(0, RECENT) as d (d.id)}
        <button class="doc" onclick={() => openDocument(d.id)}>{d.label || t().app.untitled}</button>
      {/each}
      <button class="all" onclick={onShowAll}>{t().browserDocs.showAll}</button>
    </div>
  </aside>
{/if}

<style>
  /* The ribbon menus' surface, border and shadow: the card floats over a white page. */
  .resume {
    position: fixed;
    inset-inline-end: 16px;
    bottom: 40px;
    z-index: 50;
    width: min(300px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--w-border-strong);
    border-radius: 8px;
    background: var(--w-surface);
    color: var(--w-text);
    box-shadow: var(--w-menu-shadow);
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }
  .list { display: flex; flex-direction: column; padding: 6px; }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-block: 7px;
    padding-inline: 12px 8px;
    border-bottom: 1px solid var(--w-border);
    background: var(--w-accent-soft);
    font-weight: 600;
  }

  button {
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .close { font-size: 1.1rem; line-height: 1; padding: 0 4px; }
  .doc {
    padding: 5px 6px;
    border-radius: var(--radius);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .doc:hover, .all:hover, .close:hover { background: var(--w-hover); }
  .close { color: var(--w-text-dim); }
  .all { padding: 5px 6px; border-radius: var(--radius); color: var(--w-accent); }
</style>
