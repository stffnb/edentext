<script lang="ts">
  import { formatDecimal, parseDecimal } from '../../../i18n/number';
  import type { Editor } from '@tiptap/core';
  import RibbonGroup from '../RibbonGroup.svelte';
  import RibbonButton from '../RibbonButton.svelte';
  import { anchored, clickOutside, isMenuOpen, toggleMenu, closeMenu } from '../menu.svelte';
  import { uniformBlockAttr } from '../../../utils/selectionFormat';
  import { MARGIN_PRESETS, columnState, sectionAt, sectionValue, withSectionProps } from '../../sectionSetup';
  import { PAGE_FORMAT_CM, formatDimsCm, isNamedFormat, pageDimsCm, sizeSetup, type NamedPageFormat, type PageFormat } from '../../../storage/pageFormat';
  import { DEFAULT_MARGINS, marginAxisLabel, withMirrored, type PageMargins } from '../../../storage/pageMargins';
  import type { Orientation } from '../../../storage/pageOrientation';
  import { spreadMargins, type HfSet, type HfZone, type PageSide } from '../../../storage/headerFooter';
  import { DEFAULT_PAGE_NUMBERING, PAGE_NUM_FORMATS, clampPageStart, type PageNumbering } from '../../../storage/pageNumbering';
  import { EMPTY_PAGE_DECOR, type PageDecor } from '../../../storage/pageDecor';
  import { DEFAULT_LINE_NUMBERING, type LineNumbering } from '../../../storage/lineNumbering';
  import PageDecorDialog from '../../PageDecorDialog.svelte';
  import { formatOrdinal } from '../../../utils/orderedListTypes';
  import { t } from '../../../i18n/i18n.svelte';
  import { shortcutHint } from '../../../editor/shortcuts';
  import { leftCm, rightCm } from '../../../editor/extensions/indent';
  import { blockFontSize } from '../../../utils/fontSize';

  let {
    editor, tick, hfActive = null,
    pageMargins = $bindable(DEFAULT_MARGINS),
    pageOrientation = $bindable<Orientation>('portrait'),
    pageFormat = $bindable<PageFormat>('A4'),
    extraHfSections = $bindable<HfSet[]>([]),
    hyphenate = $bindable(false),
    pageRtl = $bindable(false),
    pageNumbering = $bindable(DEFAULT_PAGE_NUMBERING),
    pageDecor = $bindable(EMPTY_PAGE_DECOR),
    lineNumbering = $bindable(DEFAULT_LINE_NUMBERING),
    foldMarks = $bindable(false),
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
    pageRtl?: boolean;
    pageNumbering?: PageNumbering;
    pageDecor?: PageDecor;
    lineNumbering?: LineNumbering;
    foldMarks?: boolean;
    onParagraphDialog?: () => void;
  } = $props();

  let decorOpen = $state(false);

  // Only the paper DIN 5008 describes carries fold marks; App.svelte gates drawing
  // and export on the same condition.
  const foldMarksFit = $derived(pageFormat === 'A4' && pageOrientation === 'portrait');

  let currentSection = $derived(tick >= 0 && editor ? sectionAt(editor.state) : 0);
  // The paper and orientation the section sets itself — null where it takes the
  // document's, so the menu can mark that row instead of one it never chose.
  let sectionFormat = $derived(sectionValue(extraHfSections, currentSection, 'format'));
  let sectionOrientation = $derived(sectionValue(extraHfSections, currentSection, 'orientation'));

  function setSectionOrientation(o: Orientation | null): void {
    setSectionProp({ orientation: o });
  }

  function setSectionProp(props: Partial<HfSet>): void {
    extraHfSections = withSectionProps(extraHfSections, currentSection, props);
  }

  // The side this section must open on, if it must (Word's Layout ▸ Section start).
  let sectionStartsOn = $derived(sectionValue(extraHfSections, currentSection, 'startsOn'));
  // Where this section restarts the numbering, if it does (Word's "Start at").
  let sectionPageStart = $derived(sectionValue(extraHfSections, currentSection, 'pageNumberStart'));

  const FORMATS = Object.keys(PAGE_FORMAT_CM) as NamedPageFormat[];
  const EDGES = ['top', 'bottom', 'left', 'right'] as const;

  const fmtCm = (v: number) => formatDecimal(v);

  // Mirrored, the left/right fields are the inner/outer pair and say so.
  const mLabel = (edge: (typeof EDGES)[number]) => t().toolbarExpanded.margins[marginAxisLabel(edge, pageMargins)];

  function setMargin(edge: (typeof EDGES)[number], raw: string) {
    const v = parseDecimal(raw);
    if (isNaN(v)) return;
    setMargins({ ...pageMargins, [edge]: Math.min(10, Math.max(0, v)) });
  }
  // A typed width or height: the page takes the box, its orientation following the sides.
  function setPageSize(side: 'w' | 'h', input: HTMLInputElement) {
    const cur = pageDimsCm(pageFormat, pageOrientation);
    const v = parseDecimal(input.value);
    const next = sizeSetup(side === 'w' ? v : cur.w, side === 'h' ? v : cur.h);
    if (!next) { input.value = fmtCm(cur[side]); return; }
    pageFormat = next.format;
    pageOrientation = next.orientation;
  }
  function setMargins(next: PageMargins) {
    extraHfSections = spreadMargins(extraHfSections, pageMargins, next);
    pageMargins = next;
  }

  let colState = $derived(tick >= 0 && editor ? columnState(editor.state) : columnState(null));

  function setColumns(n: number) {
    closeMenu();
    editor?.chain().focus().setColumns(n).run();
  }

  // --- Paragraph indent and spacing, in the units Word's Layout tab uses ---
  // An indent counted in characters shows here in cm, at the cursor block's size.
  let indentLeft = $derived.by(() => {
    if (tick < 0 || !editor) return 0;
    if (!uniformBlockAttr<number>(editor.state, 'indentChars', 0)) return uniformBlockAttr<number>(editor.state, 'indent', 0);
    const block = editor.state.selection.$from.parent;
    return leftCm(block.attrs, parseFloat(blockFontSize(block)));
  });
  let indentRight = $derived.by(() => {
    if (tick < 0 || !editor) return 0;
    if (!uniformBlockAttr<number>(editor.state, 'indentRightChars', 0)) return uniformBlockAttr<number>(editor.state, 'indentRight', 0);
    const block = editor.state.selection.$from.parent;
    return rightCm(block.attrs, parseFloat(blockFontSize(block)));
  });
  let spaceBefore = $derived(tick >= 0 && editor ? uniformBlockAttr<number>(editor.state, 'spaceBefore', 0) : 0);
  let spaceAfter = $derived(tick >= 0 && editor ? uniformBlockAttr<number>(editor.state, 'spaceAfter', 0) : 0);

  const num = (v: number | '') => (v === '' ? '' : formatDecimal(v));

  function apply(fn: (v: number) => void, raw: string) {
    const v = parseDecimal(raw);
    if (!isNaN(v)) fn(v);
  }
