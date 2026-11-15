<script lang="ts">
  // The microphone button of both chromes (docs/architecture/dictation.md): a split button
  // whose menu picks the recognition language. Shown only where an engine works.
  import RibbonButton from './ribbon/RibbonButton.svelte';
  import IslandMenu from './toolbar/IslandMenu.svelte';
  import { anchored, clickOutside, closeMenu, isMenuOpen, toggleMenu } from './ribbon/menu.svelte';
  import { chooseDictationLanguage, dictationAvailable, dictationState, toggleDictation } from '../dictation/session.svelte';
  import { LANGUAGES, tagForLanguage } from '../storage/documentLanguage';
  import { shortcutHint } from '../editor/shortcuts';
  import { t } from '../i18n/i18n.svelte';

  // `cmd` is the id the command search clicks (ribbon/commands.ts).
  let { variant, cmd, disabled = false }: { variant: 'ribbon' | 'island'; cmd: string; disabled?: boolean } = $props();

  const s = $derived(dictationState());
  const title = $derived(s.error ? t().dictation.errors[s.error]
    : `${s.listening ? t().dictation.listening : t().dictation.title} (${shortcutHint('dictate')})`);
  const choices = LANGUAGES.map((l) => ({ tag: tagForLanguage(l.code) ?? l.code, label: l.label }));

  function choose(tag: string | null) {
    closeMenu();
    chooseDictationLanguage(tag);
  }
</script>

{#snippet languages()}
  <button class:selected={s.chosen === null} onclick={() => choose(null)}>{t().dictation.caretLanguage}</button>
  {#each choices as c (c.tag)}
    <button class:selected={s.chosen === c.tag} onclick={() => choose(c.tag)}>{c.label}</button>
  {/each}
{/snippet}

{#if dictationAvailable()}
  <div class="dictation" class:listening={s.listening} use:clickOutside={'dictation'}>
    {#if variant === 'ribbon'}
      <RibbonButton variant="big" icon="mic" {cmd} label={t().dictation.dictate} {title} {disabled} active={s.listening}
        caret caretTitle={t().dictation.language} caretActive={isMenuOpen('dictation')}
        onclick={() => void toggleDictation()} onCaret={() => toggleMenu('dictation')} />
      {#if isMenuOpen('dictation')}
        <div class="ribbon-menu right" use:anchored={'right'} role="menu">{@render languages()}</div>
      {/if}
    {:else}
      <IslandMenu id="dictation" icon="mic" {cmd} {title} caretTitle={t().dictation.language} {disabled} active={s.listening} align="right"
        onclick={() => void toggleDictation()}>{@render languages()}</IslandMenu>
    {/if}
    {#if s.error}<span class="hint" role="status">{t().dictation.errors[s.error]}</span>{/if}
  </div>
{/if}

<style>
  .dictation { position: relative; display: inline-flex; align-items: stretch; }

  /* A calm pulse while listening; still for readers who asked for less motion. */
  .listening :global(.rb-split), .listening :global(.im-split) { animation: dictation-pulse 1.6s ease-in-out infinite; border-radius: 4px; }
  @keyframes dictation-pulse {
    50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 35%, transparent); }
  }
  @media (prefers-reduced-motion: reduce) {
    .listening :global(.rb-split), .listening :global(.im-split) { animation: none; box-shadow: 0 0 0 2px var(--color-primary); }
  }

  .hint {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 30;
    width: max-content;
    max-width: 240px;
    padding: 4px 8px;
    border-radius: var(--radius);
    background: var(--color-text);
    color: var(--color-bg);
    font-size: 0.75rem;
    pointer-events: none;
  }
</style>
