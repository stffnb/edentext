<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { extensions } from './extensions';
  import { saveDocument, loadDocument } from '../storage/autosave';
  import '../../styles/editor.css';

  let { editor = $bindable(), tick = $bindable(0), currentPage = $bindable(1), numPages = $bindable(1) }: {
    editor: Editor | null; tick: number; currentPage: number; numPages: number;
  } = $props();

  let element: HTMLDivElement;
  let editorContainer: HTMLDivElement;

  const CYCLE = 1143; // PAGE_HEIGHT + PAGE_GAP, must match pageBreaks.ts

  function updateCurrentPage() {
    const tiptap = element?.querySelector('.tiptap') as HTMLElement | null;
    if (!tiptap || !editorContainer) return;

    const editorRect = editorContainer.getBoundingClientRect();
    const tiptapRect = tiptap.getBoundingClientRect();

    // If the cursor is visible in the editor viewport, show its page
    if (editor) {
      try {
        const coords = editor.view.coordsAtPos(editor.state.selection.head);
        const cursorMidY = (coords.top + coords.bottom) / 2;
        if (cursorMidY >= editorRect.top && cursorMidY <= editorRect.bottom) {
          const cursorInTiptap = cursorMidY - tiptapRect.top;
          currentPage = Math.max(1, Math.min(numPages, Math.floor(Math.max(0, cursorInTiptap) / CYCLE) + 1));
          return;
        }
      } catch {
        // coordsAtPos can fail during editor teardown — fall through
      }
    }

    // Cursor not visible — use the top of the visible scroll area
    const visibleTopInTiptap = editorRect.top - tiptapRect.top;
    currentPage = Math.max(1, Math.min(numPages, Math.floor(Math.max(0, visibleTopInTiptap) / CYCLE) + 1));
  }

  function onPageCount(e: Event) {
    numPages = (e as CustomEvent<{ numPages: number }>).detail.numPages;
    updateCurrentPage();
  }

  onMount(() => {
    const saved = loadDocument();

    editor = new Editor({
      element,
      extensions,
      content: saved || undefined,
      onTransaction: () => {
        tick++;
      },
      onSelectionUpdate: ({ editor: e }) => {
        // Use the editor instance passed by TipTap directly — avoids any Svelte
        // prop-reactivity timing issues. TipTap always auto-scrolls the cursor
        // into view before firing this, so no visibility check is needed here.
        const tiptap = element?.querySelector('.tiptap') as HTMLElement | null;
        if (!tiptap) return;
        try {
          const coords = e.view.coordsAtPos(e.state.selection.head);
          const cursorInTiptap = ((coords.top + coords.bottom) / 2) - tiptap.getBoundingClientRect().top;
          currentPage = Math.max(1, Math.min(numPages, Math.floor(Math.max(0, cursorInTiptap) / CYCLE) + 1));
        } catch { /* ignore */ }
      },
      onUpdate: ({ editor: e }) => {
        saveDocument(e.getJSON());
      },
    });

    element.addEventListener('pm-pagecount', onPageCount);
    editorContainer.addEventListener('scroll', updateCurrentPage);
  });

  onDestroy(() => {
    editor?.destroy();
    element?.removeEventListener('pm-pagecount', onPageCount);
    editorContainer?.removeEventListener('scroll', updateCurrentPage);
  });
</script>

<div class="editor" bind:this={editorContainer}>
  <div bind:this={element} class="paper"></div>
</div>
