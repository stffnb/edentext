<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { Slice, Fragment } from 'prosemirror-model';
  import type { Node as PmNode, MarkType } from 'prosemirror-model';
  import { extensions } from './extensions';
  import TableToolbar from './TableToolbar.svelte';
  import { saveDocument, loadDocument } from '../storage/autosave';
  import { applyMarginVars, DEFAULT_MARGINS, type PageMargins } from '../storage/pageMargins';
  import { applyOrientationVars, type Orientation } from '../storage/pageOrientation';
  import { FORCE_PAGE_RECALC, type TableBreakBand } from './pageBreaks';
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

  // --- Floating table-editing toolbar ---
  // Shown when the selection is inside a table; positioned just above that table.
  let tableUi = $state<{ visible: boolean; top: number; left: number }>({ visible: false, top: 0, left: 0 });
  let tableUiRaf = 0;

  // The DOM element of the table containing the current selection, or null.
  // nodeDOM(before(table)) returns the wrapper div the table node view renders.
  function activeTableDOM(ed: Editor): HTMLElement | null {
    const resolved = ed.state.selection.$from;
    for (let d = resolved.depth; d > 0; d--) {
      if (resolved.node(d).type.name === 'table') {
        try {
          const dom = ed.view.nodeDOM(resolved.before(d));
          return dom instanceof HTMLElement ? dom : null;
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  function recomputeTableUi() {
    const ed = editor;
    if (!ed || !editorContainer) {
      if (tableUi.visible) tableUi = { ...tableUi, visible: false };
      return;
    }
    const dom = activeTableDOM(ed);
    if (!dom) {
      if (tableUi.visible) tableUi = { ...tableUi, visible: false };
      return;
    }
    // Position in the editor container's content space: viewport delta + scroll.
    // getBoundingClientRect and scrollTop share the same (zoom-affected) scale,
    // so this stays aligned across zoom; the toolbar itself is a non-zoomed
    // sibling of .paper, so it renders at a constant size.
    const tRect = dom.getBoundingClientRect();
    const cRect = editorContainer.getBoundingClientRect();
    tableUi = {
      visible: true,
      top: tRect.top - cRect.top + editorContainer.scrollTop,
      left: tRect.left - cRect.left + editorContainer.scrollLeft,
    };
  }

  // --- Table page-break close/open bands ---
  // The pagination plugin (pageBreaks.ts) reports, via the pm-pagecount event,
  // bands (in unscaled document px) where an in-cell table is split across a page
  // boundary. We render them here in the non-zoomed .editor layer (screen space)
  // so they stay aligned with the zoomed content at any zoom level — placing them
  // inside the CSS-`zoom`ed .tiptap misplaced them.
  type BandStyle = { top: number; left: number; width: number; height: number; background: string };
  let tableBandsDoc = $state<TableBreakBand[]>([]);
  let bandStyles = $state<BandStyle[]>([]);

  function recomputeBands() {
    const tiptap = element?.querySelector('.tiptap') as HTMLElement | null;
    if (!tiptap || !editorContainer || tableBandsDoc.length === 0) {
      if (bandStyles.length) bandStyles = [];
      return;
    }
    const tRect = tiptap.getBoundingClientRect();
    const cRect = editorContainer.getBoundingClientRect();
    const z = appliedZoom / 100;
    // .tiptap's top/left in the editor's scrollable content space (same basis as
    // the floating toolbar). A document-y maps to tiptapTop + docY * z.
    const tiptapTop = tRect.top - cRect.top + editorContainer.scrollTop;
    const tiptapLeft = tRect.left - cRect.left + editorContainer.scrollLeft;
    // In-cell spacers in document order, paired 1:1 with the bands (both ordered).
    const spacers = Array.from(
      tiptap.querySelectorAll<HTMLElement>('[data-page-break-spacer-incell]'),
    );
    bandStyles = tableBandsDoc.map((b, i) => {
      const gapPx = b.gap * z;
      const left = tiptapLeft + b.left * z;
      const width = b.width * z;
      // Anchor the band to the matching spacer's full rendered extent: its top is
      // where the page's cell content ends, its bottom where the content resumes.
      // The mask then exactly covers the gap the spacer creates, so it never eats
      // content at either edge regardless of sub-pixel zoom drift (which can push
      // the real break tens of px off the theoretical page edges). Fall back to
      // the theoretical placement when no spacer is found.
      const sp = spacers[i];
      let top: number;
      let height: number;
      let gapTop: number;
      if (sp) {
        const r = sp.getBoundingClientRect();
        top = r.top - cRect.top + editorContainer.scrollTop;
        height = r.height;
        // Place the canvas-coloured gap stripe at the real page surface bottom
        // (= content-end + bottom margin) relative to the spacer's top.
        const spacerTopDoc = (r.top - tRect.top) / z;
        const gapTopDoc = b.closeY + b.marginBottom - spacerTopDoc;
        gapTop = Math.min(Math.max(0, gapTopDoc * z), Math.max(0, height - gapPx));
      } else {
        top = tiptapTop + b.closeY * z;
        height = b.height * z;
        gapTop = b.marginBottom * z;
      }
      return {
        top,
        left,
        width,
        height,
        // White over the page margins, canvas colour over the gap.
        background:
          `linear-gradient(to bottom,`
          + ` var(--color-page-bg) 0, var(--color-page-bg) ${gapTop}px,`
          + ` var(--color-bg) ${gapTop}px, var(--color-bg) ${gapTop + gapPx}px,`
          + ` var(--color-page-bg) ${gapTop + gapPx}px, var(--color-page-bg) 100%)`,
      };
    });
  }

  // Defer to the next frame so the DOM reflects the latest transaction /
  // pagination spacers before we measure (mirrors the page-break code).
  function scheduleTableUi() {
    cancelAnimationFrame(tableUiRaf);
    tableUiRaf = requestAnimationFrame(() => {
      recomputeTableUi();
      recomputeBands();
    });
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
    // Zoom changes the table's rendered position — re-place the floating toolbar.
    scheduleTableUi();
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
    const detail = (e as CustomEvent<{ numPages: number; tableBreakBands?: TableBreakBand[] }>).detail;
    numPages = detail.numPages;
    tableBandsDoc = detail.tableBreakBands ?? [];
    updateCurrentPage();
    // Pagination spacers can shift a table's position — re-place the toolbar/bands.
    scheduleTableUi();
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
        // Covers both doc and selection changes (entering/leaving a table,
        // adding/removing rows or columns).
        scheduleTableUi();
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
    editorContainer.addEventListener('scroll', onEditorScroll);
  });

  function onEditorScroll() {
    updateCurrentPage();
    scheduleTableUi();
  }

  onDestroy(() => {
    if (zoomRaf !== null) cancelAnimationFrame(zoomRaf);
    cancelAnimationFrame(marginRecalcRaf);
    cancelAnimationFrame(tableUiRaf);
    editor?.destroy();
    element?.removeEventListener('pm-pagecount', onPageCount);
    editorContainer?.removeEventListener('scroll', onEditorScroll);
  });
</script>

<div class="editor" bind:this={editorContainer}>
  <div bind:this={element} class="paper" class:show-formatting-marks={showFormattingMarks} style="zoom: {appliedZoom / 100}"></div>
  {#each bandStyles as b}
    <div
      class="table-break-band"
      style="top: {b.top}px; left: {b.left}px; width: {b.width}px; height: {b.height}px; background: {b.background};"
    ></div>
  {/each}
  {#if tableUi.visible}
    <TableToolbar {editor} top={tableUi.top} left={tableUi.left} />
  {/if}
</div>

<style>
  /* Table page-break close/open band: masks the table's bleeding vertical borders
     across the margin/gap and draws the black close (top) + open (bottom) line.
     Positioned in the non-zoomed .editor content space (see recomputeBands). */
  .table-break-band {
    position: absolute;
    z-index: 50;
    pointer-events: none;
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
  }
</style>
