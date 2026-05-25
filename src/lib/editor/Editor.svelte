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
