<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { Editor, type Content } from '@tiptap/core';
  import { layOutZoneTabs, zoneDefaultStops } from '../editor/extensions/tabStops';
  import { FORCE_PAGE_RECALC, placeZoneFrames } from '../editor/extensions/pageBreaks';
  import { zoneExtensions } from '../editor/extensions';
  import { StateStep, ZoneHistory } from '../editor/extensions/stateHistory';
  import { RECORDING } from '../editor/extensions/trackChanges';
  import { ZONE_SETTLED, connectZones } from '../editor/zoneReview';
  import { authorColors } from '../editor/authorColors';
  import { isUndoRedo } from '../editor/undo';
  import { TextSelection, type Transaction } from '@tiptap/pm/state';
  import { plainPastedSpaces, unwrapPastedBoxes } from '../editor/paste';
  import { readClickCaret } from '../editor/clickCaret';
  import { hfIsEmpty, DEFAULT_HF_DISTANCES, HF_ZONE_KEYS, NO_HF_FRAMES, type HfSetFrames, type HfFrame, type HfDoc, type HfZone, type HfVariant, type HfDistances, type HfSet, type HfZoneKey, type PageZones } from '../storage/headerFooter';
  import { cmToPx, PX_PER_CM, type PageMargins } from '../storage/pageMargins';
  import { type Orientation } from '../storage/pageOrientation';
  import { pageDimsCm, type PageFormat } from '../storage/pageFormat';
  import { DEFAULT_PAGE_NUMBERING, isLeftPage, printedPageNumber, type PageNumbering } from '../storage/pageNumbering';
  import { formatOrdinal } from '../utils/orderedListTypes';
  import { cssBorder } from '../editor/extensions/tableCellBorders';
  import { chapterOn, type ChapterStart } from '../utils/chapterField';
  import { t } from '../i18n/i18n.svelte';
  import { nameIsland } from '../i18n/shortcut';
  import { allPagesDrawn } from './pageWindow.svelte';
  import { claimZone, heldZones, yieldsZone, zoneHolder } from '../collab/zones.svelte';
  import { reading } from '../collab/reading.svelte';

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
    pageBoxes,
    currentPage,
    pageMargins,
    orientation,
    pageFormat = 'A4',
    hfDistances = DEFAULT_HF_DISTANCES,
    hfFrames = NO_HF_FRAMES,
    hfEditor = $bindable(),
    hfActive = $bindable(),
    activePage = $bindable(1),
    hfTick = $bindable(),
    extraHfSections = $bindable([]),
    sectionStartPages = [],
    blankPages = [],
    pageRtl = false,
    chapterStarts = [],
    pageNumbering = DEFAULT_PAGE_NUMBERING,
    zoneHeights = $bindable([]),
    zoneIntrusions = $bindable([]),
    pageZones = $bindable([]),
    interactive = true,
    onlyPage = 0,
    bodyEditor = null,
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
    /** One box per page (Editor.svelte): a section on its own paper differs in size. */
    pageBoxes: { top: number; left: number; height: number; width: number }[];
    currentPage: number;
    /** How the page-number field counts (format + start value). */
    pageNumbering?: PageNumbering;
    pageMargins: PageMargins;
    orientation: Orientation;
    pageFormat?: PageFormat;
    hfDistances?: HfDistances;
    hfFrames?: HfSetFrames;
    hfEditor: Editor | null;
    hfActive: HfZone | null;
    /** The page whose zone is being edited, which the ruler measures. */
    activePage?: number;
    hfTick: number;
    extraHfSections?: HfSet[];
    sectionStartPages?: number[];
    // Pages a section's start side leaves blank: LibreOffice draws no zone there.
    blankPages?: number[];
    pageRtl?: boolean;
    chapterStarts?: ChapterStart[];
    /** Rendered height (px) of each set's six zones, in HF_ZONE_KEYS order — read back
     *  by Editor.svelte, whose margins have to clear the band the zone really needs. */
    zoneHeights?: number[][];
    /** How far past the body's top each header's frames set against the body keep its text
     *  (px, same layout) — a letterhead block the body wraps below; for a footer, how far
     *  its frames' gaps reach above its text. */
    zoneIntrusions?: number[][];
    /** The pages a field's text makes a zone taller or shorter on than `zoneHeights` says. */
    pageZones?: PageZones[];
    /** False in a split view's second pane: it draws the zones, it does not edit them. */
    interactive?: boolean;
    /** A page-grid cell's page: the cell clips every other, so only its zones are drawn. */
    onlyPage?: number;
    /** The body editor, whose undo stack the zones' edits join. */
    bodyEditor?: Editor | null;
  } = $props();

  const PAGE_GAP = 20;
  // Minimum zone height (~one 12pt line), so a thin margin band (footer distance ≥
  // bottom margin, as some Word docs have) still renders instead of collapsing to 0.
  const MIN_ZONE_PX = 20;
  // Schema for the read-only editors the inactive zones are cloned from.
  const renderExts = zoneExtensions();

  // All geometry is in unscaled document px — the layer lives inside the scaled
  // .paper, so the zoom transform applies to it identically to the page background.
  let pageWidthPx = $derived(pageDimsCm(pageFormat, orientation).w * PX_PER_CM);
  let pageHeightPx = $derived(pageDimsCm(pageFormat, orientation).h * PX_PER_CM);
  // A section on its own paper makes the pages differ, so every box comes from the
  // grid Editor.svelte publishes; the document's own is the fallback.
  const boxOf = (page: number) => pageBoxes[page - 1]
    ?? { top: (page - 1) * (pageHeightPx + PAGE_GAP), left: 0, height: pageHeightPx, width: pageWidthPx };
  // A section with page margins of its own puts its zones on them, not the document's
  // — the running head of a mirrored body would otherwise sit at the wrong margin.
  function marginsOf(page: number): PageMargins {
    const i = sectionOf(page);
    const s = sets[i];
    const own = page === sectionFirstPage(i) ? s?.marginsFirst ?? s?.margins : s?.margins;
    return own ?? pageMargins;
  }
  const contentWidthOf = (page: number) => {
    const m = marginsOf(page);
    return Math.max(0, boxOf(page).width - cmToPx(m.left) - cmToPx(m.right));
  };
  // Edge→zone distance in px. The footer may sit farther from the edge than the body
  // bottom margin (Word's w:footer > w:bottom); the zone then grows up into the margin.
  let headerDistPx = $derived(Math.min(cmToPx(hfDistances.header), pageHeightPx));
  let footerDistPx = $derived(Math.min(cmToPx(hfDistances.footer), pageHeightPx));
  // A section whose page setup gives it its own distances puts its zones on those.
  function distancesOf(page: number): { header: number; footer: number } {
    const i = sectionOf(page);
    const s = sets[i];
    const d = (page === sectionFirstPage(i) ? s?.distancesFirst ?? s?.distances : s?.distances) ?? null;
    return d
      ? { header: Math.min(cmToPx(d.header), pageHeightPx), footer: Math.min(cmToPx(d.footer), pageHeightPx) }
      : { header: headerDistPx, footer: footerDistPx };
  }

  // Only the pages around the one being read carry their zones: a long document's layer
  // is a thousand absolutely-placed boxes otherwise, laid out again on every pass. The
  // window shifts a step at a time, so a scroll does not rebuild it on every tick.
  const WINDOW_STEP = 25;
  const WINDOW_PAGES = 75;
  function allPages(): number[] {
    const total = Math.max(1, numPages);
    if (onlyPage && !allPagesDrawn.on) return onlyPage <= total ? [onlyPage] : [];
    if (allPagesDrawn.on || total <= WINDOW_PAGES) return Array.from({ length: total }, (_, i) => i + 1);
    const step = Math.floor((currentPage - 1) / WINDOW_STEP) * WINDOW_STEP - WINDOW_STEP + 1;
    const start = Math.max(1, Math.min(total - WINDOW_PAGES + 1, step));
    return Array.from({ length: WINDOW_PAGES }, (_, i) => start + i);
  }
  let pages = $derived(allPages().filter((p) => !blankPages.includes(p)));

  function zoneBox(zone: HfZone, page: number) {
    // Mirrored margins: an even page is the left-hand one, so the pair is swapped.
    const box = boxOf(page);
    const m = marginsOf(page);
    const dist = distancesOf(page);
    const swap = m.mirrored && isLeftPage(pageNumberAt(page));
    // From the page's own left edge — a section on narrower paper is centred.
    const left = box.left + cmToPx(swap ? m.right : m.left);
    const width = contentWidthOf(page);
    const clip = clipOf(zone, page);
    if (zone === 'header') {
      const top = box.top + dist.header;
      return { top, left, width, height: clip ?? Math.max(MIN_ZONE_PX, cmToPx(m.top) - dist.header) };
    }
    // Footer anchors its bottom edge at its distance from the page bottom and grows up.
    const height = clip ?? Math.max(MIN_ZONE_PX, cmToPx(m.bottom) - dist.footer);
    const top = box.top + box.height - dist.footer - height;
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
    const height = clipOf(zone, page) ?? Math.max(b.height, contentPx);
    if (zone === 'footer') return { ...b, top: b.top + b.height - height, height };
    return { ...b, height };
  }
  // Double-click target: the zone's ::after grows the box out to the page edges, so the
  // whole margin band opens the zone (as in LibreOffice) without a box of its own — a
  // second element per zone is a hundred more to lay out on every pass.
  function hitVars(zone: HfZone, page: number, z: { top: number; left: number; width: number; height: number }) {
    const box = boxOf(page);
    const edge = zone === 'header' ? z.top - box.top : box.top + box.height - z.top - z.height;
    return ` --hit-${zone === 'header' ? 'top' : 'bottom'}: ${-edge}px;` +
      ` --hit-left: ${box.left - z.left}px; --hit-right: ${box.left + box.width - z.left - z.width}px;`;
  }
  // A zone's framed area (HfFrame) as its editor root draws it: borders, padding, the gap
  // outside them and on a page the area's least height, band less gap. A dynamic gap is
  // no margin, so the band reaches max(band, area) as LibreOffice's does (probed).
  function frameOf(index: number, key: HfZoneKey, first = key.endsWith('First')): HfFrame | null {
    const s = sets[index];
    return ((first ? s?.framesFirst ?? s?.frames : s?.frames)?.[key.startsWith('header') ? 'header' : 'footer']) ?? null;
  }
  function frameVars(f: HfFrame | null, header: boolean, bandPx: number | null = null): string {
    if (!f) return '';
    const side = (v: string | null) => (v && cssBorder(v)) || 'none';
    const px = (cm: number) => `${cmToPx(cm)}px`;
    const p = f.padding;
    return ` --hf-frame-bt: ${side(f.border.top)}; --hf-frame-br: ${side(f.border.right)};` +
      ` --hf-frame-bb: ${side(f.border.bottom)}; --hf-frame-bl: ${side(f.border.left)};` +
      ` --hf-frame-pad: ${px(p.top)} ${px(p.right)} ${px(p.bottom)} ${px(p.left)};` +
      (f.background ? ` --hf-frame-bg: ${f.background};` : '') +
      ` --hf-frame-gap-${header ? 'b' : 't'}: ${px(f.dynamic ? 0 : f.gap)};` +
      (bandPx == null ? '' : ` --hf-frame-min: ${Math.max(0, bandPx - cmToPx(f.gap))}px;`);
  }
  // A page's zone frame, filling the page's band.
  function pageFrameVars(zone: HfZone, page: number): string {
    const index = Math.min(sectionOf(page), setSig.length - 1);
    const f = frameOf(index, zoneKey(zone, variantFor(page, index)), page === sectionFirstPage(index));
    const m = marginsOf(page);
    const d = distancesOf(page);
    return frameVars(f, zone === 'header', zone === 'header' ? cmToPx(m.top) - d.header : cmToPx(m.bottom) - d.footer);
  }
  const boxStyle = (b: { top: number; left: number; width: number; height: number }) =>
    `top: ${b.top}px; left: ${b.left}px; width: ${b.width}px; height: ${b.height}px;`;

  // Section 1 is the app's own editable state; the rest live in extraHfSections.
  let sets = $derived<HfSet[]>([
    {
      header: headerDoc, footer: footerDoc,
      headerFirst: headerFirstDoc, footerFirst: footerFirstDoc, differentFirstPage,
      headerEven: headerEvenDoc, footerEven: footerEvenDoc, differentOddEven, ...hfFrames,
    },
    ...extraHfSections,
  ]);
  // Each zone as a string: '' for an empty one, and what the pages test for fields in.
  const signature = (doc: HfDoc) => (hfIsEmpty(doc) ? '' : JSON.stringify(doc));
  let setSig = $derived(sets.map((s) => ({
    header: signature(s.header), footer: signature(s.footer),
    headerFirst: signature(s.headerFirst), footerFirst: signature(s.footerFirst),
    headerEven: signature(s.headerEven), footerEven: signature(s.footerEven),
  })));

  // Rendered once per set, not per page: a read-only editor per zone, in the off-screen
  // measuring box at its section's text width. A page shows a clone of its DOM, so list
  // markers, table columns and frames render as they do in the live zone.
  let sources = $state<Record<string, HTMLElement>>({});
  let sourceVersion = $state(0);
  const stored = new Set<Editor>();
  // Authors share one colour table: a new one in any part repaints the stored zones.
  let palette = '';
  function repaint() {
    const body = bodyEditor?.state.doc;
    const now = body ? [...authorColors(body).keys()].join('\n') : '';
    if (now === palette) return;
    palette = now;
    for (const ed of stored) ed.view.dispatch(ed.state.tr);
  }
  // One frame for all zones: each bump clones every zone into every page and re-measures.
  let bumpFrame = 0;
  const bump = () => {
    bumpFrame ||= requestAnimationFrame(() => { bumpFrame = 0; sourceVersion++; });
  };
  // A zone that never scrolls: where the engine lacks overflow-anchor (WebKit), ProseMirror
  // otherwise records the scroll position around each update, a forced layout per zone.
  function scrollFree(node: HTMLElement): HTMLElement {
    const dom = node.appendChild(document.createElement('div'));
    dom.style.overflowAnchor = 'none';
    return dom;
  }
  // A zone lies outside the body's host, so it takes the page's direction itself; set
  // on change only, as the host's is (Editor.svelte pageDir).
  function pageDir(node: HTMLElement, rtl: boolean) {
    const set = (on: boolean) => node.setAttribute('dir', on ? 'rtl' : 'ltr');
    set(rtl);
    return { update: set };
  }

  function staticZone(node: HTMLElement, [id, doc]: [string, HfDoc]) {
    const ed = new Editor({ element: { mount: scrollFree(node) }, editable: false, extensions: renderExts, content: doc as Content });
    stored.add(ed);
    // NodeViews settle after the first render (an image's size, a box's layout).
    const mo = new MutationObserver(bump);
    mo.observe(ed.view.dom, { subtree: true, childList: true, attributes: true, characterData: true });
    sources[id] = ed.view.dom as HTMLElement;
    bump();
    return {
      update([, next]: [string, HfDoc]) {
        if (next !== doc) ed.commands.setContent((doc = next) as Content, { emitUpdate: false });
      },
      destroy() {
        mo.disconnect();
        delete sources[id];
        stored.delete(ed);
        ed.destroy();
      },
    };
  }
  // Whether a zone holds a frame behind the text: the background layer paints those, from
  // a second clone of the zone, so they sit under the body as they do in both products.
  type ZoneNode = { type?: string; attrs?: Record<string, unknown>; content?: ZoneNode[] };
  const behind = (n: ZoneNode): boolean =>
    (n.attrs?.wrap === 'through' && !n.attrs.inFront) || !!n.content?.some(behind);
  let setBehind = $derived(sets.map((s) => Object.fromEntries(HF_ZONE_KEYS.map((k) => [k, !!s[k] && behind(s[k] as ZoneNode)]))));

  // Off-screen copy of every zone at its section's text width. What the body has to
  // clear is the height the zone renders at: counting paragraphs sees neither a line
  // that wraps, nor a taller run, nor the paragraph's own padding.
  let measureRoot = $state<HTMLDivElement | null>(null);
  $effect(() => {
    const root = measureRoot;
    if (!root) return;
    void sourceVersion; // a frame past the zone changes no box size
    void filledKeys;
    const version = `${sourceVersion}:${fontVersion}`;
    const boxes = Array.from(root.querySelectorAll<HTMLElement>('.hf-measure-box:not([data-filled])'));
    const filled = Array.from(root.querySelectorAll<HTMLElement>('.hf-measure-box[data-filled]'));
    const n = HF_ZONE_KEYS.length;
    const read = () => {
      const next = setSig.map((_, i) => HF_ZONE_KEYS.map((_, k) => boxes[i * n + k]?.offsetHeight ?? 0));
      if (String(next) !== String(untrack(() => sourceHeights))) sourceHeights = next;
      // A copy no longer shown keeps its height while the zone and the fonts stay as they
      // are: a page count going back and forth must not fall back to the unfilled height.
      const own = version === filledVersion ? { ...untrack(() => filledHeights) } : {};
      filledVersion = version;
      for (const el of filled) if (el.offsetHeight) own[el.dataset.filled!] = el.offsetHeight;
      if (JSON.stringify(own) !== JSON.stringify(untrack(() => filledHeights))) filledHeights = own;
      const past = setSig.map((_, i) => HF_ZONE_KEYS.map((key, k) => (key.startsWith('header') ? intrusion(boxes[i * n + k]) : rise(boxes[i * n + k]))));
      if (String(past) !== String(untrack(() => zoneIntrusions))) zoneIntrusions = past;
    };
    // A web font arriving late (an embedded one lands after the import) reflows the zone,
    // so the height is observed rather than read once. The first report comes after the
    // frame's own layout: a read here would force one, ~0.4 s on a long document in WebKit.
    const ro = new ResizeObserver(read);
    for (const el of [...boxes, ...filled]) ro.observe(el);
    return () => ro.disconnect();
  });

  // A zone with page fields is as tall as their text makes it on each page: a longer
  // number wraps a line, and the body has to clear the zone the page really shows. Pages
  // whose fields are equally wide share one filled copy, so a long document measures few.
  const FIELD_NODES = ['"pageNumber"', '"pageCount"', '"chapterField"'];
  type Filled = { key: string; id: string; index: number; zoneKey: HfZoneKey; zone: HfZone; page: number; pages: number };
  let fontVersion = $state(0);
  $effect(() => {
    const fonts = document.fonts;
    const arrived = () => { advances.clear(); fontVersion++; };
    fonts?.addEventListener?.('loadingdone', arrived);
    return () => fonts?.removeEventListener?.('loadingdone', arrived);
  });
  let ruler: CanvasRenderingContext2D | null | undefined;
  const advances = new Map<string, string>();
  // What tells two texts of a field apart in layout: a number or letters cannot break, so
  // only their length and width count; anything else is compared as the text it is.
  type FieldFont = { el: Element; font: string; transform: string };
  function fieldFont(el: Element): FieldFont {
    const cs = getComputedStyle(el);
    const font = `${cs.fontStyle} ${cs.fontVariantCaps === 'small-caps' ? 'small-caps ' : ''}${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return { el, font, transform: cs.textTransform };
  }
  function fieldShape({ font, transform }: FieldFont, text: string): string {
    if (!/^[\p{Nd}A-Za-z]+$/u.test(text)) return text;
    if (ruler === undefined) {
      try { ruler = document.createElement('canvas').getContext('2d'); } catch { ruler = null; }
    }
    if (!ruler) return text;
    const shown = transform === 'uppercase' ? text.toUpperCase() : transform === 'lowercase' ? text.toLowerCase() : text;
    const id = `${font}\n${shown}`;
    let shape = advances.get(id);
    if (shape === undefined) {
      ruler.font = font;
      advances.set(id, shape = `${shown.length}:${Math.round(ruler.measureText(shown).width * 64)}`);
    }
    return shape;
  }
  let filledZones = $derived.by(() => {
    void sourceVersion;
    void fontVersion;
    const list = new Map<string, Filled>();
    // Per page: its set, its header's place in HF_ZONE_KEYS and the copies its zones match.
    const ofPage: ([number, number, string, string] | undefined)[] = [];
    const fields = new Map<string, FieldFont[]>();
    // Every pane measures all pages, a page-grid cell too: they report into one state.
    for (let page = 1; page <= numPages; page++) {
      if (blankPages.includes(page)) continue;
      const index = Math.min(sectionOf(page), setSig.length - 1);
      const variant = variantFor(page, index);
      const keys = (['header', 'footer'] as const).map((zone) => {
        const zk = zoneKey(zone, variant), id = `${index}:${zk}`, sig = setSig[index][zk];
        const src = sig && FIELD_NODES.some((f) => sig.includes(f)) ? sources[id] : undefined;
        if (!src) return '';
        let els = fields.get(id);
        if (!els) fields.set(id, els = Array.from(src.querySelectorAll('[data-page-field]'), fieldFont));
        const total = sig.includes('"pageCount"') ? numPages : 0;
        const key = `${id}|${contentWidthOf(page)}|${els.map((f) => fieldShape(f, fieldText(f.el, page, total, zone))).join('|')}`;
        const known = list.get(key);
        if (known) known.pages++;
        else list.set(key, { key, id, index, zoneKey: zk, zone, page, pages: 1 });
        return key;
      });
      if (keys[0] || keys[1]) ofPage[page - 1] = [index, HF_ZONE_KEYS.indexOf(zoneKey('header', variant)), keys[0], keys[1]];
    }
    // The copy most pages of a zone match stands for the zone; the others are exceptions.
    const usual: Record<string, Filled> = {};
    for (const f of list.values()) if (!usual[f.id] || f.pages > usual[f.id].pages) usual[f.id] = f;
    return { list: [...list.values()], ofPage, usual };
  });
  let filledKeys = $derived(filledZones.list.map((f) => f.key).join('\n'));
  let filledHeights = $state<Record<string, number>>({});
  let filledVersion = '';
  let sourceHeights = $state<number[][]>([]);
  // Each zone's height: with fields, the one most of its pages show.
  let renderedHeights = $derived(sourceHeights.map((row, i) => row.map((px, k) =>
    filledHeights[filledZones.usual[`${i}:${HF_ZONE_KEYS[k]}`]?.key] || px)));
  // The pages whose zones differ from that, raw and fitted to their share of the page.
  let ownBands = $derived.by(() => {
    const out = new Map<number, { k: number; raw: [number, number]; fitted: [number, number] }>();
    filledZones.ofPage.forEach((entry, at) => {
      if (!entry) return;
      const [index, k, header, footer] = entry;
      const usual = [renderedHeights[index]?.[k] ?? 0, renderedHeights[index]?.[k + 1] ?? 0];
      const raw: [number, number] = [filledHeights[header] || usual[0], filledHeights[footer] || usual[1]];
      if (raw[0] === usual[0] && raw[1] === usual[1]) return;
      out.set(at + 1, { k, raw, fitted: fit(index, at + 1 === sectionFirstPage(index), raw[0], raw[1]) });
    });
    return out;
  });
  $effect(() => {
    const next = Array.from(ownBands, ([page, b]): PageZones => ({
      page, header: HF_ZONE_KEYS[b.k], footer: HF_ZONE_KEYS[b.k + 1], headerPx: b.fitted[0], footerPx: b.fitted[1],
    }));
    if (JSON.stringify(next) !== JSON.stringify(untrack(() => pageZones))) pageZones = next;
  });
  // A page's zone as measured and as cut to its band.
  function bandOf(zone: HfZone, page: number): { raw: number; fitted: number } {
    const own = ownBands.get(page), z = zone === 'header' ? 0 : 1;
    if (own) return { raw: own.raw[z], fitted: own.fitted[z] };
    const index = Math.min(sectionOf(page), setSig.length - 1);
    const k = HF_ZONE_KEYS.indexOf(zoneKey(zone, variantFor(page, index)));
    return { raw: renderedHeights[index]?.[k] ?? 0, fitted: zoneHeights[index]?.[k] ?? 0 };
  }

  // LibreOffice gives a page's header and footer together at most 80% of the room between
  // the edges they start from, the footer first, and clips what runs past (probed): the
  // body keeps the rest, so a zone taller than the page cannot push it off.
  const HF_MAX_SHARE = 0.8;
  $effect(() => {
    const next = renderedHeights.map((row, i) => row.map((_, k) => fittedPx(i, row, k)));
    if (String(next) !== String(untrack(() => zoneHeights))) zoneHeights = next;
  });
  // Zone k's band within the cap; HF_ZONE_KEYS pairs each header with its footer (k ^ 1).
  // A clipped zone keeps a line, since a band of 0 reads as one not yet measured.
  function fittedPx(i: number, row: number[], k: number): number {
    if (!row[k]) return row[k] ?? 0;
    return fit(i, HF_ZONE_KEYS[k].endsWith('First'), row[k & ~1], row[k | 1])[k & 1];
  }
  // A header and its footer within the cap, on a set's first page or its others.
  function fit(i: number, first: boolean, header: number, footer: number): [number, number] {
    const s = sets[i];
    const restM = s?.margins ?? pageMargins;
    const m = first ? s?.marginsFirst ?? restM : restM;
    const d = (first ? s?.distancesFirst ?? s?.distances : s?.distances) ?? hfDistances;
    const top = header ? cmToPx(d.header) : cmToPx(m.top);
    const bottom = footer ? cmToPx(d.footer) : cmToPx(m.bottom);
    const room = HF_MAX_SHARE * (boxOf(sectionFirstPage(i)).height - top - bottom);
    // Cut to its share but never below a line, and never grown past its content.
    const foot = footer && Math.min(footer, Math.max(MIN_ZONE_PX, room - (header ? MIN_ZONE_PX : 0)));
    return [header && Math.min(header, Math.max(MIN_ZONE_PX, room - foot)), foot];
  }
  // The band a page's zone is cut to, or null where its content fits.
  function clipOf(zone: HfZone, page: number): number | null {
    const { raw, fitted } = bandOf(zone, page);
    return fitted < raw ? fitted : null;
  }

  // The body text a header's frames set against it keep clear: down to the frame's
  // bottom, unless LibreOffice would wrap the text beside it — it leaves a gap under
  // 2cm empty ("optimal" wrap). ponytail: the lines a deeper frame leaves above it are
  // pushed down too; place them above once a document needs it.
  const WRAP_ROOM_PX = cmToPx(2);
  function intrusion(box: HTMLElement | undefined): number {
    let px = 0;
    for (const el of Array.from(box?.querySelectorAll<HTMLElement>('[data-from-body]') ?? [])) {
      const wrap = el.dataset.wrap;
      const x = Number(el.dataset.pageX) || 0;
      const room = wrap === 'left' ? box!.clientWidth - x - el.offsetWidth : wrap === 'right' ? x : 0;
      if (wrap === 'through' || room >= WRAP_ROOM_PX) continue;
      px = Math.max(px, (Number(el.dataset.pageY) || 0) + el.offsetHeight);
    }
    return px;
  }

  // A footer frame spanning its column keeps its gap above clear of the body, though the
  // footer's text runs through it (probed in LibreOffice: a full-width rule with a 2.54mm
  // gap ends the body 2.5mm higher; one 15cm wide, or with no gap, moves nothing).
  function rise(box: HTMLElement | undefined): number {
    const text = box?.querySelector<HTMLElement>('.tiptap');
    if (!box || !text) return 0;
    const scale = box.getBoundingClientRect().width / (box.offsetWidth || 1) || 1;
    const top = text.getBoundingClientRect().top;
    let px = 0;
    for (const el of Array.from(box.querySelectorAll<HTMLElement>('[data-zone-gap]'))) {
      const para = el.parentElement;
      if (!para || el.offsetWidth < box.clientWidth - 1) continue;
      px = Math.max(px, (Number(el.dataset.zoneGap) || 0) - (para.getBoundingClientRect().top - top) / scale);
    }
    return px;
  }

  // Where a page's body text begins before any frame pushes it: its margin, or below
  // its header where that reaches further (as Editor.svelte works it out).
  function bodyTopOf(page: number): number {
    const index = Math.min(sectionOf(page), setSig.length - 1);
    const key = zoneKey('header', variantFor(page, index));
    const band = setSig[index]?.[key] ? bandOf('header', page).fitted : 0;
    return Math.max(cmToPx(marginsOf(page).top), band ? distancesOf(page).header + band : 0);
  }

  /** A page's header and footer bands for the vertical ruler, px from the page top: null
   *  where the page shows none; the open zone grows with its content. */
  export function rulerBands(page: number) {
    const index = Math.min(sectionOf(page), setSig.length - 1);
    const dist = distancesOf(page);
    const band = (zone: HfZone) => {
      const key = zoneKey(zone, variantFor(page, index));
      const open = interactive && hfActive === zone && editingPage === page;
      if (!setSig[index]?.[key] && !open) return null;
      const measured = zoneHeights[index]?.[HF_ZONE_KEYS.indexOf(key)] ?? 0;
      const height = Math.max(measured, open ? activeContentPx - activeTrailingPx : 0, open ? MIN_ZONE_PX : 0);
      return { top: zone === 'header' ? dist.header : boxOf(page).height - dist.footer - height, height };
    };
    return { header: band('header'), footer: band('footer') };
  }

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
    if (s.differentOddEven && isLeftPage(pageNumberAt(page))) return 'even';
    return 'default';
  }
  // The zone a page shows: its set and key, that zone's signature, and whether it holds
  // a frame behind the text.
  function zoneOf(zone: HfZone, page: number): { id: string; sig: string; bg: boolean } {
    const index = Math.min(sectionOf(page), setSig.length - 1);
    const key = zoneKey(zone, variantFor(page, index));
    return { id: `${index}:${key}`, sig: setSig[index][key], bg: setBehind[index][key] };
  }
  // A frame placed against the page takes its top from there (--page-y); the zone's own
  // distance below the page top is what its layer subtracts.
  const pageVar = (b: { top: number }, page: number) =>
    ` --hf-page-y: ${b.top - boxOf(page).top}px; --hf-body-y: ${bodyTopOf(page)}px;`;


  // Page, the page count and chapter map (only where the zone shows them), its source
  // editor's DOM and version, the zone and the number the page shows: everything the
  // action below re-runs on. The label is a parameter of its own because numbering can
  // change without the page doing so.
  type ZoneParams = [number, number, HTMLElement | undefined, unknown, HfZone, string, number];

  // The zone's tabs: static HTML no ProseMirror plugin reaches, in layout px, so only a new
  // text or width invalidates them — the action re-runs on every transaction, in each view
  // of a page grid. The zones of one flush lay out together: one layout, not one each.
  const tabQueue = new Set<HTMLElement>();
  const tabsDirty = new WeakSet<HTMLElement>();
  const tabsWidth = new WeakMap<HTMLElement, string>();
  function layOutTabs(node: HTMLElement, changed: boolean) {
    if (changed) tabsDirty.add(node);
    if (!tabQueue.size) {
      queueMicrotask(() => {
        const zones = [...tabQueue].filter((z) => z.isConnected && (tabsDirty.has(z) || tabsWidth.get(z) !== z.style.width));
        tabQueue.clear();
        for (const z of zones) { tabsDirty.delete(z); tabsWidth.set(z, z.style.width); }
        layOutZoneTabs(zones);
        for (const root of zones.flatMap((z) => Array.from(z.querySelectorAll<HTMLElement>('.tiptap')))) placeZoneFrames(root);
      });
    }
    tabQueue.add(node);
  }

  // The number a page shows, and the label of it in its section's format (a roman
  // front matter) or the document's.
  function pageNumberAt(page: number): number {
    const starts = [pageNumbering.start, ...sets.slice(1).map((s) => s.pageNumberStart ?? null)];
    return printedPageNumber(page, sectionOf(page), starts, sectionFirstPage);
  }
  function pageLabel(page: number): string {
    return formatOrdinal(pageNumberAt(page), sets[sectionOf(page)]?.pageNumberFormat ?? pageNumbering.format);
  }

  // What a field shows on a page: the chapter there, the page count or the page's label.
  // The count stays decimal, as the field LibreOffice and Word write does.
  function fieldText(el: Element, page: number, total: number, zone: HfZone): string {
    const kind = el.getAttribute('data-page-field');
    return kind === 'chapter' ? chapterOn(chapterStarts, page, Number(el.getAttribute('data-level')) || 1, zone)
      : kind === 'count' ? String(total) : pageLabel(page);
  }

  // Clone the zone's source, replace the placeholder text in every page-field span with
  // the real value (current page number, or the total page count), then lay out its tabs.
  // A zone that only moves to another page keeps its clone and has its fields' text
  // rewritten: inserting elements makes the browser recount every list in the document,
  // in each view of a page grid, on every row a scroll brings in.
  function fillZone(node: HTMLElement, params: ZoneParams) {
    let made: [HTMLElement | undefined, unknown] | null = null;
    const apply = ([page, total, src, , zone, , version]: ZoneParams) => {
      let changed = !made || made[0] !== src || made[1] !== version;
      if (changed) {
        node.replaceChildren(...(src ? [src.cloneNode(true)] : []));
        made = [src, version];
      }
      for (const el of Array.from(node.querySelectorAll('[data-page-field]'))) {
        const text = fieldText(el, page, total, zone);
        const only = el.firstChild;
        if (only instanceof Text && !only.nextSibling) {
          if (only.data !== text) { only.data = text; changed = true; }
        } else if (el.textContent !== text) { el.textContent = text; changed = true; }
      }
      layOutTabs(node, changed);
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
  $effect(() => { if (interactive) activePage = editingPage; });
  let liveZone: HfZone | null = null;
  let liveKey = ''; // section:variant the live editor writes to
  let liveId = ''; // hf:section:zoneKey, as the body's history names it

  // Which HfSet field a zone + variant is.
  const zoneKey = (zone: HfZone, variant: HfVariant): HfZoneKey =>
    (zone + (variant === 'first' ? 'First' : variant === 'even' ? 'Even' : '')) as HfZoneKey;

  function zoneDoc(index: number, zone: HfZone, variant: HfVariant): HfDoc {
    return (sets[index] ?? sets[0])[zoneKey(zone, variant)];
  }
  // Section 1's zones are separate bindable props; a later section's live in the array,
  // replaced whole so the reassignment reaches App (which persists it).
  function writeZone(index: number, key: HfZoneKey, doc: HfDoc): void {
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

  // A zone opened while it is still empty starts on LibreOffice's header/footer stops, so
  // chapter\tcentre\tpage number needs no dialog. Only where nothing is set yet: a zone
  // that carries text or stops of its own keeps them.
  function startingDoc(index: number, zone: HfZone, variant: HfVariant, page: number): HfDoc {
    const doc = zoneDoc(index, zone, variant) ?? emptyDoc();
    const para = doc?.content?.[0] as { attrs?: Record<string, unknown> } | undefined;
    if (!doc || !para || !hfIsEmpty(doc) || para.attrs?.tabStops) return doc;
    const stops = zoneDefaultStops(contentWidthOf(page) / PX_PER_CM);
    return stops ? { ...doc, content: [{ ...para, attrs: { ...para.attrs, tabStops: stops } }] } : doc;
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
    // A split view's second layer only draws: the one live zone editor belongs to the
    // pane that owns the bindings, or both would write the same document.
    if (!interactive) return;
    const zone = hfActive;
    const mount = liveMount; // read unconditionally so it's always a tracked dep
    if (!zone) {
      if (hfEditor) destroyLive();
      return;
    }
    if (!mount) return;
    if (hfEditor && liveZone === zone) {
      // A first-page or odd/even flag flipped under the edited page: stay in the zone
      // and swap to the variant that page now shows.
      const page = untrack(() => editingPage);
      const index = sectionOf(page);
      if (liveKey === `${index}:${variantFor(page, index)}`) return;
      pendingPage = page;
    }
    // In a session a zone someone else has open stays shut; its tag says who (below).
    const page = pendingPage ?? currentPage, at = sectionOf(page);
    const target = `hf:${at}:${zoneKey(zone, variantFor(page, at))}`;
    // Reading along, no zone opens.
    if (untrack(reading)) {
      pendingPage = null;
      hfActive = null;
      return;
    }
    if (untrack(() => zoneHolder(target))) {
      pendingPage = null;
      refuse(target);
      hfActive = null;
      return;
    }
    if (hfEditor) destroyLive();

    editingPage = pendingPage ?? currentPage;
    pendingPage = null;
    liveZone = zone;
    // Which section and variant this edit session targets — fixed for its lifetime.
    const editingIndex = sectionOf(editingPage);
    const editingVariant = variantFor(editingPage, editingIndex);
    liveKey = `${editingIndex}:${editingVariant}`;
    liveId = `hf:${editingIndex}:${zoneKey(zone, editingVariant)}`;
    const ed = new Editor({
      element: mount,
      extensions: [
        ...zoneExtensions(zone === 'header' ? t().hf.headerPlaceholder : t().hf.footerPlaceholder, true),
        ZoneHistory.configure({ body: () => bodyEditor, id: liveId }),
      ],
      content: startingDoc(editingIndex, zone, editingVariant, editingPage) as Content,
      // No autofocus: its scrollIntoView nudges the page so the just-clicked zone
      // appears to jump. Focus the zone explicitly without scrolling instead.
      // Deferred: leaving a zone removes this DOM mid-render, and the blur ProseMirror
      // dispatches then would tick state while Svelte is still flushing.
      onTransaction: ({ editor }) => {
        placeZoneFrames(editor.view.dom as HTMLElement);
        queueMicrotask(() => hfTick++);
      },
      onUpdate: ({ editor }) => {
        writeZone(editingIndex, zoneKey(zone, editingVariant), editor.getJSON() as HfDoc);
      },
      editorProps: {
        // As in the body: a size-less box a foreign paste wraps blocks in is spilled back.
        transformPasted: (slice) => unwrapPastedBoxes(plainPastedSpaces(slice)),
        handleDOMEvents: { mousedown: readClickCaret },
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

  // Claimed while open, also when a session starts under it. Two who opened it at once
  // before either heard of the other: the higher client id gives way, its typing may go.
  $effect(() => {
    if (interactive) claimZone(hfEditor ? liveId : null, editingPage);
  });
  $effect(() => {
    if (interactive && hfEditor && yieldsZone(liveId)) hfActive = null;
  });
  let refused = $state('');
  let refusedTimer: ReturnType<typeof setTimeout> | undefined;
  function refuse(id: string) {
    refused = id;
    clearTimeout(refusedTimer);
    refusedTimer = setTimeout(() => (refused = ''), 1200);
  }

  // An undo or redo on the body's stack that reaches a zone puts that zone's content back,
  // in the open zone's editor too (off its own history, which only groups new edits).
  $effect(() => {
    const body = bodyEditor;
    if (!interactive || !body) return;
    const restore = ({ transaction }: { transaction: Transaction }) => {
      if (!isUndoRedo(transaction) && !transaction.getMeta(ZONE_SETTLED)) return;
      for (const step of transaction.steps) {
        if (!(step instanceof StateStep)) continue;
        const [kind, index, key] = step.id.split(':');
        if (kind !== 'hf' || Number(index) >= sets.length) continue;
        writeZone(Number(index), key as HfZoneKey, step.to as HfDoc);
        const ed = hfEditor;
        if (!ed || step.id !== liveId) continue;
        const at = ed.state.selection.from;
        ed.chain().setMeta('addToHistory', false).setMeta(RECORDING, true).setContent((step.to ?? emptyDoc()) as Content, { emitUpdate: false })
          .command(({ tr }) => { tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at, tr.doc.content.size)))); return true; })
          .run();
      }
    };
    body.on('transaction', restore);
    return () => body.off('transaction', restore);
  });

  // The review reaches every zone the pages show, open or not.
  $effect(() => {
    if (!interactive) return;
    const disconnect = connectZones({
      body: () => bodyEditor,
      list: () => sets.flatMap((s, i) => HF_ZONE_KEYS
        .filter((key) => (!key.endsWith('First') || s.differentFirstPage) && (!key.endsWith('Even') || s.differentOddEven))
        .map((key) => ({ id: `hf:${i}:${key}`, doc: s[key] }))),
      open: openZoneOf,
      live: () => (hfEditor ? liveId : null),
    });
    const body = bodyEditor;
    body?.on('update', repaint);
    untrack(repaint);
    return () => { body?.off('update', repaint); disconnect(); };
  });
  $effect(() => {
    void setSig;
    untrack(repaint);
  });

  // The first page that shows the zone, in the zone's editor.
  async function openZoneOf(id: string, ready: (editor: Editor) => void) {
    const [, section, key] = id.split(':');
    const index = Number(section), variant: HfVariant = key.endsWith('First') ? 'first' : key.endsWith('Even') ? 'even' : 'default';
    const page = Array.from({ length: numPages }, (_, i) => i + 1).find((p) => sectionOf(p) === index && variantFor(p, index) === variant);
    if (!page) return;
    if (!hfEditor || liveId !== id) {
      hfActive = null;
      await tick();
      startEdit(key.startsWith('header') ? 'header' : 'footer', page);
      await tick();
    }
    if (hfEditor) ready(hfEditor);
  }

  // The field texts the live zone last showed; a change in them is not a document change,
  // so nothing else tells its tab plugin that the advances it measured are stale.
  let liveFieldText = '';

  // Keep the live editor's own page-field spans showing the edited page / total.
  $effect(() => {
    void hfTick;
    void numPages;
    void editingPage;
    if (!liveMount) return;
    for (const el of Array.from(liveMount.querySelectorAll('[data-page-field]'))) {
      const kind = el.getAttribute('data-page-field');
      if (kind === 'chapter') el.textContent = chapterOn(chapterStarts, editingPage, Number(el.getAttribute('data-level')) || 1, hfActive ?? 'header');
      else el.textContent = kind === 'count' ? String(numPages) : pageLabel(editingPage);
    }
    const fieldText = Array.from(liveMount.querySelectorAll('[data-page-field]'), (el) => el.textContent).join('\u0001');
    if (fieldText !== liveFieldText) {
      liveFieldText = fieldText;
      // A wider number moves what a right tab stop aligns; without this the segment
      // keeps the advance of the old one and wraps the zone onto a second line.
      hfEditor?.view.dispatch(hfEditor.state.tr.setMeta(FORCE_PAGE_RECALC, true).setMeta('addToHistory', false));
    }
    // Content height (unscaled by the zoom transform) drives the active zone's frame.
    const tt = liveMount.querySelector('.tiptap') as HTMLElement | null;
    activeContentPx = tt ? tt.offsetHeight : 0;
    // A rendered trailing break adds one caret line past the real content; measure that
    // line height (the CSS var below shifts the editor down so it overflows the anchor).
    const last = tt?.lastElementChild;
    const p = last instanceof HTMLParagraphElement ? last : null;
    // Only past real content: in an empty zone that break is the caret line itself, and
    // discounting it would drop the placeholder a line below the anchored edge.
    const tb = p && p.childNodes.length > 1 ? (p.querySelector(':scope > br.ProseMirror-trailingBreak') as HTMLElement | null) : null;
    const lineH = p ? parseFloat(getComputedStyle(p).lineHeight) : 0;
    activeTrailingPx = tb && getComputedStyle(tb).display !== 'none' && Number.isFinite(lineH) ? lineH : 0;
  });

  function insertField(kind: 'pageNumber' | 'pageCount' | 'chapterField') {
    hfEditor?.chain().focus().insertContent({ type: kind }).run();
  }
</script>

<!-- Only the measuring pane runs it: every pane renders the same zones, and a second
     writer would just re-report the same heights. -->
<div class="hf-measure" aria-hidden="true" bind:this={measureRoot}>
  {#each sets as set, i}
    {#each HF_ZONE_KEYS as key}
      <div class="hf-zone hf-measure-box" use:pageDir={pageRtl} style="width: {contentWidthOf(sectionFirstPage(i))}px;{frameVars(frameOf(i, key), key.startsWith('header'))}">
        {#if setSig[i]?.[key]}
          <div use:staticZone={[`${i}:${key}`, set[key]]}></div>
        {/if}
      </div>
    {/each}
  {/each}
  {#each filledZones.list as f (f.key)}
    {@const sig = setSig[f.index]?.[f.zoneKey] ?? ''}
    <div
      class="hf-zone hf-measure-box"
      data-filled={f.key}
      use:pageDir={pageRtl}
      style="width: {contentWidthOf(f.page)}px;{frameVars(frameOf(f.index, f.zoneKey), f.zone === 'header')}"
      use:fillZone={[f.page, sig.includes('"pageCount"') ? numPages : 0, sources[f.id], sig.includes('"chapterField"') ? chapterStarts : null, f.zone, pageLabel(f.page), sourceVersion]}
    ></div>
  {/each}
</div>

<!-- Own layer below the body (z-index -1 against .paper's zoom stacking context), so a
     frame behind the text sits under it the way LibreOffice paints it: a second clone of
     the zone with only those frames showing, laid out exactly as the zone above it. -->
<div class="hf-bg-layer">
  {#each pages as p}
    {#each ['header', 'footer'] as const as zone}
      {@const { id, sig, bg } = zoneOf(zone, p)}
      {#if bg && !(interactive && hfActive === zone && editingPage === p)}
        {@const zb = zoneBox(zone, p)}
        <div
          class="hf-zone hf-zone-bg hf-{zone}"
          class:hf-clipped={clipOf(zone, p) !== null}
          style={boxStyle(zb) + pageVar(zb, p) + pageFrameVars(zone, p)}
          use:pageDir={pageRtl}
          use:fillZone={[p, sig.includes('"pageCount"') ? numPages : 0, sources[id], sig.includes('"chapterField"') ? chapterStarts : null, zone, pageLabel(p), sourceVersion]}
        ></div>
      {/if}
    {/each}
  {/each}
</div>

<div class="hf-layer">
  {#each pages as p}
    {#each ['header', 'footer'] as const as zone}
      {#if !(interactive && hfActive === zone && editingPage === p)}
        {@const { id, sig, bg } = zoneOf(zone, p)}
        {@const total = sig.includes('"pageCount"') ? numPages : 0}
        {@const chapters = sig.includes('"chapterField"') ? chapterStarts : null}
        {@const src = sig ? sources[id] : undefined}
        {@const zb = zoneBox(zone, p)}
        <div
          class="hf-zone hf-{zone}"
          class:hf-empty={!sig}
          class:hf-has-bg={bg}
          class:hf-clipped={clipOf(zone, p) !== null}
          data-hf-label={zone === 'header' ? t().hf.addHeaderHint : t().hf.addFooterHint}
          style={boxStyle(zb) + pageVar(zb, p) + pageFrameVars(zone, p) + (interactive ? hitVars(zone, p, zb) : '')}
          ondblclick={() => interactive && startEdit(zone, p)}
          role="button"
          tabindex="-1"
          use:pageDir={pageRtl}
          use:fillZone={[p, total, src, chapters, zone, pageLabel(p), sourceVersion]}
        ></div>
        {@const holder = zoneHolder(`hf:${id}`)}
        {#if holder}
          <div class="hf-tag hf-held ui-dir" class:hf-refused={refused === `hf:${id}`} style="top: {zb.top}px; left: {zb.left}px; --hf-held: {holder.color || 'var(--color-primary)'};">{t().hf.heldBy(nameIsland(holder.name))}</div>
        {/if}
      {/if}
    {/each}
  {/each}

  <!-- Where each zone another person holds is open, on their page, for a jump to it. -->
  {#each heldZones() as [zid, holder] (zid)}
    {@const kind = /:header/.test(zid) ? 'header' : 'footer'}
    <div class="hf-peer-mark" data-zone-peer={holder.id} style={boxStyle(zoneBox(kind, Math.min(holder.page, Math.max(1, numPages)))) + `--hf-held: ${holder.color || 'var(--color-primary)'};`}></div>
  {/each}

  {#if interactive && hfActive}
    {@const box = activeZoneBox(hfActive, editingPage)}
    {@const index = sectionOf(editingPage)}
    {@const variant = variantFor(editingPage, index)}
    <div class="hf-zone hf-{hfActive} hf-active" class:hf-clipped={clipOf(hfActive, editingPage) !== null} style={boxStyle(box) + pageVar(box, editingPage) + pageFrameVars(hfActive, editingPage) + ` --hf-tb-offset: ${-activeTrailingPx}px;`} use:pageDir={pageRtl} bind:this={liveMount}></div>
    <div class="hf-tag ui-dir" style="top: {box.top}px; left: {box.left}px;">
      {hfActive === 'header'
        ? (variant === 'first' ? t().hf.firstPageHeader : variant === 'even' ? t().hf.evenPageHeader : t().hf.headerLabel)
        : (variant === 'first' ? t().hf.firstPageFooter : variant === 'even' ? t().hf.evenPageFooter : t().hf.footerLabel)}{sets.length >
      1
        ? ` · ${t().hf.section} ${index + 1}`
        : ''}
    </div>
    <div class="hf-bar ui-dir" style="top: {box.top}px; left: {box.left + box.width}px;">
      <span class="hf-bar-label">{t().hf.insert}</span>
      <button class="hf-bar-btn" title={t().hf.pageNumberTitle} onmousedown={(e) => e.preventDefault()} onclick={() => insertField('pageNumber')}>{t().hf.pageNumber}</button>
      <button class="hf-bar-btn" data-cmd="hfPageCount" title={t().hf.pageCountTitle} onmousedown={(e) => e.preventDefault()} onclick={() => insertField('pageCount')}>{t().hf.pageCount}</button>
      <button class="hf-bar-btn" data-cmd="hfChapter" title={t().hf.chapterTitle} onmousedown={(e) => e.preventDefault()} onclick={() => insertField('chapterField')}>{t().hf.chapter}</button>
      <span class="hf-bar-sep"></span>
      <button class="hf-bar-btn hf-bar-done" data-cmd="closeHf" title={t().hf.doneTitle} onmousedown={(e) => e.preventDefault()} onclick={() => (hfActive = null)}>{t().hf.done}</button>
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
  /* The background clone shows the frames behind the text and nothing else; the zone
     above shows everything but them. The one being edited shows them all, on top. */
  .hf-zone-bg {
    pointer-events: none;
  }
  .hf-zone-bg::after {
    content: none;
  }
  .hf-zone-bg :global(*) {
    visibility: hidden;
  }
  .hf-zone-bg :global([data-wrap='through']:not([data-in-front])),
  .hf-zone-bg :global([data-wrap='through']:not([data-in-front]) *) {
    visibility: visible;
  }
  .hf-has-bg:not(.hf-active) :global([data-wrap='through']:not([data-in-front])) {
    visibility: hidden;
  }

  /* A frame placed against the page is placed from the zone box (its containing block,
     so neither the editor nor its paragraph may take a position of their own): its x in
     the text column, which is the zone's, and its y from the page top, which the zone
     sits --hf-page-y below. Out of the flow, it leaves the zone's height alone. */
  .hf-zone :global(.tiptap),
  .hf-zone :global(:is(p, h1, h2, h3, h4, h5, h6):has(> [data-page-y])) {
    position: static !important;
  }
  .hf-zone :global([data-page-y]) {
    margin: 0 !important;
    left: var(--page-x);
    top: calc(var(--page-y) - var(--hf-page-y, 0px));
  }
  .hf-zone :global([data-from-body]) {
    top: calc(var(--hf-body-y, 0px) + var(--page-y) - var(--hf-page-y, 0px));
  }
  /* A frame's gap below it makes the zone no taller (measured: a footer rule with a
     2.5mm gap cost a long report three pages against LibreOffice). */
  .hf-zone :global([data-wrap]) {
    margin-bottom: 0 !important;
  }

  .hf-measure {
    position: absolute;
    top: 0;
    left: -10000px;
    visibility: hidden;
    pointer-events: none;
  }
  .hf-measure .hf-zone {
    position: static;
    height: auto;
  }
  /* The space above a footer's first block carries the zone's own gap to the body
     (import/odt.ts), so it is measured (.hf-measure) but not drawn: drawn, it would
     push the text off the page. */
  .hf-footer:not([style*='--hf-frame-pad']) :global(.tiptap > :first-child) {
    --space-before: 0 !important;
  }

  .hf-zone {
    position: absolute;
    display: flex;
    flex-direction: column;
    pointer-events: auto;
    /* Content taller than the margin band spills into the margin (footer up, header
       down) — the zone auto-grows; the anchored edge stays put. */
    overflow: visible;
    --font-west: 'Liberation Serif', 'Times New Roman';
    --font-tail: var(--font-serif);
    font-family: var(--font-west), var(--font-asian, var(--font-tail)), var(--font-tail);
    font-size: 12pt;
    color: var(--color-page-text);
    cursor: text;
  }

  .hf-header {
    justify-content: flex-start;
  }
  /* A zone past its share of the page shows its start and cuts the rest, as LibreOffice
     does; the edited one scrolls instead, so the caret stays in view. */
  .hf-zone.hf-clipped {
    justify-content: flex-start;
    overflow: clip;
  }
  .hf-active.hf-clipped {
    overflow-y: auto;
  }
  .hf-footer {
    justify-content: flex-end;
  }

  /* The margin band around the zone, double-clickable like the zone itself. Not on the
     edited zone, where it would swallow the clicks into the live editor. */
  .hf-zone:not(.hf-active)::after {
    content: '';
    position: absolute;
    top: var(--hit-top, 0);
    bottom: var(--hit-bottom, 0);
    left: var(--hit-left, 0);
    right: var(--hit-right, 0);
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

  .hf-held {
    background: var(--hf-held);
  }

  .hf-refused {
    animation: hf-refused 0.4s ease-in-out 2;
  }

  @keyframes hf-refused {
    50% { transform: translateY(calc(-100% - 2px)) scale(1.15); }
  }

  .hf-peer-mark { position: absolute; pointer-events: none; border-radius: 2px; }
  :global(.hf-peer-mark.collab-flash) { animation: collab-flash 1.6s ease-out; }

  @media print {
    .hf-held, .hf-peer-mark { display: none; }
  }

  /* A zone's editor (live, source or clone) is a `.tiptap`, so it takes the body's block
     rules; the root's own page rules (96px padding, 1123px min-height, page gradient)
     are reset here — higher specificity, plus !important for the gradient. */
  .hf-zone :global(.tiptap) {
    padding: 0;
    min-height: 0;
    width: 100%;
    background: none !important;
    box-shadow: none;
    /* The zone's own size, which follows the document's default style — not the 12pt
       `.paper .tiptap` puts on the body. */
    font-size: inherit;
    line-height: 1.15;
    outline: none;
    /* Keep the editable root at its content height (min-height:0 would otherwise let
       the flex column shrink it to the band, hiding lines and misreporting height). */
    flex-shrink: 0;
    /* Drop the editor by the trailing-break line so the caret line overflows past the
       anchored edge while the real content stays put (set per active zone). */
    margin-bottom: calc(var(--hf-tb-offset, 0px) + var(--hf-frame-gap-b, 0px));
    /* A framed area (frameVars); unframed, each variable falls back to nothing. */
    margin-top: var(--hf-frame-gap-t, 0px);
    border-top: var(--hf-frame-bt, none);
    border-right: var(--hf-frame-br, none);
    border-bottom: var(--hf-frame-bb, none);
    border-left: var(--hf-frame-bl, none);
    box-sizing: border-box;
  }
  .hf-zone[style*='--hf-frame-pad'] :global(.tiptap) {
    padding: var(--hf-frame-pad);
    background: var(--hf-frame-bg, none) !important;
    min-height: var(--hf-frame-min, 0px);
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
