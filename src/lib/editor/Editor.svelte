<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { extensions } from './extensions';
  import { saveDocument, loadDocument } from '../storage/autosave';
  import '../../styles/editor.css';

  let { editor = $bindable(), tick = $bindable(0) }: { editor: Editor | null; tick: number } = $props();

  let element: HTMLDivElement;

  onMount(() => {
    const saved = loadDocument();

    editor = new Editor({
      element,
      extensions,
      content: saved || undefined,
      onTransaction: () => {
        // Increment tick to signal Svelte that editor state changed.
        // (editor = editor is a no-op in Svelte 5 for same references)
        tick++;
      },
      onUpdate: ({ editor: e }) => {
        saveDocument(e.getJSON());
      },
    });
  });

  onDestroy(() => {
    editor?.destroy();
  });
</script>

<div class="editor">
  <div bind:this={element} class="paper"></div>
</div>
