# Components

`App.svelte` owns persisted document and application state. `Editor.svelte` mounts TipTap
and owns editor-local layout: pagination wiring, zoom, floating tools, and page layers.
Read `docs/architecture/pagination.md`, `ribbon.md`, `island.md`, `frames.md`, `tables.md`,
`formatting.md`, `formulas.md`, and `notes.md` before changing their respective features.

## Ownership and data flow

`chromeMode` selects either the floating toolbar or `ribbon/`; only one mounts. Both route
commands through `activeEditor` and `activeTick`, so the same controls work for the body and
an active header/footer zone. `App.svelte` owns zoom, page setup, theme, formatting-mark and
document state and passes it into `Editor.svelte`.

`Editor.svelte` exposes `editor`, `tick`, `currentPage`, and `numPages` as bindable props.
`tick` advances for every TipTap transaction; toolbar components derive their state from it
instead of subscribing to ProseMirror. Defer the caret-page lookup one task after selection
changes: reading coordinates in the transaction handler can force a full layout during load.

## Layout lifecycle

Pagination measures DOM that its prior pass changed. While an opened document converges,
`.paper.settling` hides content without removing it from layout. Stop when the layout
signature repeats or the bounded settle time expires. Re-arm on `documentEpoch` when opening a
document, not on ordinary edits; sample only a bounded number of blocks so measurement does
not starve the layout it is waiting for.

Zoom is `transform: scale()` on `.paper`; pagination always measures unscaled geometry.
`.paper-scaler` reserves the transformed footprint for centering and scrollbars. `App.svelte`'s
`setZoom` is the sole writer and persists the clamped range. Pointer zoom preserves the point
under the cursor; keyboard, buttons, and slider preserve the viewport anchor.
A two-finger pinch over `.editor` is the same zoom, anchored between the fingers;
`touch-action: pan-x pan-y` keeps the browser from scaling the whole app there.

Keep `pageBreaks.ts`, `Editor.svelte`, and `editor.css` page constants aligned. Section paper
dimensions remain unrounded: pagination uses the published value directly and cumulative
rounding changes later page positions.

## Multiple views

### Split view

Split is horizontal only. The second pane is an `EditorView` over the editor's state and is
kept in sync by the primary view; it is not an independent document editor.

- One view measures and paginates. `pageBreaks`, columns, and tab-stop plugins must be inert
  in the other pane because they share decorations and derived state.
