<script lang="ts">
  import ReadGate from '../ReadGate.svelte';
  import type { Editor } from '@tiptap/core';
  import IslandButton from './IslandButton.svelte';
  import IslandMenu from './IslandMenu.svelte';
  import DictationButton from '../DictationButton.svelte';
  import ColorPicker from '../ColorPicker.svelte';
  import ParagraphBorderPicker from '../ParagraphBorderPicker.svelte';
  import { closeMenu } from '../ribbon/menu.svelte';
  import { changeIndent } from '../formatCommands';
  import { clipboardCommand, readClipboard } from '../../editor/contextMenuItems';
  import { painterClick, painting } from '../../editor/formatPainter.svelte';
  import { stepFontSize } from '../../editor/extensions/shortcuts';
  import { emphasisCss, hasTextEffect, type CapsMode, type Emphasis } from '../../editor/extensions/textEffects';
  import TextEffectsMenu from './TextEffectsMenu.svelte';
  import TextEffectsIcon from './TextEffectsIcon.svelte';
  import { hasAsianLanguage, uniformBlockAttr } from '../../utils/selectionFormat';
  import { t } from '../../i18n/i18n.svelte';
  import { formatDecimal, parseDecimal } from '../../i18n/number';
  import { withShortcut } from '../../i18n/shortcut';
  import { shortcutHint, type ShortcutId } from '../../editor/shortcuts';

  // The Home category: what the ribbon's Home tab has beyond the island's first row.
  let { editor, tick, asianDocument = false, showFormattingMarks = $bindable(false), onFind, onParagraphDialog }: {
    editor: Editor | null;
    tick: number;
    asianDocument?: boolean;
    showFormattingMarks?: boolean;
    onFind?: (mode: 'find' | 'replace') => void;
    onParagraphDialog?: () => void;
  } = $props();

  let hasSelection = $derived(tick >= 0 && !!editor && !editor.state.selection.empty);
  let isSuper = $derived(tick >= 0 && !!editor?.isActive('superscript'));
  let isSub = $derived(tick >= 0 && !!editor?.isActive('subscript'));
  let asianSelection = $derived(tick >= 0 && !!editor && hasAsianLanguage(editor.state));
  let emphasis = $derived(tick >= 0 ? editor?.getAttributes('textStyle').emphasis ?? null : null);
  let hasEffect = $derived(tick >= 0 && !!editor && hasTextEffect(editor.getAttributes('textStyle')));
  let paraShade = $derived(tick >= 0 && editor ? (uniformBlockAttr<string | null>(editor.state, 'backgroundColor', null) || null) : null);
  let lineHeight = $derived(tick >= 0 && editor ? uniformBlockAttr(editor.state, 'lineHeight', '1') : '1');
  let spaceBefore = $derived(tick >= 0 && editor ? uniformBlockAttr<number | null>(editor.state, 'spaceBefore', null) : null);
  let spaceAfter = $derived(tick >= 0 && editor ? uniformBlockAttr<number | null>(editor.state, 'spaceAfter', null) : null);

  function paste(plainOnly: boolean) {
    closeMenu();
    if (editor) void readClipboard(editor, plainOnly);
  }

  const CASES: { mode: CapsMode | null; key: 'none' | 'upper' | 'lower' | 'capitalize' | 'smallCaps' }[] = [
    { mode: null, key: 'none' },
    { mode: 'uppercase', key: 'upper' },
    { mode: 'lowercase', key: 'lower' },
    { mode: 'capitalize', key: 'capitalize' },
    { mode: 'smallCaps', key: 'smallCaps' },
  ];

  // Chinese sets its emphasis dots below the characters, so that is the button's own.
  const EMPHASES: { mode: Emphasis | null; key: 'none' | 'dotBelow' | 'dotAbove' | 'circle' | 'disc' | 'accent' }[] = [
    { mode: null, key: 'none' },
    { mode: 'dot below', key: 'dotBelow' },
    { mode: 'dot above', key: 'dotAbove' },
    { mode: 'circle above', key: 'circle' },
    { mode: 'disc above', key: 'disc' },
    { mode: 'accent above', key: 'accent' },
  ];

  function setTextStyle(attrs: Record<string, unknown>) {
    closeMenu();
    editor?.chain().focus().setMark('textStyle', attrs).run();
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

  // Empty is the style's own spacing (null); otherwise points.
  function setSpace(axis: 'before' | 'after', raw: string) {
    const v = raw.trim() === '' ? null : parseDecimal(raw);
    if (v !== null && (isNaN(v) || v < 0 || v > 200)) return;
    const chain = editor?.chain().focus();
    (axis === 'before' ? chain?.setSpaceBefore(v) : chain?.setSpaceAfter(v))?.run();
  }
</script>

<div class="toolbar-group">
  <ReadGate>
  <IslandMenu id="paste" icon="paste" cmd="paste" title={`${t().contextMenu.paste} (${withShortcut('Ctrl+V')})`} disabled={!editor}>
    <!-- The engine reads the clipboard either as HTML or as text, so there is no third choice. -->
    <button onclick={() => paste(false)}>{t().contextMenu.paste}<span class="menu-key">{withShortcut('Ctrl+V')}</span></button>
    <button data-cmd="pastePlain" onclick={() => paste(true)}>{t().contextMenu.pasteWithoutFormatting}<span class="menu-key">{withShortcut('Ctrl+Shift+V')}</span></button>
  </IslandMenu>
  <IslandButton icon="cut" cmd="cut" title={`${t().contextMenu.cut} (${withShortcut('Ctrl+X')})`} disabled={!hasSelection} onclick={() => editor && clipboardCommand(editor, 'cut')} />
  </ReadGate>
  <IslandButton icon="copy" cmd="copy" title={`${t().contextMenu.copy} (${withShortcut('Ctrl+C')})`} disabled={!hasSelection} onclick={() => editor && clipboardCommand(editor, 'copy')} />
  <ReadGate><IslandButton icon="formatPainter" cmd="formatPainter" title={`${t().toolbarExpanded.formatPainter} – ${t().toolbarExpanded.formatPainterHint}`} disabled={!editor?.isEditable} active={painting()} onclick={(e) => painterClick(editor?.state, e)} /></ReadGate>
</div>

<div class="toolbar-separator"></div>
<ReadGate>

<div class="toolbar-group">
  <IslandButton content={growIcon} cmd="growFont" title={`${t().toolbarExpanded.growFont} (${shortcutHint('fontGrow')})`} onclick={() => editor && stepFontSize(editor, 1)} />
  <IslandButton content={shrinkIcon} cmd="shrinkFont" title={`${t().toolbarExpanded.shrinkFont} (${shortcutHint('fontShrink')})`} onclick={() => editor && stepFontSize(editor, -1)} />
  <IslandMenu id="case" icon="changeCase" cmd="changeCase" title={t().ribbon.case.title}>
    {#each CASES as c}
      <button data-cmd={`case-${c.mode ?? 'none'}`} onclick={() => setTextStyle({ caps: c.mode })}>{t().ribbon.case[c.key]}</button>
    {/each}
  </IslandMenu>
  <IslandMenu id="textEffects" content={effectsIcon} cmd="textEffects" title={t().ribbon.textEffects.title}
    active={hasEffect}>
    <TextEffectsMenu {editor} {tick} onDone={closeMenu} />
  </IslandMenu>
  <!-- East Asian typography only (document, UI or selected text language); a mark already in the text keeps the button to clear it. -->
  {#if asianDocument || asianSelection || emphasis}
    <IslandMenu id="emphasis" content={emphasisIcon} cmd="emphasis" title={t().ribbon.emphasis.title} active={!!emphasis}
      onclick={() => editor?.chain().focus().setMark('textStyle', { emphasis: emphasis ? null : 'dot below' }).run()}>
      {#each EMPHASES as e}
        <button onclick={() => setTextStyle({ emphasis: e.mode })}>
          <span style={e.mode ? emphasisCss(e.mode) : null}>{t().ribbon.emphasis[e.key]}</span>
        </button>
      {/each}
    </IslandMenu>
  {/if}
  <IslandButton content={superIcon} cmd="superscript" title={`${t().toolbarExpanded.superscript} (${shortcutHint('superscript')})`} active={isSuper} onclick={() => editor?.chain().focus().unsetSubscript().toggleSuperscript().run()} />
  <IslandButton content={subIcon} cmd="subscript" title={`${t().toolbarExpanded.subscript} (${shortcutHint('subscript')})`} active={isSub} onclick={() => editor?.chain().focus().unsetSuperscript().toggleSubscript().run()} />
</div>

<div class="toolbar-separator"></div>

<div class="toolbar-group">
  <IslandButton icon="indentLess" cmd="indentLess" title={t().toolbarExpanded.decreaseIndent} onclick={() => editor && changeIndent(editor, -1)} />
  <IslandButton icon="indentMore" cmd="indentMore" title={t().toolbarExpanded.increaseIndent} onclick={() => editor && changeIndent(editor, 1)} />
  <IslandMenu id="lineHeight" icon="lineSpacing" cmd="lineSpacing" title={t().toolbarExpanded.lineParagraphSpacing} minWidth={200}>
    <div class="im-label">{t().toolbarExpanded.lineSpacing}</div>
    {#each LINE_HEIGHTS as h}
      <button class:selected={lineHeight === h} onclick={() => { closeMenu(); editor?.chain().focus().setLineHeight(h).run(); }}>
        {lineHeightLabel(h)}
        {#if LH_SHORTCUTS[h]}<span class="menu-key">{shortcutHint(LH_SHORTCUTS[h]!)}</span>{/if}
      </button>
    {/each}
    <hr />
    <div class="im-grid">
      <label class="im-field">
        <span>{t().toolbarExpanded.spaceBefore} (pt)</span>
        <input type="text" inputmode="decimal" placeholder={t().toolbarExpanded.spacingDefault} value={typeof spaceBefore === 'number' ? formatDecimal(spaceBefore) : ''}
          onchange={(e) => setSpace('before', e.currentTarget.value)} />
      </label>
      <label class="im-field">
        <span>{t().toolbarExpanded.spaceAfter} (pt)</span>
        <input type="text" inputmode="decimal" placeholder={t().toolbarExpanded.spacingDefault} value={typeof spaceAfter === 'number' ? formatDecimal(spaceAfter) : ''}
          onchange={(e) => setSpace('after', e.currentTarget.value)} />
      </label>
    </div>
  </IslandMenu>
  <span class="cmd" data-cmd="paragraphShading"><ColorPicker
    {editor}
    currentColor={paraShade}
    defaultColor="#D9D9D9"
    title={t().toolbarExpanded.paragraphShading}
    chevronTitle={t().toolbarExpanded.chooseParagraphShading}
    clearLabel={t().toolbarExpanded.noColor}
    onOpen={closeMenu}
    onApply={(c, r) => editor?.chain().focus().setTextSelection(r).setParagraphBackground(c).run()}
    onClear={(r) => editor?.chain().focus().setTextSelection(r).setParagraphBackground(null).run()}
  >
    {#snippet icon()}
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 13h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <rect x="3" y="3" width="10" height="7" rx="1" fill="currentColor" opacity="0.3" stroke="currentColor" stroke-width="1.2"/>
      </svg>
    {/snippet}
  </ColorPicker></span>
  <span class="cmd" data-cmd="paragraphBorders"><ParagraphBorderPicker {editor} {tick} /></span>
  <IslandButton icon="pilcrow" cmd="formattingMarks" title={`${t().toolbarExpanded.formattingMarks} (${shortcutHint('formattingMarks')})`} active={showFormattingMarks} onclick={() => (showFormattingMarks = !showFormattingMarks)} />
  <IslandButton content={launcherIcon} title={t().paragraphDialog.title} disabled={!editor} onclick={() => onParagraphDialog?.()} />
</div>
</ReadGate>

<div class="toolbar-separator"></div>

<div class="toolbar-group">
  <IslandButton icon="find" cmd="find" title={`${t().ribbon.find} (${shortcutHint('find')})`} onclick={() => onFind?.('find')} />
  <ReadGate>
  <IslandButton icon="replace" cmd="replace" title={`${t().ribbon.replace} (${shortcutHint('replace')})`} onclick={() => onFind?.('replace')} />
  <DictationButton variant="island" cmd="dictate" disabled={!editor} />
  </ReadGate>
</div>

{#snippet growIcon()}
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <text x="5" y="14" text-anchor="middle" font-size="15" font-family="sans-serif" fill="currentColor">A</text>
    <path d="M12.5 12V5m0 0L10.5 7m2-2l2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
{/snippet}
{#snippet shrinkIcon()}
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <text x="5" y="14" text-anchor="middle" font-size="11" font-family="sans-serif" fill="currentColor">A</text>
    <path d="M12.5 5v7m0 0l-2-2m2 2l2-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
{/snippet}
{#snippet superIcon()}
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2.5 11.5L7 5M7 11.5L2.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M10.5 4.7c0-.8.7-1.4 1.5-1.4s1.5.6 1.5 1.4c0 1.2-1.6 1.5-3 3.1h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
{/snippet}
{#snippet subIcon()}
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2.5 11.5L7 5M7 11.5L2.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M10.5 12.2c0-.8.7-1.4 1.5-1.4s1.5.6 1.5 1.4c0 1.2-1.6 1.5-3 3.1h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
{/snippet}
{#snippet effectsIcon()}<TextEffectsIcon />{/snippet}
{#snippet emphasisIcon()}<span style="text-emphasis: filled dot; text-emphasis-position: under right; font-size: 13px">文</span>{/snippet}
<!-- The ribbon's ↘ group launcher: it opens the dialog with every paragraph setting. -->
{#snippet launcherIcon()}
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 3.5h12M2 6.5h8M2 9.5h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M14 9.5v4.5H9.5M13.6 13.6 9.8 9.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
{/snippet}
