<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { uniformBlockAttr } from '../utils/selectionFormat';
  import { t } from '../i18n/i18n.svelte';
  import { blockFontSize } from '../utils/fontSize';

  type Unit = 'cm' | 'chars';
  type Field = 'left' | 'right' | 'first';

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
    if (open) unitPicked = {};
  });

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
  // '' is the page's own direction (LibreOffice's "Use superordinate object settings").
  let dir = $derived(read<string | null>('dir', null) ?? '');
  let indent = $derived(read('indent', 0));
  let indentRight = $derived(read('indentRight', 0));
  let indentFirst = $derived(read('indentFirst', 0));
  let indentFirstChars = $derived(read('indentFirstChars', 0));
  let indentChars = $derived(read('indentChars', 0));
  let indentRightChars = $derived(read('indentRightChars', 0));
  // The indent fields count characters when the block does, or once picked.
  let unitPicked = $state<Partial<Record<Field, Unit>>>({});
  let units = $derived({
    left: unitPicked.left ?? (indentChars ? 'chars' : 'cm'),
    right: unitPicked.right ?? (indentRightChars ? 'chars' : 'cm'),
    first: unitPicked.first ?? (indentFirstChars ? 'chars' : 'cm'),
  } as Record<Field, Unit>);
  let values = $derived({
    left: units.left === 'chars' ? indentChars : indent,
    right: units.right === 'chars' ? indentRightChars : indentRight,
    first: units.first === 'chars' ? indentFirstChars : indentFirst,
  } as Record<Field, number | ''>);
  let spaceBefore = $derived(read('spaceBefore', 0));
  let spaceAfter = $derived(read('spaceAfter', 0));
  let lineHeight = $derived(read('lineHeight', '1'));
  // A fixed spacing is a height in pt ('28pt'), the presets are factors.
  let fixedLine = $derived(/pt$/.test(String(lineHeight)));
  const LINE_FACTORS = ['1', '1.15', '1.5', '2', '2.5', '3'];

  let breakBefore = $derived(read<string | null>('breakBefore', null) === 'page');
  // widowControl is on unless a paragraph turned it off; the other two are off unless set.
  let widowControl = $derived(read<boolean | null>('widowControl', null) !== false);
  // A heading keeps with next unless it opted out, so there the stored value is `false`.
  let inHeading = $derived(tick >= 0 && !!editor?.isActive('heading'));
  let keepNext = $derived(inHeading ? read<boolean | null>('keepNext', null) !== false : read<boolean | null>('keepNext', null) === true);
  let keepLines = $derived(read<boolean | null>('keepLines', null) === true);
  // LibreOffice's Hyphenation checkbox: on unless this paragraph opted out.
  let hyphenate = $derived(read<boolean | null>('noHyphenation', null) !== true);

  function read<T>(attr: string, fallback: T): T | '' {
    if (tick < 0 || !editor) return fallback;
    return uniformBlockAttr<T>(editor.state, attr, fallback);
  }

  // Every block in the selection takes the value, whichever node type it is.
  function setAttr(attr: string, value: unknown, headingValue = value) {
    if (!editor) return;
    const chain = editor.chain().focus();
    for (const type of ['paragraph', 'heading']) {
      if (editor.schema.nodes[type]) chain.updateAttributes(type, { [attr]: type === 'heading' ? headingValue : value });
    }
    chain.run();
  }

  function setNumber(attr: string, raw: string) {
    const v = parseFloat(raw.replace(',', '.'));
    if (!isNaN(v)) setAttr(attr, v);
  }

  // Through the commands, so a field's two units replace each other.
  function setIndentIn(field: Field, raw: string, unit: Unit) {
    const v = parseFloat(raw.replace(',', '.'));
    if (isNaN(v) || !editor) return;
    const c = editor.chain().focus();
    if (field === 'left') (unit === 'chars' ? c.setIndentChars(v) : c.setIndent(v)).run();
    else if (field === 'right') (unit === 'chars' ? c.setIndentRightChars(v) : c.setIndentRight(v)).run();
    else (unit === 'chars' ? c.setIndentFirstChars(v) : c.setIndentFirst(v)).run();
  }

  // Switching the unit converts the value at the block's size, as the ruler would show it.
  function switchUnit(field: Field, unit: Unit) {
    const current = values[field];
    unitPicked = { ...unitPicked, [field]: unit };
    if (!editor || !current) return;
    const cmPerChar = parseFloat(blockFontSize(editor.state.selection.$from.parent)) / 72 * 2.54;
    const next = unit === 'chars' ? current / cmPerChar : current * cmPerChar;
    setIndentIn(field, String(Math.round(next * 100) / 100), unit);
  }

  const num = (v: number | '') => (v === '' ? '' : String(Math.round((v as number) * 100) / 100));

  const FLOW: { attr: string; on: () => boolean; label: () => string; set: (v: boolean) => void }[] = [
    { attr: 'widowControl', on: () => widowControl, label: () => t().paragraphDialog.widowControl, set: (v) => setAttr('widowControl', v ? null : false) },
    { attr: 'keepNext', on: () => keepNext, label: () => t().paragraphDialog.keepNext, set: (v) => setAttr('keepNext', v || null, v ? null : false) },
    { attr: 'keepLines', on: () => keepLines, label: () => t().paragraphDialog.keepLines, set: (v) => setAttr('keepLines', v || null) },
    { attr: 'noHyphenation', on: () => hyphenate, label: () => t().paragraphDialog.hyphenate, set: (v) => setAttr('noHyphenation', v ? null : true) },
    { attr: 'breakBefore', on: () => breakBefore, label: () => t().paragraphDialog.pageBreakBefore, set: (v) => setAttr('breakBefore', v ? 'page' : null) },
  ];
