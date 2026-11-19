<script lang="ts">
  import { listDocuments, openDocument, deleteDocument, type BrowserDocument } from '../storage/docScope';
  import { t } from '../i18n/i18n.svelte';
  import { formatMoment } from '../storage/dateFormat.svelte';

  // The documents this browser autosaves, one per tab slot (`storage/docScope.ts`).
  // Opening one reloads this tab onto it; the open one and those other tabs hold stay.
  let { open = $bindable(false) }: { open?: boolean } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let docs = $state<BrowserDocument[]>([]);

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) { void listDocuments().then((d) => (docs = d)); el.showModal(); }
    else if (!open && el.open) el.close();
  });


  function busyHint(d: BrowserDocument): string | undefined {
    if (d.mine) return t().browserDocs.alreadyHere;
    return d.held ? t().browserDocs.alreadyElsewhere : undefined;
  }

  async function remove(id: string) {
    if (!confirm(t().browserDocs.confirmDelete)) return;
    await deleteDocument(id);
    docs = await listDocuments();
  }
</script>

<dialog
  bind:this={dialogEl}
  onclose={() => !dialogEl?.open && (open = false)}
  onclick={(e) => e.target === dialogEl && (open = false)}
  aria-label={t().browserDocs.title}
>
  <div class="body">
    <h2>{t().browserDocs.title}</h2>
    <p class="intro">{t().browserDocs.intro}</p>

    <ul>
      {#each docs as d (d.id)}
        <li>
          <div class="info">
            <span class="label doc-quote" dir="auto">{d.label || t().app.untitled}</span>
            <span class="meta">
              {formatMoment(d.at)}{#if d.mine}{' · '}{t().browserDocs.thisTab}{:else if d.held}{' · '}{t().browserDocs.otherTab}{/if}
            </span>
          </div>
          <button onclick={() => openDocument(d.id)} disabled={d.mine || d.held} title={busyHint(d)}>{t().browserDocs.open}</button>
          <button onclick={() => remove(d.id)} disabled={d.mine || d.held} title={busyHint(d)}>{t().browserDocs.delete}</button>
        </li>
      {/each}
    </ul>

    <div class="actions">
      <button onclick={() => (open = false)}>{t().common.close}</button>
    </div>
  </div>
</dialog>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(520px, calc(100vw - 32px));
    max-height: 80vh;
    overflow-y: auto;
    padding: 18px 20px 16px;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }

  h2 { font-size: 1rem; }
  .intro { color: var(--color-text-muted); }

  ul { list-style: none; display: flex; flex-direction: column; }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-top: 1px solid var(--color-border);
  }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { color: var(--color-text-muted); font-size: 0.78rem; }

  .actions { display: flex; justify-content: flex-end; padding-top: 4px; }

  button {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 4px 12px;
    font: inherit;
    cursor: pointer;
  }
  button:hover:not(:disabled) { background: var(--color-btn-hover); }
  button:disabled { opacity: 0.45; cursor: default; }
</style>
