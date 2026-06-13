<script lang="ts">
  import { Editor, generateHTML } from '@tiptap/core';
  import { hfExtensions } from './hfExtensions';
  import { HF_DISTANCE_CM, hfIsEmpty, type HfDoc, type HfZone } from '../storage/headerFooter';
  import { cmToPx, type PageMargins } from '../storage/pageMargins';
  import { PAGE_W_PORTRAIT, PAGE_H_PORTRAIT, type Orientation } from '../storage/pageOrientation';

  let {
    headerDoc = $bindable(),
    footerDoc = $bindable(),
    numPages,
    currentPage,
    pageMargins,
    orientation,
    hfEditor = $bindable(),
    hfActive = $bindable(),
    hfTick = $bindable(),
  }: {
    headerDoc: HfDoc;
    footerDoc: HfDoc;
    numPages: number;
    currentPage: number;
    pageMargins: PageMargins;
    orientation: Orientation;
    hfEditor: Editor | null;
    hfActive: HfZone | null;
    hfTick: number;
  } = $props();

  const PAGE_GAP = 20;
  const HF_DISTANCE_PX = cmToPx(HF_DISTANCE_CM);
  // Schema for static (read-only) rendering of the inactive zones.
  const renderExts = hfExtensions();

  // All geometry is in unscaled document px — the layer lives inside the scaled
  // .paper, so the zoom transform applies to it identically to the page background.
  let pageWidthPx = $derived(orientation === 'landscape' ? PAGE_H_PORTRAIT : PAGE_W_PORTRAIT);
  let pageHeightPx = $derived(orientation === 'landscape' ? PAGE_W_PORTRAIT : PAGE_H_PORTRAIT);
  let cycle = $derived(pageHeightPx + PAGE_GAP);
  let mTop = $derived(cmToPx(pageMargins.top));
  let mBottom = $derived(cmToPx(pageMargins.bottom));
  let mLeft = $derived(cmToPx(pageMargins.left));
  let mRight = $derived(cmToPx(pageMargins.right));
  let contentWidth = $derived(Math.max(0, pageWidthPx - mLeft - mRight));

  let pages = $derived(Array.from({ length: Math.max(1, numPages) }, (_, i) => i + 1));

  function zoneBox(zone: HfZone, page: number) {
    const left = mLeft;
    const width = contentWidth;
    if (zone === 'header') {
      const top = (page - 1) * cycle + HF_DISTANCE_PX;
      return { top, left, width, height: Math.max(0, mTop - HF_DISTANCE_PX) };
    }
    const top = (page - 1) * cycle + pageHeightPx - mBottom;
    return { top, left, width, height: Math.max(0, mBottom - HF_DISTANCE_PX) };
  }
  const boxStyle = (b: { top: number; left: number; width: number; height: number }) =>
    `top: ${b.top}px; left: ${b.left}px; width: ${b.width}px; height: ${b.height}px;`;

  function staticHtml(doc: HfDoc): string {
    if (hfIsEmpty(doc)) return '';
    try {
      return generateHTML(doc as Parameters<typeof generateHTML>[0], renderExts);
    } catch {
      return '';
    }
  }
  let headerHtml = $derived(staticHtml(headerDoc));
  let footerHtml = $derived(staticHtml(footerDoc));

  // Replace the placeholder text in every page-field span with the real value:
  // current page number, or the total page count. Re-runs when its param changes.
  function patchFields(node: HTMLElement, params: [number, number, string]) {
    const apply = ([page, total]: [number, number, string]) => {
      for (const el of Array.from(node.querySelectorAll('[data-page-field]'))) {
        el.textContent = String(el.getAttribute('data-page-field') === 'count' ? total : page);
      }
    };
    apply(params);
    return { update: apply };
  }

  // --- live editing of one zone ---
  let liveMount = $state<HTMLDivElement | null>(null);
  let editingPage = $state(1);
  // Set by a double-click (that page); null when editing is triggered externally
  // (Layout-panel buttons), where the current page is used instead.
  let pendingPage: number | null = null;
  let liveZone: HfZone | null = null;

  function zoneDoc(zone: HfZone): HfDoc {
    return zone === 'header' ? headerDoc : footerDoc;
  }
  function emptyDoc(): HfDoc {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }

  function startEdit(zone: HfZone, page: number) {
    pendingPage = page;
    hfActive = zone; // the $effect below mounts the live editor
  }

  function destroyLive() {
    hfEditor?.destroy();
    hfEditor = null;
    liveZone = null;
  }

  // Mount / swap / unmount the single live editor as hfActive changes. Driven from
  // double-click (sets editingPage) or the Layout-panel buttons (use currentPage).
  $effect(() => {
    const zone = hfActive;
    const mount = liveMount; // read unconditionally so it's always a tracked dep
    if (!zone) {
      if (hfEditor) destroyLive();
      return;
    }
    if (!mount) return;
    if (hfEditor && liveZone === zone) return; // already editing this zone
    if (hfEditor) destroyLive();

    editingPage = pendingPage ?? currentPage;
    pendingPage = null;
    liveZone = zone;
    const ed = new Editor({
      element: mount,
      extensions: hfExtensions(zone === 'header' ? 'Header…' : 'Footer…'),
      content: zoneDoc(zone) ?? emptyDoc(),
      // No autofocus: its scrollIntoView nudges the page so the just-clicked zone
      // appears to jump. Focus the zone explicitly without scrolling instead.
      onTransaction: () => {
        hfTick++;
      },
      onUpdate: ({ editor }) => {
        const json = editor.getJSON() as HfDoc;
        if (zone === 'header') headerDoc = json;
        else footerDoc = json;
      },
      editorProps: {
        handleKeyDown: (_view, event) => {
          if (event.key === 'Escape') {
            hfActive = null;
            return true;
          }
          return false;
        },
      },
    });
    ed.commands.focus('end', { scrollIntoView: false });
    hfEditor = ed;
  });

  // Keep the live editor's own page-field spans showing the edited page / total.
  $effect(() => {
    void hfTick;
    void numPages;
    void editingPage;
    if (!liveMount) return;
    for (const el of Array.from(liveMount.querySelectorAll('[data-page-field]'))) {
      el.textContent = String(el.getAttribute('data-page-field') === 'count' ? numPages : editingPage);
    }
  });

  function insertField(kind: 'pageNumber' | 'pageCount') {
    hfEditor?.chain().focus().insertContent({ type: kind }).run();
  }
