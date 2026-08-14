# Pagination

Covers `src/lib/editor/extensions/pageBreaks.ts`, `columns.ts` and `columnsFlow.ts`, plus the
page geometry they share with `components/Editor.svelte` and `styles/editor.css`.

## Page break system (`pageBreaks.ts`)

A custom ProseMirror plugin that simulates paginated A4 layout entirely in CSS/DOM — no `<iframe>`, no actual page breaks in the document model. On every document change it:

1. Measures each top-level block's natural `offsetTop`/height (excluding existing spacers).
2. Calculates whether a block would overflow a page's content area.
3. Injects invisible `div[data-page-break-spacer]` widget decorations before blocks that need to move to the next page. A spacer inside a table is emitted as a borderless `<tr>` instead of a `<div>` (`spacerKind: 'table-row'`).
4. Sets `minHeight` on the `.tiptap` element so the visual page slots always exist.
5. Fires a `pm-pagecount` CustomEvent (bubbles to `Editor.svelte`) carrying `numPages`, `docHeight`, and `tableBreakBands`.

**Mirrored margins** ride the same per-block inset as a section's own side margins: `.tiptap`'s padding draws the odd page's pair, so a leaf landing on an even page is inset by `--user-margin-mirror` (right − left) one way and the other (`storage/pageMargins.ts`), and the header/footer band moves with it in `HeaderFooterLayer.svelte`. A block straddling a page boundary takes the inset of the page it starts on, as a section's own margins already do.

**Widow-orphan control:** `findLineSplit` picks the first line that overflows the page, then applies Word's/LibreOffice's rule (`MIN_KEPT_LINES` = 2, on by default in both via OOXML `w:widowControl`, so not configurable): fewer than two lines carrying over pulls one more down with them, and fewer than two staying behind cancels the split so the caller pushes the whole block. A leaf taller than one page slot passes `minLines: 1` — there the rule can't be satisfied and splitting beats overflowing.

**Images in a paragraph:** an as-character image is a line box like any other (`getLineRects`
measures `.image-node` alongside the text runs, and text sharing its line groups into it), so a
paragraph of stacked images breaks between them instead of overflowing the page. Only a *floated*
image keeps its paragraph atomic — a line-split spacer beside a float is dropped by ProseMirror.
A float hangs out of its paragraph's box, so the leaf's height reaches down to the lowest float
instead of stopping at `offsetHeight` — otherwise the paragraph measures as one text line and the
image walks off the page bottom. Text still wraps beside the float; only the push moves as a unit.
What the model can't see is how far that overhang moves the blocks *below* it: further than the
spacer it accounts for, so two layouts can each imply the other. `prevPlacementsKey` catches that
ping-pong and keeps the current layout; only an edit or a forced recalc forgets it (the TOC
rewrites its page numbers on every `pm-pagecount`, so resetting on any document change would
leave nothing to catch).

**Keeping blocks together** (`pageBreak.ts` attrs, both read from the direct property *and* the paragraph style): `keepNext` (`w:keepNext`, `fo:keep-with-next`) moves a block down when the successor's first `MIN_KEPT_LINES` no longer fit below it — one line is not enough, because widow-orphan control would carry the second one over and strand the block anyway (measured on the Math Guide: a heading left alone at the foot of page 8) — headings do that in Word and LibreOffice anyway, so the attr only marks the others. `keepLines` (`w:keepLines`, `fo:keep-together`) makes an otherwise splittable block paginate atomically, unless it is taller than the page slot, where Word splits it too. A table's `keepRows` (ODF `style:may-break-between-rows="false"`, no Word equivalent) is the same rule for a table: pageBreaks emits one atomic leaf for the whole wrapper instead of one per row, so a table with no room left moves whole (probed: LibreOffice leaves four lines of the page empty rather than break it, and splits the identical table when the attribute says `true`).

**Line breaking:** `editor.css` overrides prosemirror-view's `white-space: break-spaces` back to `pre-wrap` on `.paper .tiptap`. Under `break-spaces` a line-end space may not hang into the margin and counts toward the line width, so lines break one word earlier than in Word/LibreOffice whenever a line reaches within a space width of the margin.

