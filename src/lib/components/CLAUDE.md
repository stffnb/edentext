# `src/lib/components/`

All Svelte UI. `Editor.svelte` mounts TipTap and owns pagination wiring, zoom, the floating
toolbars and the header/footer layer.

Two chromes sit above the document and `chromeMode` (`storage/theme.ts`) picks which mounts:
the floating command island below, or `ribbon/` — see `docs/architecture/ribbon.md`. Both drive
the same editor through `activeEditor`/`activeTick`, and only one is mounted at a time.

## Data flow

```
App.svelte                    – owns app-level state (theme, zoom, margins, orientation,
 │                              toolbar-expanded, formatting-marks); persists each to localStorage
 ├─ Toolbar.svelte            – primary formatting buttons (bold/italic/underline, style gallery,
 │                              lists, undo/redo); reads editor state via `tick` counter.
 │                              The style gallery lists the document's named paragraph styles
 │                              (see below); picking one only assigns it.
 ├─ ToolbarExpanded.svelte    – secondary toolbar (toggled): font family + detection, font size,
 │                              font/highlight color (ColorPicker), sub/superscript, increase/decrease
 │                              indent, formatting marks, table insert (TablePicker); right-aligned
 │                              (CSS `order`): line/paragraph spacing + the Layout panel (margins +
 │                              orientation)
 ├─ Editor.svelte             – mounts TipTap, wires autosave, zoom (CSS transform), page-count
 │    │                         events, the floating TableToolbar, and the table page-break overlay
 │    ├─ extensions.ts        – the full TipTap extension list (built-ins + custom ones below)
 │    ├─ Ruler.svelte         – horizontal ruler above the page: the cursor's paragraph's
 │    │                         tab stops (click to add, drag to move, drag off to remove; a
 │    │                         type selector cycles left/centre/right/decimal) and its indent
 │    │                         markers (first line, left and right, via setIndent/setIndentRight/setIndentFirst). Sticky
 │    │                         inside .editor, so it clears the toolbar island and scrolls
 │    │                         horizontally with the page; positions are scaled by zoom while the
 │    │                         chrome keeps its size. Toggled in ToolbarExpanded (edentext-ruler).
 │    └─ TableToolbar.svelte  – floating row/column/table actions, shown above the active table
 └─ footer statusbar          – "Page X of Y" + zoom controls (20–300%)
```

`Editor.svelte` exposes `editor`, `tick`, `currentPage`, and `numPages` as bindable props to `App.svelte`, and takes `zoom`, `showFormattingMarks`, `pageMargins`, and `orientation` as inputs. `tick` is incremented on every TipTap transaction; toolbar components use `$derived(tick >= 0 && ...)` to re-evaluate `isActive`/value checks reactively without subscribing to ProseMirror directly.

## The settle gate (`Editor.svelte`)

A pagination pass measures the DOM the previous one changed, so a freshly opened document
re-flows a few times before it holds still — a columns chain longest (measured: 12 layouts
over 550ms). `.paper.settling` hides the page's contents (`visibility`, so every pass still
measures the same boxes) until `layoutSignature()` repeats twice or `SETTLE_CAP_MS` passes;
the reader gets one layout instead of the search for it. It re-arms on the `documentEpoch`
prop, which `App.svelte` bumps per document it opens — never on an edit. The signature samples
at most `SETTLE_SAMPLES` blocks: reading every one each frame starves the layout it waits for
(the 458-page guide then never settled at all).

## Split view (`Editor.svelte`)

Word's View ▸ Split (`Mod-Alt-s`, its own key): the pane column holds one `.editor`
scroller per pane, both rendered from the same `{#snippet pane(i)}`, so every layer and
the whole floating chrome exist per pane. The split is **horizontal only** — the panes are
the same width, which is what lets the second one render the first one's pagination.

- The second pane is a raw `EditorView` on the editor's own state (`...ed.view.props`,
  `dispatchTransaction` routed to `ed.view`), mirrored by `secondView.updateState` in
  `onTransaction`, and given the `tiptap` class + `dom.editor` back-reference TipTap puts
  on its own. Only its `min-height` is set here — the pagination pass writes that on the
  view it measures.
