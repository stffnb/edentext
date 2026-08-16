<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import HistoryButton from './HistoryButton.svelte';
  import AlignButton from './AlignButton.svelte';
  import { ORDERED_LIST_TYPES, type OrderedListType } from '../utils/orderedListTypes';
  import { BULLET_TYPES } from '../utils/bulletListTypes';
  import { effectiveOrderedTypeAt } from '../editor/extensions/orderedList';
  import { isInHeaderCell } from '../editor/extensions/tableHeaderRow';
  import { cellRegionText } from '../editor/extensions/tableStyle';
  import { blockStyleName } from '../editor/extensions/paragraphStyle';
  import { activeCharacterStyle } from '../editor/extensions/characterStyle';
  import { DEFAULT_STYLE, headingStyleName, resolveStyle, visibleStyles, type StyleFamily } from '../styles/styleSheet';
  import { MAX_HEADING_LEVEL } from '../export/odt';
  import { showAllStyles, styleSheet, toggleAllStyles } from '../styles/sheet.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { withShortcut } from '../i18n/shortcut';
  import { shortcutHint, type ShortcutId } from '../editor/shortcuts';

  // Bullet-marker tooltip by char, with the char itself as fallback.
  function bulletName(char: string): string {
    return (t().toolbar.bullets as Record<string, string>)[char] ?? char;
  }

  // The style manager is mounted once in App.svelte; the gallery only asks for it.
  let { editor, tick, onManageStyles }: {
    editor: Editor | null;
    tick: number;
    onManageStyles?: (family: StyleFamily) => void;
  } = $props();

  // The document's named paragraph styles (LibreOffice model): the gallery lists the
  // registry, assigning one only sets the style — hard formatting stays, as in Word/LO.
  let sheet = $derived(styleSheet());
  // Character styles apply to the selected run, not the block (LibreOffice's second family).
  let charStyles = $derived(Object.values(sheet.character ?? {}));
  let currentCharStyle = $derived.by<string | null>(() => {
    if (tick < 0 || !editor) return null;
    return activeCharacterStyle(editor.state as never);
  });

  function applyCharStyle(name: string) {
    stylesOpen = false;
    if (!editor) return;
    // Clicking the active one removes it, like a toggle.
    if (currentCharStyle === name) editor.chain().focus().unsetCharacterStyle().run();
    else editor.chain().focus().setCharacterStyle(name).run();
  }

  // Built-in names are translated; user styles show their own name.
  function styleLabel(name: string): string {
    const s = t().toolbar.styles;
    return ({
      Standard: s.default, Title: s.docTitle, Subtitle: s.subtitle, Quotations: s.quote,
      'Heading 1': t().toolbar.heading1, 'Heading 2': t().toolbar.heading2,
      'Heading 3': t().toolbar.heading3, 'Heading 4': t().toolbar.heading4,
      'Heading 5': t().toolbar.heading5, 'Heading 6': t().toolbar.heading6,
    } as Record<string, string>)[name] ?? name;
  }

  // Menu entries preview their own style, clamped so the list stays compact.
  function previewSize(name: string): string {
    const pt = resolveStyle(sheet, name).text.fontSizePt ?? 12;
    return `${Math.min(1.35, Math.max(0.85, pt / 20))}rem`;
  }

  let stylesOpen = $state(false);

  // $derived re-evaluates whenever `tick` changes (i.e. on every TipTap transaction)
  let isHeading    = $derived(tick >= 0 && !!editor?.isActive('heading'));

  // The style assigned to the cursor's block (headings without one fall back to their level).
  let currentStyle = $derived.by<string>(() => {
    if (tick < 0 || !editor) return DEFAULT_STYLE;
    return blockStyleName(editor.state.selection.$from.parent as never);
  });

  let galleryStyles = $derived(visibleStyles(sheet, showAllStyles(), currentStyle));

  // Only the styles the Shortcuts extension binds carry a hint.
  function styleShortcut(name: string): string | undefined {
    if (name === DEFAULT_STYLE) return shortcutHint('styleStandard');
    const level = sheet.paragraph[name]?.outlineLevel;
    // The keys apply the built-in heading styles, not any style at that level.
    if (!level || level > MAX_HEADING_LEVEL || name !== headingStyleName(level)) return undefined;
    return shortcutHint(`heading${level}` as ShortcutId);
  }

  function applyStyle(name: string) {
    stylesOpen = false;
    if (!editor) return;
    const level = sheet.paragraph[name]?.outlineLevel;
    // The header/footer schema has no heading node.
    if (level && !editor.schema.nodes.heading) return;
    editor.commands.setParagraphStyle(name);
  }

  // Header-row cells render bold by default (CSS), like headings — so the Bold button
  // toggles the fontWeight:'normal' override there too (keeps header bold editable).
  // A table style's regions render the same way, so they count as well.
  let inHeaderCell = $derived(
    tick >= 0 && !!editor
      && (isInHeaderCell(editor.state) || cellRegionText(editor.state, sheet.table).bold === true),
  );
  let boldByDefault = $derived(isHeading || inHeaderCell);
  // fontWeight:'normal' is set explicitly to override the default boldness
  let hasNormalWeight = $derived(tick >= 0 && !!editor?.isActive('textStyle', { fontWeight: 'normal' }));
  // Bold = explicit bold mark, OR a bold-by-default context that hasn't been un-bolded
  let isBold       = $derived(tick >= 0 && (!!editor?.isActive('bold') || (boldByDefault && !hasNormalWeight)));
  let isItalic     = $derived(tick >= 0 && !!editor?.isActive('italic'));
  let isUnderline  = $derived(tick >= 0 && !!editor?.isActive('underline'));
  let isStrike     = $derived(tick >= 0 && !!editor?.isActive('strike'));
  let isBulletList = $derived(tick >= 0 && !!editor?.isActive('bulletList'));
  let isOrderedList= $derived(tick >= 0 && !!editor?.isActive('orderedList'));

  // Effective numbering at the cursor's list level — explicit attr, inherited
  // multilevel chain, or the depth default (null when not in an ordered list).
  let currentOrderedType = $derived.by<OrderedListType | null>(() => {
    if (tick < 0 || !editor || !editor.isActive('orderedList')) return null;
    return effectiveOrderedTypeAt(editor.state);
  });

  let olMenuOpen = $state(false);
  let blMenuOpen = $state(false);

  // Marker char of the innermost bullet list at the cursor (null = default cycle
  // or not in a bullet list).
  let currentBulletChar = $derived.by<string | null>(() => {
    if (tick < 0 || !editor || !editor.isActive('bulletList')) return null;
    return (editor.getAttributes('bulletList').bulletChar ?? null) as string | null;
  });

  // Toggle a plain bullet list — the split button's main half.
  function toggleBulletList() {
    blMenuOpen = false;
    editor?.chain().focus().toggleBulletList().run();
  }

  // Apply a marker char to the innermost list level (null = default); creates the
  // list first if the selection isn't in one.
  function applyBulletChar(char: string | null) {
    if (!editor) return;
    blMenuOpen = false;
    const chain = editor.chain().focus();
    if (!editor.isActive('bulletList')) chain.toggleBulletList();
    chain.setBulletChar(char).run();
  }

  // Toggle a plain (decimal) ordered list — the split button's main half.
  function toggleOrderedList() {
    olMenuOpen = false;
    editor?.chain().focus().toggleOrderedList().run();
  }

  // Apply a numbering style; creates the list first if the selection isn't in one.
  function applyOrderedType(key: OrderedListType) {
    if (!editor) return;
    olMenuOpen = false;
    const chain = editor.chain().focus();
    if (!editor.isActive('orderedList')) chain.toggleOrderedList();
    chain.setOrderedListType(key).run();
  }

  function menuClickOutside(node: HTMLElement, close: () => void) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) close();
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }
</script>

