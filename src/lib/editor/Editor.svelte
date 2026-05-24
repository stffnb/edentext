<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { extensions } from './extensions';
  import { saveDocument, loadDocument } from '../storage/autosave';
  import '../../styles/editor.css';

  let { editor = $bindable() }: { editor: Editor | null } = $props();

  let element: HTMLDivElement;

  onMount(() => {
    const saved = loadDocument();

    editor = new Editor({
      element,
      extensions,
      content: saved || undefined,
      onTransaction: () => {
        // Force Svelte reactivity update
        editor = editor;
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
  <div bind:this={element}></div>
</div>