- **One view measures.** `isSplitPane` (pageBreaks.ts) marks the second pane's host, and
  `pageBreaks`/`columnsFlow`/`tabStops` return an empty plugin view for it; their
  decorations are shared state, so a second pass would fight the first over them.
- **A widget decoration must build its DOM in a function.** Two views render the same
  decoration set, and one element can only sit in one document — passing a node makes each
  view take it back from the other, forever. Fixed at all four sites (the page-break
  spacers, both table resize handles, the word-completion offer).
- `activePane` is set by a pointerdown on a pane and is what every coordinate here reads
  (`paneScroller`, `paneView`). A focus arriving at the *other* pane is handed back to it —
  a toolbar command focuses the editor's own view, which is pane 0. Each pane's
  `handleScrollToSelection` suppresses scrolling while it is not the active one, or every
  keystroke would drag the other pane to the caret.
- The divider drags (`splitRatio`); only the on/off flag is persisted
  (`edentext-split`), as neither word processor restores a split's position either.

## The page grid (`Editor.svelte`)

LibreOffice's View layout ▸ Columns and Word's Multiple Pages — neither stops at two,
so `pageColumns` runs 1–`MAX_PAGE_COLUMNS`. Rows of `gridCols` pages filled left to
right, scrolling as one canvas, every page editable. Only one pane layout is on at a
time: the buttons in both chromes clear the other, and `gridCols` is 1 while split.

**A cell is a window of one page onto its own view.** A pane can only show a
*contiguous* slice of the document, and a grid column is not one (pages 1, 3, 5 with
two columns) — so the pane is a cell, not a column: `.page-cell` clips to one page and
the `.paper` inside is offset to that page's box. **Two rows** of cells exist, because
a scroll shows the foot of one row above the head of the next; the two slots take turns
being the upper row (`rowOfSlot`), so scrolling only re-aims the views it already has.
Pane index = `slot * gridCols + column`. Cost: `gridCols × 2` live views, each holding
the whole document's DOM — measured at ~94k nodes and ~16ms per keystroke *per view* on
a 177-page document. Word and LibreOffice draw only the visible pages; we can't.

- **One scroller** (`scrollers[0]`) carries the canvas, so every floating layer keeps
  measuring against the one scroll space it is positioned in. `readFirstRow` turns its
  scrollTop into the top row; `scrollGridToPage` is the reverse and writes `firstRow`
  itself, since the caller reads the cells back in the same tick.
- **The caret must be drawn by the cell that shows its page** (`followCaret`): only the
  focused view draws one, and every other cell clips that page away. It scrolls the row
  into view first if the caret left the screen.
- **The zoom fits a whole row** on a change of count (`fitPagesZoom`, `utils/zoom.ts`),
  as both word processors re-zoom for this view. Leaving it keeps that zoom.
- **A pane may only dispatch what the user did in it** (doc, selection or stored-marks
  change). A plugin that derives state from its own viewport — TipTap's placeholder
  does — otherwise has every pane fighting the others over it, one transaction each,
  forever; with one shared scroller that loop never settles.
- The editor's own view **moves** to pane 0's new host when the layout changes
  (`$effect` on `hosts[0]`), rather than being rebuilt from the document.
- `min-width: 0` on the row and its scroller, in every mode: a flex item's automatic
  minimum is its content, so without it a canvas wider than the window — the grid, or a
  page beside the balloon strip — widens the app and the toolbar ends short of it.
- No ruler here: it would repeat per column and eat into the page's own box.
- **`sectionPaper` stays unrounded.** `pageBreaks` builds its grid from the height this
  publishes as `--pb-section-page`, so rounding A4's 1122.52px to 1123 ran every page
  0.127mm long — 6mm of drift by page 48, against a reference page that never moves.

## Zoom (`Editor.svelte`)