**A block's spacing is part of the block.** LibreOffice's paragraph frame includes the space
below it, so the fit test adds `leaf.spaceAfter` (and keep-with-next adds the successor's space
above too): a block whose text fits but whose spacing doesn't moves down whole. The **space
above** is then dropped at the page top, as LibreOffice does (probed: an automatic *and* a hard
break at a page top swallow it, the document's first block keeps it). `pageBreaks.ts` marks those
blocks with a `padding-top:0;margin-top:0` node decoration — geometrically, a leaf pushed by its
own spacer never measures as sitting at the page top, since `effectiveTop` excludes that push, so
the mark follows from the break it got. The value itself rides `--space-before`
(`storage/spacingModel.ts`).

**A pass must not read its own last answer.** Dropping that space shortens the block, which moves
everything below it, which changes what sits at the *next* page top — so measuring the decorated
DOM made the two layouts imply each other, and `prevPlacementsKey` froze whichever came first: the
same document opened at 59 or 65 pages from one load to the next. `collectLeaves` adds the dropped
space back (`spaceAbove`, and a running `cumulativeDropped` for the leaves below), so what it
measures is the document; the placement loop then takes the drop off `cumulativeShift` itself. The
rule is general — anything the pass decides has to be reconstructed out of the next pass's input.
Every leaf is therefore born through `naturalTopOf`: four of the six push sites (index, text box,
columns fragment, table row) once subtracted the spacers but not the dropped space, and a figure
frame below a chapter heading landed 16mm down its page.

**A justified line fits more in LibreOffice than in a browser:** LibreOffice compresses the
inter-word spaces to squeeze one more word onto a justified line, CSS `text-align: justify` only
stretches them. Measured on `02-blocks`: LO fits a trailing "et" that needs ~5mm of compression
across 15 spaces. Nothing in CSS expresses that, so a justified paragraph may break one word
earlier here; the same paragraph left-aligned matches LibreOffice to 0.1mm.

**Per-section page margins.** Word's `w:pgMar` and ODF's page layout belong to the section,
not the document, so each section's `HfSet` carries its own `margins` (and `marginsFirst`
where an ODF master hands over to another with `style:next-style-name` — that layout governs
the section's first page, the successor's the rest). `Editor.svelte` publishes them as
`--pb-section-reach` (already the per-page content area) and `--pb-section-inset`
("leftFirst|rightFirst|leftRest|rightRest" px against the document's own side margins).
Vertically a spacer can only push down, so a section whose top margin is *smaller* than the
document's gets a **lifting** spacer — height 0 and a negative `margin-top` — on its first
block, and only where nothing was pushed onto that page ahead of it; `collectLeaves` counts
that margin into `cumulativeSpacerHeight` or the next pass measures its own answer.
Horizontally `.tiptap`'s padding draws one pair for every page, so the difference becomes a
`--sec-inset-left`/`-right` node decoration on the section's top-level blocks, added in by
everything that writes a block margin (`editor.css`, `indent.ts`, `styleSheet.ts`,
`tableView.ts`) and cleared on descendants so a nested indent can't count it twice. The page
a block lands on is read *after* its own spacer, so a forced break onto the section's second
page takes the "rest" pair. Not carried: the ruler and a frame's `COLUMN_WIDTH_CSS` stay document-wide.

**Per-section paper.** A section's own format/orientation (`HfSet.format`/`.orientation`,
null = the document's) makes the pages differ in size, which a repeating background
cannot express — so the page grid is a **`PageGrid`** of height runs ("every page from
here on is this tall") instead of one cycle, and the sheets are one box per page
(`PageSheetLayer`). `placeLeaves` builds its own grid as each section's first page
becomes known, so a pass never measures its own last answer; it reports the runs, and
`Editor.svelte` publishes them as `--pb-page-runs` for every other consumer (the TOC, a
cross-reference, a page-anchored frame) plus `--pb-section-page` for the next pass.
`.paper` reserves the **widest** section's paper (`--pb-paper-width`) or a landscape page
would be cut at the sheet edge, and a narrower section takes the difference as an extra
right inset on top of its own margins. The sheets are left-aligned in that box, where
both word processors centre each page.

**Tables across page breaks:** when a single continuous table box crosses a page boundary, the plugin reports `TableBreakBand`s (doc-px geometry). `Editor.svelte` renders an overlay (`.band-layer` inside `.paper`) that masks the table borders bleeding through the page margins and paints the dark page gap as one seam-free stripe.

A break *between rows* instead closes the table on both sides of the gap: collapsed borders paint a shared edge only once, so the spacer `<tr>` would leave one fragment open. `splitLines` (`pageBreaks.ts`) resolves what LibreOffice draws there — the row separator the break falls on, or, where the rows carry none, the table's own box (probed: its **top** border closes the fragment, its **bottom** border opens the continuation) — and the spacer cell renders it as two absolutely positioned lines. Out of flow deliberately: a collapsed border on the spacer itself moves every row below it down by half its width.

**Layout constants** (must stay in sync between `pageBreaks.ts`, `Editor.svelte`, and `editor.css`):
- `PAGE_HEIGHT = 1123px` (A4 portrait), `PAGE_GAP = 20px`, `CYCLE = PAGE_HEIGHT + PAGE_GAP = 1143px`.
- Page height/width and margins are read **live** from CSS custom properties (`--user-page-height`, `--user-page-width`, `--user-margin-*`) so orientation/margin changes don't require new constants. `getCycle()` in `Editor.svelte` reads `--user-page-height` at runtime.
- A margin/orientation change dispatches an empty `FORCE_PAGE_RECALC` meta-transaction (deferred via `requestAnimationFrame`, outside the Svelte effect flush, to avoid re-entrant binding updates) to trigger a re-paginate.

## Multi-column sections (`columns.ts` + `columnsFlow.ts`)

- **`columns.ts`** (`Columns`) + **`columnsFlow.ts`** (`ColumnsFlow`) — multi-column (newspaper) layout with **cross-page flow** and **Word's sequential fill order**: column 1 fills to the page bottom, then column 2, then the next page — via per-fragment node decorations carrying `height:…;column-fill:auto` (full page slot for fragments with a continuation; content height + `OPEN_HEIGHT_SLACK_PX` for the open last fragment of a document-final chain, so typing grows column 1 first without one-frame flashes into column 2). A chain followed by real content keeps its last fragment undecorated → CSS `column-fill: balance` (Word balances the end of a continuous section). Because the box height is the plugin's own decoration, overflow/join decisions use content-based estimates (`contentHeightPx` = block rects + collapsed margins), not the rendered height. A section is a block region (`content: '(paragraph|heading|bulletList|orderedList)+'`) rendered as CSS multi-column (`column-count`/`column-gap` inline via `renderHTML`; no NodeView, no visual affordance — it must read as plain flowing text, so NOT isolating/selectable: selection, Backspace, and joins cross its boundary). Attrs: `count` (2–3) and `gapCm` (default `DEFAULT_COLUMN_GAP_CM` 0.5, clamp 0–5). Own group like textBox (Document is `'(block | textBox | columns)+'`). **Chain model:** the document may hold a section as several *adjacent equal-attr fragments* — the user-visible section is the maximal run (`columnsChain`); commands, export, and import all treat a chain as one section. **Cross-page flow (`columnsFlow.ts`):** a rAF layout pass (mirroring pageBreaks' geometry via the exported `readVerticalMargins`) keeps the fragmentation in sync with the page grid — an overflowing fragment is **split** at a block boundary so the maximal prefix fills its page (balanced-height estimate = Σ block `getClientRects` heights / count), and a fragment with room **joins** the adjacent continuation back (the split pass then re-splits at the right point). One op per pass, `addToHistory: false` (layout-only; undo of user edits just re-flows), composition-guarded, pass-budgeted (`MAX_FLOW_PASSES`, reset per external change). **pageBreaks.ts cooperation:** a `.columns-node` leaf carries `columnsFragment` (block count + first-block fit estimate); on bottom overflow pageBreaks *waits for the flow* when the fragment is splittable and its first block fits the remaining space, pushes it whole when mid-page (even taller-than-page), and at a page top does nothing (`columns-line-split-pending` — pushing a page-tall fragment just moves the problem down forever). Both sides use the shared `COLUMNS_FIT_MARGIN_PX` for the first-block fit test — differing thresholds make split/push/join cycle at the boundary; the flow's join `HYSTERESIS_PX` must exceed the estimate error for the same reason. The **overflow** test carries the same kind of headroom (`SAFETY_PX`): the estimate averages the flow over the columns, but a decorated column ends on a whole line, so a fragment measuring exactly its slot spills once the decoration pins the height — without it the flow reads its own last answer, measuring "fits" undecorated and "overflows" decorated forever. Every split or join therefore also clears the decoration cache key (`dispatchFlow`): ProseMirror drops node decorations whose node was replaced, and a stale key leaves the fragment at its balanced height instead of its page slot. **Page boundaries cut mid-paragraph at line boundaries** (`splitParagraphInBlock`): the flow measures a paragraph's rendered lines (`groupLines` — document-order rects banded by *overlap*: a rect joins the line it overlaps by half the taller of the two, so a raised run like a verse number is no line of its own and no outsized rect swallows the line below it), converts the page's leftover content budget into a line count by summing the **real** top-to-top advances (`linesWithin` — a line carrying a raised run is taller than the rest, so one median advance for all of them runs ~15% short; the median stands in only where the tops reset at a column break), finds the boundary text position by probing **both** edges of the line's first rect and keeping the earlier position (`lineStartPos` — on a right-to-left line the logical start is the right edge, and `left + 1` alone keeps a word too many, which costs one split pass per line), and does a depth-2 `tr.split` whose second part carries the layout-internal **`joinPrev`** paragraph attr (a global attr minted by the Columns extension; never rendered/parsed, `keepOnSplit: false`). Used in two places: a paragraph taller than the whole page slot (`force` — at least one line stays), and the **boundary block** after `k` whole blocks fit (leftover room ≥ `MIN_TAIL_LINES` — so the last column of a page is filled instead of pushing the next paragraph out whole); the join side mirrors it by pulling a multi-line paragraph head at ~two line rows of room (partial pull; the re-split hands the excess back). A live per-fragment analysis is exposed via `getColumnsFlowDebug` and included in the dev Debug dump (`columnsFlow` key). pageBreaks skips the empty trailing paragraph after a document-final chain (`trailing-empty-after-columns`) so a sequential-fill box reaching the page bottom doesn't mint a phantom page. Joins reverse it: a fragment join uses depth 2 when the continuation head is a joinPrev paragraph (needing only ~one line row of space), and a stray joinPrev paragraph *inside* a fragment merges into its predecessor immediately. `mergeJoinedBlocks` (columns.ts) restores whole paragraphs on unwrap/absorb; `mergeJoinedParagraphsJson` (export/odt.ts, shared with docx.ts) does the same before serializing, so files always hold the original single paragraph. Commands: `setColumns(n)` — inside a section 1 unwraps the whole chain / 2–3 update it; outside with a selection, 2–3 wrap the covered top-level blocks (absorbing existing sections; fail on tables/boxes/TOCs); with a **bare cursor, the whole document** gets columns (Word behavior; wrappable runs around tables become one section each) — and `setColumnGap(g)` (chain-wide); helper `findColumns`. UI: a Columns dropdown in `ToolbarExpanded.svelte` (1/2/3 buttons + gap input, tick-derived active state). `trailingNode.ts` appends a paragraph after a trailing section. **ODF**: exported via the textBox-style sentinel hoist (`replaceColumns`/`applyColumns`, U+E009) as `<text:section>` + a minted section style with `<style:columns fo:column-count fo:column-gap>` — adjacent equal-attr fragments **coalesce into one section**; import resolves via `StyleResolver.sectionColumns` (gap also derived from per-`style:column` indents), wraps runs of allowed blocks (`pushColumnRuns`), moves tables/boxes out with a warning (columns nodes from inner sections pass through silently), clamps >3 columns (the flow re-fragments after load); Word-style **page-layout columns** (`<style:columns>` in `style:page-layout-properties`, no `text:section`) are read via `StyleResolver.pageColumns` and wrap the whole body the same way. **DOCX**: full support — export splits the body into multiple `docx`-lib sections (`bodyGroups`; continuous breaks, `w:cols` with gap in twips, page geometry + fresh header/footer refs per sectPr, fragments coalesced); import groups body children on mid-body `pPr>sectPr` paragraphs (`splitBodySections`, empty markers dropped) and wraps groups whose sectPr has `w:cols w:num>1` — covering whole-document multi-column files via the body-final sectPr. A section whose own `w:type` is a page-starting break (nextPage/oddPage/evenPage, or absent = the default; `sectionStartsNewPage`, not `continuous`/`nextColumn`) tags its first block with `breakBefore:'page'` so the section starts on a new page like Word.
