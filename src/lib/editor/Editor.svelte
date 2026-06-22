<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { Slice, Fragment } from 'prosemirror-model';
  import type { Node as PmNode, MarkType } from 'prosemirror-model';
  import type { EditorView } from '@tiptap/pm/view';
  import { extensions } from './extensions';
  import { spellErrorAt } from './spellCheck';
  import { spellController } from '../spell/controller';
  import TableToolbar from './TableToolbar.svelte';
  import ImageToolbar from './ImageToolbar.svelte';
  import type { WrapMode } from './image';
  import { NodeSelection } from '@tiptap/pm/state';
  import SpellContextMenu from './SpellContextMenu.svelte';
  import HeaderFooterLayer from './HeaderFooterLayer.svelte';
  import { saveDocument, loadDocument } from '../storage/autosave';
  import { applyMarginVars, cmToPx, DEFAULT_MARGINS, type PageMargins } from '../storage/pageMargins';
  import { applyOrientationVars, type Orientation } from '../storage/pageOrientation';
  import { DEFAULT_HF_DISTANCES, type HfDoc, type HfZone, type HfDistances } from '../storage/headerFooter';
  import { FORCE_PAGE_RECALC, type TableBreakBand } from './pageBreaks';
  import { recordTransaction, resetHistoryLog } from './historyLog.svelte';
  import '../../styles/editor.css';

  const DEFAULT_EDITOR_FONT = 'Georgia'; // must match ToolbarExpanded.svelte

  let {
    editor = $bindable(), tick = $bindable(0), currentPage = $bindable(1), numPages = $bindable(1),
    zoom = 100, showFormattingMarks = false, pageMargins = DEFAULT_MARGINS, orientation = 'portrait',
    headerDoc = $bindable(null), footerDoc = $bindable(null), hfDistances = DEFAULT_HF_DISTANCES,
    hfEditor = $bindable(null), hfActive = $bindable(null), hfTick = $bindable(0),
  }: {
    editor: Editor | null; tick: number; currentPage: number; numPages: number; zoom: number;
    showFormattingMarks?: boolean; pageMargins?: PageMargins; orientation?: Orientation;
    headerDoc?: HfDoc; footerDoc?: HfDoc; hfDistances?: HfDistances;
    hfEditor?: Editor | null; hfActive?: HfZone | null; hfTick?: number;
  } = $props();

  // Apply the page margins + orientation to the :root CSS vars (visual padding,
  // page dimensions, and pagination all read these). DOM-only, safe in effects.
  $effect(() => {
    applyMarginVars(pageMargins);
  });
  $effect(() => {
    applyOrientationVars(orientation);
  });

  // Nudge the pageBreaks plugin to recompute with the new content area. The dispatch
  // bumps the tick/numPages bindings, so requestAnimationFrame defers it past the
  // Svelte effect flush (re-entering it would trip effect_update_depth_exceeded).
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

  // Zoom is a CSS `transform: scale()` on .paper (so layout and pagination stay at
  // 100%). A transform reserves no layout space, so .paper-scaler reserves the scaled
  // footprint to drive the scrollbars and horizontal centering.
  let paperEl: HTMLDivElement;
  let docHeightDoc = $state(0); // document height, from pm-pagecount
  let scaledWidth = $state(0);
  let scaledHeight = $state(0);

  function recomputeScaledSize() {
    if (!paperEl) return;
    const z = appliedZoom / 100;
    const w = paperEl.offsetWidth;                  // unscaled page width (= --user-page-width)
    const h = docHeightDoc || paperEl.offsetHeight; // unscaled document height
    scaledWidth = Math.round(w * z);
    scaledHeight = Math.round(h * z);
  }

  // Page cycle (page height + 20px gap) in document px. Orientation-dependent, so
  // read live from --user-page-height (set by applyOrientationVars). Must match
  // pageBreaks.ts. Fallback = A4 portrait (1123 + 20).
  function getCycle(): number {
    const ph = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--user-page-height'));
    return (Number.isFinite(ph) ? ph : 1123) + 20;
  }

  // --- Spelling suggestion menu (right-click on a red-squiggled word) ---
  let spellMenu = $state<{
    visible: boolean; top: number; left: number;
    from: number; to: number; word: string; suggestions: string[];
  }>({ visible: false, top: 0, left: 0, from: 0, to: 0, word: '', suggestions: [] });

  function openSpellMenu(view: EditorView, event: MouseEvent): boolean {
    if (!spellController.isEnabled() || !editorContainer) return false;
    const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!coords) return false;
    const range = spellErrorAt(view.state, coords.pos);
    if (!range) return false; // not on a misspelling → let the browser menu show
    event.preventDefault();
    const word = view.state.doc.textBetween(range.from, range.to);
    const cRect = editorContainer.getBoundingClientRect();
    spellMenu = {
      visible: true,
      top: event.clientY - cRect.top + editorContainer.scrollTop,
      left: event.clientX - cRect.left + editorContainer.scrollLeft,
      from: range.from, to: range.to, word,
      suggestions: spellController.suggest(word).slice(0, 6),
    };
    return true;
  }

  function closeSpellMenu() {
    if (spellMenu.visible) spellMenu = { ...spellMenu, visible: false };
  }

  // Replace the misspelled range, preserving the word's marks (font/bold/etc.).
  function replaceSpellWord(replacement: string) {
    const ed = editor;
    if (!ed || !spellMenu.visible) return;
    const { from, to } = spellMenu;
    const { state } = ed.view;
    const marks = state.doc.resolve(from).marksAcross(state.doc.resolve(to)) ?? state.doc.resolve(from).marks();
    ed.view.dispatch(state.tr.replaceWith(from, to, state.schema.text(replacement, marks)).scrollIntoView());
    ed.view.focus();
    closeSpellMenu();
  }

  function addSpellWord() {
    if (spellMenu.visible) spellController.addWord(spellMenu.word);
    closeSpellMenu();
    editor?.view.focus();
  }

  function ignoreSpellWord() {
    if (spellMenu.visible) spellController.ignoreWord(spellMenu.word);
    closeSpellMenu();
    editor?.view.focus();
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
    // getBoundingClientRect and scrollTop share the same zoom scale, so this stays
    // aligned across zoom; the toolbar is a non-zoomed sibling, rendered constant-size.
    const tRect = dom.getBoundingClientRect();
    const cRect = editorContainer.getBoundingClientRect();
    const left = tRect.left - cRect.left + editorContainer.scrollLeft;
    // Default: anchor just above the table's top-left corner.
    let top = tRect.top - cRect.top + editorContainer.scrollTop;

    // When a table spans page breaks, keep the toolbar on the cursor's page rather
    // than the table's first page. If the cursor's page differs from the table's start
    // page, re-anchor to that page's content-top so the toolbar floats in its margin.
    const tiptap = element?.querySelector('.tiptap') as HTMLElement | null;
    if (tiptap) {
      try {
        const z = appliedZoom / 100;
        const tiptapRect = tiptap.getBoundingClientRect();
        const cycle = getCycle();
        const tableTopDoc = (tRect.top - tiptapRect.top) / z;
        const coords = ed.view.coordsAtPos(ed.state.selection.head);
        const cursorDoc = ((coords.top + coords.bottom) / 2 - tiptapRect.top) / z;
        const tableStartPage = Math.floor(Math.max(0, tableTopDoc) / cycle);
        const cursorPage = Math.floor(Math.max(0, cursorDoc) / cycle);
        if (cursorPage > tableStartPage) {
          const marginTopDoc =
            parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--user-margin-top')) || 96;
          const pageContentTopDoc = cursorPage * cycle + marginTopDoc;
          const tiptapTopInContainer = tiptapRect.top - cRect.top + editorContainer.scrollTop;
          top = tiptapTopInContainer + pageContentTopDoc * z;
        }
      } catch { /* fall back to the table-top anchor */ }
    }

    tableUi = { visible: true, top, left };
  }

  // --- Floating image wrap toolbar ---
  // Shown when a single image node is selected; positioned just above it.
  let imageUi = $state<{ visible: boolean; top: number; left: number; wrap: WrapMode }>({ visible: false, top: 0, left: 0, wrap: 'inline' });

  function recomputeImageUi() {
    const ed = editor;
    if (!ed || !editorContainer) {
      if (imageUi.visible) imageUi = { ...imageUi, visible: false };
      return;
    }
    const sel = ed.state.selection;
    const dom = sel instanceof NodeSelection && sel.node.type.name === 'image' ? ed.view.nodeDOM(sel.from) : null;
    if (!(dom instanceof HTMLElement)) {
      if (imageUi.visible) imageUi = { ...imageUi, visible: false };
      return;
    }
    const r = dom.getBoundingClientRect();
    const cRect = editorContainer.getBoundingClientRect();
    imageUi = {
      visible: true,
      top: r.top - cRect.top + editorContainer.scrollTop,
      left: r.left - cRect.left + editorContainer.scrollLeft,
      wrap: ((sel as NodeSelection).node.attrs.wrap as WrapMode) || 'inline',
    };
  }

  // Table page-break overlay: pageBreaks.ts reports (via pm-pagecount) where a continuous
  // table box crosses a page boundary, each as a band in doc px. Rendered in .band-layer
  // inside the scaled .paper — a mask hides borders in the margins, a stripe is the gap.
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
    const pageWidth = tiptap.offsetWidth; // unscaled doc px = full page width
    // Everything below is in document px (relative to .tiptap's top). The .band-layer
    // lives inside the scaled .paper, so the transform applies the scaling — no `* z`.
    const border = 1; // 1px page-edge line, like the CSS .tiptap background
    bandStyles = tableBandsDoc.map((b) => {
      // The band spans the inter-page region (closeY through margin/gap/margin to the
      // next content-top), where pagination guarantees no content, so the mask can't eat
      // content. Matched to the table's content box (b.left/b.width) so the lines align.
      return { top: b.closeY, left: b.left, width: b.width, height: b.height };
    });
    // Full-page-width gap stripe: the dark page gap + its two edge lines at the surface
    // bottom (closeY + marginBottom). One element covers the whole gap → no seam; painted
    // after the bands so it overrides their fill in the gap region.
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
      recomputeImageUi();
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
    // Re-reserve the scaled scroll footprint for the new zoom (layout itself is frozen).
    recomputeScaledSize();
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
    const detail = (e as CustomEvent<{ numPages: number; docHeight?: number; tableBreakBands?: TableBreakBand[] }>).detail;
    numPages = detail.numPages;
    if (typeof detail.docHeight === 'number') docHeightDoc = detail.docHeight;
    tableBandsDoc = detail.tableBreakBands ?? [];
    // The document height changed → resize the scaled scroll footprint.
    recomputeScaledSize();
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

  // --- Image insertion (drag-drop / paste); the toolbar button lives in
  // ToolbarExpanded.svelte. Shared sizing mirrors the export content-width math. ---
  function imageContentBoxPx(): { maxW: number; maxH: number } {
    const land = orientation === 'landscape';
    const wCm = (land ? 29.7 : 21) - pageMargins.left - pageMargins.right;
    const hCm = (land ? 21 : 29.7) - pageMargins.top - pageMargins.bottom;
    return { maxW: Math.round(cmToPx(wCm)), maxH: Math.round(cmToPx(hCm)) };
  }

  function imageFilesFrom(dt: DataTransfer | null): File[] {
    if (!dt) return [];
    const out: File[] = [];
    for (const f of Array.from(dt.files)) if (f.type.startsWith('image/')) out.push(f);
    if (!out.length && dt.items) {
      for (const it of Array.from(dt.items)) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) out.push(f);
        }
      }
    }
    return out;
  }

  function insertImageFile(file: File, pos: number | null): void {
    const ed = editor;
    if (!ed) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const probe = document.createElement('img');
      probe.onload = () => {
        let w = probe.naturalWidth || 1;
        let h = probe.naturalHeight || 1;
        const { maxW, maxH } = imageContentBoxPx();
        if (w > maxW) { h = (h * maxW) / w; w = maxW; }
        if (h > maxH) { w = (w * maxH) / h; h = maxH; }
        const attrs = { src, alt: file.name, width: Math.round(w), height: Math.round(h) };
        if (pos == null) ed.chain().focus().setImage(attrs).run();
        else ed.chain().focus().insertContentAt(pos, { type: 'image', attrs }).run();
      };
      probe.src = src;
    };
    reader.readAsDataURL(file);
  }

  onMount(() => {
    // Start with empty history lists — loaded content is not an undoable edit.
    resetHistoryLog();
    const saved = loadDocument();

    editor = new Editor({
      element,
      extensions,
      content: saved || undefined,
      editorProps: {
        // Our SpellCheck extension draws squiggles; turn off the browser's so
        // they don't double up.
        attributes: { spellcheck: 'false' },
        handleDOMEvents: {
          contextmenu: (view, event) => openSpellMenu(view, event),
          drop: (view, event) => {
            const e = event as DragEvent;
            const files = imageFilesFrom(e.dataTransfer);
            if (!files.length) return false;
            e.preventDefault();
            const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
            for (const f of files) insertImageFile(f, at?.pos ?? null);
            return true;
          },
          paste: (view, event) => {
            const e = event as ClipboardEvent;
            const files = imageFilesFrom(e.clipboardData);
            if (!files.length) return false;
            e.preventDefault();
            for (const f of files) insertImageFile(f, null);
            return true;
          },
        },
        transformPasted(slice, view) {
          const textStyleType = view.state.schema.marks.textStyle;
          if (!textStyleType) return slice;
          const cursorMarks = view.state.storedMarks ?? view.state.selection.$head.marks();
          const cursorFont = cursorMarks.find(m => m.type === textStyleType)?.attrs.fontFamily as string | undefined;
          const font = cursorFont ?? DEFAULT_EDITOR_FONT;
          return new Slice(applyFontToFragment(slice.content, textStyleType, font), slice.openStart, slice.openEnd);
        },
      },
      onTransaction: ({ editor: e, transaction }) => {
        tick++;
        // Mirror this transaction into the labelled undo/redo log for the toolbar's
        // history dropdowns. e.state is the POST-transaction state, so the history
        // depths recordTransaction reads already reflect this transaction.
        recordTransaction(e.state, transaction);
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
      onFocus: () => {
        // Clicking back into the body ends header/footer editing (Word behaviour).
        hfActive = null;
      },
    });

    element.addEventListener('pm-pagecount', onPageCount);
    editorContainer.addEventListener('scroll', onEditorScroll);
    // Seed the scaled footprint before the first paint (so the page is centered, not
    // briefly left-aligned), then refine it once layout settles. The pageBreaks plugin
    // also fires pm-pagecount shortly after with the precise document height.
    recomputeScaledSize();
    requestAnimationFrame(recomputeScaledSize);
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
    resetHistoryLog();
    element?.removeEventListener('pm-pagecount', onPageCount);
    editorContainer?.removeEventListener('scroll', onEditorScroll);
  });
</script>

<div class="editor" bind:this={editorContainer}>
  <!-- Reserves the scaled scroll footprint; the transform on .paper reserves none.
       Before the first measure (size 0) it's left unsized so .paper isn't clipped. -->
  <div class="paper-scaler" style={scaledWidth ? `width: ${scaledWidth}px; height: ${scaledHeight}px;` : ''}>
    <div bind:this={paperEl} class="paper" class:show-formatting-marks={showFormattingMarks} class:hf-editing={hfActive} style="transform: scale({appliedZoom / 100});">
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
      <HeaderFooterLayer
        bind:headerDoc
        bind:footerDoc
        bind:hfEditor
        bind:hfActive
        bind:hfTick
        {numPages}
        {currentPage}
        {pageMargins}
        {orientation}
        {hfDistances}
      />
    </div>
  </div>
  {#if tableUi.visible}
    <TableToolbar {editor} top={tableUi.top} left={tableUi.left} />
  {/if}
  {#if imageUi.visible}
    <ImageToolbar {editor} top={imageUi.top} left={imageUi.left} wrap={imageUi.wrap} />
  {/if}
  {#if spellMenu.visible}
    <SpellContextMenu
      top={spellMenu.top}
      left={spellMenu.left}
      suggestions={spellMenu.suggestions}
      onReplace={replaceSpellWord}
      onAdd={addSpellWord}
      onIgnore={ignoreSpellWord}
      onClose={closeSpellMenu}
    />
  {/if}
</div>

<style>
  /* While editing a header/footer, dim the body so focus is on the margin zone. */
  .paper.hf-editing :global(.tiptap) {
    opacity: 0.5;
    transition: opacity 0.15s;
  }

  /* Overlay for the table page-break bands, inside .paper (inset:0) so it scales with
     the page background. pointer-events:none keeps the editor clickable. z-index clears
     the resize handles (20) so the band also masks a too-tall cell's handle in the gap. */
  .band-layer {
    position: absolute;
    inset: 0;
    z-index: 21;
    pointer-events: none;
  }

  /* Table page-break mask: a solid page-coloured fill over the margin band hiding the
     table's vertical borders, plus the black close (top) + open (bottom) lines. The
     dark gap itself is drawn by .page-gap-stripe on top. */
  .table-break-band {
    position: absolute;
    pointer-events: none;
    background: var(--color-page-bg);
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
    /* Fill matches the table's content box so the close/open lines align with its
       start/end borders. The outer L/R borders sit 0.5px into the margins, so two
       horizontal box-shadows paint 1px beyond each side to swallow those slivers. */
    box-shadow:
      1px 0 0 0 var(--color-page-bg),
      -1px 0 0 0 var(--color-page-bg);
  }

  /* The page gap at a table break, drawn as ONE full-page-width element on top of the
     masks so the dark gap is a single rasterised rectangle — no left/right edge to
     disagree (sub-pixel, at fractional zoom) with the .tiptap background gap. */
  .page-gap-stripe {
    position: absolute;
    left: 0;
    pointer-events: none;
  }
</style>
