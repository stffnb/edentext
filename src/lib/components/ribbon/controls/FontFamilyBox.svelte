<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import Icon from '../Icon.svelte';
  import { anchored, clickOutside, isMenuOpen, showMenu, closeMenu } from '../menu.svelte';
  import { uniformFont } from '../../../utils/selectionFormat';
  import { canListAllFonts, ensureDetection, listAllFonts, noteFontUse, otherFonts, recentFonts, WEB_SAFE_FONTS } from '../fontList.svelte';
  import { saveRange, type SavedRange } from '../selection';
  import { t } from '../../../i18n/i18n.svelte';

  let { editor, tick }: { editor: Editor | null; tick: number } = $props();

  const ID = 'fontFamily';
  let open = $derived(isMenuOpen(ID));
  let focused = $state(false);
  let value = $state('');
  let range: SavedRange = null;

  let current = $derived(tick >= 0 && editor ? uniformFont(editor.state) : '');

  // The box mirrors the selection unless the user is typing into it.
  $effect(() => {
    if (!focused && !open) value = current;
  });

  let filter = $derived(open && value !== current ? value.trim().toLowerCase() : '');
  const matches = (f: string) => !filter || f.toLowerCase().includes(filter);

  let recentShown = $derived(recentFonts().filter(matches));
  let webSafeShown = $derived(WEB_SAFE_FONTS.filter(matches));
  let otherShown = $derived(otherFonts().filter(matches));

  function openBox() {
    if (!editor) return;
    range = saveRange(editor);
    void ensureDetection();
    showMenu(ID);
  }

  function pick(font: string) {
    closeMenu();
    focused = false;
    if (!editor) return;
    const r = range ?? saveRange(editor);
    range = null;
    editor.chain().focus().setTextSelection(r!).setFontFamily(font).run();
    noteFontUse(font);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const typed = value.trim().toLowerCase();
      const known = [...recentFonts(), ...WEB_SAFE_FONTS, ...otherFonts()];
      const hit = known.find((f) => f.toLowerCase() === typed) ?? known.find((f) => f.toLowerCase().startsWith(typed));
      if (hit) pick(hit);
      else closeMenu();
      (e.currentTarget as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      closeMenu();
      value = current;
      (e.currentTarget as HTMLInputElement).blur();
    }
  }
</script>

<div class="rb-combo-wrap" use:clickOutside={ID}>
  <div class="rb-combo" style="width: 142px">
    <input
      class="rb-combo-input"
      type="text"
      bind:value
      placeholder={current === '' ? '—' : ''}
      title={t().toolbarExpanded.fontName}
      onfocus={(e) => { focused = true; openBox(); (e.currentTarget as HTMLInputElement).select(); }}
      onblur={() => (focused = false)}
      onkeydown={onKeydown}
    />
    <button class="rb-combo-caret" onclick={() => (open ? closeMenu() : openBox())} aria-haspopup="menu" aria-expanded={open}>
      <Icon name="chevronDown" size={10} />
    </button>
  </div>
  {#if open}
    <div class="ribbon-menu rb-font-menu" use:anchored role="menu">
      <div class="menu-scroll">
        {#if recentShown.length}
          <div class="rb-menu-label">{t().toolbarExpanded.recent}</div>
          {#each recentShown as f}
            <button class:selected={current === f} style="font-family: '{f}'" onclick={() => pick(f)}>{f}</button>
          {/each}
        {/if}
        {#if webSafeShown.length}
          <div class="rb-menu-label">{t().toolbarExpanded.webSafe}</div>
          {#each webSafeShown as f}
            <button class:selected={current === f} style="font-family: '{f}'" onclick={() => pick(f)}>{f}</button>
          {/each}
        {/if}
        {#if otherShown.length}
          <div class="rb-menu-label">{t().toolbarExpanded.allFonts}</div>
          {#each otherShown as f}
            <button class:selected={current === f} style="font-family: '{f}'" onclick={() => pick(f)}>{f}</button>
          {/each}
        {/if}
      </div>
      {#if canListAllFonts()}
        <button class="rb-menu-foot" onclick={() => void listAllFonts()}>{t().toolbarExpanded.loadAllFonts}</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .rb-font-menu {
    max-height: 340px;
    overflow: hidden;
    min-width: 200px;
  }
</style>