</script>

{#snippet indentField(field: Field)}
  <input type="text" inputmode="decimal" value={num(values[field])} onchange={(e) => setIndentIn(field, (e.currentTarget as HTMLInputElement).value, units[field])} />
  <select class="unit" value={units[field]} onchange={(e) => switchUnit(field, (e.currentTarget as HTMLSelectElement).value as Unit)}>
    <option value="cm">cm</option><option value="chars">{t().paragraphDialog.chars}</option>
  </select>
{/snippet}

<dialog bind:this={dialogEl} onclose={() => !dialogEl?.open && (open = false)} onclick={(e) => e.target === dialogEl && (open = false)} aria-label={t().paragraphDialog.title}>
  <div class="body">
    <h2>{t().paragraphDialog.title}</h2>

    <div class="tabs" role="tablist">
      <button role="tab" class:active={pane === 'indents'} aria-selected={pane === 'indents'} onclick={() => (pane = 'indents')}>{t().paragraphDialog.indentsTab}</button>
      <button role="tab" class:active={pane === 'breaks'} aria-selected={pane === 'breaks'} onclick={() => (pane = 'breaks')}>{t().paragraphDialog.breaksTab}</button>
    </div>

    <div class="panes">
      <div class="grid" class:off={pane !== 'indents'}>
        <label class="row">
          <span>{t().align.section}</span>
          <select value={align} onchange={(e) => editor?.chain().focus().setTextAlign((e.currentTarget as HTMLSelectElement).value as never).run()}>
            {#each ALIGNS as a}<option value={a}>{t().align[a]}</option>{/each}
          </select>
        </label>

        <label class="row">
          <span>{t().paragraphDialog.textDirection}</span>
          <select value={dir} onchange={(e) => setAttr('dir', (e.currentTarget as HTMLSelectElement).value || null)}>
            <option value="">{t().paragraphDialog.dirPage}</option>
            <option value="ltr">{t().paragraphDialog.dirLtr}</option>
            <option value="rtl">{t().paragraphDialog.dirRtl}</option>
          </select>
        </label>

        <label class="row newline"><span>{t().ribbon.indentLeft}</span>{@render indentField('left')}</label>
        <label class="row"><span>{t().ribbon.indentRight}</span>{@render indentField('right')}</label>
        <label class="row"><span>{t().ruler.firstLineIndent}</span>{@render indentField('first')}</label>

        <label class="row newline"><span>{t().ribbon.spaceBefore}</span><input type="text" inputmode="decimal" value={num(spaceBefore)} onchange={(e) => setNumber('spaceBefore', (e.currentTarget as HTMLInputElement).value)} /><em>pt</em></label>
        <label class="row"><span>{t().ribbon.spaceAfter}</span><input type="text" inputmode="decimal" value={num(spaceAfter)} onchange={(e) => setNumber('spaceAfter', (e.currentTarget as HTMLInputElement).value)} /><em>pt</em></label>

        <label class="row newline">
          <span>{t().toolbarExpanded.lineSpacing}</span>
          <select value={fixedLine ? 'fixed' : String(lineHeight)} onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; editor?.chain().focus().setLineHeight(v === 'fixed' ? '12pt' : v).run(); }}>
            {#each LINE_FACTORS as h}<option value={h}>{h === '1' ? t().toolbarExpanded.lineSingle : h === '2' ? t().toolbarExpanded.lineDouble : h}</option>{/each}
            <!-- An imported factor off the list still shows, rather than a blank select. -->
            {#if !fixedLine && !LINE_FACTORS.includes(String(lineHeight))}<option value={String(lineHeight)}>{lineHeight}</option>{/if}
            <option value="fixed">{t().toolbarExpanded.lineFixed}</option>
          </select>
        </label>
        {#if fixedLine}
          <label class="row"><span></span><input type="text" inputmode="decimal" value={num(parseFloat(String(lineHeight)))} onchange={(e) => { const v = parseFloat((e.currentTarget as HTMLInputElement).value.replace(',', '.')); if (v > 0) editor?.chain().focus().setLineHeight(`${v}pt`).run(); }} /><em>pt</em></label>
        {/if}
      </div>
      <div class="flow" class:off={pane !== 'breaks'}>
        {#each FLOW as f}
          <label class="check">
            <input type="checkbox" checked={f.on()} onchange={(e) => f.set((e.currentTarget as HTMLInputElement).checked)} />
            <span>{f.label()}</span>
          </label>
        {/each}
        <p class="hint">{t().paragraphDialog.flowHint}</p>
      </div>
    </div>

    <div class="actions">
      <button class="secondary" onclick={() => { open = false; onTabs?.(); }}>{t().paragraphDialog.tabsButton}</button>
      <span class="spacer"></span>
      <button class="primary" onclick={() => (open = false)}>{t().common.close}</button>
    </div>
  </div>
</dialog>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    /* Grows with the longest localized label instead of scrolling. */
    width: max-content;
    min-width: 560px;
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

  /* Both panes share one cell, so switching tabs never resizes the dialog. */
  .panes { display: grid; }
  .panes > * { grid-area: 1 / 1; }
  .off { visibility: hidden; }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px; }

  /* Equal columns plus a fixed unit width put every field on the same edge; the
     label takes the rest and never wraps, so no row grows a second line. */
  .newline { grid-column: 1; }

  .row { display: flex; align-items: center; gap: 8px; }
  .row > span { flex: 1; white-space: nowrap; color: var(--color-text-muted); }
  .row em { width: 4.8em; font-style: normal; color: var(--color-text-muted); }

  /* A phone has room for one column, and a long label wraps there instead. */
  @media (max-width: 600px) {
    .grid { grid-template-columns: 1fr; }
    .row > span { white-space: normal; }
  }

  .row input, .row select {
    width: 64px;
    height: 26px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 0 6px;
    font: inherit;
  }

  /* No unit of its own, so it reaches across the field and unit columns. */
  .row select { width: calc(72px + 4.8em); }
  /* The unit column is as wide as the switchable unit, so every field keeps one edge. */
  .row select.unit { width: 4.8em; }
  .row input { text-align: right; }

  .flow { display: flex; flex-direction: column; gap: 8px; }
  .check { display: flex; align-items: center; gap: 8px; cursor: pointer; }

  /* Wraps at the dialog width rather than widening it. */
  .hint { width: 0; min-width: 100%; color: var(--color-text-muted); font-size: 0.78rem; }

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
