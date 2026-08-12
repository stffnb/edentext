# `src/lib/storage/`

## Page layout settings

- **`pageMargins.ts`** — `PageMargins` in **cm** (default `{ top: 2, bottom: 2, left: 2, right: 2 }` — LibreOffice's; clamped 0–10). `applyMarginVars` sets `--user-margin-*` (px) on `:root`; `PX_PER_CM = 96/2.54`.
- **`tabInterval.ts`** — the document's default tab interval in **cm** (`DEFAULT_TAB_INTERVAL_CM = 1.25`, LibreOffice's for a new document; clamped 0.05–10). `applyTabIntervalVar` sets `--tab-interval`, which is `.tiptap`'s `tab-size`. A file that declares none falls back to its format's own value, neither of them ours: `ODF_IMPLIED_TAB_CM` 2cm (measured against LibreOffice), `DOCX_IMPLIED_TAB_CM` 1.27cm — so both exports always write the value out.
- **`spacingModel.ts`** — how the gap between two blocks is measured: `'add'` (LibreOffice's
  own — space-below **plus** space-above) or `'max'` (the larger of the two, what it uses for a
  Word document). Probed against soffice; per document, read from ODF `settings.xml`
  (`AddParaTableSpacing`), always `'max'` on DOCX import, and written back on ODF export.
  `editor.css` turns `--space-before` into padding or margin accordingly (CSS margins can
  only collapse, so `'add'` cannot be a margin).
- **`pageOrientation.ts`** — `'portrait' | 'landscape'`. `applyOrientationVars` sets `--user-page-{width,height}`; landscape swaps the A4 dimensions (matching odf-kit's automatic swap).

Both margins and orientation are passed into the ODT export so the exported document's geometry/line-wrapping matches the on-screen preview.

## localStorage keys

- **Document:** `odf-editor-doc` — TipTap JSON, debounced 1 s on every `onUpdate` (`autosave.ts`). Loading it raises `odf-editor-doc-loading`, which only a completed startup clears (`markDocumentLoaded`, two frames after `Editor.svelte`'s mount). Still set at the next load = that document hung or crashed the editor: it moves to `odf-editor-doc-broken` and the app starts empty, so a reload escapes the freeze instead of repeating it.
- **Theme:** `odf-editor-theme` — `'light' | 'dark' | 'allBlack' | 'auto'`.
- **Toolbar expanded:** `odf-editor-toolbar-expanded` — boolean string.
- **Chrome:** `odf-editor-chrome` — `'classic' | 'ribbon'`; absent = classic.
- **Ribbon collapsed:** `odf-editor-ribbon-collapsed` — boolean string; absent = expanded.
- **Formatting marks:** `odf-editor-formatting-marks` — boolean string.
- **Ruler:** `odf-editor-ruler` — boolean string; absent = on.
- **Zoom:** `odf-editor-zoom` — integer percent.
- **Page margins:** `odf-editor-page-margins` — JSON cm values.
- **Page orientation:** `odf-editor-page-orientation` — `'portrait' | 'landscape'`.
- **Tab interval:** `odf-editor-tab-interval` — cm as a decimal string.
- **Spacing model:** `odf-editor-spacing-model` — `'add' | 'max'`.
- **Recent fonts:** `odf-editor-recent-fonts` — JSON string array (ToolbarExpanded).
- **Header/footer:** `odf-editor-header` / `-footer` (HfDoc), `odf-editor-hf-distances`.
- **Styles:** `odf-editor-styles` — the style registry (`styles/sheet.svelte.ts`).

## Themes (`theme.ts`, `styles/global.css`)

Four modes: `light`, `dark`, `allBlack` (forces font colors white), `auto` (follows `prefers-color-scheme`). Applied by setting `data-theme` on `<html>`; CSS variables for each theme live in `global.css`. The sheet keeps its own pair through light and dark — white paper, **black** text, the colour LibreOffice and Word draw an uncoloured run in (the app's slate would also differ from a run the file colours `#000000`); only `allBlack` inverts it.
