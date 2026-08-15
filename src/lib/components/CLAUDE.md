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

## Zoom (`Editor.svelte`)

Zoom is a CSS `transform: scale()` on `.paper` (layout and pagination always run at 100%, so they stay stable across zoom — this replaced an earlier CSS `zoom` approach that re-ran layout at every scale). A transform reserves no layout space, so `.paper-scaler` reserves the scaled footprint to drive scrollbars and horizontal centering — it's sized in the `$effect.pre`, so it reaches the DOM in the same flush as the transform and the anchor pass below measures the right geometry. The applied zoom is throttled to one DOM write per animation frame. Range 20–300% (`MIN_ZOOM`/`MAX_ZOOM`/`clampZoom` in `utils/zoom.ts`), persisted in `localStorage['edentext-zoom']`.

`zoom` lives in `App.svelte`; `setZoom` is the only writer (clamps + persists) and reaches `Editor.svelte` as the `onZoom` prop, so a gesture there routes back through it and the status-bar slider follows for free. Inputs beyond the slider:

- **Ctrl+wheel** (`onWheel` on `.editor`) — a touchpad two-finger zoom fires exactly this event, so one handler covers both it and a Ctrl+mouse-wheel. `preventDefault` keeps the *browser* from scaling the whole app UI. `wheelZoomFactor` (`utils/zoom.ts`) turns the delta into a multiplicative factor — normalizing Firefox's line-mode deltas and capping one mouse notch — so a step feels the same at 30% as at 250%. Its sensitivity and cap are gesture-feel tuning knobs.
- **Ctrl `+`/`-`/`0`** — in `App.svelte`'s global keydown, ±10% / reset, suppressing the browser's own zoom keys.

Both anchors differ: a wheel zoom holds the **point under the cursor** fixed (`pendingAnchor` in client coords → doc space in the `$effect.pre`, both axes corrected via `scrollLeft`/`scrollTop` in the post-effect); slider, buttons and keyboard have no pointer and fall back to the top-of-viewport anchor. Touchscreen pinch is **not** handled — real touches fire no wheel event.

## Headers & footers (`HeaderFooterLayer.svelte`, `storage/headerFooter.ts`)

One header and one footer (`HfDoc` = a single-paragraph TipTap doc per zone, persisted to `edentext-header`/`-footer`), repeated on every page. Double-clicking a page margin — or the Layout-panel "Edit header/footer" buttons — opens the zone for editing; clicking back into the body (`onFocus`) or Escape ends it. The edge→zone distance (header from top, footer from bottom) is user-configurable in cm via the Layout panel (`HfDistances`, persisted to `edentext-hf-distances`, default `HF_DISTANCE_CM` 1.27cm, clamped 0–10 and below the body margin).
- **Fields:** the bar beside the active zone inserts the `pageField.ts` atoms — page number, page count, chapter (the running head, level 1). Each is patched per page, so the same zone shows a different value on every page.
- **Rendering:** the zone's own font is the document's **default paragraph style** (`styleCss` gives `.paper .hf-layer .hf-zone` its text half): both formats base the Header/Footer style on it, so a file whose body is Arial 10pt has an Arial footer, not the editor's serif. `HeaderFooterLayer.svelte` mounts inside the scaled `.paper` (like `.band-layer`), positioning per-page zone boxes in unscaled doc px. A zone's out-of-flow frame (`wrap` ≠ inline) is hidden in the box and painted per page by `.hf-bg-layer` at `z-index: -1` — hence `.paper`, not `.tiptap`, paints the page surface, so the image lands between the sheet and the body text. Inactive zones render as static HTML (`generateHTML` + `hfExtensions`); the active zone hosts the single live TipTap editor. `App.svelte`'s `activeEditor`/`activeTick` route the top toolbars to `hfEditor` while a zone is active, so all body formatting works on the header/footer with no toolbar changes.

## Comments (`CommentsPane.svelte`)