- Widget decorations must create DOM in a factory. Two views cannot share one element.
- A node view measures against the view it renders in (`addNodeView`'s `view`), never
  `editor.view`. What a pass places by measurement must match in every pane: pageBreaks
  hands each pane's frames the margins its pass measured (`panes`), and an index in a pane takes
  its main view's rows and breaks (`TocView.twins`) rather than measuring a passing layout.
- `activePane` owns coordinate reads, focus restoration, and scroll-to-selection. A command
  otherwise focuses the primary TipTap view and scrolls the wrong pane.
- Persist only whether split is enabled, not its temporary divider position.

### Page grid

Grid cells are clipped windows onto whole-document views: a column contains non-contiguous
pages, so it cannot be one view. Reuse as many rows of cells as the viewport shows at once (one more than fit whole) while scrolling. Split and grid are
mutually exclusive.

- One scroller carries the canvas and defines the coordinate space for floating layers.
- The focused view must be the cell displaying the caret's page; other cells clip it away.
  Cells clip with `overflow: clip` (a hidden box still scrolls to a caret it clips), and an
  empty slot hides by opacity (a `visibility: hidden` cell drops the focus when rows re-aim).
- Neither ProseMirror nor the browser scrolls the caret into view: the drawing view may clip
  that page. `followCaret` scrolls to the caret in its page's cell, measured where the DOM
  selection draws it (flushed into the state first: fast arrow keys run it ahead), and runs
  again after each layout change. PageDown/PageUp keep the caret's
  spot on the neighbouring page (`gridPageStep`).
- A pane may dispatch only document, selection, or stored-mark changes caused by its user.
  Viewport-derived plugin state otherwise makes shared panes transact against each other.
- Only the measuring view and the caret's (or focused) cell follow every transaction: each
  view updated makes the browser lay out and paint all of them. The other cells catch up
  after a pause (capped, since passes keep transacting) and at once before they take a
  pointer, key, focus or drop, or the grid scrolls. A pane's transaction from a state it
  has not caught up to is dropped, and a cell that catches up takes the last pass's frame
  margins and its index's layout (`catchUpIndexes`).
- Move the primary editor view to the first host when the layout changes rather than rebuilding
  it. Do not render the ruler in every grid cell.
- A cell's header/footer layer draws only its own page (`onlyPage`). Every cell still lays out
  the whole document, seconds on a long one, so App.svelte hands the editor a new page count
  only once the status bar's spinner is painted (`gridColumns`).
- A scroll or zoom step must not make the browser redo a whole view, since each cost is
  paid once per cell. Cells and their papers move by transform (an offset change
  re-walks the document's paint), the host's `dir` is set outside Svelte's attribute effect
  (which rewrites it each run, rebuilding the layout tree), a zone moving to another page
  keeps its clone (an insertion recounts every list), and the spelling highlight paints
  around the cell, which scrolls with its view.

## Header and footer

Headers and footers are independent TipTap documents in the body's schema minus the page
flow (`zoneExtensions()`): paragraphs, lists, tables, pictures and text boxes. One live zone
editor serves the active zone. An inactive zone is a clone of a read-only editor per set and
zone, mounted in the off-screen measuring box, so NodeViews and decorations (list markers,
table columns, frames) render as they do live; the page's fields and tabs are laid out on each
clone. Their typography inherits the document default paragraph style, not the editor
fallback. While one is open, the floating table/image/text-box toolbars and the context menu
serve its editor (`uiEditor`), and only the body dims.

The zones, page setup, style sheet, note settings and document language share the body's undo
stack, as in both word processors. Each change lands there as a `StateStep` (`stateHistory.ts`:
the value before and after, the body untouched). The live zone's own history only groups its
edits, and its undo/redo run on the body's stack. `App.svelte` registers each store with
`watchState`, whichever control writes it, and a change lands after a 500 ms pause. Typing or an
undo lands pending changes first (`flushPending`). A store set in the same task as a text change
(a renamed style and its retagged paragraphs) joins that change's step through the extension's
`appendTransaction`. An undo writes the value back; a table style's repaint follows the sheet
outside the history. Document properties, the recording switch and embedded fonts stay out,
as in both.

A frame in a zone flows there when it wraps (side or band) and stays out of the zone's height
when it runs through. One placed against the page is placed by CSS from the zone box:
`--page-x`/`--page-y` from the node view against the zone's `--hf-page-y`, so the zone's editor
and that paragraph take no position of their own. One placed against the body's top
(`wrapFromBody`) is placed from `--hf-body-y`, where that page's body begins; a wrapping one
there pushes the body down past it (`zoneIntrusions` → Editor.svelte's reaches), since
LibreOffice leaves less than 2cm beside it empty. Only header frames are measured, and the
whole body top moves, not just the lines beside the frame. Frames behind the text paint from a second
clone of the zone in `.hf-bg-layer`, which shows only them; the open zone shows them all.

Zones live inside scaled `.paper` but use unscaled document coordinates. Page fields are
patched per page. Keep only a window near the current page for normal editing, then expand it
for DOM capture and browser printing so every page is present.

Sections own their header/footer set, distances, and first-page variants. The selected zone is
the section on the page being edited; a section with different margins must position its zone
from those margins. The body reach is measured from off-screen rendered zone copies, including
wrapping and internal spacing, rather than inferred from line counts. A page's header and
footer together take at most 80% of the room between the edges they start from, the footer
first, as LibreOffice does (probed: the body keeps ten 12pt lines on A4 under any zone height).
`HeaderFooterLayer` publishes the fitted bands and cuts a zone past its band (`hf-clipped`).
The open zone scrolls instead, so the caret stays in view.

## Review UI

Comments and revisions have a pane or margin representation, never both. Panes use shared
cards and synchronize their active row with the text selection; changes can be accepted or
rejected and comments answered, resolved, or edited from either representation. Each
reviewer has one colour (`editor/authorColors.ts`) on the text's tint or change marks, the bar,
the balloon, its leader and the names on a card, so several reviewers stay apart. A comment
card's head carries its commands as icon buttons (resolve, edit, remove), with no menu. A card's
command returns focus to the text without scrolling to the caret: the reader is at the card.
A resolved comment keeps its card in both views, as in both word processors: greyed, folded
to its head and first line, opened whole while the caret is in its text. With Show resolved
off (the comment caret's menu, Settings ▸ Review) only that one shows, so the grey underline
still leads to a card that reopens it; Previous/Next skip what is hidden (`visibleComments`).
Bars and printouts leave a resolved comment out: it is handled.

A new comment is written in a card beside its text (`CommentComposer.svelte`; the pane in the page
grid); until Add it is a draft in `comment.ts`'s plugin state, outside the document and history.

`reviewItems.ts` is the only source for markup visibility. CSS hiding and revision decorations
must change together, and a display-mode change dispatches pagination recalculation because it
changes flow.

Margin balloons sit beside `.paper`, inside the scaled canvas, so page content can remain the
pagination width. Reserve their strip only when visible markup needs it. Group and stack cards
per page using measured heights; a column too long for its page becomes a deck beside it
(`deckHeights`): each card covers the one before it, the tallest cut first and none below its
head (author, time), so the column never runs on past its page. Under the pointer a covered
card rises whole, chosen by the strips the deck shows so the pointer walks down the heads, and
nothing moves. No card scrolls: an inactive comment shows six lines and counts its answers, the
active one shows all of it, lying whole at its line with its page's others stacked or decked
around it (`deckAround`): those before it share the room above that line, those after it the
room below, so it leaves its line only as far as the heads above it need. Clicking text never scrolls; clicking
a card scrolls the view smoothly by as much as the card moved, the cards gliding on the same
curve, so it stays under the pointer while its text slides up beside it. A pane card and the Review
tab's Previous/Next glide the view to their text the same way (`selectRange`). The wheel over
the balloons scrolls the page, as anywhere else: the deck keeps every card beside its page.
Grid view omits balloons because cells clip to page width. The connector shows only the active
item and is omitted when its geometry cannot be unambiguous.

Change bars, fold marks, line numbers, page decoration, and header/footer backgrounds render
inside `.paper` so raster export and printing include them. Line numbering deliberately excludes
tables and floating frames; it derives lines from range rectangles and must be remeasured after
edits and pagination settles.

## Secondary features

The Navigator derives its outline from `editor/extensions/outline.ts` and performs chapter
operations on the selected entry; it docks either side, outside the AI pane. AutoText stores the selected slice as JSON and inserts it
through its dialog. The synonym dialog loads data lazily for the selected language; unavailable
data disables lookup rather than the application.

Applying a built-in template resets document state, then applies its content, settings, and
styles. It clears the file association so the first save chooses a destination. Template schema
and geometry checks belong in their focused tests.

The unsaved indicator compares export-relevant state with a synchronous saved baseline. Later
checks are throttled so ongoing layout work does not prevent them; exclude layout-only results
such as page count. Opening, creating, and saving a document establish a new baseline.

## Debug tooling

Development builds can download a JSON snapshot of pagination, table and frame geometry,
stylesheet and spacing state, and rendered colour diagnostics. Keep it diagnostic-only and out
of production UI.
