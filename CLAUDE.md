# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start dev server (Vite, hot-reload, --host)
npm run build    # production build → dist/
npm run preview  # serve the dist/ build locally
npm run check    # svelte-check type-check (svelte + ts, uses tsconfig.json)
npm test         # run the Vitest suite once (tests/**/*.test.ts)
npm run test:watch  # Vitest in watch mode
npm run test:lo  # the LibreOffice round-trip leg only (needs `soffice` on PATH)
npm run test:parity  # render parity vs LibreOffice (see tests/render-parity/README.md)
```

Tests live in `tests/` (outside `src/`, so `svelte-check` ignores them) and run on
jsdom via Vitest (config in `vite.config.ts` `test` field). `tests/roundtrip.test.ts`
covers the ODF export↔import round trip + a foreign-doc/style-resolver leg;
`tests/lo-roundtrip.test.ts` re-saves through LibreOffice and **self-skips** when
`soffice` is absent (so `npm test`/CI stay green). `tests/unit/` holds fast unit tests
for pure helpers (and a few that drive a real editor, e.g. `table-style.test.ts`). All test tooling (vitest, svelte-check, jsdom) is a `devDependency`
and never enters the production bundle. No linter/formatter is configured. CI
(`.github/workflows/ci.yml`) runs `check` + `test` on push/PR.

## Comments

Keep comments precise and short:

- **Never longer than three lines.** No exceptions — file-header comments, tests and config included. A comment that needs a fourth line is explaining what the code already says; cut it back to what the code can't say.
- **Never describe how the current code differs from an older version** (no "previously…", "this used to…", "changed from…"). Comment only what the current code does and why — git history covers the rest.
- **Don't use Word as a placeholder for "a word processor".** Where LibreOffice does the same thing, describe the behaviour itself ("the caret moves", "the zone auto-grows") instead of "Word-style" / "like Word" / "as in Word". Name a product only where the statement really is about that product: its file format (`w:tblLook`, DOCX), or a quirk only it has — then name both if both apply.

## Architecture

A fully client-side, serverless rich-text editor that saves documents as `.odt`. No backend; all state lives in the browser (localStorage).

**Stack:** Svelte 5 (runes: `$state`/`$derived`/`$effect`/`$props`/`$bindable`) + TypeScript + Vite. The editor engine is TipTap 3 (on ProseMirror). ODF export uses `odf-kit` plus `fflate` for re-zipping the `.odt` during post-processing.

### Source layout

```
src/
  App.svelte                – app shell + app-level state
  lib/
    components/             – all Svelte UI (toolbars, pickers, dialogs, Editor, HeaderFooterLayer)
    editor/
      extensions.ts         – the TipTap extension registry (assembles the list below)
      extensions/           – the custom TipTap/ProseMirror extensions, one file per feature
    utils/                  – framework-free helpers (fontDetect, specialChars, wordCount,
                              orderedListTypes, historyLog, colorDebug)
    export/ import/ spell/ storage/  – ODF I/O, spell-check, and persistence modules
  styles/                   – global.css + editor.css
