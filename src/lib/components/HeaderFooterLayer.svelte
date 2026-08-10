<script lang="ts">
  import { Editor, generateHTML, type Content } from '@tiptap/core';
  import { layOutZoneTabs } from '../editor/extensions/tabStops';
  import { hfExtensions } from '../editor/extensions/headerFooter';
  import { hfIsEmpty, DEFAULT_HF_DISTANCES, type HfDoc, type HfZone, type HfVariant, type HfDistances, type HfSet } from '../storage/headerFooter';
  import { cmToPx, PX_PER_CM, type PageMargins } from '../storage/pageMargins';
  import { type Orientation } from '../storage/pageOrientation';
  import { pageDimsCm, type PageFormat } from '../storage/pageFormat';
  import { t } from '../i18n/i18n.svelte';

  let {
    headerDoc = $bindable(),
    footerDoc = $bindable(),
    headerFirstDoc = $bindable(),
    footerFirstDoc = $bindable(),
    differentFirstPage = false,
    headerEvenDoc = $bindable(),
    footerEvenDoc = $bindable(),
    differentOddEven = false,
    numPages,
    currentPage,
    pageMargins,
    orientation,
    pageFormat = 'A4',
    hfDistances = DEFAULT_HF_DISTANCES,
    hfEditor = $bindable(),
    hfActive = $bindable(),
    hfTick = $bindable(),
    extraHfSections = $bindable([]),
    sectionStartPages = [],
    chapterStarts = [],
  }: {
    headerDoc: HfDoc;
    footerDoc: HfDoc;
    headerFirstDoc: HfDoc;
    footerFirstDoc: HfDoc;
    differentFirstPage?: boolean;
    headerEvenDoc: HfDoc;
    footerEvenDoc: HfDoc;
    differentOddEven?: boolean;
    numPages: number;
    currentPage: number;
    pageMargins: PageMargins;
    orientation: Orientation;
    pageFormat?: PageFormat;
    hfDistances?: HfDistances;
    hfEditor: Editor | null;
    hfActive: HfZone | null;
    hfTick: number;
    extraHfSections?: HfSet[];
    sectionStartPages?: number[];
    chapterStarts?: { page: number; level: number; text: string }[];
  } = $props();

  const PAGE_GAP = 20;
  // Minimum zone height (~one 12pt line), so a thin margin band (footer distance ≥
  // bottom margin, as some Word docs have) still renders instead of collapsing to 0.
  const MIN_ZONE_PX = 20;
  // Schema for static (read-only) rendering of the inactive zones.
  const renderExts = hfExtensions();

  // All geometry is in unscaled document px — the layer lives inside the scaled
  // .paper, so the zoom transform applies to it identically to the page background.
  let pageWidthPx = $derived(pageDimsCm(pageFormat, orientation).w * PX_PER_CM);
  let pageHeightPx = $derived(pageDimsCm(pageFormat, orientation).h * PX_PER_CM);
  let cycle = $derived(pageHeightPx + PAGE_GAP);
  let mTop = $derived(cmToPx(pageMargins.top));
  let mBottom = $derived(cmToPx(pageMargins.bottom));
  let mLeft = $derived(cmToPx(pageMargins.left));
  let mRight = $derived(cmToPx(pageMargins.right));
  let contentWidth = $derived(Math.max(0, pageWidthPx - mLeft - mRight));
  // Edge→zone distance in px. The footer may sit farther from the edge than the body
  // bottom margin (Word's w:footer > w:bottom); the zone then grows up into the margin.
  let headerDistPx = $derived(Math.min(cmToPx(hfDistances.header), pageHeightPx));
  let footerDistPx = $derived(Math.min(cmToPx(hfDistances.footer), pageHeightPx));

  let pages = $derived(Array.from({ length: Math.max(1, numPages) }, (_, i) => i + 1));

  function zoneBox(zone: HfZone, page: number) {
    const left = mLeft;
    const width = contentWidth;
    if (zone === 'header') {
      const top = (page - 1) * cycle + headerDistPx;
      return { top, left, width, height: Math.max(MIN_ZONE_PX, mTop - headerDistPx) };
    }
    // Footer anchors its bottom edge at footerDistPx from the page bottom and grows up.
    const height = Math.max(MIN_ZONE_PX, mBottom - footerDistPx);
    const top = (page - 1) * cycle + pageHeightPx - footerDistPx - height;
    return { top, left, width, height };
  }
  // The active (edited) zone grows to fit its content, keeping the anchored edge fixed
  // (footer bottom at footerDistPx, header top at headerDistPx) so the boundary line
  // sits exactly at the content's edge toward the body.
  function activeZoneBox(zone: HfZone, page: number) {
    const b = zoneBox(zone, page);
    // A visible ProseMirror trailing break (a caret line past the real content) is
    // discounted: the frame tracks the real content and the break overflows past the
    // anchored edge, so entering edit never shifts the text.
    const contentPx = Math.max(0, activeContentPx - activeTrailingPx);
    const height = Math.max(b.height, contentPx);
    if (zone === 'footer') return { ...b, top: b.top + b.height - height, height };
    return { ...b, height };
  }
  const boxStyle = (b: { top: number; left: number; width: number; height: number }) =>
    `top: ${b.top}px; left: ${b.left}px; width: ${b.width}px; height: ${b.height}px;`;

  function staticHtml(doc: HfDoc): string {
    if (hfIsEmpty(doc)) return '';
    try {
      const html = generateHTML(doc as Parameters<typeof generateHTML>[0], renderExts);
      // A paragraph ending in a hardBreak loses its last blank line: a bare trailing <br>
      // collapses, so the live editor adds a ProseMirror trailing break but generateHTML
      // doesn't. Append one (past any mark close-tags) so static matches editing.
      return html.replace(/(<br\s*\/?>)((?:<\/[a-zA-Z]+>)*<\/p>)/g, '$1<br>$2');
    } catch {
      return '';
    }
  }
  // A positioned frame in a zone is out of flow: the page-anchored letterhead or
  // watermark a title page is made of. It paints once per page from the page corner,
  // behind the body, and the zone's own box never sees it (editor.css hides it there).
  type PageBg = { src: string; x: number; y: number; width: number; height: number };
  function backgrounds(doc: HfDoc): PageBg[] {
    const inline = ((doc?.content?.[0] as { content?: { type?: string; attrs?: Record<string, unknown> }[] } | undefined)?.content ?? []);
    const out: PageBg[] = [];
    for (const n of inline) {
      if (n.type !== 'image' || typeof n.attrs?.src !== 'string' || (n.attrs.wrap ?? 'inline') === 'inline') continue;
      out.push({
        src: n.attrs.src,
        x: cmToPx(Number(n.attrs.wrapOffset) || 0),
        y: cmToPx(Number(n.attrs.wrapOffsetY) || 0),
        width: Number(n.attrs.width) || pageWidthPx,
        height: Number(n.attrs.height) || pageHeightPx,
      });
    }
    return out;
  }
  // Section 1 is the app's own editable state; the rest live in extraHfSections.
  let sets = $derived<HfSet[]>([
    {
      header: headerDoc, footer: footerDoc,
      headerFirst: headerFirstDoc, footerFirst: footerFirstDoc, differentFirstPage,
      headerEven: headerEvenDoc, footerEven: footerEvenDoc, differentOddEven,
    },
    ...extraHfSections,
  ]);
  // Rendered once per set, not per page: a 48-page document would otherwise run
  // generateHTML for every page of every zone.
  let setHtml = $derived(sets.map((s) => ({
    header: staticHtml(s.header), footer: staticHtml(s.footer),
    headerFirst: staticHtml(s.headerFirst), footerFirst: staticHtml(s.footerFirst),
    headerEven: staticHtml(s.headerEven), footerEven: staticHtml(s.footerEven),
  })));
  let setBg = $derived(sets.map((s) => ({
    header: backgrounds(s.header), footer: backgrounds(s.footer),
    headerFirst: backgrounds(s.headerFirst), footerFirst: backgrounds(s.footerFirst),
    headerEven: backgrounds(s.headerEven), footerEven: backgrounds(s.footerEven),
  })));

  // Which section a page belongs to: the count of section starts at or before it,
  // clamped to what the document actually carries.
  function sectionOf(page: number): number {
    let i = 0;
    for (const start of sectionStartPages) {
      if (page >= start) i++;
      else break;
    }
    return Math.min(i, sets.length - 1);
  }
  function sectionFirstPage(index: number): number {
    return index === 0 ? 1 : sectionStartPages[index - 1] ?? 1;
  }

  // Which variant a page shows, in precedence order: a section's own first page →
  // first (if on), other even pages → even (if on), everything else → default/odd.
  // Each variant, when on, always shows its own (possibly empty) zone.
  function variantFor(page: number, index = sectionOf(page)): HfVariant {
    const s = sets[index] ?? sets[0];
    if (s.differentFirstPage && page === sectionFirstPage(index)) return 'first';
    if (s.differentOddEven && page % 2 === 0) return 'even';
    return 'default';
  }
  function zoneHtml(zone: HfZone, page: number): string {
    const index = sectionOf(page);
    const v = variantFor(page, index);
    const h = setHtml[index] ?? setHtml[0];
    if (zone === 'header') return v === 'first' ? h.headerFirst : v === 'even' ? h.headerEven : h.header;
    return v === 'first' ? h.footerFirst : v === 'even' ? h.footerEven : h.footer;
  }
  function zoneBackgrounds(zone: HfZone, page: number): PageBg[] {
    const index = sectionOf(page);
    const v = variantFor(page, index);
    const b = setBg[index] ?? setBg[0];
    if (zone === 'header') return v === 'first' ? b.headerFirst : v === 'even' ? b.headerEven : b.header;
    return v === 'first' ? b.footerFirst : v === 'even' ? b.footerEven : b.footer;
  }

  // Page, page count, the zone's HTML and the chapter map: everything the two actions
  // below re-run on (the map's identity changes with each pagination pass).
  type ZoneParams = [number, number, string, unknown];

  // Lay out the zone's tabs: static HTML no ProseMirror plugin reaches. The advances are
  // layout px, so only a content change invalidates them — not the zoom transform.
  // The chapter a page runs under: the last heading at or above the field's outline
  // level that has started by then (ODF text:chapter, Word STYLEREF).
  function chapterOn(page: number, level: number): string {
    let text = '';
    for (const c of chapterStarts) {
      if (c.page > page) break;
      if (c.level <= level) text = c.text;
    }
    return text;
  }

  function layOutTabs(node: HTMLElement, _params: ZoneParams) {
    const apply = () => layOutZoneTabs(node);
    apply();
    return { update: apply };
  }

  // Replace the placeholder text in every page-field span with the real value:
  // current page number, or the total page count. Re-runs when its param changes.
  function patchFields(node: HTMLElement, params: ZoneParams) {
    const apply = ([page, total]: ZoneParams) => {
      for (const el of Array.from(node.querySelectorAll('[data-page-field]'))) {
        const kind = el.getAttribute('data-page-field');
        if (kind === 'chapter') el.textContent = chapterOn(page, Number(el.getAttribute('data-level')) || 1);
        else el.textContent = String(kind === 'count' ? total : page);
      }
    };
    apply(params);
    return { update: apply };
  }

  // --- live editing of one zone ---
  let liveMount = $state<HTMLDivElement | null>(null);
  let activeContentPx = $state(0);
  let activeTrailingPx = $state(0);
  let editingPage = $state(1);
  // Set by a double-click (that page); null when editing is triggered externally
  // (Layout-panel buttons), where the current page is used instead.
  let pendingPage: number | null = null;
  let liveZone: HfZone | null = null;

  // Which HfSet field a zone + variant is.
  type ZoneKey = 'header' | 'footer' | 'headerFirst' | 'footerFirst' | 'headerEven' | 'footerEven';
  const zoneKey = (zone: HfZone, variant: HfVariant): ZoneKey =>
    (zone + (variant === 'first' ? 'First' : variant === 'even' ? 'Even' : '')) as ZoneKey;

  function zoneDoc(index: number, zone: HfZone, variant: HfVariant): HfDoc {
    return (sets[index] ?? sets[0])[zoneKey(zone, variant)];
  }
  // Section 1's zones are separate bindable props; a later section's live in the array,
  // replaced whole so the reassignment reaches App (which persists it).
  function writeZone(index: number, zone: HfZone, variant: HfVariant, doc: HfDoc): void {
    const key = zoneKey(zone, variant);
    if (index > 0) {
      extraHfSections = extraHfSections.map((s, i) => (i === index - 1 ? { ...s, [key]: doc } : s));
    } else if (key === 'header') headerDoc = doc;
    else if (key === 'footer') footerDoc = doc;
    else if (key === 'headerFirst') headerFirstDoc = doc;
    else if (key === 'footerFirst') footerFirstDoc = doc;
    else if (key === 'headerEven') headerEvenDoc = doc;
    else footerEvenDoc = doc;
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
    // Which section and variant this edit session targets — fixed for its lifetime (the
    // edited page's; App ends the edit when a flag toggles).
    const editingIndex = sectionOf(editingPage);
    const editingVariant = variantFor(editingPage, editingIndex);
    const ed = new Editor({
      element: mount,
      extensions: hfExtensions(zone === 'header' ? t().hf.headerPlaceholder : t().hf.footerPlaceholder),
      content: (zoneDoc(editingIndex, zone, editingVariant) ?? emptyDoc()) as Content,
      // No autofocus: its scrollIntoView nudges the page so the just-clicked zone
      // appears to jump. Focus the zone explicitly without scrolling instead.
      onTransaction: () => {
        hfTick++;
      },
      onUpdate: ({ editor }) => {
        writeZone(editingIndex, zone, editingVariant, editor.getJSON() as HfDoc);
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
      const kind = el.getAttribute('data-page-field');
      if (kind === 'chapter') el.textContent = chapterOn(editingPage, Number(el.getAttribute('data-level')) || 1);
      else el.textContent = String(kind === 'count' ? numPages : editingPage);
    }
    // Content height (unscaled by the zoom transform) drives the active zone's frame.
    const tt = liveMount.querySelector('.tiptap') as HTMLElement | null;
    activeContentPx = tt ? tt.offsetHeight : 0;
    // A rendered trailing break adds one caret line past the real content; measure that
    // line height (the CSS var below shifts the editor down so it overflows the anchor).
    const p = tt?.querySelector('p') as HTMLElement | null;
    const tb = p?.querySelector(':scope > br.ProseMirror-trailingBreak') as HTMLElement | null;
    const lineH = p ? parseFloat(getComputedStyle(p).lineHeight) : 0;
    activeTrailingPx = tb && getComputedStyle(tb).display !== 'none' && Number.isFinite(lineH) ? lineH : 0;
  });

  function insertField(kind: 'pageNumber' | 'pageCount' | 'chapterField') {
    hfEditor?.chain().focus().insertContent({ type: kind }).run();
  }
</script>

<!-- Own layer below the body (z-index -1 against .paper's zoom stacking context), so a
     full-page background sits under the text the way LibreOffice paints it. -->
<div class="hf-bg-layer">
  {#each pages as p}
    {#each ['header', 'footer'] as const as zone}
      {#each zoneBackgrounds(zone, p) as bg}
        <img
          class="hf-page-bg"
          src={bg.src}
          alt=""
          style="top: {(p - 1) * cycle + bg.y}px; left: {bg.x}px; width: {bg.width}px; height: {bg.height}px;"
        />
      {/each}
    {/each}
  {/each}
</div>

<div class="hf-layer">
  {#each pages as p}
    {#each ['header', 'footer'] as const as zone}
      {#if !(hfActive === zone && editingPage === p)}
        {@const html = zoneHtml(zone, p)}
        <div
          class="hf-zone hf-{zone}"
          class:hf-empty={!html}
          data-hf-label={zone === 'header' ? t().hf.addHeaderHint : t().hf.addFooterHint}
          style={boxStyle(zoneBox(zone, p))}
          ondblclick={() => startEdit(zone, p)}
          role="button"
          tabindex="-1"
          use:patchFields={[p, numPages, html, chapterStarts]}
          use:layOutTabs={[p, numPages, html, chapterStarts]}
        >
          {@html html}
        </div>
      {/if}
    {/each}
  {/each}

  {#if hfActive}
    {@const box = activeZoneBox(hfActive, editingPage)}
    {@const index = sectionOf(editingPage)}
    {@const variant = variantFor(editingPage, index)}
    <div class="hf-zone hf-{hfActive} hf-active" style={boxStyle(box) + ` --hf-tb-offset: ${-activeTrailingPx}px;`} bind:this={liveMount}></div>
    <div class="hf-tag" style="top: {box.top}px; left: {box.left}px;">
      {hfActive === 'header'
        ? (variant === 'first' ? t().hf.firstPageHeader : variant === 'even' ? t().hf.evenPageHeader : t().hf.headerLabel)
        : (variant === 'first' ? t().hf.firstPageFooter : variant === 'even' ? t().hf.evenPageFooter : t().hf.footerLabel)}{sets.length >
      1
        ? ` · ${t().hf.section} ${index + 1}`
        : ''}
    </div>
    <div class="hf-bar" style="top: {box.top}px; left: {box.left + box.width}px;">
      <span class="hf-bar-label">{t().hf.insert}</span>
      <button class="hf-bar-btn" title={t().hf.pageNumberTitle} onmousedown={(e) => e.preventDefault()} onclick={() => insertField('pageNumber')}>{t().hf.pageNumber}</button>
      <button class="hf-bar-btn" title={t().hf.pageCountTitle} onmousedown={(e) => e.preventDefault()} onclick={() => insertField('pageCount')}>{t().hf.pageCount}</button>
      <button class="hf-bar-btn" title={t().hf.chapterTitle} onmousedown={(e) => e.preventDefault()} onclick={() => insertField('chapterField')}>{t().hf.chapter}</button>
      <span class="hf-bar-sep"></span>
      <button class="hf-bar-btn hf-bar-done" title={t().hf.doneTitle} onmousedown={(e) => e.preventDefault()} onclick={() => (hfActive = null)}>{t().hf.done}</button>
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

  .hf-bg-layer {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
  }
  .hf-page-bg {
    position: absolute;
  }
  /* The frame is painted by .hf-bg-layer; inside the zone it would grow the box and,
     while editing, flow as a line. Selecting it still works from the keyboard. */
  .hf-zone :global([data-wrap]) {
    display: none;
  }

  .hf-zone {
    position: absolute;
    display: flex;
    flex-direction: column;
    pointer-events: auto;
    /* Content taller than the margin band spills into the margin (footer up, header
       down) — the zone auto-grows; the anchored edge stays put. */
    overflow: visible;
    font-family: var(--font-serif);
    font-size: 12pt;
    color: var(--color-page-text);
    cursor: text;
  }

  .hf-header {
    justify-content: flex-start;
  }
  .hf-footer {
    justify-content: flex-end;
  }

  /* Empty zone: invisible until hovered, then show a faint double-click hint. */
  .hf-empty::before {
    content: attr(data-hf-label);
    color: var(--color-text-muted);
    font-size: 0.9rem;
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

  /* Boundary affordance: a single dashed line at the edge facing the page body
     (footer top, header bottom) instead of a rectangle around the content. */
  .hf-active::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px dashed var(--color-primary);
    pointer-events: none;
  }
  .hf-active.hf-footer::after {
    top: 0;
  }
  .hf-active.hf-header::after {
    bottom: 0;
  }

  /* Zone label tab, pinned to the zone's top-left corner. */
  .hf-tag {
    position: absolute;
    transform: translateY(calc(-100% - 2px));
    z-index: 150;
    padding: 1px 6px;
    background: var(--color-primary);
    color: #fff;
    font-family: var(--font-sans);
    font-size: 0.68rem;
    letter-spacing: 0.02em;
    border-radius: calc(var(--radius) - 3px) calc(var(--radius) - 3px) 0 0;
    pointer-events: none;
    white-space: nowrap;
    user-select: none;
  }

  /* Strip the page margins from the rendered header/footer paragraph. pre-wrap keeps
     runs of spaces (used to push a right-side field over) that HTML would collapse —
     matching the live editor's ProseMirror rendering. */
  .hf-zone :global(p) {
    margin: 0;
    line-height: 1.15;
    white-space: pre-wrap;
  }
  /* The live editor's editable root is also a `.tiptap`, so the global `.paper .tiptap`
     rules (96px padding, 1123px min-height, page gradient) leak in and push the text out
     of the clipped zone. Reset them — higher specificity, plus !important for the gradient. */
  .hf-layer .hf-zone :global(.tiptap) {
    padding: 0;
    min-height: 0;
    width: 100%;
    background: none !important;
    font-size: 12pt;
    line-height: 1.15;
    outline: none;
    /* Keep the editable root at its content height (min-height:0 would otherwise let
       the flex column shrink it to the band, hiding lines and misreporting height). */
    flex-shrink: 0;
    /* Drop the editor by the trailing-break line so the caret line overflows past the
       anchored edge while the real content stays put (set per active zone). */
    margin-bottom: var(--hf-tb-offset, 0px);
  }
  /* The live editor's paragraph also matches `.paper .tiptap p` (margin-bottom 0.212cm),
     which the static `<p>` doesn't — with flex-end alignment that gap shifts the text up
     on activation. Match the static zero margin (higher specificity). */
  .hf-layer .hf-zone :global(.tiptap p) {
    margin: 0;
  }
  /* A paragraph ending in an inline atom (a page field) gets a phantom trailing <br> the
     static <p> lacks; ProseMirror marks that case with a separator <img>, so hide the
     break only then. A real Enter-made line has no separator and keeps its caret. */
  .hf-layer .hf-zone :global(.tiptap p:has(img.ProseMirror-separator) > br.ProseMirror-trailingBreak) {
    display: none;
  }
  .hf-zone :global([data-page-field]) {
    white-space: pre;
  }

  .hf-bar {
    position: absolute;
    transform: translate(calc(-100% - 4px), -100%);
    z-index: 151;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px 4px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.14);
    pointer-events: auto;
    white-space: nowrap;
  }

  .hf-bar-label {
    padding: 0 4px 0 2px;
    color: var(--color-text-muted);
    font-family: var(--font-sans);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    user-select: none;
  }

  .hf-bar-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 1.8rem;
    padding: 0 0.55rem;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 0.8rem;
    white-space: nowrap;
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
    margin: 3px 2px;
    background: var(--color-border);
  }
</style>
