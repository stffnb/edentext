<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { synonyms } from '../spell/thesaurus';
  import { spellController } from '../spell/controller';
  import { wordRangeAt } from '../editor/extensions/spellCheck';
  import { NO_LANGUAGE } from '../storage/documentLanguage';
  import { t } from '../i18n/i18n.svelte';

  // LibreOffice's Tools ▸ Thesaurus (Ctrl+F7) / Word's Review ▸ Thesaurus: the word at
  // the caret, the groups it appears in, click one to replace it. The box above looks
  // up any other word, which is how both dialogs let you follow a chain.
  let { open = $bindable(false), editor }: { open?: boolean; editor: Editor | null } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let term = $state('');
  let groups = $state<string[][]>([]);
  let busy = $state(false);
  // The range the dialog opened on. A modal freezes the selection, and the term above
  // may wander off it while the replacement still belongs to this word.
  let target = $state<{ from: number; to: number } | null>(null);

  const language = $derived(open ? spellController.getLanguage() : NO_LANGUAGE);

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });

  // Re-read on each open, as the dialog stays mounted.
  $effect(() => {
    if (!open) return;
    const view = editor?.view;
    const range = view ? wordRangeAt(view.state, view.state.selection.from) : null;
    target = range ? { from: range.from, to: range.to } : null;
    void lookUp(range?.word ?? '');
  });

  async function lookUp(word: string) {
    term = word;
    groups = [];
    if (!word.trim()) return;
    busy = true;
    const found = await synonyms(spellController.getLanguage(), word);
    if (term !== word) return; // a newer lookup superseded this one
    groups = found;
    busy = false;
  }

  // Replace the looked-up range, preserving the word's marks (font/bold/etc.).
  function replace(word: string) {
    const view = editor?.view;
    if (view && target) {
      const { state } = view;
      const from = state.doc.resolve(target.from);
      const marks = from.marksAcross(state.doc.resolve(target.to)) ?? from.marks();
      view.dispatch(state.tr.replaceWith(target.from, target.to, state.schema.text(word, marks)).scrollIntoView());
      view.focus();
    }
    open = false;
  }
</script>

<dialog
  bind:this={dialogEl}
  onclose={() => (open = false)}
  onclick={(e) => e.target === dialogEl && (open = false)}
  aria-label={t().thesaurus.title}
>
  <div class="body">
    <h2>{t().thesaurus.title}</h2>

    <div class="lookup">
      <input
        bind:value={term}
        placeholder={t().thesaurus.word}
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void lookUp(term); } }}
        spellcheck="false"
        autocomplete="off"
      />
      <button class="small" onclick={() => void lookUp(term)}>{t().thesaurus.lookUp}</button>
    </div>

    {#if language === NO_LANGUAGE}
      <p class="hint">{t().thesaurus.noLanguage}</p>
    {:else if busy}
      <p class="hint">{t().thesaurus.loading}</p>
    {:else if groups.length}
      <p class="hint">{t().thesaurus.replaceHint}</p>
      <ul>
        {#each groups as group, i (i)}
          <li>
            {#each group as word (word)}
              <button class="syn" onclick={() => replace(word)} disabled={!target}>{word}</button>
            {/each}
          </li>
        {/each}
      </ul>
    {:else if term.trim()}
      <p class="hint">{t().thesaurus.noSynonyms}</p>
    {/if}

    <div class="actions">
      <span class="spacer"></span>
      <button class="primary" onclick={() => (open = false)}>{t().common.close}</button>
    </div>
  </div>
</dialog>

<style>
  dialog {
    /* The global reset zeroes every margin, which also takes the auto centring a
       modal <dialog> gets by default. */
    margin: auto;
    border: none;
    border-radius: 8px;
    padding: 0;
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }

  dialog::backdrop { background: rgba(0, 0, 0, 0.35); }

  .body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 420px;
    max-height: 80vh;
    overflow-y: auto;
    padding: 18px 20px 16px;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }

  h2 { font-size: 1rem; }
  .hint { color: var(--color-text-muted); }

  .lookup { display: flex; gap: 6px; }
  input {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 4px 6px;
    font: inherit;
  }

  ul { display: flex; flex-direction: column; gap: 8px; list-style: none; }
  li {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--color-border);
  }
  li:last-child { padding-bottom: 0; border-bottom: none; }

  .syn { border-radius: 999px; padding: 2px 10px; }

  .actions { display: flex; align-items: center; gap: 8px; padding-top: 6px; }
  .spacer { flex: 1; }

  button {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 4px 10px;
    font: inherit;
    cursor: pointer;
  }
  button:hover:not(:disabled) { background: var(--color-btn-hover); }
  button:disabled { opacity: 0.5; cursor: default; }
  .actions .primary {
    border-color: var(--color-primary);
    background: var(--color-primary);
    color: #fff;
  }
</style>