```

Naming: components are `PascalCase.svelte`, every `.ts` module is `camelCase`; extension files are named by feature (`image.ts`, `indent.ts`, …), not `XyzExtension.ts`.

### Data flow

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

### Custom TipTap extensions (`src/lib/editor/extensions/`)

Listed in `extensions.ts` (one level up, at `src/lib/editor/`). Beyond the TipTap built-ins (Bold, Italic, Underline, Highlight `multicolor`, TextStyle/FontFamily/FontSize, Heading, HardBreak, lists, Table family, History, Placeholder, TextAlign):

- **`fontColor.ts`** (`FontColor`) — adds a `color` attr on the TextStyle mark; also emits `data-color` so theme CSS (allBlack) can target color-bearing spans.
- **`fontWeight.ts`** (`FontWeight`) — adds a `fontWeight` attr on TextStyle (e.g. set `normal` to un-bold a heading without changing the node type).
- **`textEffects.ts`** (`TextEffects`, `UnderlineStyled`, `StrikeStyled`) — the character effects beyond bold/italic that both formats carry and CSS can draw: `caps` (`uppercase`/`lowercase`/`capitalize`/`smallCaps` → `text-transform`/`font-variant-caps`) and `textPosition` (pt above the baseline → `vertical-align`, independent of sub/superscript) as TextStyle attrs, plus `lineStyle`/`lineColor` on the **underline** mark and `lineStyle` on **strike** (the `<u>`/`<s>` element draws the line, so its shape belongs there). Replaces TipTap's bare Underline/Strike in `extensions.ts` **and** `hfExtensions`. `caps` is also a `TextProps` key, so a named style can carry it. **DOCX**: `w:caps`/`w:smallCaps` (toggles — a run may switch a style's off), `w:u w:val`+`w:color`, `w:dstrike`, `w:position` (`ST_SignedHpsMeasure`: a bare number is half-points, else a measure with its unit). **ODF**: `fo:text-transform`/`fo:font-variant`, `style:text-underline-style`/`-type`/`-color`, `style:text-line-through-type`, `style:text-position` (a percentage of the font size, so the pt value is converted against the run's own size). odf-kit's run formatting has a field for none of them, so `markTextEffects` prefixes the `TEF` sentinel (U+E00F) on the run and `applyTextEffects` folds the attributes into that run's automatic text style — before `applyCharacterStyles`, which then clones the style that already carries them. `tests/lo-roundtrip.test.ts` is what proves LibreOffice reads each one back.
- **`lineHeight.ts`** (`LineHeight`) — `lineHeight` attr on paragraph/heading. Note `LINE_HEIGHT_RATIO = 1.15`: ODF line spacing multiplies the font's *natural* line height (Liberation Serif ≈1.15× em), CSS multiplies the font size — so the on-screen value is scaled to match what LibreOffice renders.
- **`paragraphSpacing.ts`** (`ParagraphSpacing`) — `spaceBefore`/`spaceAfter` attrs in **pt**, round-tripping 1:1 to `fo:margin-top`/`fo:margin-bottom`.
- **`paragraphBox.ts`** (`ParagraphBox`) — paragraph/heading **background** (`backgroundColor`, "colored field") + per-side **borders** (`borderTop/Right/Bottom/Left`, "rule line"), as in Word/LibreOffice letterheads. Borders reuse table cells' canonical `'<W>pt solid #RRGGBB'` (from `tableCellBorders.ts`), but here `null`/absent = no border. Commands `setParagraphBackground`/`setParagraphBorders(preset, spec)`; `activeParagraphBorderPresets` drives the picker states. An input rule turns a paragraph typed as `---`/`___`/`===` into an empty bottom-rule line (the border-line AutoCorrect); attrs are `keepOnSplit: false` so the box doesn't cascade onto the next paragraph on Enter. In both `extensions.ts` (body) and `hfExtensions` (header/footer). **ODF**: import reads `fo:background-color`/`fo:border-*` in `blockAttrs` (body) and merges them across the collapsed header/footer paragraphs (`convertHfZone`, first/last heuristic — bottom rule from the last line); export emits them via `ParaStyle`/`paraStyleProps` for cells/lists, a `PBX`-sentinel post-process (`applyParagraphBoxes`, odf-kit has no such options) for top-level body paragraphs, and `applyHfPostProcess` for the Header/Footer styles. **DOCX**: `w:shd`/`w:pBdr` (import `readParaBox`, export `paraShadingOf`/`paraBordersOf`). UI: a paragraph-shading `ColorPicker` + `ParagraphBorderPicker.svelte` in `ToolbarExpanded.svelte` (route via `activeEditor`, so body and the active HF zone).
- **`indent.ts`** (`Indent`) — `indent` attr in **cm** (rendered as `margin-left`), on paragraph/heading **and** bulletList/orderedList. `indentMore`/`indentLess` step a paragraph/heading by `INDENT_STEP_CM = 1.25` → `fo:margin-left` (odf-kit `indentLeft`); `indentListMore`/`indentListLess` step the innermost list's `indent`, shifting the whole list (export adds it to the L# list-style level margins, see `applyListIndents`). `indentListForward`/`indentListBackward` apply one Word/LibreOffice step to the list point (bullet + text): **forward** shifts the whole list when the cursor is in the first item or the whole list is selected (`indentListMore`), otherwise nests the item (`sinkListItem`); **backward** is the inverse — it peels back the innermost list's own `indent` first (`indentListLess`), then lifts a *nested* item out one level (`liftListItem`), and at the base level (no margin, not nested) does nothing. So a list point steps left one tab-stop at a time and never gets dissolved into a paragraph — Shift-Tab keeps list points as list points. They return false outside a list. `indentRight` is the mirror of `indent` (`fo:margin-right` / `w:ind w:right`; ODF export rides the PBX sentinel, since odf-kit has no right-indent option). `setIndent(cm)`/`setIndentRight(cm)`/`setIndentFirst(cm)` write one indent outright (what the ruler drags; the buttons step relatively) — all go through the same `write` walk. The exported `listContext(state)` (cursor in a list? whole list targeted? innermost list indent? list nested inside a parent list item?) is their shared helper. Both the toolbar's `changeIndent` and the **Tab**/**Shift-Tab** keymap call these: in a list Tab/Shift-Tab run `indentListForward`/`indentListBackward`; outside a list Tab inserts a real tab character (`\t`, rendered via `tab-size: 1.25cm`) and Shift-Tab runs `indentLess` (`changeIndent` uses `indentMore`/`indentLess`). The keymap bails inside table cells so the Table extension's Tab keeps navigating between cells. `Indent` sets `priority: 1000` so its Tab/Shift-Tab win over `ListItem`'s built-in sink/lift bindings — without it, TipTap's reverse-then-priority-sort lets the later-registered `ListItem` handle the key first (its `liftListItem` would dissolve a top-level list item into a paragraph on Shift-Tab).
- **`tabStops.ts`** (`TabStops`) — per-paragraph tab stops (Word's `w:tabs`, ODF `style:tab-stops`). Global attr `tabStops` on paragraph/heading, rendered as `data-tab-stops`; canonical string `'<cm><align code>'` per stop, `;`-separated (`'6c;12r;16d'`, codes `l|c|r|d`), parsed only by the exported `parseTabStops`/`formatTabStops`. Positions are **cm from the left text margin** — the origin Word and ODF share, verified by probe (a Word stop at 100mm in a 30mm-indented paragraph stays 100mm in ODF and LibreOffice renders it there), so neither I/O side shifts them by the paragraph indent. **Rendering**: CSS only has the fixed `tab-size` grid, so a rAF measuring plugin (shaped like `pageBreaks.ts`, whose `FORCE_PAGE_RECALC` it both listens to and fires) computes each tab's advance from `coordsAtPos` against `.tiptap`'s content edge and emits `Decoration.inline(tab, tab+1, {style:'tab-size:0;margin-left:Npx'})` — `tab-size:0` collapses the tab's own advance, the inline margin supplies the exact width, so no `display` change and no baseline/line-height side effects. The margin is on the **left** because the gap is the tab's own advance: as `margin-right` a caret placed after the tab rendered before the gap, i.e. at the pre-tab x until the next keystroke. The pen position is read with **side −1** (the end of the content before the tab), which lies outside the tab's own span — measuring the tab itself would fold the margin just applied back into the next pass's reading. `nextStop` takes the first custom stop right of the tab, else leaves the tab undecorated (past the last custom stop the CSS grid already does the right thing, which is also why custom stops suppress the default ones to their left). A **negative `indentFirst` implies a stop at the block's indent** (the hanging-indent stop). Centre/right/decimal measure the segment up to the next tab; a segment that wraps degrades to left. Passes converge (one more tab settles per pass, `MAX_PASSES`), since a stop can rewrap the line. **UI**: `Ruler.svelte`. Body only — an inactive header/footer zone is static `generateHTML` output no plugin reaches.
- **`listMarker.ts`** (`ListMarker`) — the marker's **family, weight, slant, size and color**, taken from the item's **first text portion** (`markerFormat`): a mark lives inside the item's paragraph and never reaches `::marker`, which only inherits the `li`'s own font, so a bold numbered heading would keep a light number. A **character style** on that portion is resolved through the registry (`charStyleProps`, handed in by the caller: the plugin from its `sheet` option, the exporters from their `exportSheet`); what a **named paragraph style** provides reaches the marker through `styleCss`'s `li:has(> …)` rule instead. First portion, not the whole line, is LibreOffice's own numbering rule (verified by probe: bold-then-plain gets a bold number, plain-then-bold does not; Word instead takes the paragraph mark). **Rendering**: a node decoration puts `--marker-family/-weight/-style/-size/-color` on **every** `listItem` — they inherit, so an item without its own format resets them to `initial` (the guaranteed-invalid value, so the `var(…, inherit)` in `editor.css` falls back; `inherit` would pull the parent item's value in), and `editor.css` has one rule reading them on the item block's `::before` — which is what **draws** the marker: `::marker` cannot be positioned, and Chromium sets it flush against the text, ~4mm right of the level's hanging indent (`LIST_HANGING_CM` 0.635cm, what both exports write). The pseudo is **absolutely positioned** at that indent, because in flow it grew every list line by a pixel. `list-style: none` drops only the marker box, so the `list-item` counter and `<ol start>` keep numbering, and `content: counter(list-item, …)`/`counters(list-item, '.')` per `data-eff-list-style` replaces `list-style-type`; a `bulletChar` rides `--bullet` (an `attr()` inside the pseudo would read the block, not the list). `export/pdf.ts` switches the pseudo off and injects the same marker as a real span, since html2canvas cannot paint counters. The bullet shim keeps the symbol font first and takes `--marker-family` as its fallback. The pass also re-runs on `FORCE_PAGE_RECALC`, so editing a character style repaints the markers. **Export**: both formats carry marker formatting **per level**, so `listMarkerFormat` returns one only when *every* item of the list agrees — ODF mints a **named** `style:family="text"` style **in styles.xml** and points the level definition at it via `text:style-name` (`collectListMarkerFormats`/`applyListMarkerFormats`) — LibreOffice ignores the reference when it resolves to an automatic style in content.xml (probed), DOCX writes the level's `w:rPr` (`markerRunProps` → `ILevelsOptions.style.run`). A **mixed** list gets no level format on purpose: LibreOffice then applies its first-portion rule and matches the editor, Word falls back to the paragraph mark (which only carries the size). Import needs nothing — the runs already carry the formatting. Nested lists that odf-kit restyles (`applyNestedListTypes`) and in-cell lists keep a plain marker. A character style **inside a list item** is handled by an ODF pre-pass (`bakeListCharStyles`) instead: odf-kit's list builder reads marks itself and knows nothing about `charStyle`, and `applyRuns` never sees a list paragraph, so the pre-pass does both of its jobs — bake the resolved props into direct marks (which is what gets the run a `<text:span>` at all) and prefix the `CST` sentinel, so `applyCharacterStyles` re-points that span at the named style like everywhere else. Formatting and name both round-trip. `tests/unit/list-marker.test.ts` covers the four LibreOffice cases, the reset, and both export legs.
- **`formattingMarks.ts`** (`FormattingMarks`) — decorations marking spaces (`·`) and tabs (`→`) when `.paper.show-formatting-marks` is set.
- **`dateTimeField.ts`** (`DateTimeField`) — inline atom for an inserted date/time field (Word's "Insert Date and Time"). Attrs: `kind` (`'date'|'time'`), `format` (a catalog key), `fixed`, `value` (ISO local datetime captured at insert). A **fixed** field renders its stored `value`; an **auto** field renders the *current* moment on every load (`renderHTML`/`renderText` via `dateTimeFieldText`) — no plugin, Word/LibreOffice likewise only refresh on open. As an inline atom with no children it can't inherit the surrounding run's font from a sibling span, so it **carries that run's marks** on the node: insert adopts the cursor's stored marks, and both importers attach the field run's resolved marks (else it falls back to the editor default font). Command `insertDateTimeField({kind,format,fixed})`. Formats live in `utils/dateTime.ts` as a **token model** (one `Token[]` per format) so the three consumers stay in agreement: `renderFormat` (locale display via `Intl`), `odfNumberStyle` (`<number:date-style>`/`<number:time-style>` body), `docxPicture` (Word field switch). `DateTimePicker.svelte` (a dropdown next to `SpecialCharPicker` in `ToolbarExpanded.svelte`) lists live samples + an "update automatically" checkbox. Not in the header/footer schema (there a `<text:date>`/DATE field stays plain text). **ODF**: `replaceDateTimeFields`/`applyDateTimeFields` (sentinel U+E00A, mirrors images) emit `<text:date text:date-value text:fixed style:data-style-name>`/`<text:time text:time-value …>` + a minted per-format number style (language from the export doc language; `ensureNumberNamespace` adds `xmlns:number`); import matches the referenced number style back to a format via `parseNumberStyleTokens` + `matchFormat` (unknown ⇒ keep the shown text). **DOCX**: auto → `SimpleField` `DATE`/`TIME \@ "picture"` with a cached run; fixed → a plain text run (Word has no fixed-date field); import maps a `DATE`/`TIME` `fldSimple`/complex field's picture back to a format (`dateTimeFieldFromInstr`).
- **`image.ts`** (`Image`) — inline, as-character image atom (Word's "in line with text"). Attrs: `src` (data-URI), `alt`, `width`/`height` (**unscaled doc px @96dpi**, like `rowHeight`), `rotation` (CW degrees). The node view nests an `<img>` in a rotated "rotor" inside an axis-aligned wrapper that reserves the rotated bounding box (so text reflows around it). The rotor's transform makes it a stacking context, so a selected `.image-node` is given a `z-index` above the header/footer layer to keep handles that poke into a margin grabbable. It has eight zoom-aware resize handles — corners aspect-locked, edges single-axis (width- or height-only) — plus a rotation-arrow grip, and shows a live "Width … × Height …" (cm) badge while resizing; resize deltas are un-rotated onto the image's own axes so handles track the pointer at any angle (drag math mirrors `tableRowResize.ts`; width cap = the cell or page-text-column, height cap = the page text height). `setImage` command inserts it; the toolbar button (ToolbarExpanded), drag-drop and paste (Editor.svelte) read the file via `FileReader` → data-URI and clamp the initial size to the page text box. **Text wrap:** the `wrap` attr (`'inline'|'left'|'right'|'topBottom'`) makes the image a *floating* frame — `ImageToolbar.svelte` (a per-image floating toolbar wired in `Editor.svelte` like `TableToolbar`) sets the mode; `left`/`right` float the wrapper at its anchor paragraph (text flows on the open side via CSS `float`), `topBottom` is a **full-width `float`** (text only above/below). All modes use `float` deliberately: an in-flow `display:block` on an inline-atom node view splits the paragraph's inline content into anonymous block boxes, which desyncs ProseMirror's inline view descriptor and makes it drop the following page-break spacer widget; a float is out-of-flow and avoids that. Dragging an **inline** image runs ProseMirror's native node move (the `dropCursor` plugin shows the caret). Dragging a **floating** image runs a custom drag (`ImageView.startReposition`) that **live re-anchors** the node to the text position under the cursor, so the float and text reflow in real time as you drag; it's rAF-throttled and only moves when the cursor's line changes (a float can't move within a line), and stays a single undo step (first move records history, later moves are `addToHistory:false` and get rebased on undo). A paragraph that contains an image paginates **atomically** (`pageBreaks.ts` — pushed whole to the next page, spacer placed before it) so a page break never splits the paragraph next to the image's float (where ProseMirror drops the spacer widget). **Frame offsets:** `wrapOffset` is the frame's left edge in the text column (Word's `positionH` posOffset, ODF `svg:x`), rendered as the float's near/far margin against the live column vars — an indented anchor paragraph can't skew it — and shared with `textBox.ts` through `frameMargins`. `wrapOffsetY` (`positionV`, `svg:y`) round-trips but is **not rendered**: a line box avoids a float's whole *margin* box, so a top margin would make dead space where Word flows text (measured on the thesis fixture: 131mm off became 187mm, and the document grew a page). Browsers can't wrap text around a freely-positioned box (CSS Exclusions are unimplemented), so a frame's vertical place stays the anchor paragraph's. Inline images stay as-char. Works inside table cells. Not available while editing a header/footer (the HF schema has no image node). Images live as data-URIs in the autosaved JSON; `autosave.ts` warns once if that exceeds the localStorage quota.
- **`textBox.ts`** (`TextBox`) — block-level text box / basic shape with editable block content (`content: '(paragraph|heading|bulletList|orderedList)+'`, `isolating`). Attrs: `width`/`height` (px @96dpi; height renders as **min-height** — content grows the box), `rotation` (CW deg), `wrap` (image's `WrapMode`; `inline` renders in-flow, floats via CSS `float` like `ImageView.applyWrap`), `shapeKind` (`'textbox'|'roundRect'|'ellipse'` — ellipse renders via `border-radius:50%`), `fillColor`/`strokeColor` (`null` = transparent/no border), `strokeWidthPt`. Padding is the fixed `TEXTBOX_PADDING_CM` (0.15cm). The node has its **own group** (`group: 'textBox'`) so only the document admits it (`extensions.ts` widens Document to `'(block | textBox)+'`) — never in table cells, lists, header/footer, or other boxes; imports found there are flattened with a warning. `TextBoxView` mirrors `ImageView` (wrapper reserving the rotated bbox → rotor carrying fill/stroke/rotation → `contentDOM`); the rotor is out of flow and auto-grows, so a ResizeObserver refits the wrapper. **Click model (Word-like):** `stopEvent`/`isFrameHit` claim mouse events on a ~6px frame ring (rotation-/zoom-aware) → NodeSelection + handles (the shared `image-*` handle classes/CSS); clicks further inside pass to ProseMirror (caret). The box is browser-`draggable` only while node-selected, so PM's native block drag moves it without hijacking text selection. Commands: `insertTextBox()` (after the current top-level block, cursor inside), `setTextBoxAttrs()` (NodeSelection *or* cursor inside; helper `findTextBox`). `TextBoxToolbar.svelte` (wired in `Editor.svelte` like the image toolbar, also shown while the caret is inside a box) sets wrap/shape/fill/stroke. `trailingNode.ts` appends a paragraph after a trailing box; `pageBreaks.ts` paginates `.textbox-node` atomically.
- **`columns.ts`** (`Columns`) + **`columnsFlow.ts`** (`ColumnsFlow`) — multi-column (newspaper) layout with **cross-page flow** and **Word's sequential fill order**: column 1 fills to the page bottom, then column 2, then the next page — via per-fragment node decorations carrying `height:…;column-fill:auto` (full page slot for fragments with a continuation; content height + `OPEN_HEIGHT_SLACK_PX` for the open last fragment of a document-final chain, so typing grows column 1 first without one-frame flashes into column 2). A chain followed by real content keeps its last fragment undecorated → CSS `column-fill: balance` (Word balances the end of a continuous section). Because the box height is the plugin's own decoration, overflow/join decisions use content-based estimates (`contentHeightPx` = block rects + collapsed margins), not the rendered height. A section is a block region (`content: '(paragraph|heading|bulletList|orderedList)+'`) rendered as CSS multi-column (`column-count`/`column-gap` inline via `renderHTML`; no NodeView, no visual affordance — it must read as plain flowing text, so NOT isolating/selectable: selection, Backspace, and joins cross its boundary). Attrs: `count` (2–3) and `gapCm` (default `DEFAULT_COLUMN_GAP_CM` 0.5, clamp 0–5). Own group like textBox (Document is `'(block | textBox | columns)+'`). **Chain model:** the document may hold a section as several *adjacent equal-attr fragments* — the user-visible section is the maximal run (`columnsChain`); commands, export, and import all treat a chain as one section. **Cross-page flow (`columnsFlow.ts`):** a rAF layout pass (mirroring pageBreaks' geometry via the exported `readVerticalMargins`) keeps the fragmentation in sync with the page grid — an overflowing fragment is **split** at a block boundary so the maximal prefix fills its page (balanced-height estimate = Σ block `getClientRects` heights / count), and a fragment with room **joins** the adjacent continuation back (the split pass then re-splits at the right point). One op per pass, `addToHistory: false` (layout-only; undo of user edits just re-flows), composition-guarded, pass-budgeted (`MAX_FLOW_PASSES`, reset per external change). **pageBreaks.ts cooperation:** a `.columns-node` leaf carries `columnsFragment` (block count + first-block fit estimate); on bottom overflow pageBreaks *waits for the flow* when the fragment is splittable and its first block fits the remaining space, pushes it whole when mid-page (even taller-than-page), and at a page top does nothing (`columns-line-split-pending` — pushing a page-tall fragment just moves the problem down forever). Both sides use the shared `COLUMNS_FIT_MARGIN_PX` for the first-block fit test — differing thresholds make split/push/join cycle at the boundary; the flow's join `HYSTERESIS_PX` must exceed the estimate error for the same reason. **Page boundaries cut mid-paragraph at line boundaries** (`splitParagraphInBlock`): the flow measures a paragraph's rendered lines (document-order rects; a top jump = new line), converts the page's leftover content budget into a line count, finds the boundary text position via `posAtCoords`, and does a depth-2 `tr.split` whose second part carries the layout-internal **`joinPrev`** paragraph attr (a global attr minted by the Columns extension; never rendered/parsed, `keepOnSplit: false`). Used in two places: a paragraph taller than the whole page slot (`force` — at least one line stays), and the **boundary block** after `k` whole blocks fit (leftover room ≥ `MIN_TAIL_LINES` — so the last column of a page is filled instead of pushing the next paragraph out whole); the join side mirrors it by pulling a multi-line paragraph head at ~two line rows of room (partial pull; the re-split hands the excess back). A live per-fragment analysis is exposed via `getColumnsFlowDebug` and included in the dev Debug dump (`columnsFlow` key). pageBreaks skips the empty trailing paragraph after a document-final chain (`trailing-empty-after-columns`) so a sequential-fill box reaching the page bottom doesn't mint a phantom page. Joins reverse it: a fragment join uses depth 2 when the continuation head is a joinPrev paragraph (needing only ~one line row of space), and a stray joinPrev paragraph *inside* a fragment merges into its predecessor immediately. `mergeJoinedBlocks` (columns.ts) restores whole paragraphs on unwrap/absorb; `mergeJoinedParagraphsJson` (export/odt.ts, shared with docx.ts) does the same before serializing, so files always hold the original single paragraph. Commands: `setColumns(n)` — inside a section 1 unwraps the whole chain / 2–3 update it; outside with a selection, 2–3 wrap the covered top-level blocks (absorbing existing sections; fail on tables/boxes/TOCs); with a **bare cursor, the whole document** gets columns (Word behavior; wrappable runs around tables become one section each) — and `setColumnGap(g)` (chain-wide); helper `findColumns`. UI: a Columns dropdown in `ToolbarExpanded.svelte` (1/2/3 buttons + gap input, tick-derived active state). `trailingNode.ts` appends a paragraph after a trailing section. **ODF**: exported via the textBox-style sentinel hoist (`replaceColumns`/`applyColumns`, U+E009) as `<text:section>` + a minted section style with `<style:columns fo:column-count fo:column-gap>` — adjacent equal-attr fragments **coalesce into one section**; import resolves via `StyleResolver.sectionColumns` (gap also derived from per-`style:column` indents), wraps runs of allowed blocks (`pushColumnRuns`), moves tables/boxes out with a warning (columns nodes from inner sections pass through silently), clamps >3 columns (the flow re-fragments after load); Word-style **page-layout columns** (`<style:columns>` in `style:page-layout-properties`, no `text:section`) are read via `StyleResolver.pageColumns` and wrap the whole body the same way. **DOCX**: full support — export splits the body into multiple `docx`-lib sections (`bodyGroups`; continuous breaks, `w:cols` with gap in twips, page geometry + fresh header/footer refs per sectPr, fragments coalesced); import groups body children on mid-body `pPr>sectPr` paragraphs (`splitBodySections`, empty markers dropped) and wraps groups whose sectPr has `w:cols w:num>1` — covering whole-document multi-column files via the body-final sectPr. A section whose own `w:type` is a page-starting break (nextPage/oddPage/evenPage, or absent = the default; `sectionStartsNewPage`, not `continuous`/`nextColumn`) tags its first block with `breakBefore:'page'` so the section starts on a new page like Word.
- **`pageBreaks.ts`** (`PageBreaks`) — pagination plugin (see below).

### State / table extensions

- **`tableView.ts`** (`TableView`) — custom table node view. Unlike TipTap's built-in view it renders the `<colgroup>` with **percentage** widths and keeps the table at `width:100%`, so the table fills its wrapper (by default the full text width, matching the ODT export) and stays responsive to margin/orientation changes. The per-column `colwidth` cell attrs are treated as proportional *weights* (only ratios matter; `null` = equal share). The table's own `marginLeft`/`marginRight` attrs (cm, from the outer-edge drag) go on the `.tableWrapper` — that's what narrows the table.
- **`tableRow.ts`** (`ResizableTableRow`) — `TableRow` extended with a `rowHeight` attr (unscaled doc px @96dpi), rendered as a CSS min-height (`height` on `<tr>`), exported as `style:min-row-height`. `Table` (unlike `TableKit`) does NOT auto-add child extensions, so `ResizableTableRow` must be listed explicitly.
- **`tableColumnResize.ts`** (`TableColumnResize`) — Word-style column drag: dragging an *inner* border trades width between two columns only (their sum stays constant, table width fixed). Live feedback pokes the `<col>` elements; release writes new weights into `colwidth`. The table's **outer left/right edges** are draggable too (Word/LibreOffice): they move that edge alone — the pure `edgeResize` helper shifts the global `marginLeft`/`marginRight` attrs it adds on `table` (cm, `>= 0`, so the table never leaves the text area) and resizes only the adjacent column, so every other gridline stays put; the minimum is `CELL_MIN_PX`. `borderAt` classifies a hovered border as `inner`/`left`/`right`, the handle decoration mirrors to the cell's left side (`.column-resize-handle.left`), and the commit writes `colwidth` + the table attrs in one transaction. `TableView` renders the margins on the wrapper; the attrs' own `renderHTML` emits them (plus a matching `width: calc(...)`) for the static HTML paths (PDF export, clipboard). They round-trip as ODF `fo:margin-left`/`-right` + `style:width` (`applyTableMargins`) and DOCX `w:tblInd` + the narrower `w:tblGrid`.
- **`tableRowResize.ts`** (`TableRowResize`) — Word-style row-height drag (changes the row *above* the grid line; min-height semantics). Yields to column resize at a corner.
- **`tableSplit.ts`** (`TableSplit`) — Word/LibreOffice "Split Cells…": adds `splitCellInto(cols, rows)` (prosemirror-tables only ships `splitCell` = un-merge). Reads the grid via `TableMap`, expands it (duplicating the cell region's right-edge column / bottom-edge row so every other cell crossing a new grid line grows its span — the bridging Word does), partitions the region into `cols`×`rows` sub-cells (first keeps the original content), recomputes `colwidth` weights, and rebuilds the table node in one step. **Merge** uses extension-table's built-in `mergeCells` (drag/shift-click `CellSelection` via the always-on `tableEditing` plugin). Both are surfaced by `TableToolbar.svelte` (Merge button + Split button → `TableSplitDialog.svelte`).
- **`tableCellBackground.ts`** (`TableCellBackground`) — adds a `backgroundColor` attr to `tableCell`/`tableHeader` (rendered as the cell's CSS background), set via extension-table's built-in `setCellAttribute` (so it applies to a whole `CellSelection` or the cursor's cell). `TableToolbar.svelte` exposes it via a reused `ColorPicker` (cell shading); round-trips to ODF `fo:background-color` (export/import below). Survives split/merge (attrs are carried through).
- **`tableCellBorders.ts`** (`TableCellBorders`) — Word/LibreOffice border control: per-side attrs `borderTop/Right/Bottom/Left` on `tableCell`/`tableHeader` (`null` = the table default 0.5pt black, `'none'`, or canonical `'<W>pt solid #RRGGBB'`; rendered as per-side inline CSS — pt→px, min 1px — plus `data-border-*` for HTML parse). `setTableBorders(preset, spec)` applies a preset (`all`/`outer`/`inner`/`innerH`/`innerV`/`top`/`bottom`/`left`/`right`; spec `null` = no border, the default 0.5pt-black spec normalizes to `null`) to the selected cell region (`selectedRect`), writing **both sides of every affected boundary** — including the facing side of neighbour cells *outside* the region — so collapsed borders never disagree between adjacent cells. Surfaced by `TableBorderPicker.svelte` (dropdown in `TableToolbar.svelte`: preset grid + line width + line color; presets apply with the picker's current pen settings). **Word-like button states**: `activeBorderPresets(state, pen)` marks a preset active when every boundary it targets renders exactly the pen border — width *and* color, where a boundary's effective border is the collapse winner of its two facing cell sides and attr `null` counts as the 0.5pt-black default — so a fresh table lights the presets up under the default pen and a thicker pen turns them off; `'none'` is active when the region is borderless. Clicking an **active** preset toggles those borders off; an inactive one applies the pen. The panel stays open on preset clicks so the states visibly update. Round-trips to ODF `fo:border-*` (export → odf-kit `CellOptions.border*`, `null` falls back to the table's default border; import via `StyleResolver.cellBorders` + `borderAttrFromOdf` — an undeclared side ⇒ `'none'`, the 0.5pt-black default ⇒ `null` with unit tolerance, non-solid styles coerced to solid) and DOCX `w:tcBorders` (import also resolves table-level `w:tblBorders` by cell position; sides nothing declares stay `null` = default).
- **`tableCellPadding.ts`** (`TableCellPadding`) — the table's **cell margins**, a global `cellPadding` attr on `table`: `[top, right, bottom, left]` in cm, `null` = the default `[0, 0.19, 0, 0.19]`, which is Word's own and what `editor.css` falls back to — so an ordinary table carries no attr. A side within `SAME_CM` (0.005cm) of the default *is* the default, or Word's 108 twips (0.1905cm) and LibreOffice's 0.191cm would tag every table. Rendered as one `--cell-pad` custom property (the attr's `renderHTML` for the static paths, `TableView` for the node view, since it bypasses `renderHTML`) that `td/th { padding: var(--cell-pad, 0 0.19cm) }` reads. **DOCX**: `w:tblPr/w:tblCellMar` direct, else the table style's (`DocxStyles.tableCellMar` walks `w:basedOn`); export writes `Table.margins`. **ODF** has no table-level cell margin — it sits on each cell's style, so import takes the first cell's `fo:padding*` for the table and export rides the value on every cell as a CSS-style TRBL shorthand that `expandCellPadding` splits per side (odf-kit only writes the `fo:padding` shorthand, and ODF allows it only one length). Getting this wrong is not cosmetic: a 0.71cm bibliography marker column lost 0.38cm to the old constant and wrapped `"[2] "` onto three lines.
- **`tableHeaderRow.ts`** (`TableHeaderRow`) — "header row" as a **styling preset** (not the structural ODF header that repeats per page, by design): `toggleHeaderRowStyle` sets/clears a **light-grey fill (`HEADER_SHADE` `#F2F2F2`)** on the first row's cells; `isHeaderStyled(state, axis)` drives the toolbar toggle's active state. **A table carrying a table style owns these two areas through its Table Style Options instead**: there `toggleHeaderStyle`/`isHeaderStyled` read and write `headerRow`/`firstColumn` in the table's `tableLook` (delegating to `setTableLook`), so the toolbar button and the gallery's checkbox are one state and can't disagree. Both also read their label from the same key (`styles.regions.*`), so they can't drift apart in wording either — the button used to say "header column" where the checkbox said "first column". The fill is the *marker* and **round-trips natively** as `fo:background-color`, so the toggle state survives reopen with no `table:table-header-rows` (⇒ Word/LibreOffice don't repeat it). **Bold is presentational, exactly like a heading**: `tableCellBackground.ts` tags a header-shaded cell with `class="cell-header"` and `editor.css` renders `.cell-header` bold — so *all* its text is bold (existing, typed, pasted, IME) without storing marks, and it stays **editable** via the `fontWeight:'normal'` override (the `Toolbar.svelte` Bold button treats `isInHeaderCell` like a heading: toggles `setFontWeight('normal')`/`unsetFontWeight`). Export (`export/odt.ts`) **bakes** bold onto header-shaded cells' runs (`applyRuns(..., forceBold)`, skipping `fontWeight:'normal'` runs) so Word/LibreOffice match; import (`import/odt.ts`) converts those cells' runs with `boldByDefault` (bold run → no mark, normal run → `fontWeight:'normal'`), mirroring headings. `TableToolbar.svelte` exposes the toggle button.

