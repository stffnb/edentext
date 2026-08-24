<script lang="ts">
  import { t } from '../i18n/i18n.svelte';
  import { TEMPLATES } from '../templates/registry';
  import type { TemplateEntry } from '../templates/types';

  let { open = $bindable(false), onPick }: {
    open?: boolean;
    onPick?: (entry: TemplateEntry) => void;
  } = $props();

  let dialogEl: HTMLDialogElement | null = $state(null);

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });

  function onClose() {
    open = false;
  }

  function onClick(e: MouseEvent) {
    if (e.target === dialogEl) open = false;
  }

  function pick(entry: TemplateEntry) {
    open = false;
    onPick?.(entry);
  }
</script>

<dialog class="gallery" bind:this={dialogEl} onclose={onClose} onclick={onClick} aria-label={t().templates.title}>
  <div class="card">
    <button class="close" onclick={() => (open = false)} aria-label={t().common.close} title={t().common.close}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>
    <h2>{t().templates.title}</h2>
    <div class="grid">
      {#each TEMPLATES as entry (entry.id)}
        <button class="tpl" onclick={() => pick(entry)}>
          <!-- A stylized letter page: address block, info column or date line, body lines. -->
          <span class="thumb" aria-hidden="true">
            <span class="addr"></span>
            {#if entry.id === 'din5008b'}
              <span class="info"></span>
            {:else}
              <span class="date"></span>
            {/if}
            <span class="line l1"></span>
            <span class="line l2"></span>
            <span class="line l3"></span>
            <span class="fold f1"></span>
            <span class="fold f2"></span>
          </span>
          <span class="name">{entry.name()}</span>
          <span class="desc">{entry.description()}</span>
        </button>
      {/each}
    </div>
  </div>
</dialog>

<style>
  .gallery {
    margin: auto;
    padding: 0;
    border: none;
    background: transparent;
    max-width: none;
    max-height: none;
    overflow: visible;
  }
  .gallery::backdrop {
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(2px);
  }

  .card {
    position: relative;
    width: 440px;
    max-width: 90vw;
    box-sizing: border-box;
    padding: 20px 22px 22px;
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22);
    font-family: var(--font-sans);
  }

  h2 {
    margin: 0 0 14px;
    font-size: 1rem;
  }

  .close {
    position: absolute;
    top: 8px;
    right: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
  }
  .close:hover {
    background: var(--color-btn-hover);
    color: var(--color-text);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
  }

  .tpl {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s;
  }
  .tpl:hover {
    border-color: var(--color-primary);
    background: var(--color-btn-hover);
  }

  .thumb {
    position: relative;
    width: 84px;
    height: 118px;
    align-self: center;
    background: #fff;
    border: 1px solid var(--color-border);
    border-radius: 2px;
  }
  .thumb > span {
    position: absolute;
    background: #b9c2cc;
  }
  .addr { top: 26px; left: 12px; width: 28px; height: 16px; }
  .info { top: 26px; left: 52px; width: 22px; height: 16px; }
  .date { top: 48px; right: 12px; width: 20px; height: 3px; }
  .line { left: 12px; height: 3px; }
  .l1 { top: 56px; width: 40px; background: #8a94a0; }
  .l2 { top: 66px; width: 60px; }
  .l3 { top: 73px; width: 55px; }
  .fold { left: 2px; width: 5px; height: 1px; background: #8a94a0; }
  .f1 { top: 36px; }
  .f2 { top: 80px; }

  .name {
    font-size: 0.85rem;
    font-weight: 600;
  }
  .desc {
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--color-text-muted);
  }
</style>
