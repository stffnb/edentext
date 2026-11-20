<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import RibbonGroup from '../RibbonGroup.svelte';
  import RibbonButton from '../RibbonButton.svelte';
  import ReadGate from '../../ReadGate.svelte';
  import DictationButton from '../../DictationButton.svelte';
  import Icon from '../Icon.svelte';
  import FontFamilyBox from '../controls/FontFamilyBox.svelte';
  import FontSizeBox from '../controls/FontSizeBox.svelte';
  import StyleGallery from '../controls/StyleGallery.svelte';
  import ColorPicker from '../../ColorPicker.svelte';
  import ParagraphBorderPicker from '../../ParagraphBorderPicker.svelte';
  import { anchored, clickOutside, isMenuOpen, toggleMenu, closeMenu } from '../menu.svelte';
  import { formatDecimal } from '../../../i18n/number';
  import { uniformMarkColor, uniformBlockAttr, hasAsianLanguage, shownAlign } from '../../../utils/selectionFormat';
  import { stepFontSize } from '../../../editor/extensions/shortcuts';

  import { clipboardCommand, readClipboard } from '../../../editor/contextMenuItems';
  import { LINE_STYLES, changeIndent as stepIndent, setLineStyle as applyLineStyle } from '../../formatCommands';
  import { BULLET_TYPES } from '../../../utils/bulletListTypes';
  import { formatOrdinal, orderedTypeDef, orderedTypesFor, sampleDir, type OrderedListType } from '../../../utils/orderedListTypes';
  import { effectiveOrderedTypeAt, inChapterHeading } from '../../../editor/extensions/orderedList';
  import { outlineIsEmpty } from '../../../styles/outlineNumbering';
  import { listStyleNameAt } from '../../../editor/extensions/listStyle';
  import type { ListStyle } from '../../../styles/listStyles';
  import { isInHeaderCell } from '../../../editor/extensions/tableHeaderRow';
  import { cellRegionText } from '../../../editor/extensions/tableStyle';
  import { styleSheet } from '../../../styles/sheet.svelte';
  import { emphasisCss, hasTextEffect, type CapsMode, type Emphasis, type LineStyle } from '../../../editor/extensions/textEffects';
  import TextEffectsMenu from '../../toolbar/TextEffectsMenu.svelte';
  import TextEffectsIcon from '../../toolbar/TextEffectsIcon.svelte';
  import type { StyleFamily } from '../../../styles/styleSheet';
  import { styleLabel, t } from '../../../i18n/i18n.svelte';
  import { withShortcut } from '../../../i18n/shortcut';
  import { shortcutHint, type ShortcutId } from '../../../editor/shortcuts';

  let { editor, tick, showFormattingMarks = $bindable(false), onManageStyles, onFind, onParagraphDialog, asianDocument = false, scripts = { cjk: false, cyrillic: false } }: {
    editor: Editor | null;
    tick: number;
    asianDocument?: boolean;
    scripts?: { cjk: boolean; cyrillic: boolean };
    showFormattingMarks?: boolean;
    onManageStyles?: (family: StyleFamily) => void;
    onFind?: (mode: 'find' | 'replace') => void;
    onParagraphDialog?: () => void;
  } = $props();

  let sheet = $derived(styleSheet());

  let hasSelection = $derived(tick >= 0 && !!editor && !editor.state.selection.empty);

  // A heading or a header-row cell renders bold by default (CSS), so there the
  // Bold button toggles an explicit font-weight instead of the mark.
  let isHeading = $derived(tick >= 0 && !!editor?.isActive('heading'));
  let inHeaderCell = $derived(
    tick >= 0 && !!editor
      && (isInHeaderCell(editor.state) || cellRegionText(editor.state, sheet.table).bold === true),
  );
  let boldByDefault = $derived(isHeading || inHeaderCell);
  let hasNormalWeight = $derived(tick >= 0 && !!editor?.isActive('textStyle', { fontWeight: 'normal' }));
  let isBold = $derived(tick >= 0 && (!!editor?.isActive('bold') || (boldByDefault && !hasNormalWeight)));

  function toggleBold() {
    if (!boldByDefault) return void editor?.chain().focus().toggleBold().run();
    if (hasNormalWeight) editor?.chain().focus().unsetFontWeight().run();
    else editor?.chain().focus().setFontWeight('normal').run();
  }

  let isItalic = $derived(tick >= 0 && !!editor?.isActive('italic'));
  let isUnderline = $derived(tick >= 0 && !!editor?.isActive('underline'));
  let isStrike = $derived(tick >= 0 && !!editor?.isActive('strike'));
  let asianSelection = $derived(tick >= 0 && !!editor && hasAsianLanguage(editor.state));
  let emphasis = $derived(tick >= 0 ? editor?.getAttributes('textStyle').emphasis ?? null : null);
  let hasEffect = $derived(tick >= 0 && !!editor && hasTextEffect(editor.getAttributes('textStyle')));
  let isSuper = $derived(tick >= 0 && !!editor?.isActive('superscript'));
  let isSub = $derived(tick >= 0 && !!editor?.isActive('subscript'));
  let isBulletList = $derived(tick >= 0 && !!editor?.isActive('bulletList'));
  // On a heading the button stands for the chapter numbering it switches.
  let isOrderedList = $derived(tick >= 0 && !!editor
    && (editor.isActive('orderedList') || (inChapterHeading(editor.state) && !outlineIsEmpty(sheet.outline))));
  let align = $derived(tick >= 0 && editor ? shownAlign(editor.view) : '');

  let fontColor = $derived(tick >= 0 && editor ? uniformMarkColor(editor.state, 'textStyle') : null);
  let highlight = $derived(tick >= 0 && editor ? uniformMarkColor(editor.state, 'highlight') : null);
  let paraShade = $derived(tick >= 0 && editor ? (uniformBlockAttr<string | null>(editor.state, 'backgroundColor', null) || null) : null);
  let lineHeight = $derived(tick >= 0 && editor ? uniformBlockAttr(editor.state, 'lineHeight', '1') : '1');

  function paste(plainOnly: boolean) {
    closeMenu();
    if (editor) void readClipboard(editor, plainOnly);
  }

  // Sub- and superscript are mutually exclusive, so each clears the other.
  const toggleSuper = () => editor?.chain().focus().unsetSubscript().toggleSuperscript().run();
  const toggleSub = () => editor?.chain().focus().unsetSuperscript().toggleSubscript().run();

  const CASES: { mode: CapsMode | null; label: string }[] = $derived([
    { mode: null, label: t().ribbon.case.none },
    { mode: 'uppercase', label: t().ribbon.case.upper },
    { mode: 'lowercase', label: t().ribbon.case.lower },
    { mode: 'capitalize', label: t().ribbon.case.capitalize },
    { mode: 'smallCaps', label: t().ribbon.case.smallCaps },
  ]);

  function setCase(mode: CapsMode | null) {
    closeMenu();
    editor?.chain().focus().setMark('textStyle', { caps: mode }).run();
  }

  // Chinese sets its emphasis dots below the characters, so that is the button's own.
  const EMPHASES: { mode: Emphasis | null; key: 'none' | 'dotBelow' | 'dotAbove' | 'circle' | 'disc' | 'accent' }[] = [
    { mode: null, key: 'none' },
    { mode: 'dot below', key: 'dotBelow' },
    { mode: 'dot above', key: 'dotAbove' },
    { mode: 'circle above', key: 'circle' },
    { mode: 'disc above', key: 'disc' },
    { mode: 'accent above', key: 'accent' },
  ];

  function setEmphasis(mode: Emphasis | null) {
    closeMenu();
    editor?.chain().focus().setMark('textStyle', { emphasis: mode }).run();
  }

  function setLineStyle(mark: 'underline' | 'strike', style: LineStyle) {
    closeMenu();
    if (editor) applyLineStyle(editor, mark, style);
  }

  function changeIndent(dir: 1 | -1) {
    if (editor) stepIndent(editor, dir);
  }

  const LINE_HEIGHTS = ['1', '1.15', '1.5', '2', '2.5', '3'];
  const LH_SHORTCUTS: Record<string, ShortcutId | undefined> = {
    '1': 'lineHeight1', '1.5': 'lineHeight15', '2': 'lineHeight2',
  };

  function lineHeightLabel(v: string): string {
    if (v === '1') return t().toolbarExpanded.lineSingle;
    if (v === '2') return t().toolbarExpanded.lineDouble;
    return formatDecimal(Number(v));
  }

  let currentBulletChar = $derived.by<string | null>(() => {
    if (tick < 0 || !editor || !editor.isActive('bulletList')) return null;
    return (editor.getAttributes('bulletList').bulletChar ?? null) as string | null;
  });

  let currentOrderedType = $derived.by<OrderedListType | null>(() => {
    if (tick < 0 || !editor || !editor.isActive('orderedList')) return null;
    return effectiveOrderedTypeAt(editor.state);
  });

  // Both markers create the list first when the selection isn't in one.
  function applyBulletChar(char: string | null) {
    closeMenu();
    if (!editor) return;
    const chain = editor.chain().focus();
    if (!editor.isActive('bulletList')) chain.toggleBulletList();
    chain.setBulletChar(char).run();
  }

  function applyOrderedType(key: OrderedListType) {
    closeMenu();
    if (!editor) return;
    const chain = editor.chain().focus();
    if (!editor.isActive('orderedList')) chain.toggleOrderedList();
    chain.setOrderedListType(key).run();
  }

  function bulletName(char: string): string {
    return (t().toolbar.bullets as Record<string, string>)[char] ?? char;
  }

  // Named list styles, split by their first level's kind (same split as Toolbar.svelte).
  let bulletListStyles = $derived(Object.values(sheet.list ?? {}).filter((s) => s.levels[0]?.kind === 'bullet'));
  let orderedListStyles = $derived(Object.values(sheet.list ?? {}).filter((s) => s.levels[0]?.kind !== 'bullet'));
  let currentListStyle = $derived.by<string | null>(() => {
    if (tick < 0 || !editor) return null;
    return listStyleNameAt(editor.state as never);
  });

  function listStylePreview(s: ListStyle): string {
    const def = s.levels[0];
    if (def?.kind === 'bullet') return def.bulletChar ?? '•';
    if (s.multilevel) return '1.1.';
    const type = orderedTypeDef(def?.numType ?? 'decimal');
    return formatOrdinal(def?.startAt ?? 1, type.numFormat) + type.numSuffix;
  }

  function applyListStyle(s: ListStyle, kind: 'bulletList' | 'orderedList') {
    closeMenu();
    if (!editor) return;
    const chain = editor.chain().focus();
    if (!editor.isActive('bulletList') && !editor.isActive('orderedList')) {
      if (kind === 'bulletList') chain.toggleBulletList();
      else chain.toggleOrderedList();
    }
    chain.setListStyle(currentListStyle === s.name ? null : s.name).run();
  }
