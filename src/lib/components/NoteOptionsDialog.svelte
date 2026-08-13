<script lang="ts">
  import {
    DEFAULT_NOTE_SETTINGS, type NoteKind, type NoteNumFormat, type NoteRestart, type NoteSettings,
  } from '../storage/noteSettings';
  import { noteSettings, setNoteSettings } from '../storage/notes.svelte';
  import { styleSheet } from '../styles/sheet.svelte';
  import { formatOrdinal } from '../utils/orderedListTypes';
  import { t } from '../i18n/i18n.svelte';

  // LibreOffice's Tools ▸ Footnotes and Endnotes. Everything here round-trips to ODF's
  // text:notes-configuration + style:footnote-sep and to Word's w:footnotePr.
  let { open = $bindable(false) }: { open?: boolean } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let kind = $state<NoteKind>('footnote');

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });

  const FORMATS: NoteNumFormat[] = ['1', 'i', 'I', 'a', 'A'];
  const RESTARTS: NoteRestart[] = ['document', 'page', 'chapter'];
  const ALIGNS = ['left', 'center', 'right'] as const;

  const cls = $derived(noteSettings()[kind]);
  const sep = $derived(noteSettings().separator);
  // Three running values, so a format reads as a sequence rather than a letter.
  const preview = (f: NoteNumFormat) => [0, 1, 2].map((i) => formatOrdinal(i + 1, f)).join(', ');

  function patch(next: Partial<NoteSettings[NoteKind]>) {
    const s = noteSettings();
    setNoteSettings({ ...s, [kind]: { ...s[kind], ...next } });
  }

  function patchSep(next: Partial<NoteSettings['separator']>) {
    const s = noteSettings();
    setNoteSettings({ ...s, separator: { ...s.separator, ...next } });
  }

  const num = (e: Event) => parseFloat((e.currentTarget as HTMLInputElement).value.replace(',', '.'));
</script>

<dialog
  bind:this={dialogEl}
  onclose={() => (open = false)}
  onclick={(e) => e.target === dialogEl && (open = false)}
  aria-label={t().notesDialog.title}
