<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import RibbonGroup from '../RibbonGroup.svelte';
  import RibbonButton from '../RibbonButton.svelte';
  import Icon from '../Icon.svelte';
  import FontFamilyBox from '../controls/FontFamilyBox.svelte';
  import FontSizeBox from '../controls/FontSizeBox.svelte';
  import StyleGallery from '../controls/StyleGallery.svelte';
  import ColorPicker from '../../ColorPicker.svelte';
  import ParagraphBorderPicker from '../../ParagraphBorderPicker.svelte';
  import { anchored, clickOutside, isMenuOpen, toggleMenu, closeMenu } from '../menu.svelte';
  import { uniformMarkColor, uniformBlockAttr } from '../../../utils/selectionFormat';
  import { stepFontSize } from '../../../editor/extensions/shortcuts';

  import { clipboardCommand, readClipboard } from '../../../editor/contextMenuItems';
  import { BULLET_TYPES } from '../../../utils/bulletListTypes';
  import { ORDERED_LIST_TYPES, type OrderedListType } from '../../../utils/orderedListTypes';
  import { effectiveOrderedTypeAt } from '../../../editor/extensions/orderedList';
  import { isInHeaderCell } from '../../../editor/extensions/tableHeaderRow';
  import { cellRegionText } from '../../../editor/extensions/tableStyle';
  import { styleSheet } from '../../../styles/sheet.svelte';
  import type { CapsMode, LineStyle } from '../../../editor/extensions/textEffects';
  import type { StyleFamily } from '../../../styles/styleSheet';
  import { t } from '../../../i18n/i18n.svelte';
  import { withShortcut } from '../../../i18n/shortcut';
  import { shortcutHint, type ShortcutId } from '../../../editor/shortcuts';

  let { editor, tick, showFormattingMarks = $bindable(false), onManageStyles, onFind }: {
    editor: Editor | null;
    tick: number;
    showFormattingMarks?: boolean;
    onManageStyles?: (family: StyleFamily) => void;
    onFind?: (mode: 'find' | 'replace') => void;
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
  let isSuper = $derived(tick >= 0 && !!editor?.isActive('superscript'));
  let isSub = $derived(tick >= 0 && !!editor?.isActive('subscript'));
  let isBulletList = $derived(tick >= 0 && !!editor?.isActive('bulletList'));
  let isOrderedList = $derived(tick >= 0 && !!editor?.isActive('orderedList'));
  let align = $derived(tick >= 0 && editor ? (['left', 'center', 'right', 'justify'].find((a) => editor!.isActive({ textAlign: a })) ?? '') : '');

  let fontColor = $derived(tick >= 0 && editor ? uniformMarkColor(editor.state, 'textStyle') : null);
  let highlight = $derived(tick >= 0 && editor ? uniformMarkColor(editor.state, 'highlight') : null);
  let paraShade = $derived(tick >= 0 && editor ? (uniformBlockAttr<string | null>(editor.state, 'backgroundColor', null) || null) : null);
  let lineHeight = $derived(tick >= 0 && editor ? uniformBlockAttr(editor.state, 'lineHeight', '1') : '1');

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

  const LINE_STYLES: LineStyle[] = ['solid', 'double', 'dotted', 'dashed', 'wavy'];

  // The mark has to exist before its line style means anything, so turn it on too.
  function setLineStyle(mark: 'underline' | 'strike', style: LineStyle) {
    closeMenu();
    if (!editor) return;
    const chain = editor.chain().focus();
    if (!editor.isActive(mark)) chain.setMark(mark);
    chain.updateAttributes(mark, { lineStyle: style }).run();
  }

  // Inside a list Tab/Shift-Tab nest instead of shifting the paragraph's indent.
  function changeIndent(dir: 1 | -1) {
    if (!editor) return;
    const inList = editor.isActive('bulletList') || editor.isActive('orderedList');
    const chain = editor.chain().focus();
    if (inList) (dir > 0 ? chain.indentListForward() : chain.indentListBackward()).run();
    else (dir > 0 ? chain.indentMore() : chain.indentLess()).run();
  }

  const LINE_HEIGHTS = ['1', '1.15', '1.5', '2'];
  const LH_SHORTCUTS: Record<string, ShortcutId | undefined> = {
    '1': 'lineHeight1', '1.5': 'lineHeight15', '2': 'lineHeight2',
  };

  function lineHeightLabel(v: string): string {
    if (v === '1') return t().toolbarExpanded.lineSingle;
    if (v === '2') return t().toolbarExpanded.lineDouble;
    return v;
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
</script>

<RibbonGroup label={t().ribbon.groups.clipboard}>
  <RibbonButton
    variant="big"
    icon="paste"
    label={t().contextMenu.paste}
    title={`${t().contextMenu.paste} (${withShortcut('Ctrl+V')})`}
    disabled={!editor}
    onclick={() => editor && void readClipboard(editor, false)}
  />
  <div class="rb-col">
    <RibbonButton variant="small" icon="cut" label={t().contextMenu.cut} title={`${t().contextMenu.cut} (${withShortcut('Ctrl+X')})`} disabled={!hasSelection} onclick={() => editor && clipboardCommand(editor, 'cut')} />
    <RibbonButton variant="small" icon="copy" label={t().contextMenu.copy} title={`${t().contextMenu.copy} (${withShortcut('Ctrl+C')})`} disabled={!hasSelection} onclick={() => editor && clipboardCommand(editor, 'copy')} />
  </div>
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().ribbon.groups.font}>
  <div class="rb-rows">
    <div class="rb-row">
      <FontFamilyBox {editor} {tick} />
      <FontSizeBox {editor} {tick} />
      <RibbonButton title={t().toolbarExpanded.growFont} content={growIcon} onclick={() => editor && stepFontSize(editor, 1)} />
      <RibbonButton title={t().toolbarExpanded.shrinkFont} content={shrinkIcon} onclick={() => editor && stepFontSize(editor, -1)} />
      <div class="rb-menu-wrap" use:clickOutside={'case'}>
        <RibbonButton icon="changeCase" title={t().ribbon.case.title} caretActive={isMenuOpen('case')} caret onCaret={() => toggleMenu('case')} onclick={() => toggleMenu('case')} />
        {#if isMenuOpen('case')}
          <div class="ribbon-menu" use:anchored role="menu">
            {#each CASES as c}
              <button onclick={() => setCase(c.mode)}>{c.label}</button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
    <div class="rb-row">
      <RibbonButton content={boldIcon} title={`${t().toolbar.bold} (${withShortcut('Ctrl+B')})`} active={isBold} onclick={toggleBold} />
      <RibbonButton content={italicIcon} title={`${t().toolbar.italic} (${withShortcut('Ctrl+I')})`} active={isItalic} onclick={() => editor?.chain().focus().toggleItalic().run()} />
      <div class="rb-menu-wrap" use:clickOutside={'underline'}>
        <RibbonButton content={underlineIcon} title={`${t().toolbar.underline} (${withShortcut('Ctrl+U')})`} active={isUnderline} caret caretActive={isMenuOpen('underline')} onclick={() => editor?.chain().focus().toggleUnderline().run()} onCaret={() => toggleMenu('underline')} />
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
        <RibbonButton content={strikeIcon} title={`${t().toolbar.strikethrough} (${withShortcut('Ctrl+Shift+S')})`} active={isStrike} caret caretActive={isMenuOpen('strike')} onclick={() => editor?.chain().focus().toggleStrike().run()} onCaret={() => toggleMenu('strike')} />
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
      <RibbonButton icon="subscript" title={`${t().toolbarExpanded.subscript} (${shortcutHint('subscript')})`} active={isSub} onclick={toggleSub} />
      <RibbonButton icon="superscript" title={`${t().toolbarExpanded.superscript} (${shortcutHint('superscript')})`} active={isSuper} onclick={toggleSuper} />
      <span class="rb-mini-sep"></span>
      <ColorPicker
        {editor}
        currentColor={highlight}
        defaultColor="#FFFF00"
        title={t().toolbarExpanded.highlightColor}
        chevronTitle={t().toolbarExpanded.chooseHighlightColor}
        clearLabel={t().toolbarExpanded.noColor}
        onApply={(c, r) => editor?.chain().focus().setTextSelection(r).setHighlight({ color: c }).run()}
        onClear={(r) => editor?.chain().focus().setTextSelection(r).unsetHighlight().run()}
        icon={highlightIcon}
      />
      <ColorPicker
        {editor}
        currentColor={fontColor}
        defaultColor="#C00000"
        title={t().toolbarExpanded.fontColor}
        chevronTitle={t().toolbarExpanded.chooseFontColor}
        onApply={(c, r) => editor?.chain().focus().setTextSelection(r).setColor(c).run()}
        onClear={(r) => editor?.chain().focus().setTextSelection(r).unsetColor().run()}
        icon={fontColorIcon}
      />
      <RibbonButton icon="clearFormat" title={`${t().toolbarExpanded.clearFormatting} (${shortcutHint('clearFormatting')})`} onclick={() => editor?.commands.clearDirectFormatting()} />
    </div>
  </div>
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().ribbon.groups.paragraph}>
  <div class="rb-rows">
    <div class="rb-row">
      <div class="rb-menu-wrap" use:clickOutside={'bullets'}>
        <RibbonButton icon="bulletList" title={t().toolbar.bulletList} active={isBulletList} caret caretActive={isMenuOpen('bullets')} onclick={() => editor?.chain().focus().toggleBulletList().run()} onCaret={() => toggleMenu('bullets')} />
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
          </div>
        {/if}
      </div>
      <div class="rb-menu-wrap" use:clickOutside={'numbering'}>
        <RibbonButton icon="orderedList" title={t().toolbar.orderedList} active={isOrderedList} caret caretActive={isMenuOpen('numbering')} onclick={() => editor?.chain().focus().toggleOrderedList().run()} onCaret={() => toggleMenu('numbering')} />
        {#if isMenuOpen('numbering')}
          <div class="ribbon-menu" use:anchored role="menu">
            <div class="rb-menu-label">{t().toolbar.numbering}</div>
            {#each ORDERED_LIST_TYPES as o}
              <button class:selected={currentOrderedType === o.key} onclick={() => applyOrderedType(o.key)}>
                <span class="marker">{o.preview}</span>{o.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <span class="rb-mini-sep"></span>
      <RibbonButton icon="indentLess" title={t().toolbarExpanded.decreaseIndent} onclick={() => changeIndent(-1)} />
      <RibbonButton icon="indentMore" title={t().toolbarExpanded.increaseIndent} onclick={() => changeIndent(1)} />
      <span class="rb-mini-sep"></span>
      <RibbonButton icon="pilcrow" title={`${t().toolbarExpanded.formattingMarks} (${shortcutHint('formattingMarks')})`} active={showFormattingMarks} onclick={() => (showFormattingMarks = !showFormattingMarks)} />
    </div>
    <div class="rb-row">
      {#each (['left', 'center', 'right', 'justify'] as const) as a}
        <RibbonButton
          icon={a === 'left' ? 'alignLeft' : a === 'center' ? 'alignCenter' : a === 'right' ? 'alignRight' : 'alignJustify'}
          title={`${t().align.alignTo(t().align[a])} (${shortcutHint(`align${a[0].toUpperCase()}${a.slice(1)}` as ShortcutId)})`}
          active={align === a}
          onclick={() => editor?.chain().focus().setTextAlign(a).run()}
        />
      {/each}
      <div class="rb-menu-wrap" use:clickOutside={'lineHeight'}>
        <RibbonButton icon="lineSpacing" title={t().toolbarExpanded.lineSpacing} caret caretActive={isMenuOpen('lineHeight')} onclick={() => toggleMenu('lineHeight')} onCaret={() => toggleMenu('lineHeight')} />
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
      <ColorPicker
        {editor}
        currentColor={paraShade}
        defaultColor="#D9D9D9"
        title={t().toolbarExpanded.paragraphShading}
        chevronTitle={t().toolbarExpanded.chooseParagraphShading}
        clearLabel={t().toolbarExpanded.noColor}
        onApply={(c, r) => editor?.chain().focus().setTextSelection(r).setParagraphBackground(c).run()}
        onClear={(r) => editor?.chain().focus().setTextSelection(r).setParagraphBackground(null).run()}
        icon={shadingIcon}
      />
      <ParagraphBorderPicker {editor} {tick} />
    </div>
  </div>
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().toolbar.styles.title} grow>
  <StyleGallery {editor} {tick} {onManageStyles} />
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().ribbon.groups.editing}>
  <div class="rb-col">
    <RibbonButton variant="small" icon="find" label={t().ribbon.find} title={`${t().ribbon.find} (${shortcutHint('find')})`} onclick={() => onFind?.('find')} />
    <RibbonButton variant="small" icon="replace" label={t().ribbon.replace} title={`${t().ribbon.replace} (${shortcutHint('replace')})`} onclick={() => onFind?.('replace')} />
  </div>
</RibbonGroup>

{#snippet boldIcon()}<span class="glyph" style="font-weight: 800">B</span>{/snippet}
{#snippet italicIcon()}<span class="glyph" style="font-style: italic; font-family: serif">I</span>{/snippet}
{#snippet underlineIcon()}<span class="glyph" style="text-decoration: underline">U</span>{/snippet}
{#snippet strikeIcon()}<span class="glyph" style="text-decoration: line-through">S</span>{/snippet}
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