Word's Reviewing Pane, not its margin bubbles: the page here fills its own scroller, so a
pane beside it (`.editor-row` in `App.svelte`) keeps the sheet at its true width. It lists
`comments(editor.state.doc)` in document order — click a card to select the annotated
range, edit / resolve / remove in place. `App.svelte` owns the New-comment prompt, which
both the Review tab and the context menu (`OPEN_COMMENT_EVENT`) fire; the author comes
from the document properties.

## Revisions (`RevisionsPane.svelte`)

The reviewing pane both word processors list revisions in, docked beside `CommentsPane`
and built the same way: one row per change **id** (a paragraph boundary splits one change
into several ranges), in the author's own colour, click to select the text, accept or
reject in place through `acceptRevision`/`rejectRevision`. Opened from the Review tab.

## AutoText (`AutoTextDialog.svelte`, `editor/extensions/autoText.ts`)

LibreOffice's Tools ▸ AutoText, reachable where Word puts it too (the ribbon's Insert ▸
Text group, the classic chrome's Tools menu): the library, a click to insert, and "new
from selection" — the selected slice serialized to HTML. `hasSelection` is derived off
`open` because the dialog stays mounted and a modal freezes the selection it opened on.

## Navigator (`NavigatorPane.svelte`, `editor/extensions/outline.ts`)

LibreOffice's Navigator and Word's Navigation pane: the outline, click to jump, and the
four chapter operations on hover. Docked right beside `CommentsPane`, not left where both
reference products put it — the classic chrome's floating "Tools" chip lives there. The
toolbar island overlays the row's top, so the pane takes a `margin-top` of
`--toolbar-overlay-h` (`App.svelte` sets it; 0 for the ribbon, which is in flow).

## Page decoration (`PageDecorLayer.svelte`, `storage/pageDecor.ts`)

Background, border and watermark, all page-level. The layer sits inside the scaled
`.paper` at `z-index: -1` like `.hf-bg-layer`, drawing one border box and one watermark
per page in unscaled document px. The watermark is an `<svg><text textLength>` because a
fontwork shape **stretches** its text to its box instead of setting it at a size — a font
size alone makes a short word far too small and a long one overflow the page.

## Line numbering (`LineNumberLayer.svelte`, `storage/lineNumbering.ts`)

One number per rendered line in the left margin. There is no CSS line box to read, so
each block's contents are Range-selected and the distinct tops of its client rects are
its lines; the count runs from the document start (or restarts per page). Re-measured on
each edit and each pagination settle — the whole document each time, which is the
ceiling noted in the file.

## Debug tooling (dev only)

In dev builds a **Debug** button (`App.svelte`) downloads a JSON snapshot combining `getPageBreakDebug(view)` (leaves, placements, rendered spacers, table-break bands, live overlay geometry), `getTableCellDebug(view)` (per cell: the `verticalAlign` attr beside the computed value, cell/row height, the gap above and below the content, and every block's margins/`--space-before` — cell alignment reads as broken whenever the content fills the box, so the numbers that decide that travel with it), `getFrameDebug(view)` (`caption.ts` — per picture: its attrs, its rendered span in the text column and its caption's; every other section measures the flow downwards, and a misplaced caption is a sideways question), the style sheet + spacing model, and `getColorDebug(editor)` (selection marks, text runs, document colors, DOM spans).

## Per-section header/footer

A body block carrying `sectionBreak` (pageBreak.ts) opens a section; `HeaderFooterLayer`
picks that section's `HfSet` per page from `sectionStartPages`, which `pageBreaks.ts`
reports on `pm-pagecount`. Section 1 is the app's six per-zone states, the rest live in
`extraHfSections` (bound up to `App`, persisted whole). Editing targets the section of the
page it starts on, so a double-click edits the zone under the pointer and the Layout-panel
buttons the current page's; `zoneKey`/`writeZone` route the one live editor's read and
write-back to either side. Page geometry is still document-wide.

Word's "different first page" is per section, so a later section's first page shows its
own variant. `Editor.svelte` publishes each section's zone reaches as `--pb-section-reach`
("topFirst|topRest|bottomFirst|bottomRest" per section, comma-separated) and pageBreaks
resolves the content area per page from it — without it a tall letterhead on a later
section's first page would sit on top of the body (measured: 24.9mm).
