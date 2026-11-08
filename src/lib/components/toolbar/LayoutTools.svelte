<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import IslandButton from './IslandButton.svelte';
  import IslandMenu from './IslandMenu.svelte';
  import PageDecorDialog from '../PageDecorDialog.svelte';
  import { closeMenu } from '../ribbon/menu.svelte';
  import { MARGIN_PRESETS, columnState, sectionAt, sectionValue, withSectionProps } from '../sectionSetup';
  import { uniformBlockAttr } from '../../utils/selectionFormat';
  import { PAGE_FORMAT_CM, formatDimsCm, isNamedFormat, pageDimsCm, sizeSetup, type NamedPageFormat, type PageFormat } from '../../storage/pageFormat';
  import { DEFAULT_MARGINS, marginAxisLabel, withMirrored, type PageMargins } from '../../storage/pageMargins';
  import type { Orientation } from '../../storage/pageOrientation';
  import { spreadMargins, type HfSet, type HfZone, type PageSide } from '../../storage/headerFooter';
  import { DEFAULT_PAGE_NUMBERING, PAGE_NUM_FORMATS, clampPageStart, type PageNumbering } from '../../storage/pageNumbering';
  import { EMPTY_PAGE_DECOR, type PageDecor } from '../../storage/pageDecor';
  import { DEFAULT_LINE_NUMBERING, type LineNumbering } from '../../storage/lineNumbering';
  import { formatOrdinal } from '../../utils/orderedListTypes';
  import { leftCm, rightCm } from '../../editor/extensions/indent';
  import { blockFontSize } from '../../utils/fontSize';
  import { t } from '../../i18n/i18n.svelte';
  import { shortcutHint } from '../../editor/shortcuts';

  // The Layout category, as the ribbon's Layout tab.
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

  // Word's "apply to this section": the section's own page setup, null where it takes the document's.
  let section = $derived(tick >= 0 && editor ? sectionAt(editor.state) : 0);
  let sectionFormat = $derived(sectionValue(extraHfSections, section, 'format'));
  let sectionOrientation = $derived(sectionValue(extraHfSections, section, 'orientation'));
  let sectionStartsOn = $derived(sectionValue(extraHfSections, section, 'startsOn'));
  let sectionPageStart = $derived(sectionValue(extraHfSections, section, 'pageNumberStart'));

  function setSectionProp(props: Partial<HfSet>): void {
    extraHfSections = withSectionProps(extraHfSections, section, props);
  }

  const FORMATS = Object.keys(PAGE_FORMAT_CM) as NamedPageFormat[];
  const EDGES = ['top', 'bottom', 'left', 'right'] as const;

  const fmtCm = (v: number) => String(Math.round(v * 100) / 100);
  // Mirrored, the left/right fields are the inner/outer pair and say so.
  const mLabel = (edge: (typeof EDGES)[number]) => t().toolbarExpanded.margins[marginAxisLabel(edge, pageMargins)];

  function setMargins(next: PageMargins) {
    extraHfSections = spreadMargins(extraHfSections, pageMargins, next);
    pageMargins = next;
  }

  function setMargin(edge: (typeof EDGES)[number], raw: string) {
    const v = parseFloat(raw.replace(',', '.'));
    if (!isNaN(v)) setMargins({ ...pageMargins, [edge]: Math.min(10, Math.max(0, v)) });
  }

  // A typed width or height: the page takes the box, its orientation following the sides.
  function setPageSize(side: 'w' | 'h', input: HTMLInputElement) {
    const cur = pageDimsCm(pageFormat, pageOrientation);
    const v = parseFloat(input.value.replace(',', '.'));
    const next = sizeSetup(side === 'w' ? v : cur.w, side === 'h' ? v : cur.h);
    if (!next) { input.value = fmtCm(cur[side]); return; }
    pageFormat = next.format;
    pageOrientation = next.orientation;
  }

  let colState = $derived(columnState(tick >= 0 && editor ? editor.state : null));

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

  const num = (v: number | '') => (v === '' ? '' : String(Math.round(v * 100) / 100));

  function apply(fn: (v: number) => void, raw: string) {
    const v = parseFloat(raw.replace(',', '.'));
    if (!isNaN(v)) fn(v);
  }
