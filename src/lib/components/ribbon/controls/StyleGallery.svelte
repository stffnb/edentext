<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import Icon from '../Icon.svelte';
  import { anchored, clickOutside, isMenuOpen, toggleMenu, closeMenu } from '../menu.svelte';
  import { blockStyleName } from '../../../editor/extensions/paragraphStyle';
  import { activeCharacterStyle } from '../../../editor/extensions/characterStyle';
  import { DEFAULT_STYLE, headingStyleName, resolveStyle, styleOrder, type StyleFamily } from '../../../styles/styleSheet';
  import { styleSheet } from '../../../styles/sheet.svelte';
  import { t } from '../../../i18n/i18n.svelte';
  import { shortcutHint, type ShortcutId } from '../../../editor/shortcuts';

  let { editor, tick, onManageStyles }: {
    editor: Editor | null;
    tick: number;
    onManageStyles?: (family: StyleFamily) => void;
  } = $props();

  const ID = 'styleGallery';

  let sheet = $derived(styleSheet());
  let paraStyles = $derived(styleOrder(sheet));
  let charStyles = $derived(Object.values(sheet.character ?? {}));

  let current = $derived.by<string>(() => {
    if (tick < 0 || !editor) return DEFAULT_STYLE;
    return blockStyleName(editor.state.selection.$from.parent as never);
  });

  let currentChar = $derived.by<string | null>(() => {
    if (tick < 0 || !editor) return null;
    return activeCharacterStyle(editor.state as never);
  });

  // Built-in names are translated; a user style shows its own.
  function label(name: string): string {
    const s = t().toolbar.styles;
    return ({
      Standard: s.default, Title: s.docTitle, Subtitle: s.subtitle, Quotations: s.quote,
      'Heading 1': t().toolbar.heading1, 'Heading 2': t().toolbar.heading2,
      'Heading 3': t().toolbar.heading3, 'Heading 4': t().toolbar.heading4,
      'Heading 5': t().toolbar.heading5,
    } as Record<string, string>)[name] ?? name;
  }

  // Only the styles the Shortcuts extension binds carry a hint.
  function styleShortcut(name: string): string | undefined {
    if (name === DEFAULT_STYLE) return shortcutHint('styleStandard');
    const level = sheet.paragraph[name]?.outlineLevel;
    if (!level || level > 5 || name !== headingStyleName(level)) return undefined;
    return shortcutHint(`heading${level}` as ShortcutId);
  }

  // Previews the style at 1px per pt. A tile takes 21 as its ceiling — measured:
  // the widest four letters at that size still clear its inner width — and a menu
  // row keeps the smaller one, since it also carries a shortcut hint.
  function tileStyle(name: string, max = 15): string {
    const s = resolveStyle(sheet, name);
    const pt = s.text.fontSizePt ?? 12;
    return `font-size: ${Math.min(max, Math.max(Math.min(13, max), pt))}px;`
      + `font-weight: ${s.text.bold ? 700 : 400};`
      + `font-style: ${s.text.italic ? 'italic' : 'normal'};`
      + `font-family: ${s.text.fontFamily ?? 'inherit'};`
      + (s.text.color ? `color: ${s.text.color};` : '');
  }

  function apply(name: string) {
    closeMenu();
    if (!editor) return;
    const level = sheet.paragraph[name]?.outlineLevel;
    // The header/footer schema has no heading node.
    if (level && !editor.schema.nodes.heading) return;
    editor.commands.setParagraphStyle(name);
  }

  function applyChar(name: string) {
    closeMenu();
    if (!editor) return;
    // Clicking the active one removes it, like a toggle.
    if (currentChar === name) editor.chain().focus().unsetCharacterStyle().run();
    else editor.chain().focus().setCharacterStyle(name).run();
  }
</script>

<div class="gallery-wrap" use:clickOutside={ID}>
  <div class="gallery-strip">
    {#each paraStyles as s}
      <button
        class="tile"
        class:active={current === s.name}
        onclick={() => apply(s.name)}
        title={styleShortcut(s.name) ? `${label(s.name)} (${styleShortcut(s.name)})` : label(s.name)}
        aria-pressed={current === s.name}
      >
        <span class="tile-sample" style={tileStyle(s.name, 21)}>AaBb</span>
        <span class="tile-name">{label(s.name)}</span>
      </button>
    {/each}
  </div>
  <button class="gallery-more" onclick={() => toggleMenu(ID)} title={t().toolbar.styles.title} aria-haspopup="menu" aria-expanded={isMenuOpen(ID)}>
    <Icon name="chevronDown" size={10} />
  </button>
  {#if isMenuOpen(ID)}
    <div class="ribbon-menu gallery-menu" use:anchored={'right'} role="menu">
      <div class="menu-scroll">
        <div class="rb-menu-label">{t().toolbar.styles.title}</div>
        {#each paraStyles as s}
          <button class:selected={current === s.name} style={tileStyle(s.name)} onclick={() => apply(s.name)}>
            {label(s.name)}
            {#if styleShortcut(s.name)}<span class="menu-key">{styleShortcut(s.name)}</span>{/if}
          </button>
        {/each}
        {#if charStyles.length}
          <div class="rb-menu-label">{t().styles.characterStyles}</div>
          {#each charStyles as c}
            <button class:selected={currentChar === c.name} style={tileStyle(c.name)} onclick={() => applyChar(c.name)}>{c.name}</button>
          {/each}
        {/if}
      </div>
      <button class="rb-menu-foot" onclick={() => { closeMenu(); onManageStyles?.('paragraph'); }}>{t().styles.manage}</button>
    </div>
  {/if}
</div>

<style>
  /* The group centres its controls; a gallery tile is Word's full-height card, so
     it opts out and fills the band instead. */
  .gallery-wrap {
    position: relative;
    display: flex;
    align-items: stretch;
    align-self: stretch;
    flex: 1;
    min-width: 0;
    gap: 3px;
  }

  /* Scrolls rather than wrapping, so the group keeps the band's fixed height. */
  .gallery-strip {
    display: flex;
    align-items: stretch;
    gap: 3px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .gallery-strip::-webkit-scrollbar { display: none; }

  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    /* Wide enough for the longest style name in either locale: 'Überschrift 4'
       measures 58.4px, and truncating a numbered family before its number tells
       the five headings apart not at all. */
    width: 72px;
    border: 1px solid var(--w-border);
    border-radius: 4px;
    background: var(--w-surface);
    padding: 4px;
    cursor: pointer;
    overflow: hidden;
  }

  .tile:hover { border-color: var(--w-accent); background: var(--w-hover); }
  .tile.active { border-color: var(--w-accent); background: var(--w-accent-soft, #e8f1fb); }

  /* Takes the height the name leaves over and centres the sample in it, so the
     name stays on the tile's bottom edge whatever the sample's size. */
  .tile-sample {
    display: flex;
    align-items: center;
    flex: 1;
    line-height: 1.1;
    white-space: nowrap;
    color: var(--w-text);
  }

  .tile-name {
    max-width: 100%;
    font-family: var(--w-font);
    font-size: 9px;
    font-weight: 400;
    font-style: normal;
    color: var(--w-text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .gallery-more {
    flex-shrink: 0;
    width: 17px;
    border: 1px solid var(--w-border);
    border-radius: 4px;
    background: var(--w-surface);
    color: var(--w-text-dim);
    cursor: pointer;
  }

  .gallery-more:hover { background: var(--w-hover); }

  .gallery-menu {
    max-height: 380px;
    min-width: 220px;
    overflow: hidden;
  }
</style>
