<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { Slice, Fragment } from 'prosemirror-model';
  import type { Node as PmNode, MarkType } from 'prosemirror-model';
  import { extensions } from '../editor/extensions';
  import { buildContextMenu, type MenuEntry, type SpellSection } from '../editor/contextMenuItems';
  import { spellErrorAt } from '../editor/extensions/spellCheck';
  import { spellController } from '../spell/controller';
  import { isInTable, selectedRect } from '@tiptap/pm/tables';
  import { currentCellFormat, currentCellFormula, currentCellName, guessFormula } from '../editor/extensions/tableFormula';
  import type { CellFormat } from '../utils/cellFormat';
  import TableToolbar from './TableToolbar.svelte';
  import TableSplitDialog from './TableSplitDialog.svelte';
  import TableSortDialog from './TableSortDialog.svelte';
  import TableFormulaDialog from './TableFormulaDialog.svelte';
  import ImageToolbar from './ImageToolbar.svelte';
  import TextBoxToolbar from './TextBoxToolbar.svelte';
  import type { WrapMode } from '../editor/extensions/image';
  import { findTextBox, type ShapeKind } from '../editor/extensions/textBox';
  import { NodeSelection, TextSelection } from '@tiptap/pm/state';
  import { EditorView } from '@tiptap/pm/view';
  import ContextMenu from './ContextMenu.svelte';
  import HeaderFooterLayer from './HeaderFooterLayer.svelte';