Zoom is a CSS `transform: scale()` on `.paper` (layout and pagination always run at 100%, so they stay stable across zoom — this replaced an earlier CSS `zoom` approach that re-ran layout at every scale). A transform reserves no layout space, so `.paper-scaler` reserves the scaled footprint to drive scrollbars and horizontal centering — it's sized in the `$effect.pre`, so it reaches the DOM in the same flush as the transform and the anchor pass below measures the right geometry. The applied zoom is throttled to one DOM write per animation frame. Range 20–300% (`MIN_ZOOM`/`MAX_ZOOM`/`clampZoom` in `utils/zoom.ts`), persisted in `localStorage['edentext-zoom']`.

`zoom` lives in `App.svelte`; `setZoom` is the only writer (clamps + persists) and reaches `Editor.svelte` as the `onZoom` prop, so a gesture there routes back through it and the status-bar slider follows for free. Inputs beyond the slider:

- **Ctrl+wheel** (`onWheel` on `.editor`) — a touchpad two-finger zoom fires exactly this event, so one handler covers both it and a Ctrl+mouse-wheel. `preventDefault` keeps the *browser* from scaling the whole app UI. `wheelZoomFactor` (`utils/zoom.ts`) turns the delta into a multiplicative factor — normalizing Firefox's line-mode deltas and capping one mouse notch — so a step feels the same at 30% as at 250%. Its sensitivity and cap are gesture-feel tuning knobs.
- **Ctrl `+`/`-`/`0`** — in `App.svelte`'s global keydown, ±10% / reset, suppressing the browser's own zoom keys.

Both anchors differ: a wheel zoom holds the **point under the cursor** fixed (`pendingAnchor` in client coords → doc space in the `$effect.pre`, both axes corrected via `scrollLeft`/`scrollTop` in the post-effect); slider, buttons and keyboard have no pointer and fall back to the top-of-viewport anchor. Touchscreen pinch is **not** handled — real touches fire no wheel event.

## Headers & footers (`HeaderFooterLayer.svelte`, `storage/headerFooter.ts`)

One header and one footer (`HfDoc` = a single-paragraph TipTap doc per zone, persisted to `edentext-header`/`-footer`), repeated on every page. Double-clicking a page margin — or the Layout-panel "Edit header/footer" buttons — opens the zone for editing; clicking back into the body (`onFocus`) or Escape ends it. The edge→zone distance (header from top, footer from bottom) is user-configurable in cm via the Layout panel (`HfDistances`, persisted to `edentext-hf-distances`, default `HF_DISTANCE_CM` 1.27cm, clamped 0–10 and below the body margin). A **section** can have its own (`HfSet.distances`, `distancesFirst` where its page style hands over): ODF's page-layout margin *is* that distance, Word's is `w:pgMar w:header/w:footer`, and an index whose header starts 4cm down is not the body's 1.25 — `zoneBox` and `sectionReach` both read the section's.
- **Fields:** the bar beside the active zone inserts the `pageField.ts` atoms — page number, page count, chapter (the running head, level 1). Each is patched per page, so the same zone shows a different value on every page.
- **Rendering:** the zone's own font is the document's **default paragraph style** (`styleCss` gives `.paper .hf-layer .hf-zone` its text half): both formats base the Header/Footer style on it, so a file whose body is Arial 10pt has an Arial footer, not the editor's serif. `HeaderFooterLayer.svelte` mounts inside the scaled `.paper` (like `.band-layer`), positioning per-page zone boxes in unscaled doc px. A zone's out-of-flow frame (`wrap` ≠ inline) is hidden in the box and painted per page by `.hf-bg-layer` at `z-index: -1` — hence `.paper`, not `.tiptap`, paints the page surface, so the image lands between the sheet and the body text. Inactive zones render as static HTML (`generateHTML` + `hfExtensions`); the active zone hosts the single live TipTap editor. `App.svelte`'s `activeEditor`/`activeTick` route the top toolbars to `hfEditor` while a zone is active, so all body formatting works on the header/footer with no toolbar changes.

## Comments (`CommentsPane.svelte`)