- **`tableStyle.ts`** (`TableStyle`) — the **table style** family's editor half (model in `styles/tableStyles.ts`, see below): global attrs `tableStyle` on `table` (⇄ `data-table-style`) and `region` on `tableCell`/`tableHeader` (⇄ `data-region`, a space-separated region list). `setTableStyle(name|null)` writes the attr and **materializes** the style into the cells in one transaction — `paintTable` walks the `TableMap`, resolves each cell via `resolveTableCell` (merged cells by their top-left `findCell` box) and writes `backgroundColor`/the four border attrs/`region`, so **export, PDF and clipboard need no new code**. It only writes cells that differ, which makes it idempotent — the condition the re-band plugin depends on. That plugin (`appendTransaction`) repaints a styled table when its row/column **shape** changes (Word's re-banding); deliberately *not* on every transaction, or a manually shaded cell would be repainted away immediately. `refreshTableStyles()` repaints every styled table and is called from `Editor.svelte`'s document-stylesheet `$effect` — the choke point every registry change (edit, rename, reset, import) passes through. `activeTableStyle`/`cellRegionText` feed the gallery and the Bold button (a style's bold region behaves like a heading, see `tableHeaderRow.ts`). `TableView` sets `data-table-style` itself, since the node view bypasses `renderHTML`.