<div class="toolbar">
  {#if editor}
    <div class="toolbar-group">
      <button
        class:active={isBold}
        onclick={() => {
          if (boldByDefault) {
            if (hasNormalWeight) {
              // Restore the default (heading / header-row) bold
              editor?.chain().focus().unsetFontWeight().run();
            } else {
              // Override the default bold with explicit font-weight: normal
              editor?.chain().focus().setFontWeight('normal').run();
            }
          } else {
            editor?.chain().focus().toggleBold().run();
          }
        }}
        title={`${t().toolbar.bold} (${withShortcut('Ctrl+B')})`}
      >
        <strong>B</strong>
      </button>
      <button
        class:active={isItalic}
        onclick={() => editor?.chain().focus().toggleItalic().run()}
        title={`${t().toolbar.italic} (${withShortcut('Ctrl+I')})`}
      >
        <em>I</em>
      </button>
      <button
        class:active={isUnderline}
        onclick={() => editor?.chain().focus().toggleUnderline().run()}
        title={`${t().toolbar.underline} (${withShortcut('Ctrl+U')})`}
      >
        <u>U</u>
      </button>
      <button
        class:active={isStrike}
        onclick={() => editor?.chain().focus().toggleStrike().run()}
        title={`${t().toolbar.strikethrough} (${withShortcut('Ctrl+Shift+S')})`}
      >
        <s>S</s>
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <div class="ol-picker" use:menuClickOutside={() => (stylesOpen = false)}>
        <button
          class="style-button"
          onclick={() => (stylesOpen = !stylesOpen)}
          title={t().toolbar.styles.title}
          aria-haspopup="menu"
          aria-expanded={stylesOpen}
        >
          <span class="style-current">{styleLabel(currentStyle)}</span>
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
            <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        {#if stylesOpen}
          <div class="ol-dropdown style-dropdown" role="menu">
            <div class="menu-scroll">
              <div class="ol-section-label">{t().toolbar.styles.title}</div>
              {#each galleryStyles as s}
                {@const preview = resolveStyle(sheet, s.name)}
                <button
                  class="ol-option style-option"
                  class:active={currentStyle === s.name}
                  onclick={() => applyStyle(s.name)}
                  role="menuitemradio"
                  aria-checked={currentStyle === s.name}
                  title={styleShortcut(s.name)}
                  style="font-size: {previewSize(s.name)}; font-weight: {preview.text.bold ? 600 : 400}; font-style: {preview.text.italic ? 'italic' : 'normal'}"
                >
                  {styleLabel(s.name)}
                </button>
              {/each}
              <button
                class="ol-option style-option show-all"
                class:active={showAllStyles()}
                onclick={toggleAllStyles}
                aria-pressed={showAllStyles()}
              >
                {t().styles.showAll}
              </button>
              {#if charStyles.length}
                <div class="ol-section-label char-label">{t().styles.characterStyles}</div>
                {#each charStyles as c}
                  {@const preview = resolveStyle(sheet, c.name, 'character')}
                  <button
                    class="ol-option style-option"
                    class:active={currentCharStyle === c.name}
                    onclick={() => applyCharStyle(c.name)}
                    role="menuitemradio"
                    aria-checked={currentCharStyle === c.name}
                    style="font-weight: {preview.text.bold ? 600 : 400}; font-style: {preview.text.italic ? 'italic' : 'normal'}; font-family: {preview.text.fontFamily ?? 'inherit'}"
                  >
                    {c.name}
                  </button>
                {/each}
              {/if}
            </div>
            <button class="ol-option manage" onclick={() => { stylesOpen = false; onManageStyles?.('paragraph'); }}>
              <!-- Sliders, as on the Tools button: this opens a settings surface -->
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2 4.5h8M13 4.5h1M2 11.5h1M6 11.5h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                <circle cx="11.5" cy="4.5" r="1.6" stroke="currentColor" stroke-width="1.4"/>
                <circle cx="4.5" cy="11.5" r="1.6" stroke="currentColor" stroke-width="1.4"/>
              </svg>
              {t().styles.manage}
            </button>
          </div>
        {/if}
      </div>
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <div class="ol-picker" use:menuClickOutside={() => (blMenuOpen = false)}>
        <div class="ol-split">
          <button
            class="ol-main"
            class:active={isBulletList}
            onclick={toggleBulletList}
            title={t().toolbar.bulletList}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="2" cy="4" r="1.5" fill="currentColor"/>
              <circle cx="2" cy="8" r="1.5" fill="currentColor"/>
              <circle cx="2" cy="12" r="1.5" fill="currentColor"/>
              <line x1="5.5" y1="4" x2="15" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="5.5" y1="8" x2="15" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="5.5" y1="12" x2="15" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
          <button
            class="ol-chevron"
            class:active={isBulletList}
            onclick={() => (blMenuOpen = !blMenuOpen)}
            title={t().toolbar.bulletSymbol}
            aria-haspopup="menu"
            aria-expanded={blMenuOpen}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
              <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        {#if blMenuOpen}
          <div class="ol-dropdown bl-dropdown" role="menu">
            <div class="ol-section-label">{t().toolbar.bulletSymbol}</div>
            <button
              class="ol-option"
              class:active={isBulletList && currentBulletChar === null}
              onclick={() => applyBulletChar(null)}
              role="menuitemradio"
              aria-checked={isBulletList && currentBulletChar === null}
            >
              <span class="ol-option-preview">•</span>
              <span class="ol-option-label">{t().toolbar.bulletDefault}</span>
            </button>
            <div class="bl-grid">
              {#each BULLET_TYPES as b}
                <button
                  class="bl-tile"
                  class:active={currentBulletChar === b.char}
                  onclick={() => applyBulletChar(b.char)}
                  title={bulletName(b.char)}
                  role="menuitemradio"
                  aria-checked={currentBulletChar === b.char}
                >{b.char}</button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
      <div class="ol-picker" use:menuClickOutside={() => (olMenuOpen = false)}>
        <div class="ol-split">
          <button
            class="ol-main"
            class:active={isOrderedList}
            onclick={toggleOrderedList}
            title={t().toolbar.orderedList}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <text x="0" y="5.5" font-size="5" font-weight="bold" font-family="sans-serif" fill="currentColor">1.</text>
              <text x="0" y="9.5" font-size="5" font-weight="bold" font-family="sans-serif" fill="currentColor">2.</text>
              <text x="0" y="13.5" font-size="5" font-weight="bold" font-family="sans-serif" fill="currentColor">3.</text>
              <line x1="5.5" y1="4" x2="15" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="5.5" y1="8" x2="15" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="5.5" y1="12" x2="15" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
          <button
            class="ol-chevron"
            class:active={isOrderedList}
            onclick={() => (olMenuOpen = !olMenuOpen)}
            title={t().toolbar.numberingStyle}
            aria-haspopup="menu"
            aria-expanded={olMenuOpen}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
              <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        {#if olMenuOpen}
          <div class="ol-dropdown" role="menu">
            <div class="ol-section-label">{t().toolbar.numbering}</div>
            {#each ORDERED_LIST_TYPES as o}
              <button
                class="ol-option"
                class:active={currentOrderedType === o.key}
                onclick={() => applyOrderedType(o.key)}
                title={o.label}
                role="menuitemradio"
                aria-checked={currentOrderedType === o.key}
              >
                <span class="ol-option-preview">{o.preview}</span>
                <span class="ol-option-label">{o.label}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <AlignButton {editor} {tick} />
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <HistoryButton {editor} {tick} direction="undo" />
      <HistoryButton {editor} {tick} direction="redo" />
    </div>
  {/if}
</div>


<style>
  /* Sits inside the header island (which paints the frosted background). Not a
     stacking context: its dropdowns (z:200) must join the header's context so they
     paint above the island scrollbar (z:1) while it stays above the island surface. */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    padding: 0.5rem 1rem;
    background: transparent;
  }

  .toolbar-group {
    display: flex;
    gap: 1px;
  }

  .toolbar-separator {
    width: 1px;
    height: 1.2rem;
    background: var(--color-border);
    margin: 0 0.3rem;
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--toolbar-btn-size);
    height: var(--toolbar-btn-size);
    padding: 0 0.3rem;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-size: 0.85rem;
    font-family: var(--font-sans);
    cursor: pointer;
    transition: background 0.15s;
  }

  button:hover:not(:disabled) {
    background: var(--color-btn-hover);
  }

  button.active {
    background: var(--color-primary);
    color: white;
  }

  button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  /* Plain toolbar buttons gain a primary outline on hover (split buttons handle
     their own; menu items keep border:none so border-color is a no-op). */
  .toolbar-group > button {
    border: 1px solid transparent;
    transition: background 0.15s, border-color 0.15s;
  }

  .toolbar-group > button:hover:not(:disabled) {
    border-color: var(--color-primary);
  }

  /* Style gallery: a combobox-style button showing the block's current style. */
  .style-button {
    justify-content: space-between;
    gap: 0.4rem;
    min-width: 8.5rem;
    padding: 0 0.45rem;
    border: 1px solid var(--color-border);
  }

  .style-button:hover:not(:disabled) {
    border-color: var(--color-primary);
  }

  .style-current {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .style-option {
    line-height: 1.2;
  }

  /* The gallery lists every registered style, so it scrolls inside itself like the
     font picker instead of growing past the viewport. The panel itself never
     scrolls, so an overscroll bounce can't drag its background off the frame. */
  .style-dropdown {
    max-height: 360px;
    overflow: hidden;
  }

  .show-all {
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }

  .char-label {
    margin-top: 2px;
    border-top: 1px solid var(--color-border);
  }

  /* Sits below the scrolling gallery (margins cancel the dropdown's padding) so it
     is reachable without scrolling to the last style. */
  /* Qualified with .ol-option: that rule sits further down the sheet, so at equal
     specificity its width/padding/hover would win over this one's. */
  .ol-option.manage {
    flex-shrink: 0;
    /* auto, so the negative margins bleed the row to both panel edges instead of
       pushing a 100%-wide box 4px past the right one. */
    width: auto;
    margin: 2px -2px -2px;
    padding: 0.45rem 0.6rem;
    gap: 0.45rem;
    background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
    border-top: 1px solid var(--color-border);
    border-radius: 0;
    font-weight: 600;
    white-space: nowrap;
    /* Mixed toward the text color so it stays legible on the dark surfaces too. */
    color: color-mix(in srgb, var(--color-primary) 55%, var(--color-text));
  }

  .manage svg {
    flex-shrink: 0;
  }

  .ol-option.manage:hover {
    background: color-mix(in srgb, var(--color-primary) 16%, var(--color-surface));
  }

  /* Ordered-list split button: main toggle + chevron that opens the numbering
     style menu, rendered as one joined control. */
  .ol-picker {
    position: relative;
  }

  .ol-split {
    display: inline-flex;
    align-items: stretch;
    height: var(--toolbar-btn-size);
    border: 1px solid transparent;
    border-radius: var(--radius);
    overflow: hidden;
    transition: border-color 0.15s;
  }

  .ol-split:hover {
    border-color: var(--color-primary);
  }

  .ol-split:hover .ol-chevron {
    border-left-color: var(--color-border);
  }

  .ol-main {
    min-width: unset;
    height: 100%;
    padding: 0 0.2rem 0 0.3rem;
    border-radius: 0;
  }

  .ol-chevron {
    min-width: unset;
    width: 1rem;
    height: 100%;
    padding: 0;
    border-left: 1px solid transparent;
    border-radius: 0;
    transition: background 0.15s, border-color 0.15s;
  }

  .ol-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    min-width: 170px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 2px;
    display: flex;
    flex-direction: column;
  }

  .ol-section-label {
    padding: 0.4rem 0.6rem 0.2rem;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text);
    font-family: var(--font-sans);
    user-select: none;
  }

  .ol-option {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    min-width: unset;
    height: auto;
    padding: 0.35rem 0.6rem;
    border-radius: calc(var(--radius) - 2px);
    justify-content: flex-start;
    text-align: left;
  }

  .ol-option:hover {
    background: var(--color-btn-hover);
  }

  .ol-option.active {
    background: var(--color-primary);
    color: white;
  }

  .ol-option-preview {
    display: inline-flex;
    justify-content: center;
    min-width: 1.6rem;
    font-family: var(--font-serif, serif);
    font-size: 0.9rem;
  }

  .ol-option-label {
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }

  .ol-option.active .ol-option-label {
    color: white;
  }

  /* Bullet-symbol picker: the curated chars as a compact tile grid. */
  .bl-dropdown {
    min-width: 130px;
  }

  .bl-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2px;
    padding: 2px;
  }

  .bl-tile {
    min-width: unset;
    height: 1.9rem;
    padding: 0;
    border-radius: calc(var(--radius) - 2px);
    /* Same symbol shim the list markers use, so tiles preview the real glyphs. */
    font-family: 'EdenText Symbols', var(--font-serif, serif);
    font-size: 1rem;
  }

  .bl-tile:hover {
    background: var(--color-btn-hover);
  }

  .bl-tile.active {
    background: var(--color-primary);
    color: white;
  }
</style>
