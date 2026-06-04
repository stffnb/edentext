<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { Slice, Fragment } from 'prosemirror-model';
  import type { Node as PmNode, MarkType } from 'prosemirror-model';
  import { extensions } from './extensions';
  import { saveDocument, loadDocument } from '../storage/autosave';
  import { applyMarginVars, DEFAULT_MARGINS, type PageMargins } from '../storage/pageMargins';
  import { applyOrientationVars, type Orientation } from '../storage/pageOrientation';
  import { FORCE_PAGE_RECALC } from './pageBreaks';
  import '../../styles/editor.css';

  const DEFAULT_EDITOR_FONT = 'Georgia'; // must match ToolbarExpanded.svelte

  let { editor = $bindable(), tick = $bindable(0), currentPage = $bindable(1), numPages = $bindable(1), zoom = 100, showFormattingMarks = false, pageMargins = DEFAULT_MARGINS, orientation = 'portrait' }: {
    editor: Editor | null; tick: number; currentPage: number; numPages: number; zoom: number; showFormattingMarks?: boolean; pageMargins?: PageMargins; orientation?: Orientation;
  } = $props();

  // Apply the page margins + orientation to the :root CSS vars (visual padding,
  // page dimensions, and pagination all read these). DOM-only, safe in effects.
  $effect(() => {
    applyMarginVars(pageMargins);
  });
  $effect(() => {
    applyOrientationVars(orientation);
  });

  // Nudge the pageBreaks plugin to recompute with the new content area. The
  // dispatch bumps the `tick`/`numPages` bindings (via onTransaction/pm-pagecount),
  // so it must run OUTSIDE the Svelte effect flush — otherwise the child↔parent
  // binding updates re-enter and trip effect_update_depth_exceeded. requestAnimation-
  // Frame defers it past the flush; the empty transaction changes no document content.
  let marginRecalcRaf = 0;
  $effect(() => {
    // track each margin + orientation so the effect re-runs on any change
    void (pageMargins.top + pageMargins.bottom + pageMargins.left + pageMargins.right);
    void orientation;
    const ed = editor;
    if (!ed) return;
    cancelAnimationFrame(marginRecalcRaf);
    marginRecalcRaf = requestAnimationFrame(() => {
      ed.view.dispatch(
        ed.state.tr.setMeta('addToHistory', false).setMeta(FORCE_PAGE_RECALC, true),
      );
    });
  });

  let element: HTMLDivElement;
  let editorContainer: HTMLDivElement;

  // Page cycle (page height + 20px gap) in document px. Orientation-dependent, so
  // read live from --user-page-height (set by applyOrientationVars). Must match
  // pageBreaks.ts. Fallback = A4 portrait (1123 + 20).
  function getCycle(): number {
    const ph = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--user-page-height'));
    return (Number.isFinite(ph) ? ph : 1123) + 20;
  }

  // Throttle the value actually written to the DOM to one update per animation frame,
  // so rapid slider events don't trigger 50+ layout/paint cycles per second.
  let appliedZoom = $state(untrack(() => zoom));
  let zoomRaf: number | null = null;

  $effect(() => {
    zoom; // track
    if (zoomRaf !== null) return;
    zoomRaf = requestAnimationFrame(() => {
      zoomRaf = null;
      appliedZoom = zoom; // pick up the latest value, not a captured snapshot
    });
  });

  // Preserve the top-of-viewport anchor across zoom changes.
  let prevZoom = -1;
  let pendingAnchorDocY: number | null = null;

  $effect.pre(() => {
    const z = appliedZoom;
    if (prevZoom < 0 || !editorContainer || !element || z === prevZoom) {
      prevZoom = z;
      return;
    }
    const editorRect = editorContainer.getBoundingClientRect();
    const paperRect = element.getBoundingClientRect();
    pendingAnchorDocY = (editorRect.top - paperRect.top) / (prevZoom / 100);
    prevZoom = z;
  });

  $effect(() => {
    appliedZoom; // track to fire after the pre-effect / DOM update
    if (pendingAnchorDocY === null || !editorContainer || !element) return;
    const docY = pendingAnchorDocY;
    pendingAnchorDocY = null;
    const editorRect = editorContainer.getBoundingClientRect();
    const paperRect = element.getBoundingClientRect();
    const targetScreenY = paperRect.top + docY * (appliedZoom / 100);
    editorContainer.scrollTop += targetScreenY - editorRect.top;
  });

  function updateCurrentPage() {
    const tiptap = element?.querySelector('.tiptap') as HTMLElement | null;
    if (!tiptap || !editorContainer) return;

    const editorRect = editorContainer.getBoundingClientRect();
    const tiptapRect = tiptap.getBoundingClientRect();
    // getBoundingClientRect and coordsAtPos return zoomed viewport pixels;
    // divide by zoom factor to convert to document coordinates before comparing with the cycle.
    const zoomFactor = appliedZoom / 100;
    const cycle = getCycle();

    if (editor) {
      try {
        const coords = editor.view.coordsAtPos(editor.state.selection.head);
        const cursorMidY = (coords.top + coords.bottom) / 2;
        if (cursorMidY >= editorRect.top && cursorMidY <= editorRect.bottom) {
          const cursorInDoc = (cursorMidY - tiptapRect.top) / zoomFactor;
          currentPage = Math.max(1, Math.min(numPages, Math.floor(Math.max(0, cursorInDoc) / cycle) + 1));
          return;
        }
      } catch {
        // coordsAtPos can fail during editor teardown — fall through
      }
    }

    const visibleTopInDoc = (editorRect.top - tiptapRect.top) / zoomFactor;
    currentPage = Math.max(1, Math.min(numPages, Math.floor(Math.max(0, visibleTopInDoc) / cycle) + 1));
  }

  function onPageCount(e: Event) {
    numPages = (e as CustomEvent<{ numPages: number }>).detail.numPages;
    updateCurrentPage();
  }

  function applyFontToFragment(frag: Fragment, textStyleType: MarkType, font: string): Fragment {
    const nodes: PmNode[] = [];
    frag.forEach((node: PmNode) => {
      if (node.isText) {
        const existingTS = node.marks.find(m => m.type === textStyleType);
        if (existingTS?.attrs.fontFamily) {
          nodes.push(node);
        } else {
          const newAttrs = { ...(existingTS?.attrs ?? {}), fontFamily: font };
          const otherMarks = node.marks.filter(m => m.type !== textStyleType);
          nodes.push(node.mark([...otherMarks, textStyleType.create(newAttrs)]));
        }
      } else {
        nodes.push(node.copy(applyFontToFragment(node.content, textStyleType, font)));
      }
    });
    return Fragment.fromArray(nodes);
  }

  onMount(() => {
    const saved = loadDocument();

    editor = new Editor({
      element,
      extensions,
      content: saved || undefined,
      editorProps: {
        transformPasted(slice, view) {
          const textStyleType = view.state.schema.marks.textStyle;
          if (!textStyleType) return slice;
          const cursorMarks = view.state.storedMarks ?? view.state.selection.$head.marks();
          const cursorFont = cursorMarks.find(m => m.type === textStyleType)?.attrs.fontFamily as string | undefined;
          const font = cursorFont ?? DEFAULT_EDITOR_FONT;
          return new Slice(applyFontToFragment(slice.content, textStyleType, font), slice.openStart, slice.openEnd);
        },
      },
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
          const cursorInDoc = ((coords.top + coords.bottom) / 2 - tiptap.getBoundingClientRect().top) / (appliedZoom / 100);
          currentPage = Math.max(1, Math.min(numPages, Math.floor(Math.max(0, cursorInDoc) / getCycle()) + 1));
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
    if (zoomRaf !== null) cancelAnimationFrame(zoomRaf);
    cancelAnimationFrame(marginRecalcRaf);
    editor?.destroy();
    element?.removeEventListener('pm-pagecount', onPageCount);
    editorContainer?.removeEventListener('scroll', updateCurrentPage);
  });
</script>

<div class="editor" bind:this={editorContainer}>
  <div bind:this={element} class="paper" class:show-formatting-marks={showFormattingMarks} style="zoom: {appliedZoom / 100}"></div>
</div>
