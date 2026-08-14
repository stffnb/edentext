# `src/lib/storage/`

## Page layout settings

- **`pageMargins.ts`** — `PageMargins` in **cm** (default `{ top: 2, bottom: 2, left: 2, right: 2 }` — LibreOffice's; clamped 0–10). `applyMarginVars` sets `--user-margin-*` (px) on `:root`; `PX_PER_CM = 96/2.54`. Optional `mirrored` (ODF `style:page-usage="mirrored"`, Word `w:mirrorMargins`) makes left/right the **inner/outer** pair, which an even page swaps: `--user-margin-mirror` carries the difference, `pageBreaks.ts` insets an even page's blocks by it and `HeaderFooterLayer.svelte` moves the band. The key is **absent**, never `false`, when off — margins are compared whole in the round-trip tests.
- **`tabInterval.ts`** — the document's default tab interval in **cm** (`DEFAULT_TAB_INTERVAL_CM = 1.25`, LibreOffice's for a new document; clamped 0.05–10). `applyTabIntervalVar` sets `--tab-interval`, which is `.tiptap`'s `tab-size`. A file that declares none falls back to its format's own value, neither of them ours: `ODF_IMPLIED_TAB_CM` 2cm (measured against LibreOffice), `DOCX_IMPLIED_TAB_CM` 1.27cm — so both exports always write the value out.
- **`spacingModel.ts`** — how the gap between two blocks is measured: `'add'` (LibreOffice's
  own — space-below **plus** space-above) or `'max'` (the larger of the two, what it uses for a
  Word document). Probed against soffice; per document, read from ODF `settings.xml`
  (`AddParaTableSpacing`), always `'max'` on DOCX import, and written back on ODF export.
  `editor.css` turns `--space-before` into padding or margin accordingly (CSS margins can
  only collapse, so `'add'` cannot be a margin).
