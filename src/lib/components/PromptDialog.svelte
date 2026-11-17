<script lang="ts" module>
  // window.prompt() as a modal: Electron does not implement prompt(), so every text the
  // app asks for goes through askText(). Resolves to null on cancel, as prompt() does.
  let request = $state<{ label: string; value: string; hint: string; done: (text: string | null) => void } | null>(null);

  export function askText(label: string, value = '', hint = ''): Promise<string | null> {
    request?.done(null);
    return new Promise((done) => (request = { label, value, hint, done }));
  }
</script>

<script lang="ts">
  import { t } from '../i18n/i18n.svelte';

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let shown: typeof request = null;

  function show(el: HTMLDialogElement) {
    shown = request;
    if (!el.open) el.showModal();
    queueMicrotask(() => inputEl?.select());
  }

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (request && !el.open) show(el);
    else if (!request && el.open) el.close();
  });

  // A close event arrives a task late: an Escape just before the next askText() must not
  // cancel that newer request, so a dialog shown again ignores it and a newer one reopens.
  function onClose() {
    if (dialogEl?.open) return;
    if (request && request !== shown) show(dialogEl!);
    else finish(null);
  }

  function finish(text: string | null) {
    const r = request;
    request = null;
    r?.done(text);
  }
</script>

<dialog
  bind:this={dialogEl}
  onclose={onClose}
  onclick={(e) => e.target === dialogEl && finish(null)}
  aria-label={request?.label}
>
  {#if request}
    <div class="body">
      <label>
        <span>{request.label}</span>
        <input bind:this={inputEl} bind:value={request.value} onkeydown={(e) => e.key === 'Enter' && finish(request!.value)} />
      </label>
      {#if request.hint}<p>{request.hint}</p>{/if}
      <div class="actions">
        <button onclick={() => finish(null)}>{t().common.cancel}</button>
        <button class="primary" onclick={() => finish(request!.value)}>{t().common.ok}</button>
      </div>
    </div>
  {/if}
</dialog>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 360px;
    padding: 18px 20px 16px;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }

  label { display: flex; flex-direction: column; gap: 6px; }

  p { margin: 0; color: var(--color-text-muted); }

  input {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 4px 6px;
    font: inherit;
  }

  .actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }

  .actions button {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 5px 14px;
    font: inherit;
    cursor: pointer;
  }
  .actions button:hover { background: var(--color-btn-hover); }
  .actions .primary {
    border-color: var(--color-primary);
    background: var(--color-primary);
    color: #fff;
  }
</style>