We deliberately keep TipTap's `resizable: false` (so its own columnResizing plugin isn't loaded) and supply the custom view + drag plugins instead.

### Named paragraph styles (`src/lib/styles/`, `editor/extensions/paragraphStyle.ts`)

LibreOffice's model: a style has a name, a **parent** it inherits from, a follow-on style, and two
property groups (`ParaProps` layout / `TextProps` text). `styleSheet.ts` is framework-free — the
built-ins (Standard → Heading → Heading 1–5 / Title / Subtitle, plus Quotations), `resolveStyle`
(parent chain root-first, nearest wins, cycle-safe), `styleOrder`, and `styleCss`. `sheet.svelte.ts`
holds it as a reactive singleton persisted to `odf-editor-styles` (same shape as `i18n.svelte.ts`).

- **Assignment**: the `ParagraphStyle` extension adds a global `styleName` attr on paragraph/heading,
  rendered as `data-style`. `setParagraphStyle(name)` switches the node type when the style has an
  `outlineLevel` (heading) and **keeps hard formatting**, as in Word/LibreOffice;
  `clearDirectFormatting()` (Ctrl+M, also the ToolbarExpanded eraser button) drops marks and the
  style-governed block attrs but keeps the style and hyperlinks. `blockStyleName(node)` resolves a
  block's style (own → heading level → Standard).
- **Rendering**: `Editor.svelte` writes `styleCss(sheet)` into a `#document-styles` element on every
  change (then a `FORCE_PAGE_RECALC` so pagination re-measures). One rule per style keyed by
  `data-style`, plus `hN:not([data-style])` fallbacks for imported headings, plus a **text-only
  rule for the list item carrying the block** (`li:has(> …)`): a list marker inherits the item's
  own font, never its paragraph's, so without it the number renders in the editor default while
  the text it labels follows the style (see `listMarker.ts`). `editor.css` only keeps
  a neutral `font: inherit; margin: 0` reset for `h1`–`h5`; all heading typography comes from the
  styles. Inline attrs/marks still win — the Word/LO precedence.
- **ODF I/O is style-aware.** *Export*: `buildOdt(…, styles)` takes the sheet;
  `applyNamedStyles` (inside `rewriteStylesXml`) writes every built-in plus the user styles the
  document references — merged into the blocks odf-kit already emits, appended otherwise, with
  `style:parent-style-name`/`-next-style-name` so the chain stays a chain. `stripManagedProps`
  first drops the producer's values for the properties the model owns, so anything a style leaves
  open really inherits. A block whose style isn't the ODF default for its node type carries a
  `STY` sentinel (U+E00D, `hasCustomAttrs` routes it through `applyRuns`); `applyParagraphStyles`
  then either points it at the named style or clones its automatic style with the named one as
  parent — so direct formatting keeps overriding the style.
  *Import*: `StyleResolver.namedParagraphStyles()`/`namedAncestor()` separate the file's named
  styles from automatic ones (= direct formatting). `collectStyleSheet` keeps the styles blocks
  actually reference plus their parent chains (own props = resolved minus the parent's, so
  relative sizes and repeated values don't land raw) over the built-ins, and `OdtImportResult.styles`
  hands them to `App.svelte`. Suppression no longer compares against constants: `blockDefaults`
  builds a per-block **yardstick** from the block's named style (size, margins, indent, font, bold,
  color, italic/underline/strike), and only what exceeds it becomes direct formatting. Only
  top-level blocks get a `styleName` — list items and cells reference producer plumbing styles.
