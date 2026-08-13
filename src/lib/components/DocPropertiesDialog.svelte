<script lang="ts">
  import { EMPTY_DOC_PROPERTIES, type DocProperties } from '../storage/docProperties';
  import { t } from '../i18n/i18n.svelte';

  // LibreOffice's File ▸ Properties ▸ Description, Word's File ▸ Info. The values
  // travel as ODF meta.xml and DOCX docProps/core.xml.
  let { open = $bindable(false), props, onApply }: {
    open?: boolean;
    props: DocProperties;
    onApply: (next: DocProperties) => void;
  } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let draft = $state<DocProperties>({ ...EMPTY_DOC_PROPERTIES });

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) { draft = { ...props }; el.showModal(); }
    else if (!open && el.open) el.close();
  });

  const FIELDS = [
    { key: 'title', label: () => t().docProps.docTitle },
    { key: 'subject', label: () => t().docProps.subject },
    { key: 'author', label: () => t().docProps.author },
    { key: 'keywords', label: () => t().docProps.keywords, hint: () => t().docProps.keywordsHint },
  ] as const;

  function apply() {
    onApply({ ...draft });
    open = false;
  }
</script>

<dialog
  bind:this={dialogEl}
  onclose={() => (open = false)}
  onclick={(e) => e.target === dialogEl && (open = false)}
  aria-label={t().docProps.title}
>
  <div class="body">
    <h2>{t().docProps.title}</h2>

    {#each FIELDS as f}
      <label class="row">
        <span>{f.label()}</span>
        <input value={draft[f.key]} placeholder={'hint' in f ? f.hint() : ''} oninput={(e) => (draft[f.key] = e.currentTarget.value)} />
      </label>
    {/each}

    <label class="row area">
      <span>{t().docProps.description}</span>
      <textarea rows="3" value={draft.description} oninput={(e) => (draft.description = e.currentTarget.value)}></textarea>
    </label>

    <div class="actions">
      <button class="reset" onclick={() => (draft = { ...EMPTY_DOC_PROPERTIES })}>{t().docProps.clear}</button>
      <span class="spacer"></span>
      <button onclick={() => (open = false)}>{t().common.cancel}</button>
      <button class="primary" onclick={apply}>{t().common.ok}</button>
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
    width: 460px;
    max-height: 80vh;
    overflow-y: auto;
    padding: 18px 20px 16px;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }

  h2 { font-size: 1rem; }

  .row { display: flex; align-items: center; gap: 8px; }
  .row > span { width: 110px; color: var(--color-text-muted); }
  .row.area { align-items: flex-start; }
  .row.area > span { padding-top: 5px; }

  input, textarea {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 0 6px;
    font: inherit;
  }
  input { height: 26px; }
  textarea { padding: 4px 6px; resize: vertical; }

  .actions { display: flex; align-items: center; gap: 8px; padding-top: 4px; }
  .spacer { flex: 1; }

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
  .actions .reset { color: var(--color-text-muted); }
</style>
