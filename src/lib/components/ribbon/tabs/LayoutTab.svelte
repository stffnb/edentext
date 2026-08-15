<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import RibbonGroup from '../RibbonGroup.svelte';
  import RibbonButton from '../RibbonButton.svelte';
  import { anchored, clickOutside, isMenuOpen, toggleMenu, closeMenu } from '../menu.svelte';
  import { uniformBlockAttr } from '../../../utils/selectionFormat';
  import { findColumns, DEFAULT_COLUMN_GAP_CM } from '../../../editor/extensions/columns';
  import { PAGE_FORMAT_CM, type PageFormat } from '../../../storage/pageFormat';
  import { DEFAULT_MARGINS, type PageMargins } from '../../../storage/pageMargins';
  import type { Orientation } from '../../../storage/pageOrientation';
  import { EMPTY_HF_SET, type HfSet, type HfZone } from '../../../storage/headerFooter';
  import { DEFAULT_PAGE_NUMBERING, PAGE_NUM_FORMATS, clampPageStart, type PageNumbering } from '../../../storage/pageNumbering';
  import { EMPTY_PAGE_DECOR, type PageDecor } from '../../../storage/pageDecor';
  import { DEFAULT_LINE_NUMBERING, type LineNumbering } from '../../../storage/lineNumbering';
  import PageDecorDialog from '../../PageDecorDialog.svelte';
  import { formatOrdinal } from '../../../utils/orderedListTypes';
  import { t } from '../../../i18n/i18n.svelte';
  import { shortcutHint } from '../../../editor/shortcuts';

  let {
    editor, tick, hfActive = null,
    pageMargins = $bindable(DEFAULT_MARGINS),
    pageOrientation = $bindable<Orientation>('portrait'),
    pageFormat = $bindable<PageFormat>('A4'),
    extraHfSections = $bindable<HfSet[]>([]),
    hyphenate = $bindable(false),
    pageNumbering = $bindable(DEFAULT_PAGE_NUMBERING),
    pageDecor = $bindable(EMPTY_PAGE_DECOR),
    lineNumbering = $bindable(DEFAULT_LINE_NUMBERING),
    onParagraphDialog,
  }: {
    editor: Editor | null;
    tick: number;
    hfActive?: HfZone | null;
    pageMargins?: PageMargins;
    pageOrientation?: Orientation;
    pageFormat?: PageFormat;
    extraHfSections?: HfSet[];
    hyphenate?: boolean;
    pageNumbering?: PageNumbering;
    pageDecor?: PageDecor;
    lineNumbering?: LineNumbering;
    onParagraphDialog?: () => void;
  } = $props();

  let decorOpen = $state(false);

  // The section the cursor is in: every top-level block carrying `sectionBreak` opens
  // the next one, so counting them up to the cursor is the index. 0 = the document's
  // own first section, which has no HfSet of its own.
  let currentSection = $derived.by(() => {
    if (tick < 0 || !editor) return 0;
    const at = editor.state.selection.from;
    let n = 0;
    editor.state.doc.forEach((node, pos) => {
      if (pos < at && node.attrs?.sectionBreak === true) n++;
    });
    return n;
  });
  // Its own orientation, where it has one — else the document's.
  let sectionOrientation = $derived(
    currentSection > 0 ? (extraHfSections[currentSection - 1]?.orientation ?? pageOrientation) : pageOrientation,
  );

  // Word's "apply to this section": the paper rides the section's own page setup, so
  // every other section keeps the document's.
  function setSectionOrientation(o: Orientation | null): void {
    setSectionProp({ orientation: o });
  }

  function setSectionProp(props: Partial<HfSet>): void {
    if (currentSection < 1) return;
    const out = extraHfSections.slice();
    while (out.length < currentSection) out.push({ ...EMPTY_HF_SET });
    out[currentSection - 1] = { ...out[currentSection - 1], ...props };
    extraHfSections = out;
  }

  // Where this section restarts the numbering, if it does (Word's "Start at").
  let sectionPageStart = $derived(
    currentSection > 0 ? extraHfSections[currentSection - 1]?.pageNumberStart ?? null : null,
  );

  const FORMATS = Object.keys(PAGE_FORMAT_CM) as PageFormat[];
  const EDGES = ['top', 'bottom', 'left', 'right'] as const;

  // Named after the value they set, so no preset hides what it does.
  const MARGIN_PRESETS: { key: 'normal' | 'narrow' | 'wide'; m: PageMargins }[] = [
    { key: 'normal', m: { top: 2, bottom: 2, left: 2, right: 2 } },
    { key: 'narrow', m: { top: 1.27, bottom: 1.27, left: 1.27, right: 1.27 } },
    { key: 'wide', m: { top: 2.54, bottom: 2.54, left: 5.08, right: 5.08 } },
  ];

  const fmtCm = (v: number) => (Math.round(v * 100) / 100).toString().replace('.', ',');

  function setMargin(edge: (typeof EDGES)[number], raw: string) {
    const v = parseFloat(raw.replace(',', '.'));
    if (isNaN(v)) return;
    pageMargins = { ...pageMargins, [edge]: Math.min(10, Math.max(0, v)) };
  }

  // --- Columns ---
  let colState = $derived.by(() => {
    if (tick < 0 || !editor) return { count: 1, gap: DEFAULT_COLUMN_GAP_CM, inColumns: false };
    const found = findColumns(editor.state);
    return found
      ? { count: found.node.attrs.count as number, gap: found.node.attrs.gap as number, inColumns: true }
      : { count: 1, gap: DEFAULT_COLUMN_GAP_CM, inColumns: false };
  });

  function setColumns(n: number) {
    closeMenu();
    editor?.chain().focus().setColumns(n).run();
  }

  // --- Paragraph indent and spacing, in the units Word's Layout tab uses ---
  let indentLeft = $derived(tick >= 0 && editor ? uniformBlockAttr<number>(editor.state, 'indent', 0) : 0);
  let indentRight = $derived(tick >= 0 && editor ? uniformBlockAttr<number>(editor.state, 'indentRight', 0) : 0);
  let spaceBefore = $derived(tick >= 0 && editor ? uniformBlockAttr<number>(editor.state, 'spaceBefore', 0) : 0);
  let spaceAfter = $derived(tick >= 0 && editor ? uniformBlockAttr<number>(editor.state, 'spaceAfter', 0) : 0);

  const num = (v: number | '') => (v === '' ? '' : String(Math.round(v * 100) / 100));

  function apply(fn: (v: number) => void, raw: string) {
    const v = parseFloat(raw.replace(',', '.'));
    if (!isNaN(v)) fn(v);
  }
