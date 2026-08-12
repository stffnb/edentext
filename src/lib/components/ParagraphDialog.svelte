<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { uniformBlockAttr } from '../utils/selectionFormat';
  import { t } from '../i18n/i18n.svelte';

  // Word's Paragraph dialog. Indents and spacing duplicate the ribbon's fields on
  // purpose; the second tab is the only place the text-flow attrs can be set.
  let { open = $bindable(false), editor, tick, onTabs }: {
    open?: boolean;
    editor: Editor | null;
    tick: number;
    onTabs?: () => void;
  } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let pane = $state<'indents' | 'breaks'>('indents');

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });

  const ALIGNS = ['left', 'center', 'right', 'justify'] as const;

  // An unset paragraph renders left, so that's what the box shows; a selection
  // mixing two alignments still reads '' and leaves it blank.
  let align = $derived(read('textAlign', 'left'));
  let indent = $derived(read('indent', 0));
  let indentRight = $derived(read('indentRight', 0));
  let indentFirst = $derived(read('indentFirst', 0));
  let spaceBefore = $derived(read('spaceBefore', 0));
  let spaceAfter = $derived(read('spaceAfter', 0));
  let lineHeight = $derived(read('lineHeight', '1'));

  let breakBefore = $derived(read<string | null>('breakBefore', null) === 'page');
  // widowControl is on unless a paragraph turned it off; the other two are off unless set.
  let widowControl = $derived(read<boolean | null>('widowControl', null) !== false);
  let keepNext = $derived(read<boolean | null>('keepNext', null) === true);
  let keepLines = $derived(read<boolean | null>('keepLines', null) === true);

  function read<T>(attr: string, fallback: T): T | '' {
    if (tick < 0 || !editor) return fallback;
    return uniformBlockAttr<T>(editor.state, attr, fallback);
  }

  // Every block in the selection takes the value, whichever node type it is.
  function setAttr(attr: string, value: unknown) {
    if (!editor) return;
    const chain = editor.chain().focus();
    for (const type of ['paragraph', 'heading']) {
      if (editor.schema.nodes[type]) chain.updateAttributes(type, { [attr]: value });
    }
    chain.run();
  }

  function setNumber(attr: string, raw: string) {
    const v = parseFloat(raw.replace(',', '.'));
    if (!isNaN(v)) setAttr(attr, v);
  }

  const num = (v: number | '') => (v === '' ? '' : String(Math.round((v as number) * 100) / 100));

  const FLOW: { attr: string; on: () => boolean; label: () => string; set: (v: boolean) => void }[] = [
    { attr: 'widowControl', on: () => widowControl, label: () => t().paragraphDialog.widowControl, set: (v) => setAttr('widowControl', v ? null : false) },
    { attr: 'keepNext', on: () => keepNext, label: () => t().paragraphDialog.keepNext, set: (v) => setAttr('keepNext', v || null) },
    { attr: 'keepLines', on: () => keepLines, label: () => t().paragraphDialog.keepLines, set: (v) => setAttr('keepLines', v || null) },
    { attr: 'breakBefore', on: () => breakBefore, label: () => t().paragraphDialog.pageBreakBefore, set: (v) => setAttr('breakBefore', v ? 'page' : null) },
  ];
</script>