</script>

<div class="toolbar-group">
  <IslandMenu id="margins" icon="margins" cmd="margins" title={t().toolbarExpanded.pageMargins} minWidth={230}>
    {#each MARGIN_PRESETS as p}
      <button data-cmd={`margins-${p.key}`} onclick={() => { closeMenu(); setMargins(withMirrored(p.m, pageMargins.mirrored === true)); }}>
        {t().ribbon.marginPresets[p.key]}
        <span class="menu-sub">{fmtCm(p.m.top)} / {fmtCm(p.m.left)} cm</span>
      </button>
    {/each}
    <hr />
    <div class="im-label">{t().toolbarExpanded.pageMargins} (cm)</div>
    <div class="im-grid">
      {#each EDGES as edge}
        <label class="im-field">
          <span>{mLabel(edge)}</span>
          <input type="text" inputmode="decimal" value={fmtCm(pageMargins[edge])} title={t().toolbarExpanded.marginField(mLabel(edge))}
            onchange={(e) => setMargin(edge, e.currentTarget.value)} />
        </label>
      {/each}
    </div>
    <label class="im-row" title={t().toolbarExpanded.mirrorMarginsHint}>
      <input type="checkbox" checked={pageMargins.mirrored === true} onchange={(e) => setMargins(withMirrored(pageMargins, e.currentTarget.checked))} />
      {t().toolbarExpanded.mirrorMargins}
    </label>
  </IslandMenu>

  <IslandMenu id="orientation" icon="orientation" cmd="orientation" title={t().toolbarExpanded.orientation}>
    {#each (['portrait', 'landscape'] as const) as o}
      <button data-cmd={`orientation-${o}`} class:selected={pageOrientation === o} onclick={() => { closeMenu(); pageOrientation = o; }}>{t().toolbarExpanded[o]}</button>
    {/each}
    {#if section > 0}
      <div class="im-label">{t().ribbon.thisSection}</div>
      {#each (['portrait', 'landscape'] as const) as o}
        <button class:selected={sectionOrientation === o} onclick={() => { closeMenu(); setSectionProp({ orientation: o }); }}>{t().toolbarExpanded[o]}</button>
      {/each}
      <button class:selected={sectionOrientation === null} onclick={() => { closeMenu(); setSectionProp({ orientation: null }); }}>{t().ribbon.likeDocument}</button>
    {/if}
  </IslandMenu>

  <IslandMenu id="pageFormat" icon="pageSize" cmd="pageSize" title={t().toolbarExpanded.pageFormat} minWidth={230}>
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
    <div class="im-label">{t().toolbarExpanded.pageSizeCustom}</div>
    <div class="im-grid">
      {#each (['w', 'h'] as const) as side}
        {@const label = side === 'w' ? t().toolbarExpanded.pageWidth : t().toolbarExpanded.pageHeight}
        <label class="im-field">
          <span>{label}</span>
          <input type="text" inputmode="decimal" data-cmd={`pageSize-${side}`} value={fmtCm(pageDimsCm(pageFormat, pageOrientation)[side])} title={label}
            onchange={(e) => setPageSize(side, e.currentTarget)} />
        </label>
      {/each}
    </div>
    {#if section > 0}
      <div class="im-label">{t().ribbon.thisSection}</div>
      {#each FORMATS as f}
        <button class:selected={sectionFormat === f} onclick={() => { closeMenu(); setSectionProp({ format: f }); }}>{t().toolbarExpanded.pageFormats[f]}</button>
      {/each}
      {#if sectionFormat && !isNamedFormat(sectionFormat)}
        <button class="selected" onclick={closeMenu}>{t().toolbarExpanded.pageFormatCustom}</button>
      {/if}
      <button class:selected={sectionFormat === null} onclick={() => { closeMenu(); setSectionProp({ format: null }); }}>{t().ribbon.likeDocument}</button>
    {/if}
  </IslandMenu>

  <IslandMenu id="columns" icon="columns" cmd="columns" title={hfActive ? t().toolbarExpanded.columnsNotInHf : t().toolbarExpanded.columns} active={colState.inColumns} disabled={!editor || !!hfActive}>
    {#each [1, 2, 3] as n}
      <button data-cmd={`columns-${n}`} class:selected={colState.count === n} onclick={() => { closeMenu(); editor?.chain().focus().setColumns(n).run(); }}>
        {n === 1 ? t().toolbarExpanded.columnsOne : n === 2 ? t().toolbarExpanded.columnsTwo : t().toolbarExpanded.columnsThree}
      </button>
    {/each}
    <hr />
    <label class="im-row" title={colState.inColumns ? t().toolbarExpanded.columnGap : t().toolbarExpanded.columnGapNeedsColumns}>
      <span>{t().toolbarExpanded.columnGap} (cm)</span>
      <input type="text" inputmode="decimal" value={fmtCm(colState.gapCm)} disabled={!colState.inColumns}
        onchange={(e) => apply((v) => editor?.chain().focus().setColumnGap(v).run(), e.currentTarget.value)} />
    </label>
  </IslandMenu>

  <IslandMenu id="breaks" icon="pageBreak" cmd="breaks" title={hfActive ? t().toolbarExpanded.breaksNotInHf : t().ribbon.breaks} disabled={!editor || !!hfActive} minWidth={230}>
    <button onclick={() => { closeMenu(); editor?.chain().focus().insertPageBreak().run(); }}>
      {t().ribbon.pageBreak}<span class="menu-key">{shortcutHint('pageBreak')}</span>
    </button>
    <button data-cmd="sectionBreak" onclick={() => { closeMenu(); editor?.chain().focus().updateAttributes('paragraph', { sectionBreak: true }).run(); }}>
      {t().ribbon.sectionBreak}<span class="menu-sub">{t().ribbon.sectionBreakHint}</span>
    </button>
    {#if section > 0}
      <hr />
      <div class="im-label">{t().ribbon.thisSection}</div>
      {#each [[null, t().ribbon.startsOnAny], ['odd', t().ribbon.startsOnOdd], ['even', t().ribbon.startsOnEven]] as [side, label]}
        <label class="im-row" title={t().ribbon.startsOnHint}>
          <input type="radio" checked={sectionStartsOn === side} onchange={() => setSectionProp({ startsOn: side as PageSide | null })} />
          {label}
        </label>
      {/each}
    {/if}
  </IslandMenu>
</div>

<div class="toolbar-separator"></div>

<div class="toolbar-group">
  <IslandButton icon="hyphenation" cmd="hyphenation" title={t().ribbon.hyphenationHint} active={hyphenate} onclick={() => (hyphenate = !hyphenate)} />
  <IslandMenu id="pageNum" icon="pageNumber" cmd="pageNumberFormat" title={t().ribbon.pageNumberFormat}>
    <div class="im-label">{t().ribbon.pageNumberFormat}</div>
    {#each PAGE_NUM_FORMATS as f}
      <button class:selected={pageNumbering.format === f} onclick={() => (pageNumbering = { ...pageNumbering, format: f })}>
        {[1, 2, 3].map((n) => formatOrdinal(n, f)).join(', ')}
      </button>
    {/each}
    <label class="im-row">
      <span>{t().ribbon.pageNumberStart}</span>
      <input type="number" min="1" max="9999" value={pageNumbering.start}
        onchange={(e) => (pageNumbering = { ...pageNumbering, start: clampPageStart(Number(e.currentTarget.value)) })} />
    </label>
    {#if section > 0}
      <div class="im-label">{t().ribbon.thisSection}</div>
      <label class="im-row">
        <input type="radio" checked={sectionPageStart == null} onchange={() => setSectionProp({ pageNumberStart: null })} />
        {t().ribbon.pageNumberContinue}
      </label>
      <label class="im-row">
        <input type="radio" checked={sectionPageStart != null} onchange={() => setSectionProp({ pageNumberStart: 1 })} />
        {t().ribbon.pageNumberStart}
        <input type="number" min="1" max="9999" disabled={sectionPageStart == null} value={sectionPageStart ?? ''}
          onchange={(e) => setSectionProp({ pageNumberStart: clampPageStart(Number(e.currentTarget.value)) })} />
      </label>
    {/if}
  </IslandMenu>
  <IslandMenu id="lineNum" icon="lineNumbers" cmd="lineNumbers" title={t().lineNumbers.title} active={lineNumbering.on}>
    <button class:selected={!lineNumbering.on} onclick={() => (lineNumbering = { ...lineNumbering, on: false })}>{t().lineNumbers.off}</button>
    <button class:selected={lineNumbering.on && lineNumbering.restart === 'continuous'} onclick={() => (lineNumbering = { ...lineNumbering, on: true, restart: 'continuous' })}>{t().lineNumbers.continuous}</button>
    <button class:selected={lineNumbering.on && lineNumbering.restart === 'page'} onclick={() => (lineNumbering = { ...lineNumbering, on: true, restart: 'page' })}>{t().lineNumbers.perPage}</button>
    <hr />
    <label class="im-row">
      <span>{t().lineNumbers.interval}</span>
      <input type="number" min="1" max="100" value={lineNumbering.interval}
        onchange={(e) => (lineNumbering = { ...lineNumbering, interval: Math.max(1, Math.min(100, Number(e.currentTarget.value) || 1)) })} />
    </label>
    <label class="im-row">
      <input type="checkbox" checked={lineNumbering.countEmpty} onchange={(e) => (lineNumbering = { ...lineNumbering, countEmpty: e.currentTarget.checked })} />
      {t().lineNumbers.countEmpty}
    </label>
  </IslandMenu>
  <IslandButton icon="watermark" cmd="pageDecor" title={t().pageDecor.title} active={!!(pageDecor.background || pageDecor.border || pageDecor.watermark)} onclick={() => (decorOpen = true)} />
  <IslandButton icon="foldMarks" cmd="foldMarks" title={foldMarksFit ? t().ribbon.foldMarksHint : t().ribbon.foldMarksA4Hint} active={foldMarks && foldMarksFit} disabled={!foldMarksFit} onclick={() => (foldMarks = !foldMarks)} />
</div>

<div class="toolbar-separator"></div>

<!-- Absolute indent and spacing: the ruler drags these, but only here can a value be typed. -->
<div class="toolbar-group">
  <IslandMenu id="paragraphFields" content={indentIcon} cmd="paragraphFields" title={t().ribbon.groups.paragraph} disabled={!editor} minWidth={240}>
    <div class="im-grid">
      <label class="im-field" data-cmd="indentLeft">
        <span>{t().ribbon.indentLeft}</span>
        <input type="text" inputmode="decimal" value={num(indentLeft)}
          onchange={(e) => apply((v) => editor?.chain().focus().setIndent(v).run(), e.currentTarget.value)} />
      </label>
      <label class="im-field" data-cmd="spaceBefore">
        <span>{t().ribbon.spaceBefore}</span>
        <input type="text" inputmode="decimal" value={num(spaceBefore)}
          onchange={(e) => apply((v) => editor?.chain().focus().setSpaceBefore(v).run(), e.currentTarget.value)} />
      </label>
      <label class="im-field" data-cmd="indentRight">
        <span>{t().ribbon.indentRight}</span>
        <input type="text" inputmode="decimal" value={num(indentRight)}
          onchange={(e) => apply((v) => editor?.chain().focus().setIndentRight(v).run(), e.currentTarget.value)} />
      </label>
      <label class="im-field" data-cmd="spaceAfter">
        <span>{t().ribbon.spaceAfter}</span>
        <input type="text" inputmode="decimal" value={num(spaceAfter)}
          onchange={(e) => apply((v) => editor?.chain().focus().setSpaceAfter(v).run(), e.currentTarget.value)} />
      </label>
    </div>
    <hr />
    <button onclick={() => { closeMenu(); onParagraphDialog?.(); }}>{t().paragraphDialog.title}</button>
  </IslandMenu>
</div>

<PageDecorDialog bind:open={decorOpen} bind:decor={pageDecor} />

{#snippet indentIcon()}
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M6 3h8M6 6.5h8M6 10h8M2 13.5h12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M1.5 4.5 3.5 6.5l-2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
{/snippet}