</script>

<RibbonGroup label={t().ribbon.groups.pageSetup}>
  <div class="rb-menu-wrap" use:clickOutside={'margins'}>
    <RibbonButton variant="big" icon="margins" label={t().ribbon.margins} title={t().toolbarExpanded.pageMargins} caret active={isMenuOpen('margins')} onclick={() => toggleMenu('margins')} />
    {#if isMenuOpen('margins')}
      <div class="ribbon-menu margin-menu" use:anchored role="menu">
        {#each MARGIN_PRESETS as p}
          <button onclick={() => { closeMenu(); pageMargins = p.m; }}>
            {t().ribbon.marginPresets[p.key]}
            <span class="menu-sub">{fmtCm(p.m.top)} / {fmtCm(p.m.left)} cm</span>
          </button>
        {/each}
        <hr />
        <div class="rb-menu-label">{t().toolbarExpanded.pageMargins}</div>
        <div class="margin-grid">
          {#each EDGES as edge}
            <label class="margin-field">
              <span>{t().toolbarExpanded.margins[edge]}</span>
              <input
                type="text"
                inputmode="decimal"
                value={fmtCm(pageMargins[edge])}
                title={t().toolbarExpanded.marginField(t().toolbarExpanded.margins[edge])}
                onchange={(e) => setMargin(edge, (e.currentTarget as HTMLInputElement).value)}
              />
            </label>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <div class="rb-menu-wrap" use:clickOutside={'orientation'}>
    <RibbonButton variant="big" icon="orientation" label={t().toolbarExpanded.orientation} title={t().toolbarExpanded.orientation} caret active={isMenuOpen('orientation')} onclick={() => toggleMenu('orientation')} />
    {#if isMenuOpen('orientation')}
      <div class="ribbon-menu" use:anchored role="menu">
        {#each (['portrait', 'landscape'] as const) as o}
          <button class:selected={pageOrientation === o} onclick={() => { closeMenu(); pageOrientation = o; }}>{t().toolbarExpanded[o]}</button>
        {/each}
        {#if currentSection > 0}
          <div class="rb-menu-label">{t().ribbon.thisSection}</div>
          {#each (['portrait', 'landscape'] as const) as o}
            <button class:selected={sectionOrientation === o} onclick={() => { closeMenu(); setSectionOrientation(o); }}>{t().toolbarExpanded[o]}</button>
          {/each}
          <button onclick={() => { closeMenu(); setSectionOrientation(null); }}>{t().ribbon.likeDocument}</button>
        {/if}
      </div>
    {/if}
  </div>

  <div class="rb-menu-wrap" use:clickOutside={'pageFormat'}>
    <RibbonButton variant="big" icon="pageSize" label={t().ribbon.size} title={t().toolbarExpanded.pageFormat} caret active={isMenuOpen('pageFormat')} onclick={() => toggleMenu('pageFormat')} />
    {#if isMenuOpen('pageFormat')}
      <div class="ribbon-menu format-menu" use:anchored role="menu">
        <div class="menu-scroll">
          {#each FORMATS as f}
            <button class:selected={pageFormat === f} onclick={() => { closeMenu(); pageFormat = f; }}>
              {t().toolbarExpanded.pageFormats[f]}
              <span class="menu-sub">{fmtCm(PAGE_FORMAT_CM[f].w)} × {fmtCm(PAGE_FORMAT_CM[f].h)} cm</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <div class="rb-menu-wrap" use:clickOutside={'columns'}>
    <RibbonButton
      variant="big"
      icon="columns"
      label={t().toolbarExpanded.columns}
      title={hfActive ? t().toolbarExpanded.columnsNotInHf : t().toolbarExpanded.columns}
      disabled={!editor || !!hfActive}
      caret
      active={isMenuOpen('columns')}
      onclick={() => toggleMenu('columns')}
    />
    {#if isMenuOpen('columns')}
      <div class="ribbon-menu" use:anchored role="menu">
        {#each [1, 2, 3] as n}
          <button class:selected={colState.count === n} onclick={() => setColumns(n)}>
            {@render colPreview(n)}
            {n === 1 ? t().toolbarExpanded.columnsOne : n === 2 ? t().toolbarExpanded.columnsTwo : t().toolbarExpanded.columnsThree}
          </button>
        {/each}
        <hr />
        <label class="gap-field">
          <span>{t().toolbarExpanded.columnGap}</span>
          <input
            type="text"
            inputmode="decimal"
            value={fmtCm(colState.gap)}
            disabled={!colState.inColumns}
            onchange={(e) => apply((v) => editor?.chain().focus().setColumnGap(v).run(), (e.currentTarget as HTMLInputElement).value)}
          />
        </label>
      </div>
    {/if}
  </div>

  <div class="rb-menu-wrap" use:clickOutside={'breaks'}>
    <RibbonButton
      variant="big"
      icon="pageBreak"
      label={t().ribbon.breaks}
      title={t().ribbon.breaks}
      disabled={!editor || !!hfActive}
      caret
      active={isMenuOpen('breaks')}
      onclick={() => toggleMenu('breaks')}
    />
    {#if isMenuOpen('breaks')}
      <div class="ribbon-menu breaks-menu" use:anchored role="menu">
        <button onclick={() => { closeMenu(); editor?.chain().focus().insertPageBreak().run(); }}>
          {t().ribbon.pageBreak}
          <span class="menu-key">{shortcutHint('pageBreak')}</span>
        </button>
        <button onclick={() => { closeMenu(); editor?.chain().focus().updateAttributes('paragraph', { sectionBreak: true }).run(); }}>
          {t().ribbon.sectionBreak}
          <span class="menu-sub">{t().ribbon.sectionBreakHint}</span>
        </button>
      </div>
    {/if}
  </div>

  <div class="rb-col">
    <RibbonButton
      variant="small"
      icon="hyphenation"
      label={t().ribbon.hyphenation}
      title={t().ribbon.hyphenationHint}
      active={hyphenate}
      onclick={() => (hyphenate = !hyphenate)}
    />
    <div class="rb-menu-wrap" use:clickOutside={'pageNum'}>
      <RibbonButton
        variant="small"
        icon="pageNumber"
        label={t().ribbon.pageNumberFormat}
        title={t().ribbon.pageNumberFormat}
        caret
        active={isMenuOpen('pageNum')}
        onclick={() => toggleMenu('pageNum')}
      />
      {#if isMenuOpen('pageNum')}
        <div class="ribbon-menu" use:anchored role="menu">
          <div class="rb-menu-label">{t().ribbon.pageNumberFormat}</div>
          {#each PAGE_NUM_FORMATS as f}
            <button class:selected={pageNumbering.format === f} onclick={() => (pageNumbering = { ...pageNumbering, format: f })}>
              {[1, 2, 3].map((n) => formatOrdinal(n, f)).join(', ')}
            </button>
          {/each}
          <div class="rb-menu-label">{t().ribbon.pageNumberStart}</div>
          <label class="num-row">
            <input
              type="number"
              min="1"
              max="9999"
              value={pageNumbering.start}
              onchange={(e) => (pageNumbering = { ...pageNumbering, start: clampPageStart(Number(e.currentTarget.value)) })}
            />
          </label>
          {#if currentSection > 0}
            <div class="rb-menu-label">{t().ribbon.thisSection}</div>
            <label class="num-row">
              <input
                type="number"
                min="1"
                max="9999"
                placeholder={t().ribbon.pageNumberContinue}
                value={sectionPageStart ?? ''}
                onchange={(e) => setSectionProp({ pageNumberStart: e.currentTarget.value ? clampPageStart(Number(e.currentTarget.value)) : null })}
              />
            </label>
            <button onclick={() => { closeMenu(); setSectionProp({ pageNumberStart: null }); }}>{t().ribbon.pageNumberContinue}</button>
          {/if}
        </div>
      {/if}
      </div>
  </div>

  <div class="rb-col">
    <div class="rb-menu-wrap" use:clickOutside={'lineNum'}>
      <RibbonButton
        variant="small"
        icon="lineNumbers"
        label={t().ribbon.lineNumbers}
        title={t().lineNumbers.title}
        caret
        active={isMenuOpen('lineNum') || lineNumbering.on}
        onclick={() => toggleMenu('lineNum')}
      />
      {#if isMenuOpen('lineNum')}
        <div class="ribbon-menu" use:anchored role="menu">
          <button class:selected={!lineNumbering.on} onclick={() => (lineNumbering = { ...lineNumbering, on: false })}>
            {t().lineNumbers.off}
          </button>
          <button class:selected={lineNumbering.on && lineNumbering.restart === 'continuous'}
            onclick={() => (lineNumbering = { ...lineNumbering, on: true, restart: 'continuous' })}>
            {t().lineNumbers.continuous}
          </button>
          <button class:selected={lineNumbering.on && lineNumbering.restart === 'page'}
            onclick={() => (lineNumbering = { ...lineNumbering, on: true, restart: 'page' })}>
            {t().lineNumbers.perPage}
          </button>
          <div class="rb-menu-label">{t().lineNumbers.interval}</div>
          <label class="num-row">
            <input type="number" min="1" max="100" value={lineNumbering.interval}
              onchange={(e) => (lineNumbering = { ...lineNumbering, interval: Math.max(1, Math.min(100, Number(e.currentTarget.value) || 1)) })} />
          </label>
          <label class="check-row">
            <input type="checkbox" checked={lineNumbering.countEmpty}
              onchange={(e) => (lineNumbering = { ...lineNumbering, countEmpty: e.currentTarget.checked })} />
            {t().lineNumbers.countEmpty}
          </label>
        </div>
      {/if}
      </div>
    <RibbonButton
      variant="small"
      icon="watermark"
      label={t().ribbon.pageDecor}
      title={t().pageDecor.title}
      active={!!(pageDecor.background || pageDecor.border || pageDecor.watermark)}
      onclick={() => (decorOpen = true)}
    />
  </div>
</RibbonGroup>

<PageDecorDialog bind:open={decorOpen} bind:decor={pageDecor} />

<div class="ribbon-sep"></div>

<!-- Absolute indent and spacing: the ruler can drag these, but only here can a
     value be typed. -->
<RibbonGroup label={t().ribbon.groups.paragraph} onLauncher={onParagraphDialog} launcherTitle={t().paragraphDialog.title}>
  <div class="field-grid">
    <label class="field">
      <span>{t().ribbon.indentLeft}</span>
      <input type="text" inputmode="decimal" value={num(indentLeft)} disabled={!editor}
        onchange={(e) => apply((v) => editor?.chain().focus().setIndent(v).run(), (e.currentTarget as HTMLInputElement).value)} />
    </label>
    <label class="field">
      <span>{t().ribbon.spaceBefore}</span>
      <input type="text" inputmode="decimal" value={num(spaceBefore)} disabled={!editor}
        onchange={(e) => apply((v) => editor?.chain().focus().setSpaceBefore(v).run(), (e.currentTarget as HTMLInputElement).value)} />
    </label>
    <label class="field">
      <span>{t().ribbon.indentRight}</span>
      <input type="text" inputmode="decimal" value={num(indentRight)} disabled={!editor}
        onchange={(e) => apply((v) => editor?.chain().focus().setIndentRight(v).run(), (e.currentTarget as HTMLInputElement).value)} />
    </label>
    <label class="field">
      <span>{t().ribbon.spaceAfter}</span>
      <input type="text" inputmode="decimal" value={num(spaceAfter)} disabled={!editor}
        onchange={(e) => apply((v) => editor?.chain().focus().setSpaceAfter(v).run(), (e.currentTarget as HTMLInputElement).value)} />
    </label>
  </div>
</RibbonGroup>

<!-- Word shows the layout rather than naming it. The page is 20 units of text
     width with a 2-unit gutter, so the columns narrow as their count rises. -->
{#snippet colPreview(n: number)}
  {@const gap = 2}
  {@const w = (20 - (n - 1) * gap) / n}
  <svg class="col-preview" width="25" height="32" viewBox="0 0 26 32" fill="none" aria-hidden="true">
    <rect x="0.5" y="0.5" width="25" height="31" rx="1.5" fill="var(--w-surface)" stroke="var(--w-border-strong)" />
    {#each { length: n } as _, c}
      {#each [6, 10, 14, 18, 22, 26] as y}
        <rect x={3 + c * (w + gap)} {y} width={w} height="1.5" fill="var(--w-text-dim)" opacity="0.6" />
      {/each}
    {/each}
  </svg>
{/snippet}

<style>
  .num-row { display: flex; padding: 2px 12px 6px; }
  .num-row input { width: 84px; }
  .check-row { display: flex; align-items: center; gap: 6px; padding: 2px 12px 6px; white-space: nowrap; }

  .rb-menu-wrap { position: relative; }

  /* Two rows of named commands beside the big ones, as the band is one big button tall. */
  .rb-col { display: flex; flex-direction: column; gap: 2px; }
  .rb-col :global(.rb-small) { width: 100%; }

  .col-preview { flex-shrink: 0; }

  .margin-menu, .format-menu, .breaks-menu { min-width: 230px; }
  .format-menu { max-height: 340px; overflow: hidden; }

  .margin-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    padding: 2px 7px 4px;
  }

  .margin-field, .gap-field, .field {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--w-font);
    font-size: 12px;
    color: var(--w-text-dim);
  }

  .gap-field { padding: 4px 12px; }

  .margin-field input, .gap-field input, .field input {
    width: 52px;
    height: 24px;
    border: 1px solid var(--w-border-strong);
    border-radius: 3px;
    background: var(--w-surface);
    padding: 0 5px;
    color: var(--w-text);
    font: inherit;
    text-align: right;
  }

  .margin-field input:focus, .gap-field input:focus, .field input:focus {
    outline: none;
    border-color: var(--w-accent);
  }

  /* Word's Layout tab puts indent and spacing side by side, two rows each. */
  .field-grid {
    display: grid;
    grid-template-columns: auto auto;
    align-content: center;
    gap: 3px 12px;
  }

  /* The label takes whatever its grid column is wide, so the boxes line up on that
     column's right edge at any label length. */
  .margin-field > span, .field > span {
    flex: 1;
    white-space: nowrap;
  }

  .field input:disabled { opacity: 0.5; }
</style>