</script>

<div class="hf-layer">
  {#each pages as p}
    {#each ['header', 'footer'] as const as zone}
      {#if !(hfActive === zone && editingPage === p)}
        {@const html = zone === 'header' ? headerHtml : footerHtml}
        <div
          class="hf-zone hf-{zone}"
          class:hf-empty={!html}
          data-hf-label={zone === 'header' ? 'Header' : 'Footer'}
          style={boxStyle(zoneBox(zone, p))}
          ondblclick={() => startEdit(zone, p)}
          role="button"
          tabindex="-1"
          use:patchFields={[p, numPages, html]}
        >
          {@html html}
        </div>
      {/if}
    {/each}
  {/each}

  {#if hfActive}
    {@const box = zoneBox(hfActive, editingPage)}
    <div class="hf-zone hf-{hfActive} hf-active" style={boxStyle(box)} bind:this={liveMount}></div>
    <div class="hf-bar" style="top: {box.top}px; left: {box.left + box.width}px;">
      <button class="hf-bar-btn" title="Insert current page number" onmousedown={(e) => e.preventDefault()} onclick={() => insertField('pageNumber')}>Page #</button>
      <button class="hf-bar-btn" title="Insert total page count" onmousedown={(e) => e.preventDefault()} onclick={() => insertField('pageCount')}>Count</button>
      <span class="hf-bar-sep"></span>
      <button class="hf-bar-btn hf-bar-done" title="Finish editing" onmousedown={(e) => e.preventDefault()} onclick={() => (hfActive = null)}>Done ✓</button>
    </div>
  {/if}
</div>

<style>
  /* Sits inside the scaled .paper, like .band-layer. Zones opt back into pointer
     events so the margin areas are double-clickable to edit (Word behaviour). */
  .hf-layer {
    position: absolute;
    inset: 0;
    z-index: 22;
    pointer-events: none;
  }

  .hf-zone {
    position: absolute;
    display: flex;
    flex-direction: column;
    pointer-events: auto;
    overflow: hidden;
    font-family: var(--font-serif);
    font-size: 12pt;
    color: var(--color-text);
    cursor: text;
  }

  .hf-header {
    justify-content: flex-start;
  }
  .hf-footer {
    justify-content: flex-end;
  }

  /* Inactive zones render slightly muted, like Word's greyed header/footer. */
  .hf-zone:not(.hf-active) {
    opacity: 0.65;
  }

  /* Empty zone: invisible until hovered, then show a faint label hint. */
  .hf-empty::before {
    content: attr(data-hf-label);
    color: var(--color-text-muted);
    font-size: 0.7rem;
    font-family: var(--font-sans);
    opacity: 0;
    transition: opacity 0.12s;
  }
  .hf-footer.hf-empty::before {
    margin-top: auto;
  }
  .hf-empty:hover::before {
    opacity: 0.6;
  }

  .hf-active {
    outline: 1px dashed var(--color-primary);
    outline-offset: 2px;
    opacity: 1;
  }

  /* Strip the page margins from the rendered header/footer paragraph. */
  .hf-zone :global(p) {
    margin: 0;
    line-height: 1.15;
  }
  /* The live editor's editable root is also a `.tiptap`, so the global
     `.paper .tiptap` rules (96px padding, 1123px min-height, page-background
     gradient) leak in and push the text out of the clipped zone. Reset them —
     higher specificity than `.paper .tiptap`, plus !important for the gradient. */
  .hf-layer .hf-zone :global(.tiptap) {
    padding: 0;
    min-height: 0;
    width: 100%;
    background: none !important;
    font-size: 12pt;
    line-height: 1.15;
    outline: none;
  }
  /* The live editor's paragraph also matches `.paper .tiptap p` (margin-bottom
     0.212cm), which the static `<p>` doesn't — with flex-end alignment that gap
     shifts the text up on activation. Match the static zero margin (higher
     specificity than `.paper .tiptap p`). */
  .hf-layer .hf-zone :global(.tiptap p) {
    margin: 0;
  }
  .hf-zone :global([data-page-field]) {
    white-space: pre;
  }

  .hf-bar {
    position: absolute;
    transform: translate(calc(-100% - 4px), -100%);
    z-index: 151;
    display: flex;
    gap: 1px;
    padding: 2px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.14);
    pointer-events: auto;
  }

  .hf-bar-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.6rem;
    height: 1.6rem;
    padding: 0 4px;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.12s;
  }
  .hf-bar-btn:hover {
    background: var(--color-btn-hover);
  }
  .hf-bar-done {
    color: var(--color-primary);
    font-weight: 600;
  }

  .hf-bar-sep {
    width: 1px;
    align-self: stretch;
    margin: 2px 2px;
    background: var(--color-border);
  }
</style>