Word's Reviewing Pane, docked beside the scroller (`.editor-row` in `App.svelte`): the
list view a comment goes to instead of the margin balloon below — one control picks the
place (`storage/markup`), so no comment is in both at once. It lists `visibleComments` in
document order — click a card to select the
annotated range, answer it in the reply box, and edit / resolve / remove behind the card's
**⋯** button (`CommentCard.svelte`, shared with the balloon). That menu is **in the flow**,
not floating: the balloon clips what leaves it, so a popover would be cut off there. Only
the answer box is a command a card shows outright — it is the one used most, and three
buttons in a row cost a balloon two lines. `App.svelte` owns the New-comment prompt, which
both the Review tab and the context menu (`OPEN_COMMENT_EVENT`) fire; the author comes
from the document properties. The card of the comment the selection lies within (`commentIdAt`)
is marked and scrolled into view, the pane half of the pairing `pm-comment-active`,
`ChangeBarLayer` and `ConnectorLayer` draw on the text.

## Revisions (`RevisionsPane.svelte`)

The reviewing pane both word processors list revisions in, docked beside `CommentsPane`
and built the same way: one row per change **id** (a paragraph boundary splits one change
into several ranges), in the author's own colour, click to select the text, accept or
reject in place through `acceptRevision`/`rejectRevision`. The Review tab's Show-changes
button picks between this list and the balloons; the pane is not a second view of them.
The row of the change the selection lies within (`revisionIdAt`) is marked with an inset accent in the
author's colour — the same colour its margin bar takes — and scrolled into view.

## AutoText (`AutoTextDialog.svelte`, `editor/extensions/autoText.ts`)

LibreOffice's Tools ▸ AutoText, reachable where Word puts it too (the ribbon's Insert ▸
Text group, the modern chrome's Tools menu): the library, a click to insert, and "new
from selection" — the selected slice's nodes as JSON. `hasSelection` is derived off
`open` because the dialog stays mounted and a modal freezes the selection it opened on.

## Synonyms (`ThesaurusDialog.svelte`, `spell/thesaurus.ts`)

LibreOffice's Tools ▸ Thesaurus (Ctrl+F7), reachable where Word puts it too (the ribbon's
Review ▸ Proofing) and from the context menu: the word at the caret (`wordRangeAt`), the
groups it appears in, click one to replace it. The box above looks up any other word,
which is how both dialogs follow a chain.

**Named "Synonyms", not "Thesaurus"** — the one place the label deviates from both
products. The word of art names the tool without saying what it does; it stays in the
tooltip (`thesaurus.hint`) so anyone looking for it still finds it. The i18n keys and
the code keep the technical name.

- The data is `public/thesaurus/<code>/<code>.txt`, one `;`-separated group per line,
  generated from LibreOffice's own MyThes files by `scripts/make-thesaurus.mjs` — de 3.0MB
  / 37k groups, en 6.7MB / 143k groups. MyThes repeats every group once per member, ten
  times the bytes for the same content.
- **Scanned, not indexed**: a regex over the whole file is ~4ms, which a lookup started by
  a menu click can spend, where a word→group index costs ~100MB of memory against the ~8MB
  the text itself holds (both measured).
- Loaded on first use, for the document's spell language only, and kept by the service
  worker from then on — like a dictionary, and missing data disables the feature, not the app.
- The groups come back ordered by where the word sits in each: a group leads with its main
  form, which is the sense LibreOffice lists first as well.
- **The language is shown and switchable** (both dialogs have that box): a lookup asks one
  language, and a German word in an English document otherwise just finds nothing with no
  hint why. It opens on the document's language, or the app's where that has no data.
- The open pass runs `untrack`ed, on `open` alone: it writes the state it reads (the term,
  the language), so tracked it re-runs on its own result and wipes each lookup as it lands.

## Navigator (`NavigatorPane.svelte`, `editor/extensions/outline.ts`)

