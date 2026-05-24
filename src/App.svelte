<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import EditorComponent from './lib/editor/Editor.svelte';
  import Toolbar from './lib/editor/Toolbar.svelte';
  import { exportToOdt } from './lib/export/odt';

  let editor: Editor | null = $state(null);

  async function handleExport() {
    if (editor) await exportToOdt(editor);
  }
</script>

<main>
  <header>
    <Toolbar {editor} />
    <button class="export-btn" onclick={handleExport} disabled={!editor}>
      Download .odt
    </button>
  </header>
  <EditorComponent bind:editor />
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  header {
    display: flex;
    align-items: center;
    background: var(--color-toolbar-bg);
    border-bottom: 1px solid var(--color-border);
    box-shadow: var(--shadow);
  }

  .export-btn {
    margin-left: auto;
    margin-right: 1rem;
    padding: 0.4rem 1rem;
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: var(--radius);
    font-size: 0.85rem;
    font-family: var(--font-sans);
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
  }

  .export-btn:hover:not(:disabled) {
    background: var(--color-primary-hover);
  }

  .export-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
