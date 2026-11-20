<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import Icon from '../Icon.svelte';
  import { anchored, clickOutside, isMenuOpen, showMenu, closeMenu } from '../menu.svelte';
  import { uniformFontSize } from '../../../utils/selectionFormat';
  import { coversWholeBlock, parseSize, sizeLabel, sizeMenu } from '../../../utils/fontSize';
  import { saveRange, type SavedRange } from '../selection';
  import { locale, t } from '../../../i18n/i18n.svelte';

  let { editor, tick }: { editor: Editor | null; tick: number } = $props();

  const ID = 'fontSize';
  let open = $derived(isMenuOpen(ID));
  let focused = $state(false);
  let value = $state('');
  let range: SavedRange = null;

  let named = $derived(locale() === 'zh-Hans');
  let current = $derived(tick >= 0 && editor ? uniformFontSize(editor.state) : '');

  $effect(() => {
    if (!focused && !open) value = current ? sizeLabel(current, named) : '';
  });

  function openBox() {
    if (!editor) return;
    range = saveRange(editor);
    showMenu(ID);
  }

  function apply(pt: number) {
    closeMenu();
    focused = false;
    if (!editor) return;
    const r = range ?? saveRange(editor);
    range = null;
    if (!r) return;
    const chain = editor.chain().focus().setTextSelection(r).setFontSize(`${pt}pt`);
    // A whole-block selection also moves the block's own size, so a later run typed
    // into it inherits the new one instead of the style's.
    if (coversWholeBlock(editor.state.doc, r.from, r.to)) chain.setBlockFontSize(`${pt}pt`);
    chain.run();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const pt = parseSize(value);
      if (pt != null) apply(pt);
      else closeMenu();
      (e.currentTarget as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      closeMenu();
      (e.currentTarget as HTMLInputElement).blur();
    }
  }
</script>

<div class="rb-combo-wrap" use:clickOutside={ID}>
  <div class="rb-combo" style="width: 56px">
    <input
      class="rb-combo-input"
      type="text"
      dir="ltr"
      bind:value
      title={t().toolbarExpanded.fontSize}
      onfocus={(e) => { focused = true; openBox(); (e.currentTarget as HTMLInputElement).select(); }}
      onblur={() => (focused = false)}
      onkeydown={onKeydown}
    />
    <button
      class="rb-combo-caret"
      onclick={() => (open ? closeMenu() : openBox())}
      title={t().toolbarExpanded.fontSizeList}
      aria-haspopup="menu"
      aria-expanded={open}
    >
      <Icon name="chevronDown" size={10} />
    </button>
  </div>
  {#if open}
    <div class="ribbon-menu rb-size-menu" use:anchored role="menu">
      <div class="menu-scroll">
        {#each sizeMenu(named) as [label, s]}
          <button class:selected={current !== '' && sizeLabel(current, named) === label} onclick={() => apply(s)}>{label}</button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .rb-size-menu {
    min-width: 68px;
    max-height: 320px;
    overflow: hidden;
  }
</style>
