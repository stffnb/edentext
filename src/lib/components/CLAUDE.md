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
- `NavigatorPane.svelte` (F5): tabs for headings, bookmarks and objects; the headings fold as a tree (arrow keys, `role="tree"`), a right click offers the chapter commands, and its options menu sets text size, side and wrapping (`storage/navigator.svelte.ts`). Folding is kept per row identity (level, text, occurrence), not position, so edits do not unfold it.
- `BookmarkRow.svelte` is one bookmark in the bookmark window's list and the navigator's: jump, rename in place, delete.
- `BorderWidthBox.svelte` is every line-width field (style manager, border pens, text box): presets in a list or a typed pt value, clamped to 0.05–9 pt; `none` adds "None" where a side can have no line.
- `FontSizeField.svelte` is every font-size field outside the editing toolbars (style manager, find bar): the size box's list and 1–400 pt range, empty clears.
- `Ruler.svelte` draws quarter-, else half-cm marks and thins its cm numbers to every 2nd/5th only as far as the zoom leaves them room, so nothing on it overlaps.
- `PageLabelLayer.svelte` puts the sheet number beside each page's bottom right corner, in `.paper-scaler` (`.paper` clips) at an unscaled size, ending where the scroller does so it adds no scrollbar; not in the page grid.
- `PoweredBy.svelte` is the embed mode's status-bar attribution (`docs/architecture/embed.md`); its fixed English wording is a licence notice, not catalog text.