<dialog bind:this={dialogEl} onclose={() => (open = false)} onclick={(e) => e.target === dialogEl && (open = false)} aria-label={t().paragraphDialog.title}>
  <div class="body">
    <h2>{t().paragraphDialog.title}</h2>

    <div class="tabs" role="tablist">
      <button role="tab" class:active={pane === 'indents'} aria-selected={pane === 'indents'} onclick={() => (pane = 'indents')}>{t().paragraphDialog.indentsTab}</button>
      <button role="tab" class:active={pane === 'breaks'} aria-selected={pane === 'breaks'} onclick={() => (pane = 'breaks')}>{t().paragraphDialog.breaksTab}</button>
    </div>

    {#if pane === 'indents'}
      <div class="grid">
        <label class="row">
          <span>{t().align.section}</span>
          <select value={align} onchange={(e) => editor?.chain().focus().setTextAlign((e.currentTarget as HTMLSelectElement).value as never).run()}>
            {#each ALIGNS as a}<option value={a}>{t().align[a]}</option>{/each}
          </select>
        </label>

        <label class="row newline"><span>{t().ribbon.indentLeft}</span><input type="text" inputmode="decimal" value={num(indent)} onchange={(e) => setNumber('indent', (e.currentTarget as HTMLInputElement).value)} /><em>cm</em></label>
        <label class="row"><span>{t().ribbon.indentRight}</span><input type="text" inputmode="decimal" value={num(indentRight)} onchange={(e) => setNumber('indentRight', (e.currentTarget as HTMLInputElement).value)} /><em>cm</em></label>
        <label class="row"><span>{t().ruler.firstLineIndent}</span><input type="text" inputmode="decimal" value={num(indentFirst)} onchange={(e) => setNumber('indentFirst', (e.currentTarget as HTMLInputElement).value)} /><em>cm</em></label>

        <label class="row newline"><span>{t().ribbon.spaceBefore}</span><input type="text" inputmode="decimal" value={num(spaceBefore)} onchange={(e) => setNumber('spaceBefore', (e.currentTarget as HTMLInputElement).value)} /><em>pt</em></label>
        <label class="row"><span>{t().ribbon.spaceAfter}</span><input type="text" inputmode="decimal" value={num(spaceAfter)} onchange={(e) => setNumber('spaceAfter', (e.currentTarget as HTMLInputElement).value)} /><em>pt</em></label>

        <label class="row newline">
          <span>{t().toolbarExpanded.lineSpacing}</span>
          <select value={String(lineHeight)} onchange={(e) => editor?.chain().focus().setLineHeight((e.currentTarget as HTMLSelectElement).value).run()}>
            {#each ['1', '1.15', '1.5', '2'] as h}<option value={h}>{h === '1' ? t().toolbarExpanded.lineSingle : h === '2' ? t().toolbarExpanded.lineDouble : h}</option>{/each}
          </select>
        </label>
      </div>
    {:else}
      <div class="flow">
        {#each FLOW as f}
          <label class="check">
            <input type="checkbox" checked={f.on()} onchange={(e) => f.set((e.currentTarget as HTMLInputElement).checked)} />
            <span>{f.label()}</span>
          </label>
        {/each}
      </div>
      <p class="hint">{t().paragraphDialog.flowHint}</p>
    {/if}

    <div class="actions">
      <button class="secondary" onclick={() => { open = false; onTabs?.(); }}>{t().paragraphDialog.tabsButton}</button>
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
    width: 500px;
    padding: 18px 20px 16px;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }

  h2 { font-size: 1rem; }

  .tabs {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid var(--color-border);
  }

  .tabs button {
    border: none;
    background: none;
    padding: 6px 12px;
    border-bottom: 2px solid transparent;
    color: var(--color-text-muted);
    font: inherit;
    cursor: pointer;
  }

  .tabs button.active { color: var(--color-text); border-bottom-color: var(--color-primary); }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px; }

  /* Equal columns plus a fixed unit width put every field on the same edge; the
     label takes the rest and never wraps, so no row grows a second line. */
  .newline { grid-column: 1; }

  .row { display: flex; align-items: center; gap: 8px; }
  .row > span { flex: 1; white-space: nowrap; color: var(--color-text-muted); }
  .row em { width: 1.5em; font-style: normal; color: var(--color-text-muted); }

  .row input, .row select {
    width: 76px;
    height: 26px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 0 6px;
    font: inherit;
  }

  /* No unit of its own, so it reaches across the field and unit columns. */
  .row select { width: calc(84px + 1.5em); }
  .row input { text-align: right; }

  .flow { display: flex; flex-direction: column; gap: 8px; }
  .check { display: flex; align-items: center; gap: 8px; cursor: pointer; }

  .hint { color: var(--color-text-muted); font-size: 0.78rem; }

  .actions { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
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
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: #fff;
  }
</style>
