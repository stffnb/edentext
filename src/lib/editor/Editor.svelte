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

  // --- Table page-break overlay ---
  // pageBreaks.ts reports (via pm-pagecount) the in-cell table breaks in document px
  // relative to .tiptap's top. We render the overlay in a .band-layer INSIDE the
  // zoomed .paper (in document px) so CSS `zoom` scales it by the exact same transform
  // as the .tiptap page background. Two pieces per break:
  //   • band   — a solid page-coloured mask (content width) hiding the table's borders
  //              bleeding through the page margins, plus the close/open lines.
  //   • stripe — the dark page gap, drawn as ONE full-page-width element on top. Using
  //              a single rectangle for the whole gap avoids a left/right edge where two
  //              separately-rasterised gradients disagree by a sub-pixel (the seam).
  type BandStyle = { top: number; left: number; width: number; height: number };
  type GapStripeStyle = { top: number; width: number; height: number; background: string };
  let tableBandsDoc = $state<TableBreakBand[]>([]);
  let bandStyles = $state<BandStyle[]>([]);
  let gapStripeStyles = $state<GapStripeStyle[]>([]);

  function recomputeBands() {
    const tiptap = element?.querySelector('.tiptap') as HTMLElement | null;
    if (!tiptap || tableBandsDoc.length === 0) {
      if (bandStyles.length) bandStyles = [];
      if (gapStripeStyles.length) gapStripeStyles = [];
      return;
    }
    const tRect = tiptap.getBoundingClientRect();
    const z = appliedZoom / 100;
    const pageWidth = tiptap.offsetWidth; // unscaled doc px = full page width
    // A too-tall row break produces one in-cell spacer per column, all tagged with
    // the same band key. Group them so each band can span its columns' real gaps.
    const spacersByKey = new Map<string, HTMLElement[]>();
    for (const sp of Array.from(
      tiptap.querySelectorAll<HTMLElement>('[data-page-break-spacer-incell]'),
    )) {
      const key = sp.dataset.pageBreakBoundary;
      if (key === undefined) continue;
      const arr = spacersByKey.get(key);
      if (arr) arr.push(sp);
      else spacersByKey.set(key, [sp]);
    }
    // Everything below is in document px (relative to .tiptap's top). The .band-layer
    // lives inside the zoomed .paper, so `zoom` applies the scaling — no manual `* z`.
    const border = 1; // 1px page-edge line, like the CSS .tiptap background
    bandStyles = tableBandsDoc.map((b) => {
      // Anchor the band's vertical extent to the real rendered extent of this break's
      // spacers (converted to doc px), so its close/open lines hug the actual content
      // and the mask never eats content. Across columns: top = the lowest column's
      // content end (max spacer top), bottom = the highest column's resume (min spacer
      // bottom). Fall back to the theoretical placement when no spacer is found.
      const group = spacersByKey.get(String(b.key));
      let top: number;
      let height: number;
      if (group && group.length > 0) {
        let maxTop = -Infinity; // lowest column's content end
        let minBottom = Infinity; // highest column's resume
        for (const sp of group) {
          const r = sp.getBoundingClientRect();
          maxTop = Math.max(maxTop, (r.top - tRect.top) / z);
          minBottom = Math.min(minBottom, (r.bottom - tRect.top) / z);
        }
        top = maxTop;
        height = Math.max(0, minBottom - maxTop);
      } else {
        top = b.closeY;
        height = b.height;
      }
      // Solid white mask over the table band — hides the table's vertical borders
      // bleeding through the page's bottom/top margins. The gap region is repainted
      // by the full-width stripe below, so a solid fill here is fine.
      return { top, left: b.left, width: b.width, height };
    });
    // Full-page-width gap stripe: the dark page gap + its two page-edge lines, at the
    // true surface bottom (closeY + marginBottom = N·cycle − gap). Covers the entire
    // natural gap (margins + table) with ONE element → no seam. Painted on top of the
    // bands (later in DOM) so it overrides their white fill in the gap region.
    gapStripeStyles = tableBandsDoc.map((b) => {
      const gapStart = b.closeY + b.marginBottom;
      return {
        top: gapStart - border,
        width: pageWidth,
        height: b.gap + 2 * border,
        background:
          `linear-gradient(to bottom,`
          + ` var(--color-page-border) 0, var(--color-page-border) ${border}px,`
          + ` var(--color-bg) ${border}px, var(--color-bg) ${border + b.gap}px,`
          + ` var(--color-page-border) ${border + b.gap}px, var(--color-page-border) 100%)`,
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
  <div class="paper" class:show-formatting-marks={showFormattingMarks} style="zoom: {appliedZoom / 100}">
    <!-- Dedicated mount point that TipTap fully owns — keeping it free of Svelte
         content avoids Svelte and ProseMirror fighting over the same parent's DOM. -->
    <div bind:this={element} class="tiptap-host"></div>
    {#if bandStyles.length}
      <div class="band-layer">
        {#each bandStyles as b}
          <div
            class="table-break-band"
            style="top: {b.top}px; left: {b.left}px; width: {b.width}px; height: {b.height}px;"
          ></div>
        {/each}
        {#each gapStripeStyles as s}
          <div
            class="page-gap-stripe"
            style="top: {s.top}px; width: {s.width}px; height: {s.height}px; background: {s.background};"
          ></div>
        {/each}
      </div>
    {/if}
  </div>
  {#if tableUi.visible}
    <TableToolbar {editor} top={tableUi.top} left={tableUi.left} />
  {/if}
</div>

<style>
  /* Overlay layer for the table page-break bands. It lives INSIDE the zoomed .paper
     (filling it via inset:0) so the bands are scaled by the same CSS `zoom` as the
     .tiptap page background — no sub-pixel seam at fractional zoom. z-index lifts it
     above the .tiptap content; pointer-events:none keeps the editor clickable. */
  .band-layer {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
  }

  /* Table page-break mask: a solid page-coloured fill over the table's margin band
     that hides the table's vertical borders bleeding through the page margins, plus
     the black close (top) + open (bottom) line. Document px inside .band-layer. The
     dark gap itself is drawn by .page-gap-stripe on top. */
  .table-break-band {
    position: absolute;
    pointer-events: none;
    background: var(--color-page-bg);
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
  }

  /* The page gap at a table break, drawn as ONE full-page-width element on top of the
     masks so the dark gap line is a single rasterised rectangle — no left/right edge
     where it could disagree (sub-pixel, at fractional zoom) with the .tiptap
     background gap in the side margins. */
  .page-gap-stripe {
    position: absolute;
    left: 0;
    pointer-events: none;
  }
</style>
