<script lang="ts">
  import type { Editor } from '@tiptap/core';

  let { editor, tick }: { editor: Editor | null; tick: number } = $props();

  // $derived re-evaluates whenever `tick` changes (i.e. on every TipTap transaction)
  let isBold       = $derived(tick >= 0 && !!editor?.isActive('bold'));
  let isItalic     = $derived(tick >= 0 && !!editor?.isActive('italic'));
  let isUnderline  = $derived(tick >= 0 && !!editor?.isActive('underline'));
  let isH1         = $derived(tick >= 0 && !!editor?.isActive('heading', { level: 1 }));
  let isH2         = $derived(tick >= 0 && !!editor?.isActive('heading', { level: 2 }));
  let isH3         = $derived(tick >= 0 && !!editor?.isActive('heading', { level: 3 }));
  let isBulletList = $derived(tick >= 0 && !!editor?.isActive('bulletList'));
  let isOrderedList= $derived(tick >= 0 && !!editor?.isActive('orderedList'));
  let canUndo      = $derived(tick >= 0 && !!editor?.can().undo());
  let canRedo      = $derived(tick >= 0 && !!editor?.can().redo());
</script>

<div class="toolbar">
  {#if editor}
    <div class="toolbar-group">
      <button
        class:active={isBold}
        onclick={() => editor?.chain().focus().toggleBold().run()}
        title="Bold (Ctrl+B)"
      >
        <strong>B</strong>
      </button>
      <button
        class:active={isItalic}
        onclick={() => editor?.chain().focus().toggleItalic().run()}
        title="Italic (Ctrl+I)"
      >
        <em>I</em>
      </button>
      <button
        class:active={isUnderline}
        onclick={() => editor?.chain().focus().toggleUnderline().run()}
        title="Underline (Ctrl+U)"
      >
        <u>U</u>
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <button
        class:active={isH1}
        onclick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
        title="Heading 1"
      >
        H1
      </button>
      <button
        class:active={isH2}
        onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Heading 2"
      >
        H2
      </button>
      <button
        class:active={isH3}
        onclick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
        title="Heading 3"
      >
        H3
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <button
        class:active={isBulletList}
        onclick={() => editor?.chain().focus().toggleBulletList().run()}
        title="Bullet list"
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
        class:active={isOrderedList}
        onclick={() => editor?.chain().focus().toggleOrderedList().run()}
        title="Ordered list"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <text x="0" y="5.5" font-size="5" font-family="sans-serif" fill="currentColor">1.</text>
          <text x="0" y="9.5" font-size="5" font-family="sans-serif" fill="currentColor">2.</text>
          <text x="0" y="13.5" font-size="5" font-family="sans-serif" fill="currentColor">3.</text>
          <line x1="5.5" y1="4" x2="15" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="5.5" y1="8" x2="15" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="5.5" y1="12" x2="15" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <button
        onclick={() => editor?.chain().focus().undo().run()}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
      >
        ↩
      </button>
      <button
        onclick={() => editor?.chain().focus().redo().run()}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
      >
        ↪
      </button>
    </div>
  {/if}
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 1rem;
    background: var(--color-toolbar-bg);
    border-bottom: 1px solid var(--color-border);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .toolbar-group {
    display: flex;
    gap: 2px;
  }

  .toolbar-separator {
    width: 1px;
    height: 1.5rem;
    background: var(--color-border);
    margin: 0 0.5rem;
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2rem;
    height: 2rem;
    padding: 0 0.5rem;
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
</style>