- **DOCX I/O works the same way.** *Export*: `buildDocx(…, styles)` emits the registry as
  docx-lib `paragraphStyles` (`id` via `docxStyleId` — "Heading 1" → `Heading1`, "Standard" →
  Word's `Normal` — plus `basedOn`/`next`), and every paragraph carries `style:` instead of a
  heading level (`Heading1` is the same id `HeadingLevel.HEADING_1` used to reference).
  *Import*: `DocxStyles.namedParagraphStyles()`/`styleIndentTwip()`/`defaultParagraphStyle()` feed
  `collectStyleSheet`; `registryName` maps Word's standard styles onto the registry (the document's
  default paragraph style always becomes `Standard`, whatever the file calls it). `blockAttrs` now
  reads DIRECT `w:pPr` only — style-level spacing/alignment lives in the style — and `blockDefaults`
  builds the yardstick from `paragraphRun` (docDefaults ← the style chain).
- `HEADING_STYLE_OVERRIDES` (`export/odt.ts`) is still the fallback yardstick for blocks whose file
  declares no style; `tests/unit/style-resolve.test.ts` asserts the built-ins match it.
- **Character styles** are the second family (`sheet.character`, LibreOffice's Emphasis /
  Strong Emphasis / Source Text): the `CharacterStyle` mark (`charStyle`, attr `name`) tags a run
  and renders `data-char-style`, `styleCss` emits a rule per style, and the gallery lists them
  under the paragraph styles (clicking the active one toggles it off). **ODF**: export bakes the
  style's resolved formatting onto the run *and* prefixes a `CST` sentinel (U+E00E) so
  `applyCharacterStyles` re-points that span at a clone whose parent is the named
  `style:family="text"` style; `hasCharStyleRun` routes such paragraphs through `applyRuns`.
  Import maps a span whose chain reaches a named text style back to the mark
  (`namedAncestor(…, 'text')`) and folds the style into the run's yardstick (`charDefaults`).
  **DOCX**: `w:rStyle` + `characterStyles` on export, `namedCharacterStyles()` on import.
- **Table styles** are the third family (`sheet.table`, model in **`styles/tableStyles.ts`** —
  its own shape, and **no inheritance**, because LibreOffice's table AutoFormats have none, so
  `resolveStyle`/`styleOrder` stay untouched). A style holds an outer `border`, an `innerBorder`
  (optionally split into `innerBorderH`/`innerBorderV`, which is what "row lines only" needs)
  and per-**region** props (`fill`, `text`, per-side `borders`): `TABLE_REGIONS` lists the
  conditional areas in **Word's ascending precedence** (`bandedColumn` < `bandedRow` <
  `lastColumn` < `firstColumn` < `lastRow` < `headerRow`), with `wholeTable` as the base.
  `resolveTableCell(style, coords, look)` is the single source of truth for **all four**
  consumers (apply, CSS, export bake, preview tiles): it layers the matching regions, counts
  banding over *body* rows (a header row doesn't shift the stripes) and decides each border
  **per grid line** from both sides, so two facing cells never disagree once collapsed.
  **Table Style Options** are Word's per-table `w:tblLook`: a `TableLook` (one flag per region)
  stored space-separated in the table's `tableLook` attr, absent ⇒ `DEFAULT_TABLE_LOOK` (Word's
  header row + first column + banded rows). A region paints only when the style defines it
  **and** the look enables it — which also decides whether banding skips the header row/first
  column, so toggling the header shifts every stripe. `setTableLook(region, on)` flips one and
  repaints; the look is part of `shapeOf`, so the re-band plugin sees it change. Every built-in
  defines all six areas, so each toggle visibly does something; the gallery's checkboxes grey
  out the ones the current style doesn't paint, and its tiles preview the table's own look.
  The colourful families (the four box lists, both accent tables) **fill** first/last column
  and the total row with a mid tint between header and band, so switching one on reads as
  clearly as the header row; the grey `Simple *` families and Academic/Financial keep those
  areas text-only, as Word's plain and rule-based styles do. The built-ins mirror the
  families Word and LibreOffice ship: Simple Grid (+ Rows / Columns), Simple List Shaded /
  Columns, Plain Table, Box List Blue/Green/Red/Yellow, Grid Table Accent, List Table Accent,
  Academic, Financial. A style may declare its own `look` — the options it is *about*, applied
  over the table's on assignment (`styleLook`): the list/grid Columns variants switch the bands
  to columns, Academic drops them (it is a booktabs table) and Financial turns the total row on.
  Without it the two banding variants would be indistinguishable, since every style defines all
  six areas. `tests/unit/table-style.test.ts` asserts no two built-ins render identically — the
  invariant that catches exactly that. The registry is versioned (`STYLE_SHEET_VERSION`), so
  adding or changing one needs a bump.
  **Split of responsibilities:** fill and borders are *materialized* into cell attrs (they already
  round-trip); **text** formatting is presentational, rendered by `tableStyleCss` from the cell's
  `region` attr — the same call the repo already makes for header-row bold, so typed/pasted/IME
  text inherits it. The rules must also target the cell's blocks
  (`… :is(td,th)[data-region~="X"] :is(p,h1,…,li)`), or the `Standard` paragraph rule outranks
  them on font/size/color. The `region` attr is stored rather than derived in CSS because
  `pageBreaks.ts` injects spacer `<tr>`s that would break any `nth-child` banding.
  **ODF/DOCX**: the definition lives in the app registry, not the file — ODF has **no banding
  concept** (`style:family="table"` carries width/align/margins only) and LibreOffice Writer bakes
  its AutoFormats as direct cell formatting too. So only the **name and the look** travel: the
  look rides on ODF's own per-area `table:use-first-row-styles`/`-last-row-`/`-first-column-`/
  `-last-column-`/`-banding-rows-`/`-banding-columns-styles` attributes on `<table:table>`
  (`ODF_LOOK_ATTRS`, shared by both sides) and on DOCX's native `w:tblLook` (its band flags are
  inverted). Without it a reopened file would repaint under the default look, since
  `refreshTableStyles` runs on every load. `applyTableStyleNames` walks the table elements with
  a lookahead, not `\b` — a hyphen is a word boundary, so `\b` would also match
  `<table:table-cell>` and misalign the per-table counter. Export mints an
  empty named `style:family="table"` in styles.xml (`applyNamedStyles`) and points the table's
  automatic `Table{n}` style at it via `style:parent-style-name` (`applyTableStyleNames`, mirroring
  `applyTableMargins`); DOCX writes `w:tblStyle` plus a name-only `w:style w:type="table"` through
  the docx lib's `importedStyles` (it has no `tableStyles` option, and `w:tblStylePr` is not
  emitted). The region's text is **baked** onto the runs on both exports (the `forceBold` channel
  widened to `TextProps`). Import reads the name back (`namedAncestor(…, 'table')` /
  `w:tblStyle` → `DocxStyles.tableStyleName`); the regions are then re-derived by
  `refreshTableStyles`, and `App.svelte` keeps `sheet.table` across an import because the file
  never carried it. Baked bold is only suppressed for `HEADER_SHADE` cells (the existing
  `boldByDefault` path) — a foreign style's bold survives as direct formatting.