</script>

<RibbonGroup label={t().ribbon.groups.clipboard} reads>
  <ReadGate><div class="rb-menu-wrap" use:clickOutside={'paste'}>
    <RibbonButton
      variant="big"
      icon="paste"
      cmd="paste"
      label={t().contextMenu.paste}
      title={`${t().contextMenu.paste} (${withShortcut('Ctrl+V')})`}
      disabled={!editor}
      caret
      active={isMenuOpen('paste')}
      onclick={() => toggleMenu('paste')}
    />
    {#if isMenuOpen('paste')}
      <!-- Word offers a third, Merge Formatting. The engine reads the clipboard
           either as HTML or as text, so there is no third thing to offer. -->
      <div class="ribbon-menu" use:anchored role="menu">
        <button onclick={() => paste(false)}>
          {t().contextMenu.paste}<span class="menu-key">{withShortcut('Ctrl+V')}</span>
        </button>
        <button data-cmd="pastePlain" onclick={() => paste(true)}>
          {t().contextMenu.pasteWithoutFormatting}<span class="menu-key">{withShortcut('Ctrl+Shift+V')}</span>
        </button>
      </div>
    {/if}
  </div></ReadGate>
  <div class="rb-col">
    <ReadGate><RibbonButton variant="small" icon="cut" cmd="cut" label={t().contextMenu.cut} title={`${t().contextMenu.cut} (${withShortcut('Ctrl+X')})`} disabled={!hasSelection} onclick={() => editor && clipboardCommand(editor, 'cut')} /></ReadGate>
    <RibbonButton variant="small" icon="copy" cmd="copy" label={t().contextMenu.copy} title={`${t().contextMenu.copy} (${withShortcut('Ctrl+C')})`} disabled={!hasSelection} onclick={() => editor && clipboardCommand(editor, 'copy')} />
  </div>
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().ribbon.groups.font}>
  <div class="rb-rows">
    <div class="rb-row">
      <span class="rb-cmd" data-cmd="fontFamily"><FontFamilyBox {editor} {tick} /></span>
      <span class="rb-cmd" data-cmd="fontSize"><FontSizeBox {editor} {tick} /></span>
      <RibbonButton cmd="growFont" title={t().toolbarExpanded.growFont} content={growIcon} onclick={() => editor && stepFontSize(editor, 1)} />
      <RibbonButton cmd="shrinkFont" title={t().toolbarExpanded.shrinkFont} content={shrinkIcon} onclick={() => editor && stepFontSize(editor, -1)} />
      <div class="rb-menu-wrap" use:clickOutside={'case'}>
        <RibbonButton cmd="changeCase" icon="changeCase" title={t().ribbon.case.title} active={isMenuOpen('case')} caret onclick={() => toggleMenu('case')} />
        {#if isMenuOpen('case')}
          <div class="ribbon-menu" use:anchored role="menu">
            {#each CASES as c}
              <button data-cmd={`case-${c.mode ?? 'none'}`} onclick={() => setCase(c.mode)}>{c.label}</button>
            {/each}
          </div>
        {/if}
      </div>
      <div class="rb-menu-wrap" use:clickOutside={'textEffects'}>
        <RibbonButton cmd="textEffects" content={effectsIcon} title={t().ribbon.textEffects.title} active={hasEffect || isMenuOpen('textEffects')} caret onclick={() => toggleMenu('textEffects')} />
        {#if isMenuOpen('textEffects')}
          <div class="ribbon-menu" use:anchored role="menu">
            <TextEffectsMenu {editor} {tick} onDone={closeMenu} />
          </div>
        {/if}
      </div>
    </div>
    <div class="rb-row">
      <RibbonButton cmd="bold" content={boldIcon} title={`${t().toolbar.bold} (${withShortcut('Ctrl+B')})`} active={isBold} onclick={toggleBold} />
      <RibbonButton cmd="italic" content={italicIcon} title={`${t().toolbar.italic} (${withShortcut('Ctrl+I')})`} active={isItalic} onclick={() => editor?.chain().focus().toggleItalic().run()} />
      <div class="rb-menu-wrap" use:clickOutside={'underline'}>
        <RibbonButton cmd="underline" content={underlineIcon} title={`${t().toolbar.underline} (${withShortcut('Ctrl+U')})`} active={isUnderline} caret caretActive={isMenuOpen('underline')} onclick={() => editor?.chain().focus().toggleUnderline().run()} onCaret={() => toggleMenu('underline')} />
        {#if isMenuOpen('underline')}
          <div class="ribbon-menu line-menu" use:anchored role="menu">
            {#each LINE_STYLES as s}
              <button onclick={() => setLineStyle('underline', s)}>
                <span class="line-sample" style="text-decoration: underline; text-decoration-style: {s}">{t().ribbon.lineStyles[s]}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <div class="rb-menu-wrap" use:clickOutside={'strike'}>
        <RibbonButton cmd="strike" content={strikeIcon} title={`${t().toolbar.strikethrough} (${withShortcut('Ctrl+Shift+S')})`} active={isStrike} caret caretActive={isMenuOpen('strike')} onclick={() => editor?.chain().focus().toggleStrike().run()} onCaret={() => toggleMenu('strike')} />
        {#if isMenuOpen('strike')}
          <div class="ribbon-menu line-menu" use:anchored role="menu">
            {#each LINE_STYLES as s}
              <button onclick={() => setLineStyle('strike', s)}>
                <span class="line-sample" style="text-decoration: line-through; text-decoration-style: {s}">{t().ribbon.lineStyles[s]}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <!-- East Asian typography only (document, UI or selected text language); a mark already in the text keeps the button to clear it. -->
      {#if asianDocument || asianSelection || emphasis}
      <div class="rb-menu-wrap" use:clickOutside={'emphasis'}>
        <RibbonButton cmd="emphasis" content={emphasisIcon} title={t().ribbon.emphasis.title} active={!!emphasis} caret caretActive={isMenuOpen('emphasis')} onclick={() => editor?.chain().focus().setMark('textStyle', { emphasis: emphasis ? null : 'dot below' }).run()} onCaret={() => toggleMenu('emphasis')} />
        {#if isMenuOpen('emphasis')}
          <div class="ribbon-menu line-menu" use:anchored role="menu">
            {#each EMPHASES as e}
              <button onclick={() => setEmphasis(e.mode)}>
                <span class="line-sample" style={e.mode ? emphasisCss(e.mode) : null}>{t().ribbon.emphasis[e.key]}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      {/if}
      <RibbonButton cmd="subscript" content={subIcon} title={`${t().toolbarExpanded.subscript} (${shortcutHint('subscript')})`} active={isSub} onclick={toggleSub} />
      <RibbonButton cmd="superscript" content={superIcon} title={`${t().toolbarExpanded.superscript} (${shortcutHint('superscript')})`} active={isSuper} onclick={toggleSuper} />
      <span class="rb-mini-sep"></span>
      <span class="rb-cmd" data-cmd="highlight"><ColorPicker
        {editor}
        currentColor={highlight}
        defaultColor="#FFFF00"
        title={t().toolbarExpanded.highlightColor}
        chevronTitle={t().toolbarExpanded.chooseHighlightColor}
        clearLabel={t().toolbarExpanded.noColor}
        onApply={(c, r) => editor?.chain().focus().setTextSelection(r).setHighlight({ color: c }).run()}
        onClear={(r) => editor?.chain().focus().setTextSelection(r).unsetHighlight().run()}
        icon={highlightIcon}
      /></span>
      <span class="rb-cmd" data-cmd="fontColor"><ColorPicker
        {editor}
        currentColor={fontColor}
        defaultColor="#C00000"
        title={t().toolbarExpanded.fontColor}
        chevronTitle={t().toolbarExpanded.chooseFontColor}
        onApply={(c, r) => editor?.chain().focus().setTextSelection(r).setColor(c).run()}
        onClear={(r) => editor?.chain().focus().setTextSelection(r).unsetColor().run()}
        icon={fontColorIcon}
      /></span>
      <RibbonButton cmd="clearFormatting" icon="clearFormat" title={`${t().toolbarExpanded.clearFormatting} (${shortcutHint('clearFormatting')})`} onclick={() => editor?.commands.clearDirectFormatting()} />
    </div>
  </div>
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().ribbon.groups.paragraph} onLauncher={onParagraphDialog} launcherTitle={t().paragraphDialog.title}>
  <div class="rb-rows">
    <div class="rb-row">
      <div class="rb-menu-wrap" use:clickOutside={'bullets'}>
        <RibbonButton cmd="bulletList" icon="bulletList" title={t().toolbar.bulletList} active={isBulletList} caret caretActive={isMenuOpen('bullets')} onclick={() => editor?.chain().focus().toggleBulletList().run()} onCaret={() => toggleMenu('bullets')} />
        {#if isMenuOpen('bullets')}
          <div class="ribbon-menu bullet-menu" use:anchored role="menu">
            <div class="rb-menu-label">{t().toolbar.bulletSymbol}</div>
            <button class:selected={isBulletList && currentBulletChar === null} onclick={() => applyBulletChar(null)}>
              <span class="marker">•</span>{t().toolbar.bulletDefault}
            </button>
            <div class="bullet-grid">
              {#each BULLET_TYPES as b}
                <button class="bullet-tile" class:selected={currentBulletChar === b.char} title={bulletName(b.char)} onclick={() => applyBulletChar(b.char)}>{b.char}</button>
              {/each}
            </div>
            {#if bulletListStyles.length}
              <div class="rb-menu-label">{t().styles.listStyles}</div>
              {#each bulletListStyles as s (s.name)}
                <button class:selected={currentListStyle === s.name} onclick={() => applyListStyle(s, 'bulletList')}>
                  <span class="marker">{listStylePreview(s)}</span>{styleLabel(s.name)}
                </button>
              {/each}
            {/if}
            <button onclick={() => { closeMenu(); onManageStyles?.('list'); }}>{t().styles.manageListStyles}</button>
          </div>
        {/if}
      </div>
      <div class="rb-menu-wrap" use:clickOutside={'numbering'}>
        <RibbonButton cmd="orderedList" icon="orderedList" title={t().toolbar.orderedList} active={isOrderedList} caret caretActive={isMenuOpen('numbering')} onclick={() => editor?.chain().focus().toggleOrderedList().run()} onCaret={() => toggleMenu('numbering')} />
        {#if isMenuOpen('numbering')}
          <div class="ribbon-menu" use:anchored role="menu">
            <div class="rb-menu-label">{t().toolbar.numbering}</div>
            {#each orderedTypesFor(scripts, currentOrderedType) as o}
              <button class:selected={currentOrderedType === o.key} onclick={() => applyOrderedType(o.key)}>
                <span class="marker" dir={sampleDir(o)}>{o.preview}</span><span dir={sampleDir(o)}>{o.label}</span>
              </button>
            {/each}
            {#if orderedListStyles.length}
              <div class="rb-menu-label">{t().styles.listStyles}</div>
              {#each orderedListStyles as s (s.name)}
                <button class:selected={currentListStyle === s.name} onclick={() => applyListStyle(s, 'orderedList')}>
                  <span class="marker">{listStylePreview(s)}</span>{styleLabel(s.name)}
                </button>
              {/each}
            {/if}
            <button onclick={() => { closeMenu(); onManageStyles?.('list'); }}>{t().styles.manageListStyles}</button>
          </div>
        {/if}
      </div>
      <span class="rb-mini-sep"></span>
      <RibbonButton cmd="indentLess" icon="indentLess" title={t().toolbarExpanded.decreaseIndent} onclick={() => changeIndent(-1)} />
      <RibbonButton cmd="indentMore" icon="indentMore" title={t().toolbarExpanded.increaseIndent} onclick={() => changeIndent(1)} />
      <span class="rb-mini-sep"></span>
      <RibbonButton cmd="formattingMarks" icon="pilcrow" title={`${t().toolbarExpanded.formattingMarks} (${shortcutHint('formattingMarks')})`} active={showFormattingMarks} onclick={() => (showFormattingMarks = !showFormattingMarks)} />
    </div>
    <div class="rb-row">
      {#each (['left', 'center', 'right', 'justify'] as const) as a}
        <RibbonButton
          cmd={`align-${a}`}
          icon={a === 'left' ? 'alignLeft' : a === 'center' ? 'alignCenter' : a === 'right' ? 'alignRight' : 'alignJustify'}
          title={`${t().align.alignTo(t().align[a])} (${shortcutHint(`align${a[0].toUpperCase()}${a.slice(1)}` as ShortcutId)})`}
          active={align === a}
          onclick={() => editor?.chain().focus().setTextAlign(a).run()}
        />
      {/each}
      <div class="rb-menu-wrap" use:clickOutside={'lineHeight'}>
        <RibbonButton cmd="lineSpacing" icon="lineSpacing" title={t().toolbarExpanded.lineSpacing} caret active={isMenuOpen('lineHeight')} onclick={() => toggleMenu('lineHeight')} />
        {#if isMenuOpen('lineHeight')}
          <div class="ribbon-menu" use:anchored role="menu">
            {#each LINE_HEIGHTS as h}
              <button class:selected={lineHeight === h} onclick={() => { closeMenu(); editor?.chain().focus().setLineHeight(h).run(); }}>
                {lineHeightLabel(h)}
                {#if LH_SHORTCUTS[h]}<span class="menu-key">{shortcutHint(LH_SHORTCUTS[h]!)}</span>{/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <span class="rb-mini-sep"></span>
      <span class="rb-cmd" data-cmd="paragraphShading"><ColorPicker
        {editor}
        currentColor={paraShade}
        defaultColor="#D9D9D9"
        title={t().toolbarExpanded.paragraphShading}
        chevronTitle={t().toolbarExpanded.chooseParagraphShading}
        clearLabel={t().toolbarExpanded.noColor}
        onApply={(c, r) => editor?.chain().focus().setTextSelection(r).setParagraphBackground(c).run()}
        onClear={(r) => editor?.chain().focus().setTextSelection(r).setParagraphBackground(null).run()}
        icon={shadingIcon}
      /></span>
      <span class="rb-cmd" data-cmd="paragraphBorders"><ParagraphBorderPicker {editor} {tick} /></span>
    </div>
  </div>
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().toolbar.styles.title} grow>
  <StyleGallery {editor} {tick} {onManageStyles} />
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().ribbon.groups.editing} reads>
  <div class="rb-col">
    <RibbonButton variant="small" icon="find" cmd="find" label={t().ribbon.find} title={`${t().ribbon.find} (${shortcutHint('find')})`} onclick={() => onFind?.('find')} />
    <ReadGate><RibbonButton variant="small" icon="replace" cmd="replace" label={t().ribbon.replace} title={`${t().ribbon.replace} (${shortcutHint('replace')})`} onclick={() => onFind?.('replace')} /></ReadGate>
  </div>
  <ReadGate><DictationButton variant="ribbon" cmd="dictate" disabled={!editor} /></ReadGate>
</RibbonGroup>

{#snippet boldIcon()}<span class="glyph" style="font-weight: 800">{t().toolbar.glyphs.bold}</span>{/snippet}
{#snippet italicIcon()}<span class="glyph" style="font-style: italic; font-family: serif">{t().toolbar.glyphs.italic}</span>{/snippet}
{#snippet underlineIcon()}<span class="glyph" style="text-decoration: underline">{t().toolbar.glyphs.underline}</span>{/snippet}
{#snippet emphasisIcon()}<span class="glyph" style="text-emphasis: filled dot; text-emphasis-position: under right">文</span>{/snippet}
{#snippet effectsIcon()}<TextEffectsIcon />{/snippet}
{#snippet strikeIcon()}<span class="glyph" style="text-decoration: line-through">ab</span>{/snippet}
{#snippet subIcon()}<span class="glyph">X<span class="glyph-script down">2</span></span>{/snippet}
{#snippet superIcon()}<span class="glyph">X<span class="glyph-script up">2</span></span>{/snippet}
{#snippet growIcon()}<span class="glyph">A<span class="glyph-sup">▲</span></span>{/snippet}
{#snippet shrinkIcon()}<span class="glyph glyph-small">A<span class="glyph-sup">▼</span></span>{/snippet}
{#snippet fontColorIcon()}<span class="glyph">A</span>{/snippet}
{#snippet highlightIcon()}<Icon name="highlighter" size={16} />{/snippet}
{#snippet shadingIcon()}<Icon name="shading" size={16} />{/snippet}

<style>
  /* Two stacked rows of controls inside one group, Word's usual density. */
  .rb-rows {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    height: 100%;
  }

  .rb-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .rb-col {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .rb-menu-wrap { position: relative; }

  .glyph {
    display: inline-flex;
    align-items: baseline;
    font-family: var(--w-font);
    font-size: 15px;
    line-height: 1;
  }

  .glyph-small { font-size: 12px; }
  .glyph-sup { font-size: 7px; margin-left: 1px; }

  /* The digit rides a relative offset, not vertical-align, which a flex item
     ignores: baseline alignment keeps the X on the row's baseline and the box
     the same 15px as B, I, U and S, so all six letters sit on one line. */
  .glyph-script { position: relative; font-size: 9px; margin-left: 0.5px; }
  .glyph-script.up { top: -4.5px; }
  .glyph-script.down { top: 2px; }

  .line-menu button { padding: 5px 12px; }
  .line-sample { text-underline-offset: 3px; }

  .bullet-menu { min-width: 150px; }

  .bullet-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2px;
    padding: 2px;
  }

  /* The same symbol shim the list markers use, so the tiles preview real glyphs. */
  .bullet-grid .bullet-tile {
    justify-content: center;
    width: auto;
    height: 30px;
    padding: 0;
    font-family: 'EdenText Symbols', var(--font-serif, serif);
    font-size: 15px;
  }

  .marker {
    display: inline-flex;
    justify-content: center;
    min-width: 1.7rem;
    font-family: var(--font-serif, serif);
  }
</style>