</script>

<RibbonGroup label={t().ribbon.groups.pageSetup}>
  <div class="rb-menu-wrap" use:clickOutside={'margins'}>
    <RibbonButton variant="big" icon="margins" cmd="margins" label={t().ribbon.margins} title={t().toolbarExpanded.pageMargins} caret active={isMenuOpen('margins')} onclick={() => toggleMenu('margins')} />
    {#if isMenuOpen('margins')}
      <div class="ribbon-menu margin-menu" use:anchored role="menu">
        {#each MARGIN_PRESETS as p}
          <button data-cmd={`margins-${p.key}`} onclick={() => { closeMenu(); setMargins(withMirrored(p.m, pageMargins.mirrored === true)); }}>
            {t().ribbon.marginPresets[p.key]}
            <span class="menu-sub">{fmtCm(p.m.top)} / {fmtCm(p.m.left)} cm</span>
          </button>
        {/each}
        <hr />
        <div class="rb-menu-label">{t().toolbarExpanded.pageMargins}</div>
        <div class="margin-grid">
          {#each EDGES as edge}
            <label class="margin-field">
              <span>{mLabel(edge)}</span>
              <input
                type="text"
                inputmode="decimal"
                value={fmtCm(pageMargins[edge])}
                title={t().toolbarExpanded.marginField(mLabel(edge))}
                onchange={(e) => setMargin(edge, (e.currentTarget as HTMLInputElement).value)}
              />
            </label>
          {/each}
        </div>
        <label class="check-row" title={t().toolbarExpanded.mirrorMarginsHint}>
          <input
            type="checkbox"
            checked={pageMargins.mirrored === true}
            onchange={(e) => setMargins(withMirrored(pageMargins, e.currentTarget.checked))}
          />
          {t().toolbarExpanded.mirrorMargins}
        </label>
      </div>
    {/if}
  </div>

  <div class="rb-menu-wrap" use:clickOutside={'orientation'}>
    <RibbonButton variant="big" icon="orientation" cmd="orientation" label={t().toolbarExpanded.orientation} title={t().toolbarExpanded.orientation} caret active={isMenuOpen('orientation')} onclick={() => toggleMenu('orientation')} />
    {#if isMenuOpen('orientation')}
      <div class="ribbon-menu" use:anchored role="menu">
        {#each (['portrait', 'landscape'] as const) as o}
          <button data-cmd={`orientation-${o}`} class:selected={pageOrientation === o} onclick={() => { closeMenu(); pageOrientation = o; }}>{t().toolbarExpanded[o]}</button>
        {/each}
        {#if currentSection > 0}
          <div class="rb-menu-label">{t().ribbon.thisSection}</div>
          {#each (['portrait', 'landscape'] as const) as o}
            <button class:selected={sectionOrientation === o} onclick={() => { closeMenu(); setSectionOrientation(o); }}>{t().toolbarExpanded[o]}</button>
          {/each}
          <button class:selected={sectionOrientation === null} onclick={() => { closeMenu(); setSectionOrientation(null); }}>{t().ribbon.likeDocument}</button>
        {/if}
      </div>
    {/if}
  </div>

  <div class="rb-menu-wrap" use:clickOutside={'pageFormat'}>
    <RibbonButton variant="big" icon="pageSize" cmd="pageSize" label={t().ribbon.size} title={t().toolbarExpanded.pageFormat} caret active={isMenuOpen('pageFormat')} onclick={() => toggleMenu('pageFormat')} />
    {#if isMenuOpen('pageFormat')}
      <div class="ribbon-menu format-menu" use:anchored role="menu">
        <div class="menu-scroll">
          {#each FORMATS as f}
            <button data-cmd={`pageSize-${f}`} class:selected={pageFormat === f} onclick={() => { closeMenu(); pageFormat = f; }}>
              {t().toolbarExpanded.pageFormats[f]}
              <span class="menu-sub">{fmtCm(PAGE_FORMAT_CM[f].w)} × {fmtCm(PAGE_FORMAT_CM[f].h)} cm</span>
            </button>
          {/each}
          {#if !isNamedFormat(pageFormat)}
            {@const d = formatDimsCm(pageFormat)}
            <button class="selected" onclick={closeMenu}>
              {t().toolbarExpanded.pageFormatCustom}
              <span class="menu-sub">{fmtCm(d.w)} × {fmtCm(d.h)} cm</span>
            </button>
          {/if}
          <hr />
          <div class="rb-menu-label">{t().toolbarExpanded.pageSizeCustom}</div>
          <div class="margin-grid">
            {#each (['w', 'h'] as const) as side}
              {@const label = side === 'w' ? t().toolbarExpanded.pageWidth : t().toolbarExpanded.pageHeight}
              <label class="margin-field">
                <span>{label}</span>
                <input
                  type="text"
                  inputmode="decimal"
                  data-cmd={`pageSize-${side}`}
                  value={fmtCm(pageDimsCm(pageFormat, pageOrientation)[side])}
                  title={label}
                  onchange={(e) => setPageSize(side, e.currentTarget)}
                />
              </label>
            {/each}
          </div>
          {#if currentSection > 0}
            <div class="rb-menu-label">{t().ribbon.thisSection}</div>
            {#each FORMATS as f}
              <button class:selected={sectionFormat === f} onclick={() => { closeMenu(); setSectionProp({ format: f }); }}>
                {t().toolbarExpanded.pageFormats[f]}
              </button>
            {/each}
            {#if sectionFormat && !isNamedFormat(sectionFormat)}
              <button class="selected" onclick={closeMenu}>{t().toolbarExpanded.pageFormatCustom}</button>
            {/if}
            <button class:selected={sectionFormat === null} onclick={() => { closeMenu(); setSectionProp({ format: null }); }}>{t().ribbon.likeDocument}</button>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <div class="rb-menu-wrap" use:clickOutside={'columns'}>
    <RibbonButton
      variant="big"
      icon="columns"
      cmd="columns"
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
          <button data-cmd={`columns-${n}`} class:selected={colState.count === n} onclick={() => setColumns(n)}>
            {@render colPreview(n)}
            {n === 1 ? t().toolbarExpanded.columnsOne : n === 2 ? t().toolbarExpanded.columnsTwo : t().toolbarExpanded.columnsThree}
          </button>
        {/each}
        <hr />
        <label class="gap-field" title={colState.inColumns ? t().toolbarExpanded.columnGap : t().toolbarExpanded.columnGapNeedsColumns}>
          <span>{t().toolbarExpanded.columnGap}</span>
          <input
            type="text"
            inputmode="decimal"
            value={fmtCm(colState.gapCm)}
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
      cmd="breaks"
      label={t().ribbon.breaks}
      title={hfActive ? t().toolbarExpanded.breaksNotInHf : t().ribbon.breaks}
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
        <button data-cmd="sectionBreak" onclick={() => { closeMenu(); editor?.chain().focus().updateAttributes('paragraph', { sectionBreak: true }).run(); }}>
          {t().ribbon.sectionBreak}
          <span class="menu-sub">{t().ribbon.sectionBreakHint}</span>
        </button>
        {#if currentSection > 0}
          <hr />
          <div class="rb-menu-label">{t().ribbon.thisSection}</div>
          {#each [[null, t().ribbon.startsOnAny], ['odd', t().ribbon.startsOnOdd], ['even', t().ribbon.startsOnEven]] as [side, label]}
            <label class="check-row" title={t().ribbon.startsOnHint}>
              <input
                type="radio"
                checked={sectionStartsOn === side}
                onchange={() => setSectionProp({ startsOn: side as PageSide | null })}
              />
              {label}
            </label>
          {/each}
        {/if}
      </div>
    {/if}
  </div>

  <div class="rb-col">
    <RibbonButton
      variant="small"
      icon="hyphenation"
      cmd="hyphenation"
      label={t().ribbon.hyphenation}
      title={t().ribbon.hyphenationHint}
      active={hyphenate}
      onclick={() => (hyphenate = !hyphenate)}
    />
    <RibbonButton
      variant="small"
      icon="pageRtl"
      cmd="pageRtl"
      label={t().paragraphDialog.dirRtl}
      title={t().ribbon.pageRtlHint}
      active={pageRtl}
      onclick={() => (pageRtl = !pageRtl)}
    />
    <div class="rb-menu-wrap" use:clickOutside={'pageNum'}>
      <RibbonButton
        variant="small"
        icon="pageNumber"
        cmd="pageNumberFormat"
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
              <span dir="ltr">{[1, 2, 3].map((n) => formatOrdinal(n, f)).join(', ')}</span>
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
            <label class="check-row">
              <input
                type="radio"
                checked={sectionPageStart == null}
                onchange={() => setSectionProp({ pageNumberStart: null })}
              />
              {t().ribbon.pageNumberContinue}
            </label>
            <label class="check-row">
              <input
                type="radio"
                checked={sectionPageStart != null}
                onchange={() => setSectionProp({ pageNumberStart: 1 })}
              />
              {t().ribbon.pageNumberStart}
              <input
                class="start-at"
                type="number"
                min="1"
                max="9999"
                disabled={sectionPageStart == null}
                value={sectionPageStart ?? ''}
                onchange={(e) => setSectionProp({ pageNumberStart: clampPageStart(Number(e.currentTarget.value)) })}
              />
            </label>
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
        cmd="lineNumbers"
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
      cmd="pageDecor"
      label={t().ribbon.pageDecor}
      title={t().pageDecor.title}
      active={!!(pageDecor.background || pageDecor.border || pageDecor.watermark)}
      onclick={() => (decorOpen = true)}
    />
    <RibbonButton
      variant="small"
      icon="foldMarks"
      cmd="foldMarks"
      label={t().ribbon.foldMarks}
      title={foldMarksFit ? t().ribbon.foldMarksHint : t().ribbon.foldMarksA4Hint}
      active={foldMarks && foldMarksFit}
      disabled={!foldMarksFit}
      onclick={() => (foldMarks = !foldMarks)}
    />
  </div>
</RibbonGroup>

<PageDecorDialog bind:open={decorOpen} bind:decor={pageDecor} />

<div class="ribbon-sep"></div>

<!-- Absolute indent and spacing: the ruler can drag these, but only here can a
     value be typed. -->
<RibbonGroup label={t().ribbon.groups.paragraph} onLauncher={onParagraphDialog} launcherTitle={t().paragraphDialog.title}>
  <div class="field-grid">
    <label class="field" data-cmd="indentLeft">
      <span>{t().ribbon.indentLeft}</span>
      <input type="text" inputmode="decimal" value={num(indentLeft)} disabled={!editor}
        onchange={(e) => apply((v) => editor?.chain().focus().setIndent(v).run(), (e.currentTarget as HTMLInputElement).value)} />
    </label>
    <label class="field" data-cmd="spaceBefore">
      <span>{t().ribbon.spaceBefore}</span>
      <input type="text" inputmode="decimal" value={num(spaceBefore)} disabled={!editor}
        onchange={(e) => apply((v) => editor?.chain().focus().setSpaceBefore(v).run(), (e.currentTarget as HTMLInputElement).value)} />
    </label>
    <label class="field" data-cmd="indentRight">
      <span>{t().ribbon.indentRight}</span>
      <input type="text" inputmode="decimal" value={num(indentRight)} disabled={!editor}
        onchange={(e) => apply((v) => editor?.chain().focus().setIndentRight(v).run(), (e.currentTarget as HTMLInputElement).value)} />
    </label>
    <label class="field" data-cmd="spaceAfter">
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
  .num-row { display: flex; align-items: center; padding: 2px 12px 6px; }
  .num-row input { width: 84px; }
  .check-row { display: flex; align-items: center; gap: 6px; padding: 2px 12px 6px; white-space: nowrap; }
  .check-row .start-at { width: 64px; }

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

  /* A menu field carries its own colour, so the browser's grey never shows: every
     disabled one here dims itself, and the label with it. */
  .margin-field:has(input:disabled), .gap-field:has(input:disabled),
  .field:has(input:disabled) { opacity: 0.5; }
  /* Only the box: the radio beside it is what turns it back on. */
  .check-row .start-at:disabled { opacity: 0.5; }
</style>
