<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { Slice, Fragment } from 'prosemirror-model';
  import type { Node as PmNode, MarkType } from 'prosemirror-model';
  import { extensions } from '../editor/extensions';
  import { buildContextMenu, type MenuEntry, type SpellSection } from '../editor/contextMenuItems';
  import { spellErrorAt } from '../editor/extensions/spellCheck';
  import { spellController } from '../spell/controller';
  import TableToolbar from './TableToolbar.svelte';
  import TableSplitDialog from './TableSplitDialog.svelte';
  import ImageToolbar from './ImageToolbar.svelte';
  import TextBoxToolbar from './TextBoxToolbar.svelte';
  import type { WrapMode } from '../editor/extensions/image';
  import { findTextBox, type ShapeKind } from '../editor/extensions/textBox';
  import { NodeSelection, TextSelection } from '@tiptap/pm/state';
  import ContextMenu from './ContextMenu.svelte';
  import HeaderFooterLayer from './HeaderFooterLayer.svelte';
  import Ruler from './Ruler.svelte';
  import { saveDocument, loadDocument, markDocumentLoaded } from '../storage/autosave';
  import { applyMarginVars, cmToPx, DEFAULT_MARGINS, type PageMargins } from '../storage/pageMargins';
  import { DEFAULT_TAB_INTERVAL_CM } from '../storage/tabInterval';
  import { type Orientation } from '../storage/pageOrientation';
  import { type SpacingModel } from '../storage/spacingModel';
  import { applyPageSizeVars, type PageFormat } from '../storage/pageFormat';
  import { DEFAULT_HF_DISTANCES, hfIsEmpty, hfUsesChapterField, type HfDoc, type HfZone, type HfDistances, type HfSet } from '../storage/headerFooter';
  import { FORCE_PAGE_RECALC, pageOfElement, readVerticalMargins, type TableBreakBand } from '../editor/extensions/pageBreaks';
  import { findBookmark } from '../editor/extensions/bookmark';
  import { recordTransaction, resetHistoryLog } from '../utils/historyLog.svelte';
  import { wheelZoomFactor } from '../utils/zoom';
  import { styleCss, singleLineHeight } from '../styles/styleSheet';
  import { styleSheet } from '../styles/sheet.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { withShortcut } from '../i18n/shortcut';
  import '../../styles/editor.css';

  const DEFAULT_EDITOR_FONT = 'Georgia'; // must match ToolbarExpanded.svelte

  let {
    editor = $bindable(), tick = $bindable(0), currentPage = $bindable(1), numPages = $bindable(1),
    zoom = 100, onZoom, showFormattingMarks = false, showRuler = true, pageMargins = DEFAULT_MARGINS, orientation = 'portrait',
    pageFormat = 'A4', tabIntervalCm = DEFAULT_TAB_INTERVAL_CM, spacingModel = 'add',
    headerDoc = $bindable(null), footerDoc = $bindable(null), hfDistances = DEFAULT_HF_DISTANCES,
    headerFirstDoc = $bindable(null), footerFirstDoc = $bindable(null), differentFirstPage = false,
    headerEvenDoc = $bindable(null), footerEvenDoc = $bindable(null), differentOddEven = false,
    hfEditor = $bindable(null), hfActive = $bindable(null), hfTick = $bindable(0),
    extraHfSections = $bindable([]),
  }: {
    editor: Editor | null; tick: number; currentPage: number; numPages: number; zoom: number;
    onZoom?: (zoom: number) => void;
    showFormattingMarks?: boolean; showRuler?: boolean; pageMargins?: PageMargins; orientation?: Orientation; pageFormat?: PageFormat; tabIntervalCm?: number; spacingModel?: SpacingModel;
    headerDoc?: HfDoc; footerDoc?: HfDoc; hfDistances?: HfDistances;
    headerFirstDoc?: HfDoc; footerFirstDoc?: HfDoc; differentFirstPage?: boolean;
    headerEvenDoc?: HfDoc; footerEvenDoc?: HfDoc; differentOddEven?: boolean;
    hfEditor?: Editor | null; hfActive?: HfZone | null; hfTick?: number;
    extraHfSections?: HfSet[];
  } = $props();

  // Page each section after the first starts on (pageBreaks reports it); the layer
  // turns it into a per-page set.
  let sectionStartPages = $state<number[]>([]);
  // Where each heading starts, for the running head's chapter field. Only collected
  // when a zone actually shows one — it costs a layout read per heading.
  let chapterStarts = $state<{ page: number; level: number; text: string }[]>([]);
  let wantsChapters = $derived(hfUsesChapterField([
    { header: headerDoc, footer: footerDoc, headerFirst: headerFirstDoc, footerFirst: footerFirstDoc,
      differentFirstPage, headerEven: headerEvenDoc, footerEven: footerEvenDoc, differentOddEven },
    ...extraHfSections,
  ]));

  function collectChapterStarts(): { page: number; level: number; text: string }[] {
    if (!editor || editor.isDestroyed) return [];
    const cycle = readVerticalMargins(editor.view.dom as HTMLElement).cycle;
    const out: { page: number; level: number; text: string }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'heading') return;
      const text = node.textContent.trim();
      const el = editor!.view.nodeDOM(pos) as HTMLElement | null;
      if (!text || !el || el.nodeType !== 1) return;
      out.push({ page: pageOfElement(editor!.view, el, cycle), level: (node.attrs.level as number) ?? 1, text });
    });
    return out;
  }

  // Pagination refreshes the starts; inserting a chapter field into a zone isn't a
  // pagination event, so collect them as soon as a zone asks for them.
  $effect(() => {
    chapterStarts = wantsChapters ? collectChapterStarts() : [];
  });

  // Apply the page margins + orientation to the :root CSS vars (visual padding,
  // page dimensions, and pagination all read these). DOM-only, safe in effects.
  $effect(() => {
    applyMarginVars(pageMargins);
  });
  $effect(() => {
    applyPageSizeVars(pageFormat, orientation);
  });

  // A header/footer that reaches past the body's margin (its distance from the edge plus
  // its line count) pushes the body's content area in so text doesn't overlap it: the
  // margin grows to fit the zone. ~18.4px = one 12pt line.
  const HF_LINE_PX = 16 * 1.15;
  function hfReachPx(doc: HfDoc, distPx: number, footer = false): number {
    if (!doc || hfIsEmpty(doc)) return 0;
    type Run = { type?: string; attrs?: { height?: number; wrap?: string }; marks?: { type?: string; attrs?: { fontSize?: string; fontFamily?: string } }[] };
    const para = doc.content?.[0] as { content?: Run[]; attrs?: { spaceBefore?: number; spaceAfter?: number; fontSize?: string; fontFamily?: string } } | undefined;
    const inline = para?.content ?? [];
    // The zone's biggest text run sizes its lines: LibreOffice grows the band to hold them
    // when fo:min-height is smaller (probed, a 3-line header), and a zone set throughout in
    // 10pt reserves 10pt — the body default only stands in for a run that declares none.
    // A line is its font's own natural height, which is what the band renders at.
    const line = (size?: string, family?: string) =>
      size ? (parseFloat(size) * 96) / 72 * singleLineHeight(family) : HF_LINE_PX;
    // The paragraph mark is the strut every run that declares no size of its own takes.
    const base = line(para?.attrs?.fontSize, para?.attrs?.fontFamily);
    let linePx = base;
    for (const n of inline) {
      if (n.type === 'image') continue;
      const ts = n.marks?.find((m) => m.type === 'textStyle')?.attrs;
      linePx = Math.max(linePx, ts?.fontSize ? line(ts.fontSize, ts.fontFamily) : base);
    }
    // Per line, since an as-character image (a letterhead logo) makes its own line
    // as tall as it is; the others are one text line each. A positioned frame is out
    // of flow — a page-sized background would otherwise reserve the whole page.
    let total = 0;
    let image = 0;
    for (const n of inline) {
      if (n.type === 'hardBreak') { total += Math.max(linePx, image); image = 0; }
      else if (n.type === 'image' && typeof n.attrs?.height === 'number' && (n.attrs.wrap ?? 'inline') === 'inline') image = Math.max(image, n.attrs.height);
    }
    // A footer is laid out from the page edge up, so its space above rides the band too;
    // a header's space below just hangs into the body, which LibreOffice does not move.
    const spacing = footer ? ((para?.attrs?.spaceBefore ?? 0) * 96) / 72 : 0;
    return distPx + spacing + total + Math.max(linePx, image);
  }
  let footerDistPx = $derived(cmToPx((hfDistances ?? DEFAULT_HF_DISTANCES).footer));
  let headerDistPx = $derived(cmToPx((hfDistances ?? DEFAULT_HF_DISTANCES).header));
  let mBottomPx = $derived(cmToPx(pageMargins.bottom));
  let mTopPx = $derived(cmToPx(pageMargins.top));
  // Effective top/bottom margins (px) pageBreaks reads to keep content clear of the
  // header/footer: "first" = page 1's own zone, "rest" = every page ≥ 2 with the even
  // variant folded in (max), since one --pb-content-*-rest covers all of them.
  let evenTopReach = $derived(differentOddEven ? hfReachPx(headerEvenDoc ?? null, headerDistPx) : 0);
  let evenBottomReach = $derived(differentOddEven ? hfReachPx(footerEvenDoc ?? null, footerDistPx, true) : 0);
  let effTopRest = $derived(Math.max(mTopPx, hfReachPx(headerDoc ?? null, headerDistPx), evenTopReach));
  let effTopFirst = $derived(Math.max(mTopPx, hfReachPx((differentFirstPage ? headerFirstDoc : headerDoc) ?? null, headerDistPx)));
  let effBottomRest = $derived(Math.max(mBottomPx, hfReachPx(footerDoc ?? null, footerDistPx, true), evenBottomReach));
  let effBottomFirst = $derived(Math.max(mBottomPx, hfReachPx((differentFirstPage ? footerFirstDoc : footerDoc) ?? null, footerDistPx, true)));
  // Per-section reaches for pageBreaks: "topFirst|topRest|bottomFirst|bottomRest" in px,
  // one group per section, comma-separated. Section 1 repeats the four vars below.
  // A section with page margins of its own (w:pgMar, its own ODF page layout) measures
  // against those instead of the document's; `marginsFirst` is its first page's.
  let sectionReach = $derived([
    [effTopFirst, effTopRest, effBottomFirst, effBottomRest],
    ...extraHfSections.map((s) => {
      const rest = s.margins ?? null;
      const first = s.marginsFirst ?? rest;
      const topOf = (m: PageMargins | null) => (m ? cmToPx(m.top) : mTopPx);
      const bottomOf = (m: PageMargins | null) => (m ? cmToPx(m.bottom) : mBottomPx);
      return [
        Math.max(topOf(first), hfReachPx((s.differentFirstPage ? s.headerFirst : s.header) ?? null, headerDistPx)),
        Math.max(topOf(rest), hfReachPx(s.header ?? null, headerDistPx), s.differentOddEven ? hfReachPx(s.headerEven ?? null, headerDistPx) : 0),
        Math.max(bottomOf(first), hfReachPx((s.differentFirstPage ? s.footerFirst : s.footer) ?? null, footerDistPx, true)),
        Math.max(bottomOf(rest), hfReachPx(s.footer ?? null, footerDistPx, true), s.differentOddEven ? hfReachPx(s.footerEven ?? null, footerDistPx, true) : 0),
      ];
    }),
  ].map((g) => g.map((n) => Math.round(n)).join('|')).join(','));

  // The same per section for the side margins, as a delta against the document's own:
  // .tiptap's padding draws those for every page, so a section that wants others has
  // its blocks inset by the difference ("leftFirst|rightFirst|leftRest|rightRest").
  let sectionInset = $derived([
    [0, 0, 0, 0],
    ...extraHfSections.map((s) => {
      const rest = s.margins ?? null;
      const first = s.marginsFirst ?? rest;
      const d = (m: PageMargins | null, side: 'left' | 'right') =>
        m ? Math.round(cmToPx(m[side]) - cmToPx(pageMargins[side])) : 0;
      return [d(first, 'left'), d(first, 'right'), d(rest, 'left'), d(rest, 'right')];
    }),
  ].map((g) => g.join('|')).join(','));

  $effect(() => {
    const s = document.documentElement.style;
    s.setProperty('--pb-section-inset', sectionInset);
    s.setProperty('--pb-content-top-rest', `${effTopRest}px`);
    s.setProperty('--pb-content-top-first', `${effTopFirst}px`);
    s.setProperty('--pb-content-bottom-rest', `${effBottomRest}px`);
    s.setProperty('--pb-content-bottom-first', `${effBottomFirst}px`);
    s.setProperty('--pb-section-reach', sectionReach);
  });

  // Nudge the pageBreaks plugin to recompute with the new content area. The dispatch
  // bumps the tick/numPages bindings, so requestAnimationFrame defers it past the
  // Svelte effect flush (re-entering it would trip effect_update_depth_exceeded).
  let marginRecalcRaf = 0;
  $effect(() => {
    // track each margin + orientation + format so the effect re-runs on any change
    void (pageMargins.top + pageMargins.bottom + pageMargins.left + pageMargins.right);
    void orientation;
    void pageFormat;
    // …the tab grid, which changes where a tab lands and so where a line breaks…
    void tabIntervalCm;
    // …and how the space between two blocks is measured.
    void spacingModel;
    // …and the header/footer-driven effective margins, so growing a zone re-paginates.
    void (effTopRest + effTopFirst + effBottomRest + effBottomFirst);
    void sectionReach;
    void sectionInset;
    const ed = editor;
    if (!ed) return;
    cancelAnimationFrame(marginRecalcRaf);
    marginRecalcRaf = requestAnimationFrame(() => {
      ed.view.dispatch(
        ed.state.tr.setMeta('addToHistory', false).setMeta(FORCE_PAGE_RECALC, true),
      );
    });
  });

  // Toggling formatting marks flips the .paper class but doesn't touch the doc, so the
  // pageBreaks plugin wouldn't re-run. The ¶/·/→ marks are zero-footprint, but force a
  // recalc anyway so page positions can never be left stale by a sub-pixel platform delta.
  let marksRecalcRaf = 0;
  $effect(() => {
    void showFormattingMarks;
    const ed = editor;
    if (!ed) return;
    cancelAnimationFrame(marksRecalcRaf);
    marksRecalcRaf = requestAnimationFrame(() => {
      ed.view.dispatch(
        ed.state.tr.setMeta('addToHistory', false).setMeta(FORCE_PAGE_RECALC, true),
      );
    });
  });

  // The document stylesheet: the named paragraph styles rendered as CSS rules in one
  // element that is rewritten whenever a style changes. Appended at runtime, so it also
  // wins over editor.css on equal specificity.
  let styleEl: HTMLStyleElement | null = null;
  let styleRecalcRaf = 0;
  $effect(() => {
    const css = styleCss(styleSheet());
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'document-styles';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css;
    const ed = editor;
    if (!ed) return;
    // Type sizes/margins changed under the layout, so page positions must be re-measured.
    cancelAnimationFrame(styleRecalcRaf);
    styleRecalcRaf = requestAnimationFrame(() => {
      // A table style's fill/borders live in cell attrs, so an edited registry has to be
      // painted into the document — this effect is the choke point every change passes.
      ed.commands.refreshTableStyles();
      ed.view.dispatch(ed.state.tr.setMeta('addToHistory', false).setMeta(FORCE_PAGE_RECALC, true));
    });
  });

  // Bundled fonts (Liberation Serif, Carlito, …) load with font-display:swap, so text
  // can reflow after pagination first runs (e.g. imported content in a not-yet-loaded
  // font). Re-paginate when fonts finish so page positions and the HF band settle.
  function repaginateOnFontLoad() {
    if (!editor || !editor.view.dom.isConnected) return;
    editor.view.dispatch(
      editor.state.tr.setMeta('addToHistory', false).setMeta(FORCE_PAGE_RECALC, true),
    );
  }

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

  // Page cycle (page height + 20px gap) in document px. Format/orientation-dependent,
  // so read live from --user-page-height (set by applyPageSizeVars). Must match
  // pageBreaks.ts. Fallback = A4 portrait (1123 + 20).
  function getCycle(): number {
    const ph = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--user-page-height'));
    return (Number.isFinite(ph) ? ph : 1123) + 20;
  }

  // --- Right-click context menu (text menu, spelling suggestions merged in) ---
  let ctxMenu = $state<{ top: number; left: number; items: MenuEntry[] } | null>(null);
  // The misspelled range the open menu's suggestions belong to.
  let spellTarget: { from: number; to: number; word: string } | null = null;

  function openContextMenu(event: MouseEvent) {
    const ed = editor;
    // Shift+right-click yields to the browser menu, whose Paste needs no clipboard
    // permission (Firefox does this for page handlers by itself). Header/footer keeps
    // the browser menu too — the schema has none of the entries below.
    if (!ed || event.shiftKey || hfActive || !editorContainer) return;
    const target = event.target as HTMLElement | null;
    if (!target || !ed.view.dom.contains(target)) return;
    if (target.closest('.image-node, .textbox-node')) return; // own floating toolbars
    event.preventDefault();

    const view = ed.view;
    const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
    const sel = view.state.selection;
    // A selection the click lands inside is kept, otherwise the caret moves.
    if (coords && (sel.empty || coords.pos < sel.from || coords.pos > sel.to)) {
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(coords.pos))));
    }

    spellTarget = null;
    let spell: SpellSection | undefined;
    const range = coords && spellController.isEnabled() ? spellErrorAt(view.state, coords.pos) : null;
    if (range) {
      const word = view.state.doc.textBetween(range.from, range.to);
      spellTarget = { ...range, word };
      spell = {
        suggestions: spellController.suggest(word).slice(0, 6),
        onReplace: replaceSpellWord,
        onAdd: addSpellWord,
        onIgnore: ignoreSpellWord,
      };
    }

    const cRect = editorContainer.getBoundingClientRect();
    ctxMenu = {
      top: event.clientY - cRect.top + editorContainer.scrollTop,
      left: event.clientX - cRect.left + editorContainer.scrollLeft,
      items: buildContextMenu(ed, { spell }),
    };
  }

  // Replace the misspelled range, preserving the word's marks (font/bold/etc.).
  function replaceSpellWord(replacement: string) {
    const ed = editor;
    if (!ed || !spellTarget) return;
    const { from, to } = spellTarget;
    const { state } = ed.view;
    const marks = state.doc.resolve(from).marksAcross(state.doc.resolve(to)) ?? state.doc.resolve(from).marks();
    ed.view.dispatch(state.tr.replaceWith(from, to, state.schema.text(replacement, marks)).scrollIntoView());
    ed.view.focus();
  }

  function addSpellWord() {
    if (spellTarget) spellController.addWord(spellTarget.word);
    editor?.view.focus();
  }

  function ignoreSpellWord() {
    if (spellTarget) spellController.ignoreWord(spellTarget.word);
    editor?.view.focus();
  }

  // --- Link hover hint (Word/LibreOffice style) ---
  // Hovering a link shows its URL + a modifier-click hint; the link only follows on
  // Ctrl/Cmd+click (handleClick in editorProps), so a plain click can edit the text.
  let linkTip = $state<{ top: number; left: number; href: string } | null>(null);

  function showLinkTip(a: HTMLAnchorElement) {
    const href = a.getAttribute('href');
    if (!href || !editorContainer) return;
    const aRect = a.getBoundingClientRect();
    const cRect = editorContainer.getBoundingClientRect();
    linkTip = {
      top: aRect.top - cRect.top + editorContainer.scrollTop,
      left: aRect.left - cRect.left + editorContainer.scrollLeft,
      href,
    };
  }

  function onEditorPointerOver(e: MouseEvent) {
    const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (a && editorContainer?.contains(a)) showLinkTip(a);
  }

  function onEditorPointerOut(e: MouseEvent) {
    const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const to = e.relatedTarget as Node | null;
    if (to && a.contains(to)) return; // moving within the same link
    linkTip = null;
  }

  // --- Floating table-editing toolbar ---
  // Shown when the selection is inside a table; positioned just above that table.
  let tableUi = $state<{ visible: boolean; top: number; left: number }>({ visible: false, top: 0, left: 0 });
  let tableUiRaf = 0;
  // "Split Cells…" popover, opened from the table toolbar.
  let splitDialogOpen = $state(false);
  // Drop the dialog if the selection leaves the table (toolbar hidden).
  $effect(() => {
    if (!tableUi.visible && splitDialogOpen) splitDialogOpen = false;
  });

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

  // --- Floating text-box toolbar ---
  // Shown when a text box is node-selected or the cursor is inside one; positioned
  // just above it. Hidden while the image toolbar shows (an image inside a box).
  let textBoxUi = $state<{
    visible: boolean; top: number; left: number;
    wrap: WrapMode; shapeKind: ShapeKind; fillColor: string | null;
    strokeColor: string | null; strokeWidthPt: number;
  }>({ visible: false, top: 0, left: 0, wrap: 'inline', shapeKind: 'textbox', fillColor: '#FFFFFF', strokeColor: '#000000', strokeWidthPt: 1 });

  function recomputeTextBoxUi() {
    const ed = editor;
    const found = ed && editorContainer && !imageUi.visible ? findTextBox(ed.state) : null;
    const dom = found ? ed!.view.nodeDOM(found.pos) : null;
    if (!found || !(dom instanceof HTMLElement)) {
      if (textBoxUi.visible) textBoxUi = { ...textBoxUi, visible: false };
      return;
    }
    const r = dom.getBoundingClientRect();
    const cRect = editorContainer.getBoundingClientRect();
    const a = found.node.attrs;
    // Anchor above the rotate grip (it protrudes above the box) so the toolbar never
    // covers it; fall back to the box top when the grip isn't rendered.
    const grip = dom.querySelector('.image-rotate-handle');
    const gr = grip instanceof HTMLElement ? grip.getBoundingClientRect() : null;
    const anchorTop = gr && gr.height > 0 ? Math.min(r.top, gr.top) : r.top;
    textBoxUi = {
      visible: true,
      top: anchorTop - cRect.top + editorContainer.scrollTop,
      left: r.left - cRect.left + editorContainer.scrollLeft,
      wrap: (a.wrap as WrapMode) || 'inline',
      shapeKind: (a.shapeKind as ShapeKind) || 'textbox',
      fillColor: (a.fillColor as string | null) ?? null,
      strokeColor: (a.strokeColor as string | null) ?? null,
      strokeWidthPt: (a.strokeWidthPt as number) ?? 1,
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
    // Only in-cell breaks get the white mask + close/open lines; between-rows breaks
    // are capped by the rows' own cell borders, so a band there would double them.
    bandStyles = tableBandsDoc.filter((b) => !b.rowBreak).map((b) => {
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
      recomputeTextBoxUi();
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

  // Ctrl+wheel — a touchpad two-finger zoom fires exactly this — zooms the document
  // instead of the browser. `wheel` on a plain element is non-passive, so the
  // preventDefault sticks. The pointer is the zoom anchor.
  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey || !onZoom) return;
    e.preventDefault();
    pendingAnchor = { x: e.clientX, y: e.clientY };
    onZoom(zoom * wheelZoomFactor(e.deltaY, e.deltaMode));
  }

  // The point held fixed across a zoom change: the pointer for a wheel zoom, else
  // (slider, buttons, keyboard) the top of the viewport.
  let prevZoom = -1;
  let pendingAnchor: { x: number; y: number } | null = null;
  let pendingAnchorDoc: { x: number; y: number; screenX: number; screenY: number } | null = null;

  $effect.pre(() => {
    const z = appliedZoom;
    // The scaled footprint drives the horizontal centering, so it has to reach the DOM
    // in the same flush as the transform — the post-effect measures against it.
    // Untracked so only a zoom change runs the anchor logic (onPageCount recomputes too).
    untrack(recomputeScaledSize);
    if (prevZoom < 0 || !editorContainer || !paperEl || z === prevZoom) {
      prevZoom = z;
      pendingAnchor = null;
      return;
    }
    const editorRect = editorContainer.getBoundingClientRect();
    const paperRect = paperEl.getBoundingClientRect();
    const screenX = pendingAnchor ? pendingAnchor.x : paperRect.left;
    const screenY = pendingAnchor ? pendingAnchor.y : editorRect.top;
    const s = prevZoom / 100;
    pendingAnchorDoc = {
      x: (screenX - paperRect.left) / s,
      y: (screenY - paperRect.top) / s,
      screenX, screenY,
    };
    pendingAnchor = null;
    prevZoom = z;
  });

  $effect(() => {
    appliedZoom; // track to fire after the pre-effect / DOM update
    // Zoom changes the table's rendered position — re-place the floating toolbar.
    scheduleTableUi();
    if (pendingAnchorDoc === null || !editorContainer || !paperEl) return;
    const anchor = pendingAnchorDoc;
    pendingAnchorDoc = null;
    const paperRect = paperEl.getBoundingClientRect();
    const s = appliedZoom / 100;
    // Without horizontal overflow .paper-scaler stays centred and the scrollLeft write
    // is a no-op — the whole page is visible, so there is nothing to keep in view.
    editorContainer.scrollLeft += paperRect.left + anchor.x * s - anchor.screenX;
    editorContainer.scrollTop += paperRect.top + anchor.y * s - anchor.screenY;
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
    const detail = (e as CustomEvent<{ numPages: number; docHeight?: number; tableBreakBands?: TableBreakBand[]; sectionStartPages?: number[] }>).detail;
    numPages = detail.numPages;
    if (typeof detail.docHeight === 'number') docHeightDoc = detail.docHeight;
    tableBandsDoc = detail.tableBreakBands ?? [];
    sectionStartPages = detail.sectionStartPages ?? [];
    chapterStarts = wantsChapters ? collectChapterStarts() : [];
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
        // Ctrl/Cmd+click opens a hyperlink (a plain click just places the cursor).
        handleClick: (view, _pos, event) => {
          if (!(event.metaKey || event.ctrlKey)) return false;
          const a = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
          const href = a?.getAttribute('href');
          if (!href) return false;
          // An internal href targets a bookmark in this document, not a URL.
          if (href.startsWith('#')) {
            const found = findBookmark(view.state.doc, href.slice(1));
            if (!found) return true;
            editor?.chain().focus().setTextSelection({ from: found.from, to: found.to }).scrollIntoView().run();
            return true;
          }
          window.open(href, '_blank', 'noopener,noreferrer');
          return true;
        },
        handleDOMEvents: {
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
        // Clicking back into the body ends header/footer editing.
        hfActive = null;
      },
    });

    element.addEventListener('pm-pagecount', onPageCount);
    document.fonts?.addEventListener('loadingdone', repaginateOnFontLoad);
    document.fonts?.ready.then(repaginateOnFontLoad);
    editorContainer.addEventListener('scroll', onEditorScroll);
    editorContainer.addEventListener('mouseover', onEditorPointerOver);
    editorContainer.addEventListener('mouseout', onEditorPointerOut);
    // Seed the scaled footprint before the first paint (so the page is centered, not
    // briefly left-aligned), then refine it once layout settles. The pageBreaks plugin
    // also fires pm-pagecount shortly after with the precise document height.
    recomputeScaledSize();
    requestAnimationFrame(recomputeScaledSize);
    // Two frames in: the first pagination pass has run and painted. A document that
    // hangs or throws on the way here leaves the boot flag set and is skipped next load.
    requestAnimationFrame(() => requestAnimationFrame(markDocumentLoaded));
  });

  function onEditorScroll() {
    updateCurrentPage();
    scheduleTableUi();
    if (linkTip) linkTip = null;
  }

  onDestroy(() => {
    if (zoomRaf !== null) cancelAnimationFrame(zoomRaf);
    cancelAnimationFrame(marginRecalcRaf);
    cancelAnimationFrame(marksRecalcRaf);
    cancelAnimationFrame(tableUiRaf);
    editor?.destroy();
    resetHistoryLog();
    element?.removeEventListener('pm-pagecount', onPageCount);
    document.fonts?.removeEventListener('loadingdone', repaginateOnFontLoad);
    editorContainer?.removeEventListener('scroll', onEditorScroll);
    editorContainer?.removeEventListener('mouseover', onEditorPointerOver);
    editorContainer?.removeEventListener('mouseout', onEditorPointerOut);
  });
