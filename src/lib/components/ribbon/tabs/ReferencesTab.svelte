<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import RibbonGroup from '../RibbonGroup.svelte';
  import RibbonButton from '../RibbonButton.svelte';
  import { anchored, clickOutside, isMenuOpen, toggleMenu, closeMenu } from '../menu.svelte';
  import type { HfZone } from '../../../storage/headerFooter';
  import { t } from '../../../i18n/i18n.svelte';

  let { editor, tick, hfActive = null }: {
    editor: Editor | null;
    tick: number;
    hfActive?: HfZone | null;
  } = $props();

  // The document holds at most one, so the first hit is it.
  let toc = $derived.by<{ pos: number; maxLevel: number } | null>(() => {
    if (tick < 0 || !editor) return null;
    let found: { pos: number; maxLevel: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found || node.type.name !== 'tableOfContents') return;
      found = { pos, maxLevel: (node.attrs.maxLevel ?? 5) as number };
    });
    return found;
  });
  const LEVELS = [1, 2, 3, 4, 5];

  function setMaxLevel(level: number) {
    closeMenu();
    if (!editor || !toc) return;
    editor.chain().focus().setNodeSelection(toc.pos).updateAttributes('tableOfContents', { maxLevel: level }).run();
  }
</script>

<RibbonGroup label={t().ribbon.groups.toc}>
  <RibbonButton
    variant="big"
    icon="toc"
    label={t().ribbon.toc}
    title={hfActive ? t().toolbarExpanded.tocNotInHf : t().toolbarExpanded.insertToc}
    disabled={!editor || !!hfActive}
    onclick={() => editor?.chain().focus().setTableOfContents().run()}
  />
  <div class="rb-menu-wrap" use:clickOutside={'tocLevels'}>
    <RibbonButton
      variant="big"
      icon="tocLevels"
      label={t().ribbon.tocOptions}
      title={t().ribbon.tocOptions}
      disabled={!toc}
      caret
      active={isMenuOpen('tocLevels')}
      onclick={() => toggleMenu('tocLevels')}
    />
    {#if isMenuOpen('tocLevels')}
      <div class="ribbon-menu" use:anchored role="menu">
        <div class="rb-menu-label">{t().ribbon.tocMaxLevel}</div>
        {#each LEVELS as l}
          <button class:selected={toc?.maxLevel === l} onclick={() => setMaxLevel(l)}>{l}</button>
        {/each}
      </div>
    {/if}
  </div>
</RibbonGroup>

<style>
  .rb-menu-wrap { position: relative; }
</style>
