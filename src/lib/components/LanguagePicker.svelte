<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { LANGUAGES, NO_LANGUAGE, tagForLanguage, codeForTag, documentLangs, type DocumentLanguage, type LanguageDef } from '../storage/documentLanguage';
  import { uniformLanguage } from '../utils/selectionFormat';
  import { t } from '../i18n/i18n.svelte';
  import type { MenuEntry } from '../editor/contextMenuItems';
  import ContextMenu from './ContextMenu.svelte';

  let {
    value,
    other = null,
    onChange,
    editor = null,
    tick = -1,
  }: {
    value: DocumentLanguage;
    other?: string | null;
    onChange: (code: DocumentLanguage) => void;
    editor?: Editor | null;
    tick?: number;
  } = $props();

  // The header/footer editor has no Language extension — there the box only sets the
  // document's language.
  let canSet = $derived(!!editor && typeof editor.commands.setBlockLanguage === 'function');

  // The language in force at the cursor: the run's own, else its paragraph's, else the
  // document's, each the asian one on East Asian text. '' where the selection spans two
  // — the box then shows nothing, as the font and size boxes do.
  let atCursor = $derived.by(() => {
    if (tick < 0 || !editor || !canSet) return tagForLanguage(value);
    const tag = uniformLanguage(editor.state, documentLangs(value, other));
    return tag === '' ? '' : tag ?? tagForLanguage(value);
  });
  let selected = $derived(atCursor === '' ? '' : `sel:${codeForTag(atCursor ?? '') ?? atCursor}`);

  // A language without a bundled dictionary still names the document's language; the
  // suffix says that checking stays off, as the grammar switch says for its engine.
  function label(l: LanguageDef): string {
    return l.noDict ? `${l.label} ${t().spellPicker.noDictionary}` : l.label;
  }

  function apply(raw: string) {
    const [scope, code] = raw.split(':');
    if (scope === 'doc') {
      onChange(code);
      // The document's language is the one everything without an opinion follows, so the
      // overrides go with it — LibreOffice's "For all text" clears them too. The caret stays
      // where it was, so the view does too: a caret left above would pull it back up.
      if (canSet) editor!.chain().focus(null, { scrollIntoView: false }).selectAll().setBlockLanguage(null).setRunLanguage(null).setTextSelection(editor!.state.selection.from).run();
      return;
    }
    const tag = tagForLanguage(code) ?? code;
    if (!canSet) return;
    // LibreOffice splits the same way: a selection takes a run, a bare cursor the paragraph.
    // The tag's script picks the slot (language.ts).
    if (editor!.state.selection.empty) editor!.chain().focus().setBlockLanguage(tag).run();
    else editor!.chain().focus().setRunLanguage(tag).run();
  }

  // The box's text: several languages, one we have no dictionary for (still named, so it
  // is not silently lost), a listed one, or checking off.
  let shown = $derived.by(() => {
    if (atCursor === '') return t().spellPicker.mixed;
    const def = LANGUAGES.find((l) => `sel:${l.code}` === selected);
    if (def) return label(def);
    return atCursor || t().spellPicker.noSpellCheck;
  });

  function entries(): MenuEntry[] {
    const p = t().spellPicker;
    return [
      { kind: 'item', label: p.noSpellCheck, checked: value === NO_LANGUAGE && !atCursor, run: () => apply(`doc:${NO_LANGUAGE}`) },
      { kind: 'sep' },
      { kind: 'item', label: editor?.state.selection.empty === false ? p.forSelection : p.forParagraph, disabled: true, run: () => {} },
      ...LANGUAGES.map((l): MenuEntry => ({ kind: 'item', label: label(l), checked: `sel:${l.code}` === selected, run: () => apply(`sel:${l.code}`) })),
      { kind: 'sep' },
      { kind: 'sub', label: p.forAllText, items: LANGUAGES.map((l): MenuEntry => ({ kind: 'item', label: label(l), run: () => apply(`doc:${l.code}`) })) },
    ];
  }

  // A menu of our own rather than a native list: macOS centres that on the chosen entry,
  // which in the status bar leaves it a sliver that has to be scrolled.
  let menu = $state<{ items: MenuEntry[]; x: number; y: number } | null>(null);
  let button: HTMLButtonElement | undefined = $state();
  let closedAt = 0;

  function close() {
    // A press on the button closes the menu ahead of its own click, which must not reopen it.
    if (button?.matches(':hover')) closedAt = performance.now();
    menu = null;
    queueMicrotask(() => { if (!document.activeElement || document.activeElement === document.body) button?.focus(); });
  }

  function toggle() {
    if (menu || performance.now() - closedAt < 300 || !button) { menu = null; return; }
    const box = button.getBoundingClientRect();
    // In the lower half the menu opens upward: placed at the top edge, it flips above it.
    const up = box.top > window.innerHeight / 2;
    menu = { items: entries(), x: box.left, y: up ? box.top - 2 : box.bottom + 2 };
  }
</script>

<button class="lang-picker" class:open={!!menu} bind:this={button} onclick={toggle}
  aria-haspopup="menu" aria-expanded={!!menu} aria-label={t().spellPicker.label} title={t().spellPicker.label}>
  <svg width="13" height="13" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M2 13l3-8 3 8M3.2 10.5h3.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M11 14.5l1.6-1.6 1.6 1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <span>{shown}</span>
</button>
{#if menu}
  <div class="menu-layer">
    <ContextMenu top={menu.y} left={menu.x} items={menu.items} onClose={close} />
  </div>
{/if}

<style>
  .lang-picker {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 0.75rem;
    padding: 1px 2px;
    border-radius: 2px;
    cursor: pointer;
    white-space: nowrap;
  }

  .lang-picker svg {
    flex: none;
    opacity: 0.8;
  }

  .lang-picker:hover, .lang-picker.open {
    background: var(--color-btn-hover);
  }

  .menu-layer { position: fixed; inset: 0; z-index: 300; pointer-events: none; }
  .menu-layer :global(.cm-menu) { pointer-events: auto; }
</style>