import PageDecorLayer from './PageDecorLayer.svelte';
import PageSheetLayer from './PageSheetLayer.svelte';
import LineNumberLayer from './LineNumberLayer.svelte';
import { DEFAULT_LINE_NUMBERING, type LineNumbering } from '../storage/lineNumbering';
import { EMPTY_PAGE_DECOR, type PageDecor } from '../storage/pageDecor';
  import Ruler from './Ruler.svelte';
  import { saveDocument, loadDocument, markDocumentLoaded } from '../storage/autosave';
  import { applyMarginVars, cmToPx, PX_PER_CM, DEFAULT_MARGINS, type PageMargins } from '../storage/pageMargins';
  import { DEFAULT_TAB_INTERVAL_CM } from '../storage/tabInterval';
  import { type Orientation } from '../storage/pageOrientation';
  import { type SpacingModel } from '../storage/spacingModel';
  import { NO_LANGUAGE } from '../storage/documentLanguage';
  import { DEFAULT_PAGE_NUMBERING, type PageNumbering } from '../storage/pageNumbering';
  import { applyNoteVars } from '../storage/noteSettings';
  import { noteSettings } from '../storage/notes.svelte';
  import { RESYNC_NOTES } from '../editor/extensions/notes';
  import { applyPageSizeVars, pageDimsCm, type PageFormat } from '../storage/pageFormat';
  import { MAX_PAGE_COLUMNS } from '../storage/theme';
  import { DEFAULT_HF_DISTANCES, hfIsEmpty, hfUsesChapterField, type HfDoc, type HfZone, type HfDistances, type HfSet } from '../storage/headerFooter';
  import { FORCE_PAGE_RECALC, PAGE_GAP, pageOfElement, readVerticalMargins, type TableBreakBand } from '../editor/extensions/pageBreaks';
  import { findBookmark } from '../editor/extensions/bookmark';
  import { recordTransaction, resetHistoryLog } from '../utils/historyLog.svelte';
  import { fitPagesZoom, wheelZoomFactor } from '../utils/zoom';
  import { styleCss, singleLineHeight } from '../styles/styleSheet';
  import { styleSheet } from '../styles/sheet.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { withShortcut } from '../i18n/shortcut';
  import '../../styles/editor.css';

  let {
    editor = $bindable(), tick = $bindable(0), currentPage = $bindable(1), numPages = $bindable(1),
    zoom = 100, onZoom, showFormattingMarks = false, showRuler = true, splitView = false, pageColumns = 1, pageMargins = DEFAULT_MARGINS, orientation = 'portrait',
    pageFormat = 'A4', tabIntervalCm = DEFAULT_TAB_INTERVAL_CM, spacingModel = 'add', documentEpoch = 0, pageRtl = false, hyphenate = false, documentLanguage = 'en', pageNumbering = DEFAULT_PAGE_NUMBERING, pageDecor = EMPTY_PAGE_DECOR, lineNumbering = DEFAULT_LINE_NUMBERING,
    headerDoc = $bindable(null), footerDoc = $bindable(null), hfDistances = DEFAULT_HF_DISTANCES,
    headerFirstDoc = $bindable(null), footerFirstDoc = $bindable(null), differentFirstPage = false,
    headerEvenDoc = $bindable(null), footerEvenDoc = $bindable(null), differentOddEven = false,
    hfEditor = $bindable(null), hfActive = $bindable(null), hfTick = $bindable(0),
    extraHfSections = $bindable([]),
  }: {
    editor: Editor | null; tick: number; currentPage: number; numPages: number; zoom: number;
    onZoom?: (zoom: number) => void;
    showFormattingMarks?: boolean; showRuler?: boolean; pageMargins?: PageMargins; orientation?: Orientation; pageFormat?: PageFormat; tabIntervalCm?: number; spacingModel?: SpacingModel;
    /** Two panes onto this document, scrolled on their own (Word's View ▸ Split). */
    splitView?: boolean;
    /** How many pages sit side by side (LibreOffice's View layout ▸ Columns); 1 = off. */
    pageColumns?: number;
    /** Bumped by App for each document it opens; re-arms the settle gate. */
    documentEpoch?: number;
    /** A right-to-left page: the body's base direction, so its columns fill from the right. */
    pageRtl?: boolean;
    /** Automatic hyphenation; the browser needs the document language to pick its patterns. */
    hyphenate?: boolean; documentLanguage?: string;
    /** How the page-number field counts (format + start value). */
    pageNumbering?: PageNumbering;
    /** Page background, page border and watermark. */
    pageDecor?: PageDecor;
    /** Numbers in the left margin, one per rendered line. */
    lineNumbering?: LineNumbering;
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
    const grid = readVerticalMargins(editor.view.dom as HTMLElement).grid;
    const out: { page: number; level: number; text: string }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'heading') return;
      const text = node.textContent.trim();
      const el = editor!.view.nodeDOM(pos) as HTMLElement | null;
      if (!text || !el || el.nodeType !== 1) return;
      out.push({ page: pageOfElement(editor!.view, el, grid), level: (node.attrs.level as number) ?? 1, text });
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
    // A line is its font's own natural height: the zone's biggest run sizes its lines and
    // LibreOffice grows the band to hold them where fo:min-height is smaller (probed).
    // The body default only stands in for a run that declares no size of its own.
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
  // one group per section, comma-separated. Section 1 repeats the four vars below; a
  // section with page margins of its own measures against those (`marginsFirst` = page 1).
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

  // Each section's own paper (px). A section that names neither format nor orientation
  // is on the document's, so its entry is the document's box. Unrounded: this is the
  // grid pageBreaks places against, and half a pixel per page accumulates down the document.
  let sectionPaper = $derived([
    pageDimsCm(pageFormat, orientation),
    ...extraHfSections.map((s) => pageDimsCm(s.format ?? pageFormat, s.orientation ?? orientation)),
  ].map((d) => ({ w: d.w * PX_PER_CM, h: d.h * PX_PER_CM })));
  // The sheet .paper reserves is the widest of them: a landscape section is wider than
  // the portrait ones around it and would otherwise be cut at the page edge.
  let paperWidth = $derived(Math.max(...sectionPaper.map((p) => p.w)));

  // Which section each page belongs to (sectionStartPages holds the first page of every
  // section past the first), and from it the box every per-page layer paints.
  let pageBoxes = $derived.by(() => {
    const out: { top: number; left: number; height: number; width: number; section: number }[] = [];
    let top = 0;
    let section = 0;
    for (let p = 1; p <= Math.max(1, numPages); p++) {
      while (section < sectionStartPages.length && sectionStartPages[section] <= p) section++;
      const paper = sectionPaper[Math.min(section, sectionPaper.length - 1)];
      // A page narrower than the reserved sheet is centred in it, as both word
      // processors centre each page of a document whose sections differ.
      out.push({ top, left: Math.round((paperWidth - paper.w) / 2), height: paper.h, width: paper.w, section });
      top += paper.h + PAGE_GAP;
    }
    return out;
  });

  // What one grid cell is worth in document px, across and down. Sections of differing
  // paper make the later pages differ; the grid is laid out on the first page's, and
  // each cell then places its own page box inside its box.
  let firstCycle = $derived((pageBoxes[0]?.height ?? 1123) + PAGE_GAP);
  let pageStride = $derived(paperWidth + PAGE_GAP);

  // The same per section for the side margins, as a delta against the document's own:
  // .tiptap's padding draws those for every page, so a section that wants others has
  // its blocks inset by the difference ("leftFirst|rightFirst|leftRest|rightRest").
  // A section narrower than the sheet (.paper reserves the widest paper) splits the
  // difference between its sides, so its text sits on the centred page it belongs to.
  let sectionInset = $derived.by(() => {
    const half = (i: number) => Math.round((paperWidth - (sectionPaper[i]?.w ?? paperWidth)) / 2);
    return [
      [half(0), half(0), half(0), half(0)],
      ...extraHfSections.map((s, i) => {
        const rest = s.margins ?? null;
        const first = s.marginsFirst ?? rest;
        const d = (m: PageMargins | null, side: 'left' | 'right') =>
          m ? Math.round(cmToPx(m[side]) - cmToPx(pageMargins[side])) : 0;
        const narrow = half(i + 1);
        return [d(first, 'left') + narrow, d(first, 'right') + narrow, d(rest, 'left') + narrow, d(rest, 'right') + narrow];
      }),
    ].map((g) => g.join('|')).join(',');
  });

  $effect(() => {
    const s = document.documentElement.style;
    s.setProperty('--pb-section-inset', sectionInset);
    s.setProperty('--pb-section-page', sectionPaper.map((p) => p.h).join(','));
    s.setProperty('--pb-paper-width', `${paperWidth}px`);
    // The grid the last pass laid out, as "fromPage|height" runs, so every consumer
    // resolves a page number against the same one pageBreaks placed against.
    s.setProperty('--pb-page-runs', sectionStartPages
      .map((page, i) => `${page}|${sectionPaper[Math.min(i + 1, sectionPaper.length - 1)].h}`)
      .join(','));
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

  // The separator's own band is part of the space pagination reserves for a page's
  // notes, so a change to it has to re-measure — and the line is drawn from the same
  // custom properties.
  $effect(() => {
    applyNoteVars(noteSettings());
    const ed = editor;
    if (!ed) return;
    requestAnimationFrame(() => {
      if (ed.view.dom.isConnected) {
        // The numbering follows the settings too, and nothing about them is a
        // document change the sync pass would otherwise see.
        ed.view.dispatch(ed.state.tr
          .setMeta('addToHistory', false)
          .setMeta(RESYNC_NOTES, true)
          .setMeta(FORCE_PAGE_RECALC, true));
      }
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

  // One entry per pane: [0] is the editor's own view, the rest are extra views of the
  // same state. Every coordinate below is read against the pane the user is working in.
  let hosts = $state<HTMLDivElement[]>([]);
  let scrollers = $state<HTMLDivElement[]>([]);
  let papers = $state<HTMLDivElement[]>([]);
  let activePane = $state(0);
  let paneViews = $state<(EditorView | null)[]>([]);
  // The split stacks two panes with their own scroll; the page grid lays a pane per
  // grid cell in one scroller. Only one of the two layouts is on.
  let gridCols = $derived(splitView ? 1 : Math.min(MAX_PAGE_COLUMNS, Math.max(1, pageColumns)));
  let multiPage = $derived(gridCols > 1);
  // Two rows of cells: a scroll shows the foot of one row above the head of the next,
  // and the pair is recycled as it passes, so no view is built for a row off screen.
  let paneCount = $derived(multiPage ? gridCols * 2 : splitView ? 2 : 1);
  let extraPanes = $derived(Array.from({ length: paneCount - 1 }, (_, k) => k + 1));
  // One scroller for the whole grid, so every floating layer keeps measuring against
  // the one scroll space it is positioned in.
  const paneScroller = () => scrollers[multiPage ? 0 : activePane] ?? scrollers[0];
  const viewOf = (pane: number): EditorView | null =>
    (pane === 0 ? editor?.view : paneViews[pane]) ?? null;
  const paneView = (): EditorView | null => viewOf(activePane) ?? editor?.view ?? null;

  // Zoom is a CSS `transform: scale()` on .paper (so layout and pagination stay at
  // 100%). A transform reserves no layout space, so .paper-scaler reserves the scaled
  // footprint to drive the scrollbars and horizontal centering.
  let docHeightDoc = $state(0); // document height, from pm-pagecount
  let scaledWidth = $state(0);
  let scaledHeight = $state(0);

  function recomputeScaledSize() {
    const paper = papers[0];
    if (!paper) return;
    const z = appliedZoom / 100;
    const w = paper.offsetWidth;                  // unscaled page width (= --user-page-width)
    const h = docHeightDoc || paper.offsetHeight; // unscaled document height
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

  function openContextMenu(event: MouseEvent, pane: number) {
    const ed = editor;
    activePane = pane;
    const container = paneScroller();
    // Shift+right-click yields to the browser menu, whose Paste needs no clipboard
    // permission (Firefox does this for page handlers by itself). Header/footer keeps
    // the browser menu too — the schema has none of the entries below.
    if (!ed || event.shiftKey || hfActive || !container) return;
    const view = paneView();
    const target = event.target as HTMLElement | null;
    if (!view || !target || !view.dom.contains(target)) return;
    if (target.closest('.image-node, .textbox-node')) return; // own floating toolbars
    event.preventDefault();

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

    const cRect = container.getBoundingClientRect();
    ctxMenu = {
      top: event.clientY - cRect.top + container.scrollTop,
      left: event.clientX - cRect.left + container.scrollLeft,
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
  let linkTip = $state<{ top: number; left: number; href: string; pane: number } | null>(null);

  function showLinkTip(a: HTMLAnchorElement, container: HTMLElement, pane: number) {
    const href = a.getAttribute('href');
    if (!href) return;
    const aRect = a.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    linkTip = {
      top: aRect.top - cRect.top + container.scrollTop,
      left: aRect.left - cRect.left + container.scrollLeft,
      href,
      pane,
    };
  }

  function onEditorPointerOver(e: MouseEvent, pane: number) {
    const container = scrollers[pane];
    const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (a && container?.contains(a)) showLinkTip(a, container, pane);
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
  // The popover the table toolbar has open, in its place. One at a time.
  let tableDialog = $state<'split' | 'sort' | 'formula' | null>(null);
  // What the sort and formula popovers open on: the grid around the cursor's cell.
  const NO_TABLE = { columns: 1, column: 0, headerRow: false, cell: null as string | null, formula: '=SUM(ABOVE)', format: null as CellFormat | null };
  let tableGrid = $derived.by(() => {
    const state = editor?.state;
    if (tick < 0 || !state || !isInTable(state)) return NO_TABLE;
    const rect = selectedRect(state);
    return {
      columns: rect.map.width,
      column: rect.left,
      headerRow: rect.table.firstChild?.firstChild?.type.name === 'tableHeader'
        || rect.table.attrs.repeatHeader === true,
      cell: currentCellName(state),
      formula: currentCellFormula(state) || guessFormula(state),
      format: currentCellFormat(state),
    };
  });
  // Drop the dialog if the selection leaves the table (toolbar hidden).
  $effect(() => {
    if (!tableUi.visible && tableDialog) tableDialog = null;
  });
  // A dialog hangs above the table like the toolbar, so a table near the top of the
  // scroller puts it outside the scroll area, where the overflow clips it. The
  // container's padding is what the toolbar island overlays, so clear that too.
  let tableDialogH = $state(0);
  let tableDialogTop = $derived.by(() => {
    const c = scrollers[activePane];
    if (!c || !tableDialogH) return tableUi.top;
    const pad = parseFloat(getComputedStyle(c).paddingTop) || 0;
    return Math.max(tableUi.top, c.scrollTop + pad + tableDialogH + 6);
  });

  // The DOM element of the table containing the current selection, or null.
  // nodeDOM(before(table)) returns the wrapper div the table node view renders.
  function activeTableDOM(ed: Editor, view: EditorView): HTMLElement | null {
    const resolved = ed.state.selection.$from;
    for (let d = resolved.depth; d > 0; d--) {
      if (resolved.node(d).type.name === 'table') {
        try {
          const dom = view.nodeDOM(resolved.before(d));
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
    const container = paneScroller();
    const view = paneView();
    if (!ed || !container || !view) {
      if (tableUi.visible) tableUi = { ...tableUi, visible: false };
      return;
    }
    const dom = activeTableDOM(ed, view);
    if (!dom) {
      if (tableUi.visible) tableUi = { ...tableUi, visible: false };
      return;
    }
    // Position in the editor container's content space: viewport delta + scroll.
    // getBoundingClientRect and scrollTop share the same zoom scale, so this stays
    // aligned across zoom; the toolbar is a non-zoomed sibling, rendered constant-size.
    const tRect = dom.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    const left = tRect.left - cRect.left + container.scrollLeft;
    // Default: anchor just above the table's top-left corner.
    let top = tRect.top - cRect.top + container.scrollTop;

    // When a table spans page breaks, keep the toolbar on the cursor's page rather
    // than the table's first page. If the cursor's page differs from the table's start
    // page, re-anchor to that page's content-top so the toolbar floats in its margin.
    const tiptap = view.dom as HTMLElement;
    if (tiptap) {
      try {
        const z = appliedZoom / 100;
        const tiptapRect = tiptap.getBoundingClientRect();
        const cycle = getCycle();
        const tableTopDoc = (tRect.top - tiptapRect.top) / z;
        const coords = view.coordsAtPos(ed.state.selection.head);
        const cursorDoc = ((coords.top + coords.bottom) / 2 - tiptapRect.top) / z;
        const tableStartPage = Math.floor(Math.max(0, tableTopDoc) / cycle);
        const cursorPage = Math.floor(Math.max(0, cursorDoc) / cycle);
        if (cursorPage > tableStartPage) {
          const marginTopDoc =
            parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--user-margin-top')) || 96;
          const pageContentTopDoc = cursorPage * cycle + marginTopDoc;
          const tiptapTopInContainer = tiptapRect.top - cRect.top + container.scrollTop;
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
    const container = paneScroller();
    const view = paneView();
    if (!ed || !container || !view) {
      if (imageUi.visible) imageUi = { ...imageUi, visible: false };
      return;
    }
    const sel = ed.state.selection;
    const dom = sel instanceof NodeSelection && sel.node.type.name === 'image' ? view.nodeDOM(sel.from) : null;
    if (!(dom instanceof HTMLElement)) {
      if (imageUi.visible) imageUi = { ...imageUi, visible: false };
      return;
    }
    const r = dom.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    imageUi = {
      visible: true,
      top: r.top - cRect.top + container.scrollTop,
      left: r.left - cRect.left + container.scrollLeft,
      wrap: ((sel as NodeSelection).node.attrs.wrap as WrapMode) || 'inline',
    };
  }

  // --- Floating text-box toolbar ---
  // Shown when a text box is node-selected or the cursor is inside one; positioned
  // just above it. Hidden while the image toolbar shows (an image inside a box).
  let textBoxUi = $state<{
    visible: boolean; top: number; left: number;
    wrap: WrapMode; shapeKind: ShapeKind; fillColor: string | null;
    strokeColor: string | null; strokeWidthPt: number; textVertical: boolean;
  }>({ visible: false, top: 0, left: 0, wrap: 'inline', shapeKind: 'textbox', fillColor: '#FFFFFF', strokeColor: '#000000', strokeWidthPt: 1, textVertical: false });

  function recomputeTextBoxUi() {
    const ed = editor;
    const container = paneScroller();
    const view = paneView();
    const found = ed && container && view && !imageUi.visible ? findTextBox(ed.state) : null;
    const dom = found ? view!.nodeDOM(found.pos) : null;
    if (!found || !(dom instanceof HTMLElement)) {
      if (textBoxUi.visible) textBoxUi = { ...textBoxUi, visible: false };
      return;
    }
    const r = dom.getBoundingClientRect();
    const cRect = container!.getBoundingClientRect();
    const a = found.node.attrs;
    // Anchor above the rotate grip (it protrudes above the box) so the toolbar never
    // covers it; fall back to the box top when the grip isn't rendered.
    const grip = dom.querySelector('.image-rotate-handle');
    const gr = grip instanceof HTMLElement ? grip.getBoundingClientRect() : null;
    const anchorTop = gr && gr.height > 0 ? Math.min(r.top, gr.top) : r.top;
    textBoxUi = {
      visible: true,
      top: anchorTop - cRect.top + container!.scrollTop,
      left: r.left - cRect.left + container!.scrollLeft,
      wrap: (a.wrap as WrapMode) || 'inline',
      shapeKind: (a.shapeKind as ShapeKind) || 'textbox',
      fillColor: (a.fillColor as string | null) ?? null,
      strokeColor: (a.strokeColor as string | null) ?? null,
      strokeWidthPt: (a.strokeWidthPt as number) ?? 1,
      textVertical: a.textVertical === true,
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
    // Page width and the bands are both document px — one measurement serves both panes.
    const tiptap = (editor?.view.dom ?? null) as HTMLElement | null;
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
  function onWheel(e: WheelEvent, pane: number) {
    if (!e.ctrlKey || !onZoom) return;
    e.preventDefault();
    pendingAnchor = { x: e.clientX, y: e.clientY, pane };
    onZoom(zoom * wheelZoomFactor(e.deltaY, e.deltaMode));
  }

  // The point held fixed across a zoom change: the pointer for a wheel zoom, else
  // (slider, buttons, keyboard) the top of the viewport. One per pane — a split view
  // zooms both, and the pane the pointer is not in keeps its own top in place.
  let prevZoom = -1;
  let pendingAnchor: { x: number; y: number; pane: number } | null = null;
  type Anchor = { x: number; y: number; screenX: number; screenY: number };
  let pendingAnchorDoc: (Anchor | null)[] = [];

  $effect.pre(() => {
    const z = appliedZoom;
    // The scaled footprint drives the horizontal centering, so it has to reach the DOM
    // in the same flush as the transform — the post-effect measures against it.
    // Untracked so only a zoom change runs the anchor logic (onPageCount recomputes too).
    untrack(recomputeScaledSize);
    const wheel = pendingAnchor;
    pendingAnchor = null;
    if (prevZoom < 0 || z === prevZoom) {
      prevZoom = z;
      return;
    }
    const s = prevZoom / 100;
    prevZoom = z;
    // The grid scrolls as one canvas, so the anchor lives in canvas space: the
    // pointer for a wheel zoom, else the top of the viewport, like a single pane.
    if (multiPage) {
      const container = scrollers[0];
      if (!container || !canvasEl) { pendingAnchorDoc = []; return; }
      const editorRect = container.getBoundingClientRect();
      const canvasRect = canvasEl.getBoundingClientRect();
      const screenX = wheel ? wheel.x : canvasRect.left;
      const screenY = wheel ? wheel.y : editorRect.top;
      pendingAnchorDoc = [{
        x: (screenX - canvasRect.left) / s,
        y: (screenY - canvasRect.top) / s,
        screenX, screenY,
      }];
      return;
    }
    pendingAnchorDoc = Array.from({ length: paneCount }, (_, i) => i).map((i) => {
      const container = scrollers[i];
      const paper = papers[i];
      if (!container || !paper) return null;
      const editorRect = container.getBoundingClientRect();
      const paperRect = paper.getBoundingClientRect();
      const screenX = wheel && wheel.pane === i ? wheel.x : paperRect.left;
      const screenY = wheel && wheel.pane === i ? wheel.y : editorRect.top;
      return {
        x: (screenX - paperRect.left) / s,
        y: (screenY - paperRect.top) / s,
        screenX, screenY,
      };
    });
  });

  $effect(() => {
    appliedZoom; // track to fire after the pre-effect / DOM update
    // Zoom changes the table's rendered position — re-place the floating toolbar.
    scheduleTableUi();
    // Untracked: the scroll this writes comes back as a firstRow change, and an
    // effect that reads what its own scroll writes never stops.
    if (multiPage) {
      const anchor = pendingAnchorDoc[0];
      pendingAnchorDoc = [];
      const container = scrollers[0];
      if (anchor && container && canvasEl) {
        const z = appliedZoom / 100;
        const rect = canvasEl.getBoundingClientRect();
        container.scrollLeft += rect.left + anchor.x * z - anchor.screenX;
        container.scrollTop += rect.top + anchor.y * z - anchor.screenY;
        untrack(readFirstRow);
      }
      return;
    }
    const anchors = pendingAnchorDoc;
    pendingAnchorDoc = [];
    const s = appliedZoom / 100;
    for (const [i, anchor] of anchors.entries()) {
      const container = scrollers[i];
      const paper = papers[i];
      if (!anchor || !container || !paper) continue;
      const paperRect = paper.getBoundingClientRect();
      // Without horizontal overflow .paper-scaler stays centred and the scrollLeft write
      // is a no-op — the whole page is visible, so there is nothing to keep in view.
      container.scrollLeft += paperRect.left + anchor.x * s - anchor.screenX;
      container.scrollTop += paperRect.top + anchor.y * s - anchor.screenY;
    }
  });

  function updateCurrentPage() {
    // In the grid a view's own scroll position says nothing — the row at the top of
    // the canvas is the page being read. A caret move reports its own page instead.
    if (multiPage) {
      currentPage = Math.max(1, Math.min(numPages, firstRow * gridCols + 1));
      return;
    }
    const view = paneView();
    const container = paneScroller();
    const tiptap = (view?.dom ?? null) as HTMLElement | null;
    if (!tiptap || !container) return;

    const editorRect = container.getBoundingClientRect();
    const tiptapRect = tiptap.getBoundingClientRect();
    // getBoundingClientRect and coordsAtPos return zoomed viewport pixels;
    // divide by zoom factor to convert to document coordinates before comparing with the cycle.
    const zoomFactor = appliedZoom / 100;
    const cycle = getCycle();

    if (editor && view) {
      try {
        const coords = view.coordsAtPos(editor.state.selection.head);
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

  // A pagination pass measures the DOM the previous one changed, so a freshly opened
  // document re-flows a few times before it holds still (a columns chain the longest).
  // The reader gets the page it settles on, not the search for it.
  const SETTLE_CAP_MS = 1500;
  let settling = $state(true);
  let settleRaf = 0;

  // The document height pagination derives, plus a bounded sample of block placements
  // — reading all of them each frame starves the very layout this waits for on a long
  // document, and a reflow that moves nothing in SETTLE_SAMPLES places moves nothing.
  const SETTLE_SAMPLES = 48;

  function layoutSignature(): string {
    // The pane that paginates; a split pane only renders what this one settles on.
    const tip = (editor?.view.dom ?? null) as HTMLElement | null;
    if (!tip) return '';
    const kids = tip.children;
    let sig = `${tip.style.minHeight}|${kids.length}`;
    const stride = Math.max(1, Math.ceil(kids.length / SETTLE_SAMPLES));
    for (let i = 0; i < kids.length; i += stride) {
      const child = kids[i] as HTMLElement;
      sig += `|${child.offsetTop}:${child.offsetHeight}`;
    }
    return sig;
  }

  function waitForSettled(): void {
    cancelAnimationFrame(settleRaf);
    settling = true;
    const deadline = performance.now() + SETTLE_CAP_MS;
    let last = '';
    let stable = 0;
    const tick = () => {
      const sig = layoutSignature();
      stable = sig && sig === last ? stable + 1 : 0;
      last = sig;
      // Two repeats, so a pass that only re-dispatches decorations doesn't count.
      if (stable >= 2 || performance.now() > deadline) {
        settling = false;
        return;
      }
      settleRaf = requestAnimationFrame(tick);
    };
    settleRaf = requestAnimationFrame(tick);
  }

  // Re-arms on every document the app loads (mount included), never on an edit.
  $effect(() => {
    documentEpoch;
    waitForSettled();
  });

  onMount(async () => {
    // Start with empty history lists — loaded content is not an undoable edit.
    resetHistoryLog();
    // Awaited: the document's pictures live in IndexedDB, and the editor is built
    // from the whole document or the first pagination pass measures the wrong one.
    const saved = await loadDocument();

    editor = new Editor({
      element: hosts[0],
      extensions,
      content: saved || undefined,
      editorProps: {
        // Our SpellCheck extension draws squiggles; turn off the browser's so
        // they don't double up.
        attributes: { spellcheck: 'false' },
        handleScrollToSelection: () => multiPage || (paneCount > 1 && activePane !== 0),
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
          // Only an explicit font at the caret is carried over: with none, the pasted
          // text inherits the paragraph's style, as it does in both word processors.
          const font = cursorMarks.find(m => m.type === textStyleType)?.attrs.fontFamily as string | undefined;
          if (!font) return slice;
          return new Slice(applyFontToFragment(slice.content, textStyleType, font), slice.openStart, slice.openEnd);
        },
      },
      onTransaction: ({ editor: e, transaction }) => {
        // Deferred: a blur tr arrives synchronously when a pane-layout switch tears
        // down the focused DOM — inside Svelte's flush, where a $state write throws.
        queueMicrotask(() => tick++);
        // The other pane shows the same state, decorations included.
        for (const view of paneViews) view?.updateState(e.state);
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
        const view = paneView() ?? e.view;
        const tiptap = view.dom as HTMLElement | null;
        if (!tiptap) return;
        try {
          const coords = view.coordsAtPos(e.state.selection.head);
          const cursorInDoc = ((coords.top + coords.bottom) / 2 - tiptap.getBoundingClientRect().top) / (appliedZoom / 100);
          currentPage = Math.max(1, Math.min(numPages, Math.floor(Math.max(0, cursorInDoc) / getCycle()) + 1));
          followCaret(currentPage);
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

    // On the view's own DOM, not hosts[0]: switching the pane layout replaces the
    // host element, and a listener there would go down with it.
    editor.view.dom.addEventListener('pm-pagecount', onPageCount);
    document.fonts?.addEventListener('loadingdone', repaginateOnFontLoad);
    document.fonts?.ready.then(repaginateOnFontLoad);
    // Seed the scaled footprint before the first paint (so the page is centered, not
    // briefly left-aligned), then refine it once layout settles. The pageBreaks plugin
    // also fires pm-pagecount shortly after with the precise document height.
    recomputeScaledSize();
    requestAnimationFrame(recomputeScaledSize);
    // Two frames in: the first pagination pass has run and painted. A document that
    // hangs or throws on the way here leaves the boot flag set and is skipped next load.
    requestAnimationFrame(() => requestAnimationFrame(markDocumentLoaded));
  });

  function onEditorScroll(pane: number) {
    if (multiPage) readFirstRow();
    // The grid's one scroller carries every cell, whichever of them is being worked in.
    if (multiPage || pane === activePane) updateCurrentPage();
    scheduleTableUi();
    if (linkTip) linkTip = null;
  }

  // --- The page grid ---
  // Rows of `gridCols` pages, filled left to right, scrolling as one canvas. A cell
  // is a window of exactly one page: pane index = slot * gridCols + column, and the
  // two slots take turns being the upper row, so a scroll only re-aims the views.
  let gridRows = $derived(Math.ceil(Math.max(1, numPages) / gridCols));
  let firstRow = $state(0);
  let canvasEl = $state<HTMLDivElement | null>(null);
  const rowOfSlot = (slot: number) => firstRow + ((slot - firstRow) & 1);
  const pageOfPane = (pane: number) => rowOfSlot(Math.floor(pane / gridCols)) * gridCols + (pane % gridCols) + 1;
  let cells = $derived(
    !multiPage ? [] : Array.from({ length: paneCount }, (_, pane) => {
      const z = appliedZoom / 100;
      const page = pageOfPane(pane);
      const box = pageBoxes[page - 1];
      return {
        pane, page, live: page <= numPages,
        left: (pane % gridCols) * pageStride * z,
        top: rowOfSlot(Math.floor(pane / gridCols)) * firstCycle * z,
        width: (box?.width ?? paperWidth) * z,
        height: (box?.height ?? firstCycle - PAGE_GAP) * z,
        // Where the document sits inside the cell: its own page box, at the top left.
        paperTop: -(box?.top ?? 0) * z,
        paperLeft: -(box?.left ?? 0) * z,
      };
    }),
  );

  // Scroll position of the canvas top, with the floating toolbar's overlay left free:
  // a row scrolled to the scroller's own top would sit behind the island.
  function gridOrigin(el: HTMLElement): number {
    // Inherited from the app shell, which is where the floating chrome measures itself.
    const overlay = parseFloat(getComputedStyle(el).getPropertyValue('--toolbar-overlay-h')) || 0;
    return (canvasEl?.offsetTop ?? 0) - overlay;
  }

  function readFirstRow() {
    const el = scrollers[0];
    if (!el || !canvasEl) return;
    // A scroll written for a row lands a fraction of a pixel short of it, so a whole
    // page of slack decides nothing here but the row a boundary belongs to.
    const top = (el.scrollTop - gridOrigin(el)) / (appliedZoom / 100) + 1;
    firstRow = Math.max(0, Math.min(gridRows - 1, Math.floor(top / firstCycle)));
  }

  // Scrolls the grid so `page`'s row is the top one — what a caret leaving the screen
  // and a jump from elsewhere in the app both need.
  function scrollGridToPage(page: number) {
    const el = scrollers[0];
    if (!el || !canvasEl) return;
    const row = Math.max(0, Math.min(gridRows - 1, Math.floor((Math.max(1, page) - 1) / gridCols)));
    // Written here rather than awaited from the scroll event: the caller reads the
    // cells back in the same tick to find the page it just scrolled to.
    firstRow = row;
    el.scrollTop = gridOrigin(el) + row * firstCycle * (appliedZoom / 100);
  }

  // The caret is drawn by whichever view holds the focus, so it has to be the one
  // whose cell shows the caret's page — otherwise it blinks on a clipped page.
  function followCaret(page: number) {
    if (!multiPage || hfActive) return;
    // The two rows on screen, in page numbers — the slots alternate, so pane 0 is not
    // reliably the first of them.
    const top = firstRow * gridCols + 1;
    if (page < top || page >= top + 2 * gridCols) scrollGridToPage(page);
    const focused = paneViews.some((v) => v?.hasFocus()) || editor?.view.hasFocus();
    const pane = cells.find((c) => c.page === page)?.pane;
    if (!focused || pane === undefined || pane === activePane) return;
    activePane = pane;
    viewOf(pane)?.focus();
  }

  // A pane's own listeners. `scroll` does not bubble and `mouseover` needs no a11y
  // handler pair on a scroll container, so both are attached here rather than in markup.
  function paneEvents(node: HTMLElement, pane: number) {
    const scroll = () => onEditorScroll(pane);
    const over = (e: MouseEvent) => onEditorPointerOver(e, pane);
    node.addEventListener('scroll', scroll);
    node.addEventListener('mouseover', over);
    node.addEventListener('mouseout', onEditorPointerOut);
    return {
      destroy() {
        node.removeEventListener('scroll', scroll);
        node.removeEventListener('mouseover', over);
        node.removeEventListener('mouseout', onEditorPointerOut);
      },
    };
  }

  // The editor is built into pane 0's host once, and switching the pane layout replaces
  // that element — so its view moves to the new host rather than being rebuilt.
  $effect(() => {
    const host = hosts[0];
    const view = editor?.view;
    if (host && view && view.dom.parentElement !== host) host.appendChild(view.dom);
  });

  // --- Extra panes: more live views of the same state (Word's View ▸ Split, and
  // the page columns). Every pane is the same width, so the pagination the first one
  // measures is the layout of all; only its decorations reach here (isSplitPane).
  $effect(() => {
    const ed = editor;
    const mounted = extraPanes.filter((i) => hosts[i]);
    if (!ed || !mounted.length) return;
    const made = mounted.map((i) => {
      const view = new EditorView(hosts[i], {
        ...ed.view.props,
        state: ed.state,
        // A pane shows the document, it does not measure one: a plugin deriving state
        // from its own viewport (the placeholder's does) would otherwise fight every
        // other pane over that state, one transaction each, forever.
        dispatchTransaction: (tr) => {
          if (tr.docChanged || tr.selectionSet || tr.storedMarksSet) ed.view.dispatch(tr);
        },
        // Each pane keeps the place it was scrolled to: a caret move belongs to the pane
        // being worked in, and without this every keystroke drags the others along.
        handleScrollToSelection: () => multiPage || activePane !== i,
      });
      // What TipTap puts on its own view: the class every editor style is written against,
      // and the back-reference its node views look the editor up through.
      view.dom.classList.add('tiptap');
      (view.dom as HTMLElement & { editor?: Editor }).editor = ed;
      paneViews[i] = view;
      return view;
    });
    return () => {
      for (const i of mounted) paneViews[i] = null;
      for (const view of made) view.destroy();
    };
  });

  // The page slots are a min-height the pagination pass writes on its own view's DOM.
  $effect(() => {
    if (!docHeightDoc) return;
    for (const view of paneViews) if (view) view.dom.style.minHeight = `${docHeightDoc}px`;
  });

  // A ribbon command focuses the editor's own view, which is pane 0 — but the caret
  // belongs to the pane being worked in, so hand the focus back. A click on a pane sets
  // activePane first (pointerdown precedes focus), so it is never bounced away.
  function onPaneFocus(pane: number) {
    if (pane === activePane || hfActive) return;
    viewOf(activePane)?.focus();
  }

  $effect(() => {
    if (activePane >= paneCount) activePane = 0;
  });

  // A grid is only a grid at a zoom where a whole row of pages fits it, so switching
  // the count fits it, as both word processors re-zoom for this view. A later
  // resize does not: from then on the reader's own zoom stands.
  let fittedColumns = 0;
  $effect(() => {
    const n = multiPage ? gridCols : 0;
    if (n === fittedColumns) return;
    if (!n) {
      fittedColumns = 0;
      return;
    }
    const box = panesEl, pane = scrollers[0];
    if (!box || !pane || !onZoom) return;
    const pad = (side: string) => parseFloat(getComputedStyle(pane).getPropertyValue(`padding-${side}`)) || 0;
    fittedColumns = n;
    onZoom(fitPagesZoom(
      { width: box.clientWidth - pad('left') - pad('right'), height: box.clientHeight - pad('top') },
      { width: pageStride, cycle: firstCycle },
      n,
    ));
  });

  // Where the divider sits, in percent of the pane area (both word processors drag one).
  let splitRatio = $state(50);
  let panesEl: HTMLDivElement;

  function onSplitDrag(e: PointerEvent) {
    const handle = e.currentTarget as HTMLElement;
    const rect = panesEl.getBoundingClientRect();
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      splitRatio = Math.min(85, Math.max(15, ((ev.clientY - rect.top) / rect.height) * 100));
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }

  onDestroy(() => {
    cancelAnimationFrame(settleRaf);
    if (zoomRaf !== null) cancelAnimationFrame(zoomRaf);
    cancelAnimationFrame(marginRecalcRaf);
    cancelAnimationFrame(marksRecalcRaf);
    cancelAnimationFrame(tableUiRaf);
    editor?.view.dom.removeEventListener('pm-pagecount', onPageCount);
    editor?.destroy();
    resetHistoryLog();
    document.fonts?.removeEventListener('loadingdone', repaginateOnFontLoad);
  });
</script>

<div class="editor-panes" class:grid={multiPage} bind:this={panesEl}>
  {#if multiPage}
    <!-- One scroller for the whole grid; the cells are its canvas, each a window of
         one page onto its own view of the document. -->
    <div
      class="editor"
      bind:this={scrollers[0]}
      use:paneEvents={0}
      onwheel={(e) => onWheel(e, 0)}
      role="none"
    >
      <div
        class="paper-scaler grid-canvas"
        bind:this={canvasEl}
        style="width: {Math.round(gridCols * pageStride * appliedZoom / 100 - PAGE_GAP * appliedZoom / 100)}px; height: {Math.round(gridRows * firstCycle * appliedZoom / 100)}px;"
      >
        {#each cells as cell (cell.pane)}
          <div
            class="page-cell"
            class:empty={!cell.live}
            style="left: {cell.left}px; top: {cell.top}px; width: {cell.width}px; height: {cell.height}px;"
            oncontextmenu={(e) => openContextMenu(e, cell.pane)}
            onpointerdown={() => (activePane = cell.pane)}
            onfocusin={() => onPaneFocus(cell.pane)}
            role="none"
          >
            {@render paper(cell.pane, cell.paperTop, cell.paperLeft)}
          </div>
        {/each}
      </div>
      {@render chrome(activePane)}
    </div>
  {:else}
    {@render pane(0)}
    {#if splitView}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="split-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t().view.split}
        onpointerdown={onSplitDrag}
      ></div>
      {@render pane(1)}
    {/if}
  {/if}
</div>

{#snippet pane(i: number)}
<div
  class="editor"
  class:pane-below={splitView && i > 0}
  style:flex={splitView && i === 0 ? `0 0 ${splitRatio}%` : '1'}
  bind:this={scrollers[i]}
  use:paneEvents={i}
  onwheel={(e) => onWheel(e, i)}
  oncontextmenu={(e) => openContextMenu(e, i)}
  onpointerdown={() => (activePane = i)}
  onfocusin={() => onPaneFocus(i)}
  role="none"
>
  <!-- Hidden while a header/footer zone is active: those have no tab stops, so the
       ruler would edit the body paragraph behind the user's back. -->
  {#if showRuler && scaledWidth && !hfActive}
    <Ruler {editor} {tick} zoom={appliedZoom} width={scaledWidth} margins={pageMargins} />
  {/if}
  <!-- Reserves the scaled scroll footprint; the transform on .paper reserves none.
       Before the first measure (size 0) it's left unsized so .paper isn't clipped. -->
  <div class="paper-scaler" style={scaledWidth ? `width: ${scaledWidth}px; height: ${scaledHeight}px;` : ''}>
    {@render paper(i, 0, 0)}
  </div>
  {@render chrome(i)}
</div>
{/snippet}

{#snippet paper(i: number, offsetTop: number, offsetLeft: number)}
    <div bind:this={papers[i]} class="paper" style:position={offsetTop || offsetLeft ? 'absolute' : null} style:top={offsetTop ? `${offsetTop}px` : null} style:left={offsetLeft ? `${offsetLeft}px` : null} data-spacing-model={spacingModel} class:show-formatting-marks={showFormattingMarks} class:hf-editing={hfActive} class:settling style="transform: scale({appliedZoom / 100});{pageDecor.background ? ` --color-page-bg: ${pageDecor.background};` : ''}">
      <!-- Dedicated mount point that TipTap fully owns — keeping it free of Svelte
           content avoids Svelte and ProseMirror fighting over the same parent's DOM. -->
      <div bind:this={hosts[i]} class="tiptap-host" data-split-pane={i > 0 ? '' : null} dir={pageRtl ? 'rtl' : null} lang={documentLanguage === NO_LANGUAGE ? null : documentLanguage} style:hyphens={hyphenate ? 'auto' : null}></div>
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
      <PageSheetLayer {pageBoxes} />
      <PageDecorLayer decor={pageDecor} {pageBoxes} {pageMargins} />
      {#if lineNumbering.on}
        <LineNumberLayer {editor} {tick} {lineNumbering} {pageBoxes} {pageMargins} />
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
        {pageBoxes}
        {currentPage}
        {pageMargins}
        {orientation}
        {pageFormat}
        {hfDistances}
        bind:extraHfSections
        {sectionStartPages}
        {chapterStarts}
        {pageNumbering}
        interactive={i === 0}
      />
    </div>
{/snippet}

<!-- The floating chrome renders in the pane being worked in: it is positioned in that
     scroller's own space, and the selection it describes is drawn there. -->
{#snippet chrome(i: number)}
  {#if i === activePane}
  {#if tableUi.visible && !tableDialog}
    <TableToolbar
      {editor}
      {tick}
      top={tableUi.top}
      left={tableUi.left}
      onDialog={(which) => (tableDialog = which)}
    />
  {/if}
  {#if tableUi.visible && tableDialog}
    <div class="table-dialog" bind:clientHeight={tableDialogH} style="top: {tableDialogTop}px; left: {tableUi.left}px;">
      {#if tableDialog === 'split'}
        <TableSplitDialog
          onApply={(cols, rows) => {
            editor?.chain().focus().splitCellInto(cols, rows).run();
            tableDialog = null;
          }}
          onClose={() => (tableDialog = null)}
        />
      {:else if tableDialog === 'sort'}
        <TableSortDialog
          columns={tableGrid.columns}
          column={tableGrid.column}
          headerRow={tableGrid.headerRow}
          onApply={(options) => {
            editor?.chain().focus().sortTable(options).run();
            tableDialog = null;
          }}
          onClose={() => (tableDialog = null)}
        />
      {:else}
        <TableFormulaDialog
          cell={tableGrid.cell}
          initial={tableGrid.formula}
          initialFormat={tableGrid.format}
          onApply={(formula, format) => {
            editor?.chain().focus().setCellFormula(formula, format).run();
            tableDialog = null;
          }}
          onClose={() => (tableDialog = null)}
        />
      {/if}
    </div>
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
      textVertical={textBoxUi.textVertical}
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
  {/if}
  <!-- The grid has one scroller, so its hint is placed there whichever cell it is over. -->
  {#if linkTip && (multiPage || linkTip.pane === i)}
    <div class="link-tooltip" style="top: {linkTip.top}px; left: {linkTip.left}px;">
      <span class="link-tooltip-url">{linkTip.href}</span>
      <span class="link-tooltip-hint">{t().link.openHint(withShortcut('Ctrl'))}</span>
    </div>
  {/if}
{/snippet}

<style>
  /* The pane column. Unsplit it holds the one scroller and changes nothing. */
  .editor-panes {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  /* The lower pane sits below the toolbar island, so it needs none of its clearance. */
  .editor-panes :global(.editor.pane-below) {
    padding-top: 1.25rem;
    border-top: 1px solid var(--color-border);
  }

  /* The page grid: one scroller holding a canvas of page cells. `min-width: 0` lets
     it be narrower than its canvas — a flex item's automatic minimum is its content,
     so without it the grid widens the whole app instead of scrolling. */
  .editor-panes.grid {
    min-width: 0;
  }

  .editor-panes.grid :global(.editor) {
    min-width: 0;
  }

  /* A cell is a window of exactly one page onto its own view of the document. */
  .grid-canvas {
    position: relative;
  }

  .page-cell {
    position: absolute;
    overflow: hidden;
  }

  /* Past the last page the row is short; its cell stays as the grid's empty slot. */
  .page-cell.empty {
    visibility: hidden;
  }

  .split-handle {
    flex: 0 0 6px;
    background: var(--color-toolbar-bg);
    border-block: 1px solid var(--color-border);
    cursor: row-resize;
    touch-action: none;
  }

  .split-handle:hover {
    background: var(--color-primary);
  }

  /* While editing a header/footer, dim the body so focus is on the margin zone. */
  .paper.hf-editing :global(.tiptap) {
    opacity: 0.5;
    transition: opacity 0.15s;
  }

  /* The table popovers sit above the table's top-left corner like the toolbar. The
     wrapper is what places them, so one measurement keeps a tall one in view. */
  .table-dialog {
    position: absolute;
    transform: translateY(calc(-100% - 6px));
    z-index: 300;
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
