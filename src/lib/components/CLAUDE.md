# `src/lib/components/`

All Svelte UI lives here. `App.svelte` owns app-level state; `Editor.svelte` mounts TipTap
and owns pagination wiring, zoom, floating toolbars, and the header/footer layer.

`Editor.svelte` exposes `editor`, `tick`, `currentPage`, and `numPages` as bindable props.
Toolbar components use `tick` to react to TipTap transactions rather than subscribing to
ProseMirror directly. Keep app-owned state flowing into `Editor.svelte` through its props.

Only one view may measure and paginate in split or page-grid layouts. Plugin decorations
shared by multiple views must create their DOM in a widget factory, never reuse one node.
A control disabled for a reason the user cannot see says it in its `title` (`noteNotInHf`, `mergeNeedsCells`), in both chromes.

`chromeMode` selects one of the modern toolbar island or `ribbon/`; both use
`activeEditor`/`activeTick` and only one mounts at a time.
`toolbar/` holds the island's Tools categories and menu primitives; logic shared with a ribbon tab lives in a plain `.ts` module beside them (see `docs/architecture/island.md`).
A shared session's flow (relay probe, start, join from the link, leave) is `collab/appSession.svelte.ts`; `App.svelte` keeps its status button and `CollabDialog`. A tab joined by a read link (`#view=`) reads along: `collab/reading.svelte.ts` makes the body read-only, turns the assistant off, keeps zones shut and drops the squiggles; `ReadGate.svelte` (a disabled fieldset) greys every control that edits, and a `RibbonGroup` greys itself unless it `reads` (view, zoom, statistics, find, comment and change navigation), the context menu leaving only its copy entries; `SessionView` says `reading` and lists `readers` apart from `peers`. `CollabDialog` shows a writer both links, labelled apart, and a reader only the read link; readers are listed as reading along and show as rings on the status-bar button. A reader's button says *Read only*, a key that would edit shows a short hint above it (`collab-hint`), and with no writer left a notice says so (`unwritten`).
`CollabDialog` opens by itself only when a session cannot go on; a breaking line, nobody keeping the document or a lost picture is a notice by the status bar, so nothing covers the page while someone types.
`EventDialogs.svelte` mounts the event-opened dialogs (link, bookmark, cross-reference, formula) once, outside both chromes.
Under the zh-Hans UI both size boxes list and accept the named sizes (字号, `utils/fontSize.ts`).

Keep `pageBreaks.ts`, `Editor.svelte`, and `editor.css` layout constants aligned. Zoom is a
CSS transform on `.paper`, while pagination always measures at 100%; reserve its scaled
footprint with `.paper-scaler` rather than changing the layout scale.

