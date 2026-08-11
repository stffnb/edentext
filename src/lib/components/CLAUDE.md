# `src/lib/components/`

All Svelte UI. `Editor.svelte` mounts TipTap and owns pagination wiring, zoom, the floating
toolbars and the header/footer layer.

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
 │    │                         chrome keeps its size. Toggled in ToolbarExpanded (odf-editor-ruler).
 │    └─ TableToolbar.svelte  – floating row/column/table actions, shown above the active table
 └─ footer statusbar          – "Page X of Y" + zoom controls (20–300%)
```

`Editor.svelte` exposes `editor`, `tick`, `currentPage`, and `numPages` as bindable props to `App.svelte`, and takes `zoom`, `showFormattingMarks`, `pageMargins`, and `orientation` as inputs. `tick` is incremented on every TipTap transaction; toolbar components use `$derived(tick >= 0 && ...)` to re-evaluate `isActive`/value checks reactively without subscribing to ProseMirror directly.

## Zoom (`Editor.svelte`)

Zoom is a CSS `transform: scale()` on `.paper` (layout and pagination always run at 100%, so they stay stable across zoom — this replaced an earlier CSS `zoom` approach that re-ran layout at every scale). A transform reserves no layout space, so `.paper-scaler` reserves the scaled footprint to drive scrollbars and horizontal centering — it's sized in the `$effect.pre`, so it reaches the DOM in the same flush as the transform and the anchor pass below measures the right geometry. The applied zoom is throttled to one DOM write per animation frame. Range 20–300% (`MIN_ZOOM`/`MAX_ZOOM`/`clampZoom` in `utils/zoom.ts`), persisted in `localStorage['odf-editor-zoom']`.

`zoom` lives in `App.svelte`; `setZoom` is the only writer (clamps + persists) and reaches `Editor.svelte` as the `onZoom` prop, so a gesture there routes back through it and the status-bar slider follows for free. Inputs beyond the slider:

- **Ctrl+wheel** (`onWheel` on `.editor`) — a touchpad two-finger zoom fires exactly this event, so one handler covers both it and a Ctrl+mouse-wheel. `preventDefault` keeps the *browser* from scaling the whole app UI. `wheelZoomFactor` (`utils/zoom.ts`) turns the delta into a multiplicative factor — normalizing Firefox's line-mode deltas and capping one mouse notch — so a step feels the same at 30% as at 250%. Its sensitivity and cap are gesture-feel tuning knobs.
- **Ctrl `+`/`-`/`0`** — in `App.svelte`'s global keydown, ±10% / reset, suppressing the browser's own zoom keys.

Both anchors differ: a wheel zoom holds the **point under the cursor** fixed (`pendingAnchor` in client coords → doc space in the `$effect.pre`, both axes corrected via `scrollLeft`/`scrollTop` in the post-effect); slider, buttons and keyboard have no pointer and fall back to the top-of-viewport anchor. Touchscreen pinch is **not** handled — real touches fire no wheel event.

## Headers & footers (`HeaderFooterLayer.svelte`, `storage/headerFooter.ts`)

One header and one footer (`HfDoc` = a single-paragraph TipTap doc per zone, persisted to `odf-editor-header`/`-footer`), repeated on every page. Double-clicking a page margin — or the Layout-panel "Edit header/footer" buttons — opens the zone for editing; clicking back into the body (`onFocus`) or Escape ends it. The edge→zone distance (header from top, footer from bottom) is user-configurable in cm via the Layout panel (`HfDistances`, persisted to `odf-editor-hf-distances`, default `HF_DISTANCE_CM` 1.27cm, clamped 0–10 and below the body margin).
- **Fields:** the bar beside the active zone inserts the `pageField.ts` atoms — page number, page count, chapter (the running head, level 1). Each is patched per page, so the same zone shows a different value on every page.
- **Rendering:** the zone's own font is the document's **default paragraph style** (`styleCss` gives `.paper .hf-layer .hf-zone` its text half): both formats base the Header/Footer style on it, so a file whose body is Arial 10pt has an Arial footer, not the editor's serif. `HeaderFooterLayer.svelte` mounts inside the scaled `.paper` (like `.band-layer`), positioning per-page zone boxes in unscaled doc px. A zone's out-of-flow frame (`wrap` ≠ inline) is hidden in the box and painted per page by `.hf-bg-layer` at `z-index: -1` — hence `.paper`, not `.tiptap`, paints the page surface, so the image lands between the sheet and the body text. Inactive zones render as static HTML (`generateHTML` + `hfExtensions`); the active zone hosts the single live TipTap editor. `App.svelte`'s `activeEditor`/`activeTick` route the top toolbars to `hfEditor` while a zone is active, so all body formatting works on the header/footer with no toolbar changes.

## Debug tooling (dev only)

In dev builds a **Debug** button (`App.svelte`) downloads a JSON snapshot combining `getPageBreakDebug(view)` (leaves, placements, rendered spacers, table-break bands, live overlay geometry) and `getColorDebug(editor)` (selection marks, text runs, document colors, DOM spans) — used to diagnose pagination and color round-trip issues.

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
