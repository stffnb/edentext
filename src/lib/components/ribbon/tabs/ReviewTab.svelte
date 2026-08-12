<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import RibbonGroup from '../RibbonGroup.svelte';
  import RibbonButton from '../RibbonButton.svelte';
  import LanguagePicker from '../../LanguagePicker.svelte';
  import { captionClicks, anchored, clickOutside, isMenuOpen, toggleMenu } from '../menu.svelte';
  import { countText, type TextStats } from '../../../utils/wordCount';
  import type { DocumentLanguage } from '../../../storage/documentLanguage';
  import { t } from '../../../i18n/i18n.svelte';

  let { editor, tick, documentLanguage, onLanguage }: {
    editor: Editor | null;
    tick: number;
    documentLanguage: DocumentLanguage;
    onLanguage: (code: DocumentLanguage) => void;
  } = $props();

  let stats = $derived.by<TextStats>(() => {
    if (tick < 0 || !editor) return { words: 0, charsWithSpaces: 0, charsNoSpaces: 0, paragraphs: 0 };
    const { doc } = editor.state;
    return countText(doc, 0, doc.content.size);
  });

  let selStats = $derived.by<TextStats | null>(() => {
    if (tick < 0 || !editor) return null;
    const { from, to, empty } = editor.state.selection;
    return empty ? null : countText(editor.state.doc, from, to);
  });

  const ROWS = (s: TextStats) => [
    { label: t().status.wordsLabel, value: s.words },
    { label: t().status.charsWithSpaces, value: s.charsWithSpaces },
    { label: t().status.charsNoSpaces, value: s.charsNoSpaces },
    { label: t().status.paragraphs, value: s.paragraphs },
  ];
</script>

<RibbonGroup label={t().ribbon.groups.proofing}>
  <div class="rb-menu-wrap" use:clickOutside={'wordCount'}>
    <RibbonButton
      variant="big"
      icon="wordCount"
      label={t().status.statistics}
      title={t().status.statistics}
      active={isMenuOpen('wordCount')}
      onclick={() => toggleMenu('wordCount')}
    />
    {#if isMenuOpen('wordCount')}
      <div class="ribbon-menu stats-menu" use:anchored role="menu">
        {#if selStats}
          <div class="rb-menu-label">{t().status.selection}</div>
          {#each ROWS(selStats) as r}
            <div class="stat"><span>{r.label}</span><b>{t().status.num(r.value)}</b></div>
          {/each}
        {/if}
        <div class="rb-menu-label">{t().status.document}</div>
        {#each ROWS(stats) as r}
          <div class="stat"><span>{r.label}</span><b>{t().status.num(r.value)}</b></div>
        {/each}
      </div>
    {/if}
  </div>
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().ribbon.groups.language}>
  <div class="rb-captioned" use:captionClicks>
    <LanguagePicker value={documentLanguage} onChange={onLanguage} />
    <span class="rb-caption">{t().spellPicker.label}</span>
  </div>
</RibbonGroup>

<style>
  .rb-menu-wrap { position: relative; }
  .stats-menu { min-width: 240px; }

  .stat {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 3px 12px;
    font-family: var(--w-font);
    font-size: 12px;
    color: var(--w-text-dim);
  }

  .stat b { color: var(--w-text); }

</style>
