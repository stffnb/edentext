<script lang="ts">
  import {
    DEFAULT_PAGE_BORDER, DEFAULT_WATERMARK, EMPTY_PAGE_DECOR,
    type PageBorder, type PageDecor, type Watermark,
  } from '../storage/pageDecor';
  import { t } from '../i18n/i18n.svelte';

  // LibreOffice's Format ▸ Page Style ▸ Area and Borders plus its Format ▸ Watermark,
  // in one panel — all three decorate the page and all three ride the page layout.
  let { open = $bindable(false), decor = $bindable(EMPTY_PAGE_DECOR) }: {
    open?: boolean;
    decor?: PageDecor;
  } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });

  const num = (e: Event) => parseFloat((e.currentTarget as HTMLInputElement).value.replace(',', '.'));

  function patchBorder(next: Partial<PageBorder>) {
    decor = { ...decor, border: { ...(decor.border ?? DEFAULT_PAGE_BORDER), ...next } };
  }

  function patchWatermark(next: Partial<Watermark>) {
    decor = { ...decor, watermark: { ...(decor.watermark ?? DEFAULT_WATERMARK), ...next } };
  }
</script>

<dialog
  bind:this={dialogEl}
  onclose={() => (open = false)}
  onclick={(e) => e.target === dialogEl && (open = false)}
  aria-label={t().pageDecor.title}
>
  <div class="body">
    <h2>{t().pageDecor.title}</h2>

    <fieldset>
      <legend>{t().pageDecor.background}</legend>
      <label class="row">
        <input
          type="checkbox"
          checked={!!decor.background}
          onchange={(e) => (decor = { ...decor, background: e.currentTarget.checked ? (decor.background ?? '#ffffcc') : null })}
        />
        <span>{t().pageDecor.useBackground}</span>
        <input
          type="color"
          value={decor.background ?? '#ffffcc'}
          onchange={(e) => (decor = { ...decor, background: e.currentTarget.value })}
        />
      </label>
    </fieldset>

    <fieldset>
      <legend>{t().pageDecor.border}</legend>
      <label class="row">
        <input
          type="checkbox"
          checked={!!decor.border}
          onchange={(e) => (decor = { ...decor, border: e.currentTarget.checked ? (decor.border ?? DEFAULT_PAGE_BORDER) : null })}
        />
        <span>{t().pageDecor.useBorder}</span>
        <input type="color" value={decor.border?.color ?? DEFAULT_PAGE_BORDER.color} onchange={(e) => patchBorder({ color: e.currentTarget.value })} />
      </label>
      <label class="row">
        <span class="grow">{t().pageDecor.borderWidth}</span>
        <input type="number" min="0.25" max="20" step="0.25" disabled={!decor.border}
          value={decor.border?.widthPt ?? DEFAULT_PAGE_BORDER.widthPt} onchange={(e) => patchBorder({ widthPt: num(e) })} />
      </label>
      <label class="row">
        <span class="grow">{t().pageDecor.borderPadding}</span>
        <input type="number" min="0" max="5" step="0.05" disabled={!decor.border}
          value={decor.border?.paddingCm ?? DEFAULT_PAGE_BORDER.paddingCm} onchange={(e) => patchBorder({ paddingCm: num(e) })} />
      </label>
    </fieldset>

    <fieldset>
      <legend>{t().pageDecor.watermark}</legend>
      <label class="row">
        <span class="grow">{t().pageDecor.watermarkText}</span>
        <input
          type="text"
          value={decor.watermark?.text ?? ''}
          placeholder={t().pageDecor.watermarkHint}
          oninput={(e) => {
            const text = e.currentTarget.value;
            decor = text ? { ...decor, watermark: { ...(decor.watermark ?? DEFAULT_WATERMARK), text } } : { ...decor, watermark: null };
          }}
        />
      </label>
      <label class="row">
        <span class="grow">{t().pageDecor.watermarkColor}</span>
        <input type="color" value={decor.watermark?.color ?? DEFAULT_WATERMARK.color} disabled={!decor.watermark}
          onchange={(e) => patchWatermark({ color: e.currentTarget.value })} />
      </label>
      <label class="row">
        <span class="grow">{t().pageDecor.watermarkAngle}</span>
        <input type="number" min="-180" max="180" step="5" disabled={!decor.watermark}
          value={decor.watermark?.angle ?? DEFAULT_WATERMARK.angle} onchange={(e) => patchWatermark({ angle: num(e) })} />
      </label>
      <label class="row">
        <span class="grow">{t().pageDecor.watermarkTransparency}</span>
        <input type="number" min="0" max="100" step="5" disabled={!decor.watermark}
          value={decor.watermark?.transparency ?? DEFAULT_WATERMARK.transparency} onchange={(e) => patchWatermark({ transparency: num(e) })} />
      </label>
    </fieldset>

    <div class="actions">
      <button class="reset" onclick={() => (decor = { ...EMPTY_PAGE_DECOR })}>{t().pageDecor.clear}</button>
      <span class="spacer"></span>
      <button class="primary" onclick={() => (open = false)}>{t().common.close}</button>
    </div>
  </div>
</dialog>

<style>
  dialog {
    /* The global reset zeroes every margin, which also takes the auto centring a
       modal <dialog> gets by default. */
    margin: auto;
    border: none;
    border-radius: 8px;
    padding: 0;
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }

  dialog::backdrop { background: rgba(0, 0, 0, 0.35); }

  .body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 380px;
    padding: 18px 20px 16px;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }

  h2 { font-size: 1rem; }

  fieldset { border: 1px solid var(--color-border); border-radius: var(--radius); padding: 8px 10px 10px; }
  legend { color: var(--color-text-muted); padding: 0 4px; }

  .row { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
  .row .grow { flex: 1; color: var(--color-text-muted); }
  .row span { color: var(--color-text-muted); }

  input[type='text'], input[type='number'] {
    height: 26px;
    width: 130px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 0 6px;
    font: inherit;
  }
  input[type='color'] { width: 44px; height: 26px; padding: 2px; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-surface); }
  input:disabled { opacity: 0.5; }

  .actions { display: flex; align-items: center; gap: 8px; }
  .spacer { flex: 1; }

  .actions button {
    border: 1px solid var(--color-primary);
    border-radius: var(--radius);
    background: var(--color-primary);
    color: #fff;
    padding: 5px 14px;
    font: inherit;
    cursor: pointer;
  }
  .actions .reset {
    border-color: var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-muted);
  }
  .actions .reset:hover { background: var(--color-btn-hover); }
</style>