LibreOffice's Navigator and Word's Navigation pane: the outline, click to jump, and the
four chapter operations on hover. Docked right beside `CommentsPane`, not left where both
reference products put it — the modern chrome's floating "Tools" chip lives there. The
toolbar island overlays the row's top, so the pane takes a `margin-top` of
`--toolbar-overlay-h` (`App.svelte` sets it; 0 for the ribbon, which is in flow).

## Page decoration (`PageDecorLayer.svelte`, `storage/pageDecor.ts`)

Background, border and watermark, all page-level. The layer sits inside the scaled
`.paper` at `z-index: -1` like `.hf-bg-layer`, drawing one border box and one watermark
per page in unscaled document px. The border wraps the header/footer band (both word
processors draw it so): where any section has a zone, `hfInsets` replaces the page
margin with the zone's edge distance. The watermark is an `<svg><text textLength>` because a
fontwork shape **stretches** its text to its box instead of setting it at a size — a font
size alone makes a short word far too small and a long one overflow the page.

## The unsaved dot (`App.svelte`, both chromes)

A `•` beside the document name while the document differs from what was last written to a
file. It is an FNV-1a checksum (`utils/hash.ts`) over the text **and** everything
`exportArgs()` hands the exporter beside it — page setup, styles, notes, the zones — plus
the name the file is saved under, so a margin preset or a rename marks the document as much
as a keystroke does, and an undo back to the saved state clears the dot again. The page count is left out: it is a layout result, and a font
loading late must not mark the document changed.

Taken a beat after the change (300 ms, **throttled** — a debounce never fires while a
settle pass or the spell checker keeps the document moving), and the baseline is taken
**synchronously** on the effect's first run, not in that timer: under a repagination the
timer can be pushed out past the reader's first edit, which would make that edit the
baseline. A save, an open or a new document takes a fresh baseline (`markSaved`).
Leaving the page warns only when the document actually has a file — a browser-only document
is kept by the autosave, so there would be nothing to lose.

## Built-in templates (`TemplateGalleryDialog.svelte`, `lib/templates/`)

"New from template" in both chromes opens the gallery; a card applies its entry via
`App.svelte`'s `applyTemplate` — `resetDocumentState()` (the extracted body of New),
then the template's content, margins, styles and fold marks. `documentName` becomes the
localized template name and no file handle is bound, so the first Save asks where. The
norm's two DIN letter forms come out of one builder in `din5008.ts`, parameterized by
where the address field opens; both were verified headlessly — Form B 44.97mm, Form A
26.98mm, their info blocks 49.98/31.99mm, the info column 124.99mm. The letter-family
templates share that geometry (and the JSON builders) via `templates/builders.ts`;
`tests/unit/templates.test.ts` schema-checks every entry in both locales.

A block's rect starts **above** its own first line — the spacing model puts space-before
inside the box — so a probe measuring these positions must range-select the text, not
read `getBoundingClientRect()` on the paragraph.

## Fold marks (`FoldMarkLayer.svelte`, `storage/foldMarks.ts`)

Fold + punch marks at the DIN 5008 positions, drawn per page in the left margin from
`pageBoxes`. Inside the scaled `.paper`, so print and the PDF raster include them; the
Layout tab's toggle flips the flag.

## Line numbering (`LineNumberLayer.svelte`, `storage/lineNumbering.ts`)

One number per rendered line in the left margin. There is no CSS line box to read, so
each block's contents are Range-selected and its client rects merged by vertical overlap
are its lines (a super/subscript or formula run must not open a phantom line); the count
runs from the document start (or restarts per page), covering list and column lines like
both word processors but not tables, frames or indexes — though a top-level text box
counts as the one empty anchor-paragraph line the file gives it (probed in Word), and a
floating frame's band is no line of its anchor paragraph. A line past the page surface is
skipped, or its number would print into the page gap. Re-measured on each edit and each
pagination settle — the whole document each time, which is the ceiling noted in the file.

## Change bars (`ChangeBarLayer.svelte`)