- **Style manager** (`StyleManagerDialog.svelte`, mounted **once** in `App.svelte`; the entry
  points — "Manage styles…" at the foot of the gallery, "Manage table styles…" at the foot of
  the insert-table dropdown — only call `openStyleManager(family)`, and the `family` prop picks
  the tab on every open): the registry as an inheritance tree, live-editing a style's own properties (empty field
  = inherit again; the placeholder shows the inherited value), plus LibreOffice's
  **new/update from selection** — `propsFromBlock` reads the block's attrs and its first run's
  marks, `styleDelta` reduces that against the parent's resolved props, and the block is then
  retagged and `clearDirectFormatting()`ed so the formatting lives in the style alone. Rename and
  delete re-point the registry (`renameStyle`/`deleteStyle` in `sheet.svelte.ts`, children
  re-parent to the grandparent) and retag the affected blocks; built-ins offer a reset instead.
  Two family tabs: **character styles** are edited the same way (text properties only, plus a
  "New" button for an empty one — a run needn't be selected). There `runFormatting` reads the
  selection's first run instead of the block, `applyCharStyle` drops the direct marks the new
  style now carries before setting the `charStyle` mark, and `retag` rewrites the mark's `name`
  instead of the block attr. The third tab holds the **table styles**: a flat list (no tree), an
  area picker driving fill/text fields, three border controls (outer / row lines / column
  lines, the inner two falling back to `innerBorder`), and New/Rename/Remove (no "from
  selection"). Its preview shows the style with every area on, since it edits the definition
  rather than one table's look. The
  text fields are shared by all three families via `ownText`/`resolvedText`/`editText`.
- **Table-style gallery**: `TableStylePicker.svelte` in the floating `TableToolbar` — tiles drawn
  by `previewCellCss` (the same resolver), so a preview can't disagree with what applying does,
  plus the six Table Style Options as checkboxes beside them. Each preview cell also carries a
  schematic text line (`previewTextCss`: thickness = bold, slant = italic, colour = the region's):
  without it an emphasis-only area such as first/last column or the total row is **invisible** in
  a tile, since the tiles hold no real text — only fills and borders would show.

### Page break system (`pageBreaks.ts`)

A custom ProseMirror plugin that simulates paginated A4 layout entirely in CSS/DOM — no `<iframe>`, no actual page breaks in the document model. On every document change it:

1. Measures each top-level block's natural `offsetTop`/height (excluding existing spacers).
2. Calculates whether a block would overflow a page's content area.
3. Injects invisible `div[data-page-break-spacer]` widget decorations before blocks that need to move to the next page. A spacer inside a table is emitted as a borderless `<tr>` instead of a `<div>` (`spacerKind: 'table-row'`).
4. Sets `minHeight` on the `.tiptap` element so the visual page slots always exist.
5. Fires a `pm-pagecount` CustomEvent (bubbles to `Editor.svelte`) carrying `numPages`, `docHeight`, and `tableBreakBands`.

**Widow-orphan control:** `findLineSplit` picks the first line that overflows the page, then applies Word's/LibreOffice's rule (`MIN_KEPT_LINES` = 2, on by default in both via OOXML `w:widowControl`, so not configurable): fewer than two lines carrying over pulls one more down with them, and fewer than two staying behind cancels the split so the caller pushes the whole block. A leaf taller than one page slot passes `minLines: 1` — there the rule can't be satisfied and splitting beats overflowing.

**Keeping blocks together** (`pageBreak.ts` attrs, both read from the direct property *and* the paragraph style): `keepNext` (`w:keepNext`, `fo:keep-with-next`) moves a block down when its successor's first line no longer fits below it — headings do that in Word and LibreOffice anyway, so the attr only marks the others. `keepLines` (`w:keepLines`, `fo:keep-together`) makes an otherwise splittable block paginate atomically, unless it is taller than the page slot, where Word splits it too.

**Line breaking:** `editor.css` overrides prosemirror-view's `white-space: break-spaces` back to `pre-wrap` on `.paper .tiptap`. Under `break-spaces` a line-end space may not hang into the margin and counts toward the line width, so lines break one word earlier than in Word/LibreOffice whenever a line reaches within a space width of the margin.

**Tables across page breaks:** when a single continuous table box crosses a page boundary, the plugin reports `TableBreakBand`s (doc-px geometry). `Editor.svelte` renders an overlay (`.band-layer` inside `.paper`) that masks the table borders bleeding through the page margins and paints the dark page gap as one seam-free stripe.

**Layout constants** (must stay in sync between `pageBreaks.ts`, `Editor.svelte`, and `editor.css`):
- `PAGE_HEIGHT = 1123px` (A4 portrait), `PAGE_GAP = 20px`, `CYCLE = PAGE_HEIGHT + PAGE_GAP = 1143px`.
- Page height/width and margins are read **live** from CSS custom properties (`--user-page-height`, `--user-page-width`, `--user-margin-*`) so orientation/margin changes don't require new constants. `getCycle()` in `Editor.svelte` reads `--user-page-height` at runtime.
- A margin/orientation change dispatches an empty `FORCE_PAGE_RECALC` meta-transaction (deferred via `requestAnimationFrame`, outside the Svelte effect flush, to avoid re-entrant binding updates) to trigger a re-paginate.

### Zoom (`Editor.svelte`)

Zoom is a CSS `transform: scale()` on `.paper` (layout and pagination always run at 100%, so they stay stable across zoom — this replaced an earlier CSS `zoom` approach that re-ran layout at every scale). A transform reserves no layout space, so `.paper-scaler` reserves the scaled footprint to drive scrollbars and horizontal centering — it's sized in the `$effect.pre`, so it reaches the DOM in the same flush as the transform and the anchor pass below measures the right geometry. The applied zoom is throttled to one DOM write per animation frame. Range 20–300% (`MIN_ZOOM`/`MAX_ZOOM`/`clampZoom` in `utils/zoom.ts`), persisted in `localStorage['odf-editor-zoom']`.

`zoom` lives in `App.svelte`; `setZoom` is the only writer (clamps + persists) and reaches `Editor.svelte` as the `onZoom` prop, so a gesture there routes back through it and the status-bar slider follows for free. Inputs beyond the slider:

- **Ctrl+wheel** (`onWheel` on `.editor`) — a touchpad two-finger zoom fires exactly this event, so one handler covers both it and a Ctrl+mouse-wheel. `preventDefault` keeps the *browser* from scaling the whole app UI. `wheelZoomFactor` (`utils/zoom.ts`) turns the delta into a multiplicative factor — normalizing Firefox's line-mode deltas and capping one mouse notch — so a step feels the same at 30% as at 250%. Its sensitivity and cap are gesture-feel tuning knobs.
- **Ctrl `+`/`-`/`0`** — in `App.svelte`'s global keydown, ±10% / reset, suppressing the browser's own zoom keys.

Both anchors differ: a wheel zoom holds the **point under the cursor** fixed (`pendingAnchor` in client coords → doc space in the `$effect.pre`, both axes corrected via `scrollLeft`/`scrollTop` in the post-effect); slider, buttons and keyboard have no pointer and fall back to the top-of-viewport anchor. Touchscreen pinch is **not** handled — real touches fire no wheel event.

### Page layout settings (`src/lib/storage/`)

- **`pageMargins.ts`** — `PageMargins` in **cm** (default `{ top: 2, bottom: 2, left: 2, right: 2 }` — LibreOffice's; clamped 0–10). `applyMarginVars` sets `--user-margin-*` (px) on `:root`; `PX_PER_CM = 96/2.54`.
- **`pageOrientation.ts`** — `'portrait' | 'landscape'`. `applyOrientationVars` sets `--user-page-{width,height}`; landscape swaps the A4 dimensions (matching odf-kit's automatic swap).

Both margins and orientation are passed into the ODT export so the exported document's geometry/line-wrapping matches the on-screen preview.

### Storage (localStorage)

- **Document:** `odf-editor-doc` — TipTap JSON, debounced 1 s on every `onUpdate` (`autosave.ts`).
- **Theme:** `odf-editor-theme` — `'light' | 'dark' | 'allBlack' | 'auto'`.
- **Toolbar expanded:** `odf-editor-toolbar-expanded` — boolean string.
- **Formatting marks:** `odf-editor-formatting-marks` — boolean string.
- **Ruler:** `odf-editor-ruler` — boolean string; absent = on.
- **Zoom:** `odf-editor-zoom` — integer percent.
- **Page margins:** `odf-editor-page-margins` — JSON cm values.
- **Page orientation:** `odf-editor-page-orientation` — `'portrait' | 'landscape'`.
- **Recent fonts:** `odf-editor-recent-fonts` — JSON string array (ToolbarExpanded).

### Themes (`storage/theme.ts`, `global.css`)

Four modes: `light`, `dark`, `allBlack` (forces font colors white), `auto` (follows `prefers-color-scheme`). Applied by setting `data-theme` on `<html>`; CSS variables for each theme live in `global.css`.

### Fonts

Liberation Serif TTFs are bundled (`src/assets/fonts/`) and rendered as the on-screen default — it's metric-identical to Times New Roman, so the editor, LibreOffice, and Word all share the same metrics. `fontDetect.ts` holds a curated `CANDIDATE_FONTS` list; `ToolbarExpanded.svelte` filters it to fonts actually installed on the user's machine for the font picker.

### Document defaults (aligned to LibreOffice)

The editor's defaults follow **LibreOffice**, because both importers suppress values equal to
them (above) — so any default that only we have would silently render as extra formatting in
every imported document. Word and LO disagree on most of these (Word: Calibri 11pt, 8pt after,
2.54cm margins); we save `.odt`, so LO wins the ties. Deliberately:

- **Paragraph spacing 0** — no `margin-top`/`-bottom` on `p`, `ul`/`ol`, or the table wrapper
  (`editor.css`), matching LO's Default Paragraph Style, Word's implied 0, and both exporters
  (`docx.ts` already writes `spacing: { after: 0 }`; `rewriteStylesXml` zeroes ODF's Standard).
  Blank lines between paragraphs come from the document's own empty paragraphs.
- **Body Liberation Serif 12pt**, single line spacing; **page margins 2cm**; tab/indent step 1.25cm.
  On DOCX import, body text with no resolved font falls back to the *document's own theme minor
  font* (`docx.ts` `runMarks`), not this editor default — Word's implicit body default. Headings
  don't (they keep the editor heading default); DOCX page margins default to Word's 2.54cm.
- **Headings** follow LibreOffice too (`HEADING_STYLE_OVERRIDES`): 18 / 16 / 14 / 13 / 12pt with
  the Heading style's 0.423cm/0.212cm margins on every level, bold, and **sans** (`HEADING_FONT` = Arial; on screen the bundled
  `@font-face` maps it to Liberation Sans, metric-identical, mirroring Liberation Serif →
  Times New Roman for the body). Levels 1–5 (`MAX_HEADING_LEVEL` = `HEADING_STYLE_OVERRIDES.length`);
  both constants live in `export/odt.ts` and feed the importers, the TOC, the DOCX heading styles,
  `utils/fontSize.ts`, and `editor.css` (kept in sync by `tests/unit/font-size-display.test.ts`).
  The importers no longer override a file's own heading formatting: they only suppress values
  that equal these defaults, exactly as for body text.

### ODF export (`export/odt.ts`)

`buildOdt(json, margins, orientation)` (the DOM-free pipeline returning the `.odt` bytes; `App.svelte` writes them via the File System Access API or a download — see `export/saveFile.ts`) calls `tiptapToOdt(json, opts)` from `odf-kit`, then runs **several content.xml / styles.xml post-processing passes** (unzip → string-replace → re-zip via `rezipOdt`, which preserves the mimetype-first uncompressed requirement). odf-kit alone can't express everything the editor supports, so:

- **Custom node types** (`injectCustomTypes`): paragraphs/headings carrying `lineHeight`/`textAlign`/spacing attrs — or runs with a `fontWeight` textStyle attr, which odf-kit's native path drops — are renamed to `__cust_p__`/`__cust_h__` and emitted via odf-kit's `unknownNodeHandler` (odf-kit ignores those node attrs otherwise). Tables are renamed to `__cust_table__` and built by `exportTable` with an explicit cell border (odf-kit's native table path emits no borders → invisible in LibreOffice/Word).
- **Hard breaks & tabs** (`replaceHardBreaks`/`replaceTabs`/`applyInlineSentinels`): `hardBreak` nodes become `LBR`-sentinel text and tab chars become `TAB`-sentinel text so both survive every odf-kit path (a literal `\t` would collapse to a space), then the sentinels are rewritten to `<text:line-break/>`/`<text:tab/>` in content.xml.
- **Images** (`replaceImages`/`applyImages`): odf-kit's native image path rounds dimensions to whole cm and doesn't reach our cell path, so images bypass it. `replaceImages` (a pre-pass) swaps each `image` node for an `IMG`-sentinel text run and collects the bytes (decoded data-URI) + cm geometry (px→cm via `round3`); the sentinel rides every odf-kit path including table cells. `applyImages` (after `applyCellBlocks`) rewrites each sentinel to a `<draw:frame text:anchor-type="as-char" svg:width/height><draw:image xlink:href="Pictures/imageN.png"/></draw:frame>`, adds the binary `Pictures/` entries to the zip, and appends a `<manifest:file-entry>` per picture to `META-INF/manifest.xml`. Integer px ⇄ round3-cm ⇄ px is sub-pixel exact, so size is unchanged. A rotated image also gets a `draw:transform="rotate(<rad>) translate(...)"` (ODF rotate is CCW radians, ours CW degrees; the translate re-centres it on the unrotated box). A **floating** image (`wrap !== 'inline'`) instead uses `text:anchor-type="paragraph"` + a minted `<style:style style:family="graphic">` carrying `style:wrap` + `style:horizontal-pos` (image-left → `wrap="right" horizontal-pos="left"`; topBottom → `wrap="none" horizontal-pos="center"`) injected into content.xml automatic-styles.
- **Tables:** column widths come from the editor's per-column weights (`tableColumnWidthsCm`, summing exactly to the text width, with `table:align="margins"`). **Table margins:** a table's `marginLeft`/`marginRight` shrink that width and are written by `applyTableMargins` into the table's automatic style (`style:width` + `fo:margin-left`/`-right`; odf-kit names table styles `Table1`, `Table2`, … in document order, matching the descriptor list `exportTable` fills). odf-kit serializes each cell to a single `<text:p>` of runs; `exportTable` emits all of a cell's content into that paragraph separated by a `SEG` sentinel and records a `CellBlock[]` descriptor, then `applyCellBlocks` splits on `SEG` and rebuilds real `<text:h>`/`<text:p>`/`<text:list>` (incl. nested lists) with minted automatic paragraph styles. **Merged cells:** `exportTable` passes each cell's `colspan`/`rowspan` as odf-kit `CellOptions.colSpan`/`rowSpan`; odf-kit emits `table:number-columns/rows-spanned` and auto-generates the `<table:covered-table-cell>` placeholders (which never match the `applyCellBlocks` cell regex, so `cellBlocks` stays one-per-real-cell aligned). Import already reads spans/covered cells in `convertTable`. **Cell shading:** a cell's `backgroundColor` attr is passed as `CellOptions.backgroundColor` (normalized), which odf-kit mints into the cell style as `fo:background-color`. **Cell borders:** the per-side border attrs (tableCellBorders.ts) are passed as `CellOptions.borderTop/Right/Bottom/Left` (`'none'` or `'<W>pt solid #RRGGBB'`) overriding the table-level default border per side.
- **Text boxes / shapes** (`replaceTextBoxes`/`applyTextBoxes`): a top-level `textBox` is **hoisted** — `replaceTextBoxes` (after `replacePageBreaks`, before the inline passes) swaps it for `TBX`-sentinel marker paragraphs (`S{i}`…`E{i}`, U+E008) bracketing its child blocks at top level, so every existing pass (custom attrs, list styles, inline sentinels, images) serializes them unchanged and document-order-indexed passes stay aligned. `applyTextBoxes` (after `applyImages`) wraps each serialized S…E region into `<draw:frame><draw:text-box fo:min-height>` (plain box; `svg:height` also emitted for non-auto-grow consumers) or `<draw:custom-shape>` + preset `<draw:enhanced-geometry>` (roundRect/ellipse, static LibreOffice-style paths) inside a fresh anchor paragraph, minting a `TbxFr{n}` graphic style (fill/stroke/padding + the image wrap props; `draw:auto-grow-height="true"` for boxes, both auto-grows explicitly **false** for shapes or LibreOffice's autofit shrinks them to their text).
- **`applyListItemStyles`** — per-item alignment/spacing/line-height for top-level lists (odf-kit's ListBuilder has no per-item options) via minted automatic styles.
- **`applyListIndents`** — a top-level list's whole-list `indent` (cm) added to its `L#` list-style per-level `fo:margin-left`/`text:list-tab-stop-position` (label-alignment mode ignores the paragraph margin, so the shift must live in the list style). Import reverses it in `convertList` (level-1 margin minus the 1.27cm base).
- **`applyNestedListTypes`** — odf-kit emits nested lists as bare `<text:list>` sharing the top-level list style, so a nested list of a different kind/format (e.g. ordered inside bullets) gets its own minted 6-level list style.
- **`applyListStartValues`** — odf-kit drops an ordered list's `start` attr; a Word list continued across an intervening paragraph (same numId, split into separate `orderedList` nodes with `start` > 1 by the importer) gets `text:start-value` on its first `<text:list-item>` so numbering keeps counting instead of restarting at 1.
- **`applyTableRowHeights`** — dragged row heights → `style:min-row-height` automatic table-row styles.
- **`collapseRunWhitespace`** — strips the bare `\n` separators odf-kit inserts between runs inside a paragraph (they'd otherwise collapse to spurious spaces mid-word).
- **`rewriteStylesXml`** — default font Liberation Serif → Times New Roman, heading sizes/margins → the editor's values, Standard's `fo:margin-bottom` → 0 (odf-kit emits 0.212cm; every paragraph and list item inherits it, and the editor has no paragraph spacing — see below).
- **`normalizeColor`** — coerces colors to `#RRGGBB` (ODF requirement; rejects/normalizes `rgb()` and short hex).

The filename is derived from the first non-empty heading (max 50 chars, sanitized), falling back to `document.odt`.

### ODF import (`import/odt.ts`, `import/styleResolver.ts`)

The **Open .odt** button (`App.svelte`) parses an uploaded file with `importOdt(bytes)` and replaces the document via `setContent` (after a confirm when the current doc is non-empty), also adopting the file's page margins/orientation. It parses `content.xml`/`styles.xml` directly (fflate + `DOMParser`) rather than odf-kit's reader, which flattens cell blocks and drops row heights / list number formats.

- **`StyleResolver`** flattens ODF style indirection: named + automatic styles from both XML files, `style:parent-style-name` chains rooted in `style:default-style`, font-face declarations (`style:font-name` → family), `rel-column-width`/`column-width`, `min-row-height`, list styles, and page geometry. `fo:font-family` and `style:font-name` shadow each other across chain levels (`layerTextProps`). A **percentage `fo:font-size`** (`"130%"` — how LibreOffice defines its heading styles) is resolved against the inherited size while walking the chain (`resolvePercentSize`); without it the file's size is dropped and our default silently replaces it.
- **Default suppression** keeps round trips (editor → LibreOffice → editor) from accreting explicit attrs: values matching the editor's defaults (12pt body, `HEADING_STYLE_OVERRIDES` sizes/margins, **0 paragraph spacing**, list margin 0, Times New Roman/Liberation Serif, `#000000` text) are imported as `null`/no mark, with small tolerances for producer unit rounding (pt↔cm↔twips). This is why the editor's defaults must equal Word's/LibreOffice's (below) — an editor-only default is indistinguishable from a failed style resolution and silently lands in every imported document.
- **Mapping:** `text:h` → heading (level clamped to `MAX_HEADING_LEVEL`), per-depth `text:list-level-style-*` defs decide bullet vs ordered and `listStyleType` (reverse lookup `orderedTypeFromFormat`), tables handle covered cells / `number-columns-repeated` / header rows / colspans / cell shading (`StyleResolver.cellBackgroundColor` → `backgroundColor`) / cell borders (`StyleResolver.cellBorders` + `borderAttrFromOdf` → the per-side border attrs) / table margins (`tableMargins` reads the table style's `fo:margin-*`, `style:width`/`style:rel-width` and `table:align` against `Ctx.contentWidthCm` — so a table narrower than the text width stays narrow instead of being stretched; DOCX does the same from `w:tblInd` + the `w:tblGrid`/`w:tblW` width), `text:s`/`text:tab`/`text:line-break` become spaces/`\t`/`hardBreak`, `draw:frame`/`draw:image` → an `image` node (`convertFrame`: bytes read from the zip's `Pictures/` entry into a data-URI, `svg:width`/`-height` cm → px, `svg:title` → `alt`, `draw:transform` rotate → `rotation`; a non-`as-char` anchor or a graphic style's `style:wrap` → floating `wrap` mode via `StyleResolver.graphicProps` — an **explicit `as-char` anchor is always inline**: LibreOffice's named Graphics style carries a `style:wrap` that would otherwise float every inherited frame), text fields keep their stored value. **Text boxes / shapes** (`convertDrawElement`): `draw:frame`+`draw:text-box` → a `textBox` node (`convertTextBoxFrame`: height = `fo:min-height` else `svg:height`; fill/stroke read straight from `graphicProps`' `draw:fill(-color)`/`draw:stroke`/`svg:stroke-*`, values equal to the editor defaults suppressed, none → explicit `null`); `draw:rect`/`draw:ellipse`/`draw:custom-shape` with a rect/round-rectangle/ellipse preset → a `textBox` with the matching `shapeKind` (`convertShape`; other presets → "Unsupported shapes were removed"). A box is a block node but its frame sits inside a `text:p`, so converted boxes ride `Ctx.pendingBlocks` and `convertBlocks` flushes them after the anchor paragraph (dropping our own export's empty anchor); in cells/other boxes their blocks are unwrapped in place with a warning. The DOCX importer mirrors all of this (`convertWpsShape` for DrawingML `wps:wsp` — probed before the image `a:blip` path, `convertPict` for legacy VML; Word's `mc:AlternateContent` uses only the `mc:Choice` branch so the VML fallback can't double-import).
- **Image formats (`import/imageFormats.ts`, shared by both importers):** `<img>` only renders a fixed set of formats, so `imageDataUrl(bytes, path)` resolves the mime by extension **then** magic-number (mislabelled/extensionless entries still work) and returns `null` for anything unrenderable — the importer then skips it with a specific "format the browser can't display" warning instead of a broken `<img>`. A frame's multiple `<draw:image>` alternatives (ODF) and a Word `a:blip`'s `svgBlip` alternative are probed for the first *displayable* one, and `<draw:a>`-wrapped frames are unwrapped (the hyperlink dropped). **Non-web formats we can decode client-side** (currently **TIFF**) are converted to PNG up front by `convertUnsupportedImages(bytes)` — an async pass `applyImport` runs before the synchronous import, passing a `path → PNG data-URI` map (`ConvertedImages`) into `importOdt`/`importDocx` (default empty, so tests stay sync). The decoder (`utif2`) is a **dynamic `import()`** → its own lazy chunk, loaded only when a convertible image is actually present, so ordinary docs pay nothing. **SVM/WMF/EMF** have no JS decoder (SVM is StarOffice-proprietary) → skipped with the format warning; LibreOffice/WASM conversion was ruled out (no backend; WASM LO is ~300MB).
- **Graceful degradation** (collected as `warnings`, surfaced once): footnotes/comments dropped, hyperlinks flattened to text, nested tables flattened to paragraphs, non-`Pictures` drawings dropped, unreadable pictures skipped (each with a warning). Page size is normalized to A4. Floating/wrapped images are imported as left/right/top-bottom wrap (free x/y positions collapse to the nearest side; see `image.ts`).

`tests/roundtrip.test.ts` (export→import) and `tests/lo-roundtrip.test.ts` (export→LibreOffice re-save→import, needs `soffice`) verify the round trip; run with `npm test` / `npm run test:lo`.

### Headers & footers (`HeaderFooterLayer.svelte`, `storage/headerFooter.ts`, `editor/extensions/headerFooter.ts`, `pageField.ts`)

One header and one footer (`HfDoc` = a single-paragraph TipTap doc per zone, persisted to `odf-editor-header`/`-footer`), repeated on every page. Double-clicking a page margin — or the Layout-panel "Edit header/footer" buttons — opens the zone for editing; clicking back into the body (`onFocus`) or Escape ends it. The edge→zone distance (header from top, footer from bottom) is user-configurable in cm via the Layout panel (`HfDistances`, persisted to `odf-editor-hf-distances`, default `HF_DISTANCE_CM` 1.27cm, clamped 0–10 and below the body margin).

- **Rendering:** `HeaderFooterLayer.svelte` mounts inside the scaled `.paper` (like `.band-layer`), positioning per-page zone boxes in unscaled doc px. Inactive zones render as static HTML (`generateHTML` + `hfExtensions`); the active zone hosts the single live TipTap editor. `App.svelte`'s `activeEditor`/`activeTick` route the top toolbars to `hfEditor` while a zone is active, so all body formatting works on the header/footer with no toolbar changes.
- **Schema (`editor/extensions/headerFooter.ts`, exports `hfExtensions`):** `Document` constrained to one paragraph, the body's marks, `HardBreak`, `TextAlign`, and the two page-field atoms (`pageField.ts`): `pageNumber`/`pageCount` render `<span data-page-field>`; the layer patches each span's text to the real per-page value.
- **Export:** a synthetic `__cust_hf__` node routes to `unknownNodeHandler`, which calls odf-kit's `setHeader`/`setFooter` (`applyHfRuns`); `hardBreak`→`LBR`, `pageNumber`→`addPageNumber`, `pageCount`→`PGC` sentinel. `applyHfPostProcess` (on styles.xml) rewrites the sentinels to `<text:line-break/>`/`<text:page-count>`, applies the paragraph alignment to the `Header`/`Footer` styles, and converts geometry to Word's model: page margin = the zone's edge distance (`headerDistanceCm`/`footerDistanceCm`), header/footer `min-height` = body margin − distance, so the **body** still starts at the editor's margin.
- **Import:** `StyleResolver.masterPageHF()` reads `style:header`/`style:footer` + the header/footer-style heights; `pageGeometry()` reconstructs the body margin (page margin + zone height + spacing) and `edgeDistancesCm()` returns the raw page margins as the zone distances. The header↔body spacing is only reserved when `style:dynamic-spacing="false"` — a `true` (LibreOffice's usual) means the gap collapses, so reserving it would shove the body down. `convertHfZone` → single-paragraph doc (extra paragraphs → hard breaks; a text-less zone that carries a background/border rule line is kept, box props merged with the bottom rule from the last paragraph); `convertInline(…, hfFields=true)` keeps `text:page-number`/`-count` as field nodes. Per-page variants (`header-first`/`-left`) are ignored with a warning. `hfIsEmpty` counts a rule-/shading-only paragraph as non-empty so it renders and exports.

### Keyboard shortcuts (`editor/shortcuts.ts`, `editor/extensions/shortcuts.ts`)

Word/LibreOffice key bindings. **`editor/shortcuts.ts` is the single source of truth**:
`DEFAULT_SHORTCUTS` maps a stable id to a combo in ProseMirror keymap syntax, and every
binding site reads it (the `Shortcuts` extension, `App.svelte`'s window handler, and the
`Mod-k`/`Mod-Enter`/`Mod-m`/`Tab` bindings still owned by `link.ts`/`pageBreak.ts`/
`paragraphStyle.ts`/`indent.ts`) — a planned remapping UI overrides that map alone.
TipTap's own defaults (`Mod-b/i/u`, `Mod-Shift-s/h`, `Mod-z`, `Mod-Shift-7/8`,
`Mod-Shift-l/e/r/j`) are **not** in the table; they aren't ours to bind.
`matchesEvent(e, combo)` serves the window handler (no keymap there), `shortcutHint(id)`
the tooltips (via `withShortcut`, which localizes Ctrl/Shift/Alt and swaps in ⌘/⇧/⌥ on Mac).

- **`Shortcuts` extension** — `priority: 1000` so `Mod-Alt-N` beats Heading's
  `toggleHeading` (headings are applied as *named styles*) and `Mod-Shift-b` beats Bold's
  `Mod-B` alias. Option `body: true` (only `extensions.ts`) adds the bindings whose
  commands the header/footer schema lacks; `hfExtensions()` registers the bare extension,
  which contributes the shared set only (alignment, sub/superscript, font grow/shrink,
  NBSP, soft hyphen).
- **`Mod-Alt-<digit>` can't go through the keymap**: Windows reads Ctrl+Alt as AltGr, so
  `event.key` is layout-dependent (German AltGr+2 = `²`) and prosemirror-keymap skips its
  keyCode fallback for exactly that modifier pair. Those six run in `addProseMirrorPlugins`
  off `event.code` (`Digit0`–`Digit5`) instead.
- Deliberate resolutions: `Mod-m` stays LibreOffice's *clear formatting* (Word's
  increase-indent is Tab); `Ctrl+1/2/5` are Word's **line spacing**, so headings are
  Ctrl+Alt+N only; `Mod-Shift-s` stays strikethrough, so there's no Save-As key;
  sub/superscript follow LO (`Mod-Shift-b`/`Mod-Shift-p`) because Word's `Ctrl+=` pair
  collides with zoom; formatting marks use LO's `Ctrl+F10` (Word's `Ctrl+Shift+8` is
  TipTap's bullet list). `Ctrl+N` is unbindable in Chrome and therefore absent.
- `tests/unit/shortcuts.test.ts` asserts the table has no duplicate combo (the bindings
  are spread over several files, so nothing else can catch a collision) and covers
  `matchesEvent`.

### Right-click context menu (`editor/contextMenuItems.ts`, `components/ContextMenu.svelte`)

Word's text context menu: clipboard, link, clear formatting — with the spelling
suggestions merged in as the first section (the old `SpellContextMenu.svelte`).
Deliberately flat: no submenus, so no indent column either.
`buildContextMenu(editor, { spell })` returns a `MenuEntry[]`
(item/sep) whose `run` closures call the same commands the toolbars use;
`ContextMenu.svelte` only renders it, positioned as a sibling of the zoomed `.paper` so
it stays constant-size. `Editor.svelte`'s `openContextMenu` (one `oncontextmenu` on
`.editor`) picks the caret (keeping a selection the click lands in, as Word does), reads
`spellErrorAt`, and builds the list. It bails on **Shift+right-click** (the browser menu,
whose Paste needs no clipboard permission — Firefox does this for page handlers anyway),
on images/text boxes (their floating toolbars), and in the header/footer (the HF schema
has none of the entries). Cut/copy go through `document.execCommand` so ProseMirror's own
copy handler builds the clipboard payload; paste reads `navigator.clipboard` and falls
back to an alert where the browser blocks it. The menu clamps itself into the viewport
via transforms, measured from layout offsets so the correction can't feed back into the
next measurement.

### Debug tooling (dev only)

In dev builds a **Debug** button (`App.svelte`) downloads a JSON snapshot combining `getPageBreakDebug(view)` (leaves, placements, rendered spacers, table-break bands, live overlay geometry) and `getColorDebug(editor)` (selection marks, text runs, document colors, DOM spans) — used to diagnose pagination and color round-trip issues.

## Headless browser testing

With no test suite, the way to verify rendering, layout, or interaction is to drive the live app in a headless browser. **This container is linux arm64 (`uname -m` → `aarch64`)** — the one gotcha. Use it for any check: pagination, list-marker/float layout, table sizing, header/footer, theme colors, image drag/resize, ODF round-trips, etc. PDF export is just one example.

- **Don't** use `puppeteer` / `npx @puppeteer/browsers install chrome-headless-shell`: they fetch an x86-64 Chrome that can't run here (`rosetta error: failed to open elf at /lib64/ld-linux-x86-64.so.2`). No arm64 chrome-headless-shell build exists.
- **Use Playwright's Chromium** (native arm64): `npm install --no-save playwright-core && npx playwright-core install chromium` → binary at `~/.cache/ms-playwright/chromium-*/chrome-linux/chrome`. Playwright's `install-deps` host check errors out, but the libs install via apt: `apt-get install -y libdbus-1-3 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libatspi2.0-0 libpango-1.0-0 libcairo2`. Launch with playwright-core, `executablePath` at that binary, `args: ['--no-sandbox']`.

Then load `npm run dev`, inject a document into `localStorage['odf-editor-doc']`, reload, and read live DOM geometry (`getBoundingClientRect`, `Range.getClientRects`) or screenshot. This is the only way to exercise the editor's live ProseMirror NodeViews (e.g. the image node), which `generateHTML` can't reproduce. The `debug/pagebreak-debug-*.json` snapshots carry the live `doc` JSON, handy to inject.

For PDF-export repros specifically: replicate `pdf.ts`'s clone + `html2canvas(...)` inside `page.evaluate` and read the canvas back as a PNG — capturing the real jsPDF `doc.save()` download tends to hang in headless. Inspect output PDFs with poppler-utils (`apt-get install -y poppler-utils`: `pdftoppm`, `pdfimages`, `pdftotext`).