>
  <div class="body">
    <h2>{t().notesDialog.title}</h2>

    <div class="tabs" role="tablist">
      {#each ['footnote', 'endnote'] as const as k}
        <button
          role="tab"
          aria-selected={kind === k}
          class:selected={kind === k}
          onclick={() => (kind = k)}
        >{k === 'footnote' ? t().notesDialog.tabFootnotes : t().notesDialog.tabEndnotes}</button>
      {/each}
    </div>

    <fieldset>
      <legend>{t().notesDialog.numbering}</legend>
      <label class="row">
        <span>{t().notesDialog.format}</span>
        <select value={cls.numFormat} onchange={(e) => patch({ numFormat: e.currentTarget.value as NoteNumFormat })}>
          {#each FORMATS as f}<option value={f}>{preview(f)}</option>{/each}
        </select>
      </label>
      <label class="row">
        <span>{t().notesDialog.startAt}</span>
        <input type="number" min="1" max="9999" value={cls.startAt}
          onchange={(e) => { const v = num(e); if (v >= 1) patch({ startAt: Math.round(v) }); }} />
      </label>
      <label class="row">
        <span>{t().notesDialog.restart}</span>
        <select value={cls.restart} onchange={(e) => patch({ restart: e.currentTarget.value as NoteRestart })}>
          {#each RESTARTS as r}
            <option value={r}>{r === 'page' ? t().notesDialog.restartPage : r === 'chapter' ? t().notesDialog.restartChapter : t().notesDialog.restartDocument}</option>
          {/each}
        </select>
      </label>
      {#if kind === 'footnote'}
        <label class="row">
          <span>{t().notesDialog.position}</span>
          <select value={cls.position} onchange={(e) => patch({ position: e.currentTarget.value === 'document' ? 'document' : 'page' })}>
            <option value="page">{t().notesDialog.positionPage}</option>
            <option value="document">{t().notesDialog.positionDocument}</option>
          </select>
        </label>
      {/if}
      <div class="row">
        <span>{t().notesDialog.affix}</span>
        <input class="affix" value={cls.prefix} placeholder={t().notesDialog.prefix}
          onchange={(e) => patch({ prefix: e.currentTarget.value })} />
        <input class="affix" value={cls.suffix} placeholder={t().notesDialog.suffix}
          onchange={(e) => patch({ suffix: e.currentTarget.value })} />
      </div>
    </fieldset>

    <fieldset>
      <legend>{t().notesDialog.styles}</legend>
      <label class="row">
        <span>{t().notesDialog.bodyStyle}</span>
        <select value={cls.bodyStyle} onchange={(e) => patch({ bodyStyle: e.currentTarget.value })}>
          {#each Object.keys(styleSheet().paragraph) as name}<option value={name}>{name}</option>{/each}
          {#if !styleSheet().paragraph[cls.bodyStyle]}<option value={cls.bodyStyle}>{cls.bodyStyle}</option>{/if}
        </select>
      </label>
      <label class="row">
        <span>{t().notesDialog.citationStyle}</span>
        <select value={cls.citationStyle} onchange={(e) => patch({ citationStyle: e.currentTarget.value })}>
          {#each Object.keys(styleSheet().character) as name}<option value={name}>{name}</option>{/each}
          {#if !styleSheet().character[cls.citationStyle]}<option value={cls.citationStyle}>{cls.citationStyle}</option>{/if}
        </select>
      </label>
    </fieldset>

    <!-- The separator is a footnote-only thing: the endnote list opens its own page. -->
    {#if kind === 'footnote'}
      <fieldset>
        <legend>{t().notesDialog.separator}</legend>
        <label class="row">
          <span>{t().notesDialog.sepWidth}</span>
          <input type="number" min="0" max="100" step="1" value={sep.relWidthPercent}
            onchange={(e) => { const v = num(e); if (v >= 0 && v <= 100) patchSep({ relWidthPercent: v }); }} />
        </label>
        <label class="row">
          <span>{t().notesDialog.sepWeight}</span>
          <input type="number" min="0" max="20" step="0.25" value={sep.weightPt}
            onchange={(e) => { const v = num(e); if (v >= 0) patchSep({ weightPt: v }); }} />
        </label>
        <label class="row">
          <span>{t().notesDialog.sepAbove}</span>
          <input type="number" min="0" max="5" step="0.05" value={sep.spaceAboveCm}
            onchange={(e) => { const v = num(e); if (v >= 0) patchSep({ spaceAboveCm: v }); }} />
        </label>
        <label class="row">
          <span>{t().notesDialog.sepBelow}</span>
          <input type="number" min="0" max="5" step="0.05" value={sep.spaceBelowCm}
            onchange={(e) => { const v = num(e); if (v >= 0) patchSep({ spaceBelowCm: v }); }} />
        </label>
        <label class="row">
          <span>{t().notesDialog.sepAlign}</span>
          <select value={sep.align} onchange={(e) => patchSep({ align: e.currentTarget.value as 'left' })}>
            {#each ALIGNS as a}<option value={a}>{t().align[a]}</option>{/each}
          </select>
        </label>
        <label class="row">
          <span>{t().notesDialog.sepColor}</span>
          <input type="color" value={sep.color} onchange={(e) => patchSep({ color: e.currentTarget.value })} />
        </label>
      </fieldset>
    {/if}

    <div class="actions">
      <button class="reset" onclick={() => setNoteSettings(DEFAULT_NOTE_SETTINGS)}>{t().notesDialog.reset}</button>
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
    gap: 12px;
    width: 460px;
    max-height: 80vh;
    overflow-y: auto;
    padding: 18px 20px 16px;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }

  h2 { font-size: 1rem; }

  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--color-border); }
  .tabs button {
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--color-text-muted);
    padding: 6px 12px;
    font: inherit;
    cursor: pointer;
  }
  .tabs button.selected { border-bottom-color: var(--color-primary); color: var(--color-text); }

  fieldset { border: 1px solid var(--color-border); border-radius: var(--radius); padding: 8px 10px 10px; }
  legend { color: var(--color-text-muted); padding: 0 4px; }

  .row { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
  .row > span { flex: 1; color: var(--color-text-muted); }

  input, select {
    height: 26px;
    width: 150px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 0 6px;
    font: inherit;
  }
  input[type='color'] { width: 44px; padding: 2px; }
  .affix { width: 68px; }

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