</script>

<div class="editor" bind:this={editorContainer} onwheel={onWheel} oncontextmenu={openContextMenu} role="none">
  <!-- Hidden while a header/footer zone is active: those have no tab stops, so the
       ruler would edit the body paragraph behind the user's back. -->
  {#if showRuler && scaledWidth && !hfActive}
    <Ruler {editor} {tick} zoom={appliedZoom} width={scaledWidth} margins={pageMargins} />
  {/if}
  <!-- Reserves the scaled scroll footprint; the transform on .paper reserves none.
       Before the first measure (size 0) it's left unsized so .paper isn't clipped. -->
  <div class="paper-scaler" style={scaledWidth ? `width: ${scaledWidth}px; height: ${scaledHeight}px;` : ''}>
    <div bind:this={paperEl} class="paper" data-spacing-model={spacingModel} class:show-formatting-marks={showFormattingMarks} class:hf-editing={hfActive} style="transform: scale({appliedZoom / 100});">
      <!-- Dedicated mount point that TipTap fully owns — keeping it free of Svelte
           content avoids Svelte and ProseMirror fighting over the same parent's DOM. -->
      <div bind:this={element} class="tiptap-host"></div>
      {#if gapStripeStyles.length}
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
        bind:headerFirstDoc
        bind:footerFirstDoc
        {differentFirstPage}
        bind:headerEvenDoc
        bind:footerEvenDoc
        {differentOddEven}
        bind:hfEditor
        bind:hfActive
        bind:hfTick
        {numPages}
        {currentPage}
        {pageMargins}
        {orientation}
        {pageFormat}
        {hfDistances}
        bind:extraHfSections
        {sectionStartPages}
        {chapterStarts}
      />
    </div>
  </div>
  {#if tableUi.visible && !splitDialogOpen}
    <TableToolbar
      {editor}
      {tick}
      top={tableUi.top}
      left={tableUi.left}
      onSplit={() => (splitDialogOpen = true)}
    />
  {/if}
  {#if splitDialogOpen && tableUi.visible}
    <TableSplitDialog
      open={splitDialogOpen}
      top={tableUi.top}
      left={tableUi.left}
      onApply={(cols, rows) => {
        editor?.chain().focus().splitCellInto(cols, rows).run();
        splitDialogOpen = false;
      }}
      onClose={() => (splitDialogOpen = false)}
    />
  {/if}
  {#if imageUi.visible}
    <ImageToolbar {editor} top={imageUi.top} left={imageUi.left} wrap={imageUi.wrap} />
  {/if}
  {#if textBoxUi.visible}
    <TextBoxToolbar
      {editor}
      top={textBoxUi.top}
      left={textBoxUi.left}
      wrap={textBoxUi.wrap}
      shapeKind={textBoxUi.shapeKind}
      fillColor={textBoxUi.fillColor}
      strokeColor={textBoxUi.strokeColor}
      strokeWidthPt={textBoxUi.strokeWidthPt}
    />
  {/if}
  {#if ctxMenu}
    <ContextMenu
      top={ctxMenu.top}
      left={ctxMenu.left}
      items={ctxMenu.items}
      onClose={() => (ctxMenu = null)}
    />
  {/if}
  {#if linkTip}
    <div class="link-tooltip" style="top: {linkTip.top}px; left: {linkTip.left}px;">
      <span class="link-tooltip-url">{linkTip.href}</span>
      <span class="link-tooltip-hint">{t().link.openHint(withShortcut('Ctrl'))}</span>
    </div>
  {/if}
</div>

<style>
  /* While editing a header/footer, dim the body so focus is on the margin zone. */
  .paper.hf-editing :global(.tiptap) {
    opacity: 0.5;
    transition: opacity 0.15s;
  }

  /* Hover hint for links (Word/LibreOffice style): URL + modifier-click tip, sitting
     just above the link. A child of .editor so it scrolls with content but isn't scaled
     by the zoom transform; pointer-events:none keeps the link itself clickable. */
  .link-tooltip {
    position: absolute;
    z-index: 160;
    transform: translateY(calc(-100% - 6px));
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-width: 28rem;
    padding: 0.3rem 0.55rem;
    background: var(--color-tooltip-bg, #2b2f36);
    color: #fff;
    border-radius: var(--radius);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
    pointer-events: none;
    font-family: var(--font-sans);
    font-size: 0.72rem;
    line-height: 1.35;
  }

  .link-tooltip-url {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .link-tooltip-hint { opacity: 0.75; }

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