- **`writingMode.ts`** — the page's text direction (`loadPageRtl`/`savePageRtl`, `edentext-page-rtl`), from ODF `style:writing-mode="rl-tb"` or Word's section-level `w:bidi`. `Editor.svelte` puts it on the body host as `dir`, which is what makes a multi-column page fill from the right; the header/footer band is left alone (LibreOffice lays those out unchanged — measured). The vertical modes are not read.
- **`pageNumbering.ts`** — the page-number field's format and start value (`edentext-page-numbering`, absent at the 1/1 default). `HeaderFooterLayer.svelte` formats each page through `formatOrdinal`; the page **count** stays decimal, as the field both word processors write does. ODF keeps the format on the page layout and the start on the first paragraph's own style (`style:page-number` — probed, ODF has no document-level start); Word keeps both in the first section's `w:pgNumType`.
- **`hyphenation.ts`** — automatic hyphenation for the whole document (`edentext-hyphenation`, off by default as in both word processors). `Editor.svelte` puts `hyphens: auto` and the document `lang` on the body host — the browser needs the language to pick its patterns. ODF keeps it as `fo:hyphenate` in the **text** properties of the base paragraph style (probed: in paragraph-properties LibreOffice ignores it and drops it on the next save), Word as `w:autoHyphenation` in settings.xml.
- **`pageDecor.ts`** — the page's own decoration (`edentext-page-decor`, the key removed when all three are off): background colour, a border around the text area at `paddingCm` from it, and a text watermark (LibreOffice's Format ▸ Watermark, field for field). All three ride the ODF page layout — the watermark as a `fontwork-plain-text` `<draw:custom-shape>` named `PowerPlusWaterMarkObject` in the **master page's header**, the only place LibreOffice reads one from (probed: hung off the master page directly it is dropped, and an undeclared `xmlns:draw` in styles.xml drops it too). Word keeps the background on `w:document` (plus `w:displayBackgroundShape`), the border in `w:sectPr` **after `w:pgMar`** — the child order is fixed, and ahead of the header references Word's reader loses those — and the watermark as the VML `_x0000_t136` shape, whose definition has to travel or LibreOffice cannot resolve it. `PageDecorLayer.svelte` draws border and watermark per page; the background is a `--color-page-bg` override on `.paper`.
- **`trackChanges.svelte.ts`** — whether the editor records revisions (`edentext-record-changes`, the key removed when off, as it is by default in both word processors). A reactive singleton because the extension reads it on every transaction while the Review tab flips it; the recorded changes themselves live in the document, on the marks.
- **`lineNumbering.ts`** — numbers in the left margin (`edentext-line-numbering`, the key removed when off, as it is by default in both word processors). ODF keeps one `<text:linenumbering-configuration>` in `office:styles`, Word a `<w:lnNumType>` per `w:sectPr` (probed). `LineNumberLayer.svelte` measures the lines: CSS exposes no line boxes, so a Range per block is taken and its distinct client-rect tops are the lines.
- **`pageOrientation.ts`** — `'portrait' | 'landscape'`. `applyOrientationVars` sets `--user-page-{width,height}`; landscape swaps the A4 dimensions (matching odf-kit's automatic swap).

Both margins and orientation are passed into the ODT export so the exported document's geometry/line-wrapping matches the on-screen preview.

## localStorage keys

All keys share the `edentext-` prefix — a namespace, not a description: on GitHub Pages every repo of an account shares one origin, so a generic prefix would collide.

- **Document:** `edentext-doc` — TipTap JSON, debounced 1 s on every `onUpdate` (`autosave.ts`). Loading it raises `edentext-doc-loading`, which only a completed startup clears (`markDocumentLoaded`, two frames after `Editor.svelte`'s mount). Still set at the next load = that document hung or crashed the editor: it moves to `edentext-doc-broken` and the app starts empty, so a reload escapes the freeze instead of repeating it.
- **Theme:** `edentext-theme` — `'light' | 'dark' | 'allBlack' | 'auto'`.
- **Toolbar expanded:** `edentext-toolbar-expanded` — boolean string.
- **Chrome:** `edentext-chrome` — `'classic' | 'ribbon'`; absent = classic.
- **Ribbon collapsed:** `edentext-ribbon-collapsed` — boolean string; absent = expanded.
- **Formatting marks:** `edentext-formatting-marks` — boolean string.
- **Ruler:** `edentext-ruler` — boolean string; absent = on.
- **Zoom:** `edentext-zoom` — integer percent.
- **Page margins:** `edentext-page-margins` — JSON cm values.
- **Page orientation:** `edentext-page-orientation` — `'portrait' | 'landscape'`.
- **Tab interval:** `edentext-tab-interval` — cm as a decimal string.
- **Spacing model:** `edentext-spacing-model` — `'add' | 'max'`.
- **Recent fonts:** `edentext-recent-fonts` — JSON string array (ToolbarExpanded).
- **Header/footer:** `edentext-header` / `-footer` (HfDoc), `edentext-hf-distances`.
- **Styles:** `edentext-styles` — the style registry (`styles/sheet.svelte.ts`).
- **Document properties:** `edentext-doc-properties` — title/subject/author/keywords/comments (`docProperties.ts`); the key is removed when every field is empty, so a fresh document writes nothing into `meta.xml`.
- **AutoCorrect:** `edentext-autocorrect` — one flag per rule (`autoCorrect.ts`, reactive singleton in `autoCorrect.svelte.ts`), LibreOffice's defaults (all on).
- **Notes:** `edentext-notes` — footnote/endnote numbering and the separator (`noteSettings.ts`, reactive singleton in `notes.svelte.ts`); `applyNoteVars` puts the separator on `:root`, where `editor.css` draws it and `pageBreaks.ts` reserves its band.

## Themes (`theme.ts`, `styles/global.css`)

Four modes: `light`, `dark`, `allBlack` (forces font colors white), `auto` (follows `prefers-color-scheme`). Applied by setting `data-theme` on `<html>`; CSS variables for each theme live in `global.css`. The sheet keeps its own pair through light and dark — white paper, **black** text, the colour LibreOffice and Word draw an uncoloured run in (the app's slate would also differ from a run the file colours `#000000`); only `allBlack` inverts it.