The changed-lines bar both word processors draw in the margin: a stroke beside every line
a recorded change or an unresolved comment covers, in the revision author's colour or the
comment amber, so a pane entry can be found in the text. Each range's ends give it
(`coordsAtPos`), clipped to every page's text area — a range crossing a page break strokes
once per page instead of through the gap. Inside the scaled `.paper` like the other
layers, and inside the line numbers, which sit further out. The change or comment at the
caret is drawn heavier and last, or a neighbour on the same line would cover it. Always
mounted: with nothing marked it renders nothing. It sits inside `.paper`, so the raster
export and print paths clone it and the bar prints — see `export/reviewPrint.ts` for what
the vector path has to rebuild instead.

## What the review views may show (`reviewItems.ts`)

Bars, balloons, the leader line, both panes and the two navigation pairs read
`visibleComments` / `visibleCommentRanges` / `visibleRevisions` instead of the document's
own `comments()` / `revisions()`, so the markup settings (`storage/markup`) are read in one
place and cannot drift between the five views. A **resolved** comment is not this rule's
business — each caller handles it as it did. The text itself is hidden by two levers that
have to agree: `.paper[data-hide-*]` in `editor.css` takes the mark's text and tint off the
page, and `trackChanges`' `plain` option drops the decoration that carries the underline,
the strikethrough and the author colour — CSS alone would lose against `pm-rev-a<n>`.
An anchor inside hidden text has no box, so `ReviewMarginLayer` drops a card whose line has
collapsed; the mode change dispatches `FORCE_PAGE_RECALC`, since hiding text reflows pages.

## Margin balloons (`ReviewMarginLayer.svelte`, `storage/markup.svelte.ts`)

What both word processors draw beside the page: one card per unresolved comment and per
recorded change, at the height of the line it belongs to, with a dashed leader to it.
Accept/reject and edit/resolve/remove happen in the balloon — `CommentCard.svelte` and
`RevisionCard.svelte` are the same cards the two panes build their rows from.

- **It sits outside `.paper`**, as a sibling inside `.paper-scaler`, carrying that same
  `transform: scale()` so it zooms with the page. Inside `.paper` it could not: that box
  is `overflow-x: clip`, and its width is the one `.tiptap` and the pagination measure.
- The strip is `REVIEW_MARGIN_CM` (gap + balloon) and is **only reserved when the document
  has markup the margin shows** — a kind switched to the pane, or a mode that hides it,
  leaves `.paper-scaler` exactly the page, centred as before.
  `scaledCanvasWidth` (`Editor.svelte`) adds it; `scaledWidth` stays the page, which is
  what the `Ruler` is sized from.
- **The leader runs in the gap under the anchor's line** (`coordsAtPos(...).bottom`, not the
  line's middle) and eases into the card's left edge at the anchor's own height where the
  card reaches that far — so a balloon sitting at its line is joined by one straight line
  that crosses no letters. `ConnectorLayer` draws its leader to the pane the same way.
- A balloon wants its anchor's line and is pushed down where the one above it reaches
  (`utils/balloonStack.ts`, unit-tested). Its height is **measured**, not computed — a card
  grows when its text is edited — so a `ResizeObserver` feeds the stack.
- **The column belongs to its page, not to the document.** Balloons are grouped by the page
  their anchor is on and stacked inside that page's band; a stack that would end past the
  sheet is pulled back up (second pass in `stackTops`). The cards of one page also share its
  height as a `max-height`, so a comment of a few paragraphs scrolls in its own card instead
  of pushing the ones below it off the page — `MIN_BALLOON_H` is where the shrinking stops
  and the column is allowed to run over.
- Its x comes from the anchor's own page box, so a narrower section's page keeps its
  balloons at its own right edge. Not mounted in the page grid: `.page-cell` is one page
  wide and clips.
- The **⋯** menu and the reply box are part of the shared card, so a balloon and a pane row
  answer a comment the same way; both grow the card, and the stack follows the measurement.