Read `docs/architecture/components.md` before changing component data flow, pagination
settling, split/grid views, zoom, headers/footers, review UI, templates, or debug tooling.
Read the focused architecture document for ribbon, pagination, frames, tables, formatting,
formulas, or notes before changing those areas.
- Every `<dialog>` and popover window gets its frame and the ribbon's `--w-*` palette from `styles/global.css`, wherever it is mounted; a component sets only size and layout.
- Modal `<dialog>`s move by their `<h2>` title via `dragDialogs()` (`utils/dragWindow.ts`), modeless windows via `use:dragWindow`.
- `PromptDialog.svelte`'s `askText()` stands in for `window.prompt()`, which Electron does not implement; never call `prompt()` directly.
- `SaveFormatDialog.svelte` asks the first Save for a format; without a save picker (Firefox, Safari, Brave) it also asks the first Save and every Save As for the document name, since a download never reports the name it was saved under. A file chosen in a picker names the document instead.
- `SettingsDialog.svelte` (the ribbon's gear) gathers app-wide settings in side-bar sections, each control writing through the store that owns it; on/off rows use `Toggle.svelte`, a checkbox with `role="switch"`.
- `AiPane.svelte` (docked chat, also the selection's rewrites) mounts only while `aiEnabled()`; see `docs/architecture/ai.md`. The pane's inner edge (`PaneResize.svelte`, shared with the navigator) drags or arrow-keys its width (260 px to 60 % of the window, double-click resets), kept in `localStorage`.
- `BusyIndicator.svelte` (status bar) names a running task (opening a file, PDF export) at once, a layout pass after 300 ms (`isLayingOut`, not while typing); the first layout after start-up or an import still reads as loading.
- `NavigatorPane.svelte` (F5): tabs for headings, pages, results, bookmarks and objects; the headings fold as a tree (arrow keys, `role="tree"`), a right click offers the chapter commands, and its options menu sets text size, side and wrapping (`storage/navigator.svelte.ts`). Folding is kept per row identity (level, text, occurrence), not position, so edits do not unfold it. A row dragged onto another moves its chapter before it, or after it on the lower half (`moveChapterTo`); during a search the chapters holding a match are marked yellow, and the objects tab lists tables, pictures, text boxes, notes, comments and links. A row shows its chapter number as the contents does (`headingNumbers`), and a click jumps through `selectRange` (`reviewItems.ts`), which scrolls after focusing: a transaction's `scrollIntoView` does nothing while focus is outside the editor.
- `NavigatorSearch.svelte` is the navigator's search box above its tabs: it searches through the find bar's plugin (`searchReplace.ts`, one search for both), opens the results tab, whose rows show each match in its paragraph's words (the first 500), while the pages tab lists only the pages holding one (a block on one page answers for all its matches), and folds out replace with case, whole-word and regex. Its highlights go with the pane unless the find bar has searched since.
- `PageThumbnails.svelte` is the navigator's pages tab: a virtual list that draws only the tiles in view, each a scaled copy of its own page's blocks and header/footer zones (`utils/pageStrip.ts`, shared with the PDF strips), redone after typing pauses and the layout settles. Browsers cannot mirror a painted element (CSS `element()` is Firefox-only), so the copy is laid out again, at a page's cost. Counters do not reach into a copy: chapter numbers are written in from `headingNumbers`; a header outside the HF layer's 75-page window is missing.
- `CommentsPane.svelte` and `RevisionsPane.svelte` dock either side and take the navigator's width handle and text sizes (`storage/panes.svelte.ts`); `PaneOptions.svelte` is every pane's options button and its side and size entries. Docked left, a CSS `order` keeps the navigator outermost and the reviewing panes nearest the page, and `ConnectorLayer` draws the leader mirrored.
- `ChatPane.svelte` is a shared session's chat (`collab/chat.svelte.ts`), docked as the reviewing panes with its own width, side and size (`chat` in `storage/panes.svelte.ts`); it opens from the button beside the session's in the status bar or the View tab's entry, both only in a session, and stays writable for a reader.
- `BookmarkRow.svelte` is one bookmark in the bookmark window's list and the navigator's: jump, rename in place, delete.
- `BorderWidthBox.svelte` is every line-width field (style manager, border pens, text box): presets in a list or a typed pt value, clamped to 0.05–9 pt; `none` adds "None" where a side can have no line.
- `FontSizeField.svelte` is every font-size field outside the editing toolbars (style manager, find bar): the size box's list and 1–400 pt range, empty clears.
- `Ruler.svelte` draws quarter-, else half-cm marks and thins its cm numbers to every 2nd/5th only as far as the zoom leaves them room, so nothing on it overlaps.
- `HeaderFooterLayer.svelte` opens one zone editor at a time; in a shared session a zone someone else has open stays shut and carries their name (`collab/zones.svelte.ts`, `docs/architecture/collab.md`).
- `PageLabelLayer.svelte` puts the sheet number beside each page's bottom right corner, in `.paper-scaler` (`.paper` clips) at an unscaled size, ending where the scroller does so it adds no scrollbar; not in the page grid.
- `PoweredBy.svelte` is the embed mode's status-bar attribution (`docs/architecture/embed.md`); its fixed English wording is a licence notice, not catalog text.
- `CollabPeople.svelte` shows the others in a session as circles before the session button (go to, follow; `docs/architecture/collab.md`), `CollabNews.svelte` who came or went and who named you, `MentionSuggest.svelte` offers them after `@` in a comment, reply or chat box.
