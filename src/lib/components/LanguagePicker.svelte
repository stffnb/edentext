<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { LANGUAGES, NO_LANGUAGE, hasGrammar, tagForLanguage, codeForTag, type DocumentLanguage } from '../storage/documentLanguage';
  import { grammarEnabled, setGrammarEnabled, grammarLoading } from '../spell/grammar.svelte';
  import { uniformLanguage } from '../utils/selectionFormat';
  import { t } from '../i18n/i18n.svelte';

  let {
    value,
    onChange,
    editor = null,
    tick = -1,
  }: {
    value: DocumentLanguage;
    onChange: (code: DocumentLanguage) => void;
    editor?: Editor | null;
    tick?: number;
  } = $props();

  // The header/footer editor has no Language extension — there the box only sets the
  // document's language.
  let canSet = $derived(!!editor && typeof editor.commands.setBlockLanguage === 'function');

  // The language in force at the cursor: the run's own, else its paragraph's, else the
  // document's. '' where the selection spans two — the box then shows nothing, as the
  // font and size boxes do.
  let atCursor = $derived.by(() => {
    if (tick < 0 || !editor || !canSet) return tagForLanguage(value);
    const tag = uniformLanguage(editor.state);
    return tag === '' ? '' : tag ?? tagForLanguage(value);
  });
  let selected = $derived(atCursor === '' ? '' : `sel:${codeForTag(atCursor ?? '') ?? atCursor}`);

  function apply(raw: string) {
    const [scope, code] = raw.split(':');
    if (scope === 'doc') {
      onChange(code);
      // The document's language is the one everything without an opinion follows, so the
      // overrides go with it — LibreOffice's "For all text" clears them too.
      if (canSet) editor!.chain().focus().selectAll().setBlockLanguage(null).setRunLanguage(null).setTextSelection(editor!.state.selection.from).run();
      return;
    }
    const tag = tagForLanguage(code) ?? code;
    if (!canSet) return;
    // LibreOffice splits the same way: a selection takes a run, a bare cursor the paragraph.
    if (editor!.state.selection.empty) editor!.chain().focus().setBlockLanguage(tag).run();
    else editor!.chain().focus().setRunLanguage(tag).run();
  }
</script>

<label class="lang-picker" title={t().spellPicker.label}>
  <svg width="13" height="13" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M2 13l3-8 3 8M3.2 10.5h3.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M11 14.5l1.6-1.6 1.6 1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <select
    aria-label={t().spellPicker.label}
    onchange={(e) => apply((e.currentTarget as HTMLSelectElement).value)}
  >
    {#if selected === ''}
      <option value="" selected>{t().spellPicker.mixed}</option>
    {:else if !LANGUAGES.some((l) => `sel:${l.code}` === selected)}
      <!-- A language we have no dictionary for still shows, so it is not silently lost. -->
      <option value={selected} selected>{atCursor}</option>
    {/if}
    <optgroup label={t().spellPicker.forSelection}>
      {#each LANGUAGES as l}
        <option value="sel:{l.code}" selected={`sel:${l.code}` === selected}>{l.label}</option>
      {/each}
    </optgroup>
    <optgroup label={t().spellPicker.forAllText}>
      {#each LANGUAGES as l}
        <option value="doc:{l.code}">{l.label}</option>
      {/each}
      <option value="doc:{NO_LANGUAGE}" selected={value === NO_LANGUAGE && selected === ''}>{t().spellPicker.noSpellCheck}</option>
    </optgroup>
  </select>
</label>

<!-- The switch sits beside the control that decides whether it is available: pick
     German and it greys out, with the reason in its tooltip. -->
<label
  class="gr-toggle"
  class:off={!hasGrammar(value)}
  title={hasGrammar(value) ? t().grammar.hint : t().grammar.unavailable}
>
  <input
    type="checkbox"
    checked={grammarEnabled()}
    disabled={!hasGrammar(value)}
    onchange={(e) => setGrammarEnabled((e.currentTarget as HTMLInputElement).checked)}
  />
  <span>{grammarLoading() ? t().grammar.loadingLabel : t().grammar.label}</span>
</label>

<style>
  .lang-picker {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--color-text);
    cursor: pointer;
  }

  .lang-picker svg {
    flex: none;
    opacity: 0.8;
  }

  select {
    appearance: none;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 0.75rem;
    padding: 1px 2px;
    border-radius: 2px;
    cursor: pointer;
  }

  select:hover {
    background: var(--color-btn-hover);
  }

  .gr-toggle {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-left: 8px;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 0.75rem;
    cursor: pointer;
  }

  .gr-toggle.off {
    opacity: 0.45;
    cursor: default;
  }

  .gr-toggle input {
    margin: 0;
    cursor: inherit;
  }

  /* The option list is OS-drawn; keep its text legible in dark themes. */
  option {
    color: initial;
  }
</style>