- **The card is authored for the pane's 260px and lives here in `BALLOON_W_CM`**, so everything in
  it has to wrap: the action row is `flex-wrap: wrap` (unwrapped, German labels pushed
  "Bearbeiten" clean out of the balloon) and the balloon carries `overflow-wrap: anywhere`
  plus `overflow-x: hidden`. `tests/smoke/run.mjs` guards it — a comment in the longer
  locale, one unbreakable word and one comment far too long for its share, then every
  descendant's rect against its card's and every card's against the page.
- The printout carries the margin bar and the comment list instead (`export/reviewPrint.ts`);
  `@media print` hides this layer.

## Reviewing leader (`ConnectorLayer.svelte`)

The dashed leader both word processors draw from an annotated range to its balloon, here
from the text out to the reviewing pane's card: a stub along the anchor's line, then a
diagonal onto the card's head. Only for the comment and the change **at the caret** — a
line per comment would cross the whole page, and one is what pairs card and text. It sits
in `.editor-row` (hence that row's `position: relative`), the one box spanning the
scroller and the panes both, and reads the active card straight off the DOM
(`li.active`), so nothing has to be threaded through `App.svelte`. Redrawn on every
scroller (a capturing `scroll` listener), on resize and on each edit; dropped when the
anchor scrolls out of the page view, and when a *second* pane is docked between the text
and the target card — the card is still marked and the margin bar still names the line.

## Debug tooling (dev only)

In dev builds a **Debug** button (`App.svelte`) downloads a JSON snapshot combining `getPageBreakDebug(view)` (leaves, placements, rendered spacers, table-break bands, live overlay geometry), `getTableCellDebug(view)` (per cell: the `verticalAlign` attr beside the computed value, cell/row height, the gap above and below the content, and every block's margins/`--space-before` — cell alignment reads as broken whenever the content fills the box, so the numbers that decide that travel with it), `getFrameDebug(view)` (`caption.ts` — per picture: its attrs, its rendered span in the text column and its caption's; every other section measures the flow downwards, and a misplaced caption is a sideways question), the style sheet + spacing model, and `getColorDebug(editor)` (selection marks, text runs, document colors, DOM spans, and `painted`: the colour the browser actually computes per rendered run, the element that declares it, the page's colour variables and the document stylesheet's colour rules — a mark says what was asked for, and a decoration paints a colour no mark carries).

## Per-section header/footer

A body block carrying `sectionBreak` (pageBreak.ts) opens a section; `HeaderFooterLayer`
picks that section's `HfSet` per page from `sectionStartPages`, which `pageBreaks.ts`
reports on `pm-pagecount`. Section 1 is the app's six per-zone states, the rest live in
`extraHfSections` (bound up to `App`, persisted whole). Editing targets the section of the
page it starts on, so a double-click edits the zone under the pointer and the Layout-panel
buttons the current page's; `zoneKey`/`writeZone` route the one live editor's read and
write-back to either side. A section with page margins of its own puts its zones on
**those** (`marginsOf`), not the document's — a mirrored body after a wider front matter
otherwise drew its running head 9mm off the text it belongs over.

Word's "different first page" is per section, so a later section's first page shows its
own variant. `Editor.svelte` publishes each section's zone reaches as `--pb-section-reach`
("topFirst|topRest|bottomFirst|bottomRest" per section, comma-separated) and pageBreaks
resolves the content area per page from it — without it a tall letterhead on a later
section's first page would sit on top of the body (measured: 24.9mm).

**The band is measured, not counted.** The body's margin has to clear the height the zone
really renders at, which no line count can know — a wrapping line, a run smaller than the
12pt floor and the paragraph's own padding are all invisible to one. `HeaderFooterLayer`
lays every set's six zones out off-screen (`.hf-measure`, at the section's text width, a
`ResizeObserver` so a late web font re-reports) and hands the heights up as `zoneHeights`;
`hfReachPx` uses them and keeps its estimate only for the first frame. The measuring copy
carries `.hf-zone`, so `styleCss` gives it the document's own zone font — without that it
measures the editor's serif. The ODF zone's gap to the body and its padding ride the
collapsed paragraph's spacing (`convertHfZone`), which is where the export already puts
them, so the measurement sees them and the round trip is unchanged.
