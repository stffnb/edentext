# Tables

Covers the `table*.ts` extensions in `src/lib/editor/extensions/` and the table-style family
(`src/lib/styles/tableStyles.ts`, `components/TableStylePicker.svelte`).

## Table extensions

- **`tableView.ts`** (`TableView`) — custom table node view. Unlike TipTap's built-in view it renders the `<colgroup>` with **percentage** widths and keeps the table at `width:100%`, so the table fills its wrapper (by default the full text width, matching the ODT export) and stays responsive to margin/orientation changes. The per-column `colwidth` cell attrs are treated as proportional *weights* (only ratios matter; `null` = equal share). The table's own `marginLeft`/`marginRight` attrs (cm, from the outer-edge drag) go on the `.tableWrapper` — that's what narrows the table.
- **`tableRow.ts`** (`ResizableTableRow`) — `TableRow` extended with a `rowHeight` attr (unscaled doc px @96dpi), rendered as a CSS min-height (`height` on `<tr>`), exported as `style:min-row-height`. `Table` (unlike `TableKit`) does NOT auto-add child extensions, so `ResizableTableRow` must be listed explicitly.
- **`tableColumnResize.ts`** (`TableColumnResize`) — Word-style column drag: dragging an *inner* border trades width between two columns only (their sum stays constant, table width fixed). Live feedback pokes the `<col>` elements; release writes new weights into `colwidth`. The table's **outer left/right edges** are draggable too (Word/LibreOffice): they move that edge alone — the pure `edgeResize` helper shifts the global `marginLeft`/`marginRight` attrs it adds on `table` (cm; the drag stops at the text area, but an imported value may be **negative** — see below) and resizes only the adjacent column, so every other gridline stays put; the minimum is `CELL_MIN_PX`. `borderAt` classifies a hovered border as `inner`/`left`/`right`, the handle decoration mirrors to the cell's left side (`.column-resize-handle.left`), and the commit writes `colwidth` + the table attrs in one transaction. `TableView` renders the margins on the wrapper; the attrs' own `renderHTML` emits them (plus a matching `width: calc(...)`) for the static HTML paths (PDF export, clipboard). They round-trip as ODF `fo:margin-left`/`-right` + `style:width` (`applyTableMargins`) and DOCX `w:tblInd` + the narrower `w:tblGrid`. In **Word 2010 and earlier** (`w:compatSetting` `compatibilityMode` ≤ 14, or none at all) **`w:tblInd` is measured to the cell's text**, not to the table's edge, so import subtracts the left cell margin from it (`tblIndIsToText`, `import/docx.ts`): a `w:tblInd="0"` table there has `marginLeft` **−0.19cm** and hangs that much into the page margin, which is where LibreOffice draws it and what puts the first column's text on the body's left margin. Word 2013 (mode 15) redefined it as the table's own edge — probed both ways against `soffice` — and that is what our own export writes, so `w:tblInd` goes out as `marginLeft` unchanged. ODF's `fo:margin-left` is the table edge too, and both may be negative.
- **`tableRowResize.ts`** (`TableRowResize`) — Word-style row-height drag (changes the row *above* the grid line; min-height semantics). Yields to column resize at a corner.
- **`tableSplit.ts`** (`TableSplit`) — Word/LibreOffice "Split Cells…": adds `splitCellInto(cols, rows)` (prosemirror-tables only ships `splitCell` = un-merge). Reads the grid via `TableMap`, expands it (duplicating the cell region's right-edge column / bottom-edge row so every other cell crossing a new grid line grows its span — the bridging Word does), partitions the region into `cols`×`rows` sub-cells (first keeps the original content), recomputes `colwidth` weights, and rebuilds the table node in one step. **Merge** uses extension-table's built-in `mergeCells` (drag/shift-click `CellSelection` via the always-on `tableEditing` plugin). Both are surfaced by `TableToolbar.svelte` (Merge button + Split button → `TableSplitDialog.svelte`).
- **`tableCellBackground.ts`** (`TableCellBackground`) — adds a `backgroundColor` attr to `tableCell`/`tableHeader` (rendered as the cell's CSS background), set via extension-table's built-in `setCellAttribute` (so it applies to a whole `CellSelection` or the cursor's cell). `TableToolbar.svelte` exposes it via a reused `ColorPicker` (cell shading); round-trips to ODF `fo:background-color` (export/import below). Survives split/merge (attrs are carried through).
- **`tableCellBorders.ts`** (`TableCellBorders`) — Word/LibreOffice border control: per-side attrs `borderTop/Right/Bottom/Left` on `tableCell`/`tableHeader` (`null` = the table default 0.5pt black, `'none'`, or canonical `'<W>pt solid #RRGGBB'`; rendered as per-side inline CSS — pt→px, min 1px — plus `data-border-*` for HTML parse). `setTableBorders(preset, spec)` applies a preset (`all`/`outer`/`inner`/`innerH`/`innerV`/`top`/`bottom`/`left`/`right`; spec `null` = no border, the default 0.5pt-black spec normalizes to `null`) to the selected cell region (`selectedRect`), writing **both sides of every affected boundary** — including the facing side of neighbour cells *outside* the region — so collapsed borders never disagree between adjacent cells. Surfaced by `TableBorderPicker.svelte` (dropdown in `TableToolbar.svelte`: preset grid + line width + line color; presets apply with the picker's current pen settings). **Word-like button states**: `activeBorderPresets(state, pen)` marks a preset active when every boundary it targets renders exactly the pen border — width *and* color, where a boundary's effective border is the collapse winner of its two facing cell sides and attr `null` counts as the 0.5pt-black default — so a fresh table lights the presets up under the default pen and a thicker pen turns them off; `'none'` is active when the region is borderless. Clicking an **active** preset toggles those borders off; an inactive one applies the pen. The panel stays open on preset clicks so the states visibly update. Round-trips to ODF `fo:border-*` (export → odf-kit `CellOptions.border*`, `null` falls back to the table's default border; import via `StyleResolver.cellBorders` + `borderAttrFromOdf` — an undeclared side ⇒ `'none'`, the 0.5pt-black default ⇒ `null` with unit tolerance, non-solid styles coerced to solid) and DOCX `w:tcBorders` (import also resolves table-level `w:tblBorders` by cell position; sides nothing declares stay `null` = default).
- **`tableCellPadding.ts`** (`TableCellPadding`) — **cell margins**, a global `cellPadding` attr `[top, right, bottom, left]` in cm on `table` *and* on `tableCell`/`tableHeader`. `null` = inherit: a table's from the default `[0, 0.19, 0, 0.19]` (Word's own, and `editor.css`'s fallback), a cell's from its table — so `cellPaddingAttr(sides, base)` takes the baseline it is measured against, and only a real disagreement carries an attr. A side within `SAME_CM` (0.005cm) of that baseline *is* the baseline, or Word's 108 twips (0.1905cm) and LibreOffice's 0.191cm would tag every table. Rendered as one `--cell-pad` custom property (the attr's `renderHTML` for the static paths, `TableView` for the node view, since it bypasses `renderHTML`) that `td/th { padding: var(--cell-pad, 0 0.19cm) }` reads — the property inherits, so a cell's own declaration wins for its own `td`. **DOCX**: `w:tblPr/w:tblCellMar` direct, else the table style's (`DocxStyles.tableCellMar` walks `w:basedOn`), and `w:tcPr/w:tcMar` per cell (`cellMarginsCm` reads either, `w:type="nil"` being an explicit zero); export writes `Table.margins` + `TableCell.margins`. **ODF** has no table-level cell margin — it sits on each cell's style, so import takes the first cell's `fo:padding*` for the table and measures the rest against it. `fo:padding` defaults to **0** there, so an undeclared side is imported as a real zero rather than left open to the Word default (probed: LibreOffice puts an unstyled cell's text flush against the column edge, and the Math Guide's figure tables carry no cell style at all). Export rides each cell's value on it as a CSS-style TRBL shorthand that `expandCellPadding` splits per side (odf-kit only writes the `fo:padding` shorthand, and ODF allows it only one length). Getting this wrong is not cosmetic: a 0.71cm bibliography marker column lost 0.38cm to the old constant and wrapped `"[2] "` onto three lines.
- **`tableHeaderRow.ts`** (`TableHeaderRow`) — "header row" as a **styling preset** (not the structural ODF header that repeats per page, by design): `toggleHeaderRowStyle` sets/clears a **light-grey fill (`HEADER_SHADE` `#F2F2F2`)** on the first row's cells; `isHeaderStyled(state, axis)` drives the toolbar toggle's active state. **A table carrying a table style owns these two areas through its Table Style Options instead**: there `toggleHeaderStyle`/`isHeaderStyled` read and write `headerRow`/`firstColumn` in the table's `tableLook` (delegating to `setTableLook`), so the toolbar button and the gallery's checkbox are one state and can't disagree. Both also read their label from the same key (`styles.regions.*`), so they can't drift apart in wording either — the button used to say "header column" where the checkbox said "first column". The fill is the *marker* and **round-trips natively** as `fo:background-color`, so the toggle state survives reopen with no `table:table-header-rows` (⇒ Word/LibreOffice don't repeat it). **Bold is presentational, exactly like a heading**: `tableCellBackground.ts` tags a header-shaded cell with `class="cell-header"` and `editor.css` renders `.cell-header` bold — so *all* its text is bold (existing, typed, pasted, IME) without storing marks, and it stays **editable** via the `fontWeight:'normal'` override (the `Toolbar.svelte` Bold button treats `isInHeaderCell` like a heading: toggles `setFontWeight('normal')`/`unsetFontWeight`). Export (`export/odt.ts`) **bakes** bold onto header-shaded cells' runs (`applyRuns(..., forceBold)`, skipping `fontWeight:'normal'` runs) so Word/LibreOffice match; import (`import/odt.ts`) converts those cells' runs with `boldByDefault` (bold run → no mark, normal run → `fontWeight:'normal'`), mirroring headings. `TableToolbar.svelte` exposes the toggle button.

- **`tableCellAlign.ts`** (`TableCellAlign`) — `verticalAlign` (`middle`/`bottom`, null = top, the ODF and Word default) on `tableCell`/`tableHeader`, rendered as the cell's CSS `vertical-align`. A callout table's label sits mid-cell with it, at the row's top without. Round-trips to ODF `style:vertical-align` (import via `StyleResolver.cellVerticalAlign`, export via odf-kit's `CellOptions.verticalAlign` — it mints one cell style per property set, so a differing cell gets its own) and DOCX `w:vAlign` (Word's `center` is our `middle`; `top`/`both` stay the default). Set from `TableToolbar.svelte`'s three buttons via `setCellAttribute`, which covers a whole `CellSelection`.
- **`tableStyle.ts`** (`TableStyle`) — the **table style** family's editor half (model in `styles/tableStyles.ts`, see below): global attrs `tableStyle` on `table` (⇄ `data-table-style`) and `region` on `tableCell`/`tableHeader` (⇄ `data-region`, a space-separated region list). `setTableStyle(name|null)` writes the attr and **materializes** the style into the cells in one transaction — `paintTable` walks the `TableMap`, resolves each cell via `resolveTableCell` (merged cells by their top-left `findCell` box) and writes `backgroundColor`/the four border attrs/`region`, so **export, PDF and clipboard need no new code**. It only writes cells that differ, which makes it idempotent — the condition the re-band plugin depends on. That plugin (`appendTransaction`) repaints a styled table when its row/column **shape** changes (Word's re-banding); deliberately *not* on every transaction, or a manually shaded cell would be repainted away immediately. `refreshTableStyles()` repaints every styled table and is called from `Editor.svelte`'s document-stylesheet `$effect` — the choke point every registry change (edit, rename, reset, import) passes through. `activeTableStyle`/`cellRegionText` feed the gallery and the Bold button (a style's bold region behaves like a heading, see `tableHeaderRow.ts`). `TableView` sets `data-table-style` itself, since the node view bypasses `renderHTML`.

We deliberately keep TipTap's `resizable: false` (so its own columnResizing plugin isn't loaded) and supply the custom view + drag plugins instead.

## Table styles (third style family)

- **Table styles** are the third family (`sheet.table`, model in **`styles/tableStyles.ts`** —
  its own shape, and **no inheritance**, because LibreOffice's table AutoFormats have none, so
  `resolveStyle`/`styleOrder` stay untouched). A style holds an outer `border`, an `innerBorder`
  (optionally split into `innerBorderH`/`innerBorderV`, which is what "row lines only" needs)
  and per-**region** props (`fill`, `text`, per-side `borders`): `TABLE_REGIONS` lists the
  conditional areas in **Word's ascending precedence** (`bandedColumn` < `bandedRow` <
  `lastColumn` < `firstColumn` < `lastRow` < `headerRow`), with `wholeTable` as the base.
  `resolveTableCell(style, coords, look)` is the single source of truth for **all four**
  consumers (apply, CSS, export bake, preview tiles): it layers the matching regions, counts
  banding over *body* rows — a header row doesn't shift the stripes, and the **first** body
  row is the first stripe (probed: LibreOffice shades the row under the header, and row 0
  where the style paints no header) — and decides each border
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
  A **Word** file's own table style does carry its areas (`w:tblStylePr`), and the registry has
  no entry to re-derive them from, so the DOCX importer bakes those into the cells instead —
  fill, borders and run marks alike (`src/lib/import/CLAUDE.md` for the area rules). What is
  re-exported is that bake, which is why the round trip is stable: our `w:tblStyle` is
  name-only, so a reimport finds no areas to apply over it.

- **Table-style gallery**: `TableStylePicker.svelte` in the floating `TableToolbar` — tiles drawn
  by `previewCellCss` (the same resolver), so a preview can't disagree with what applying does,
  plus the six Table Style Options as checkboxes beside them. Each preview cell also carries a
  schematic text line (`previewTextCss`: thickness = bold, slant = italic, colour = the region's):
  without it an emphasis-only area such as first/last column or the total row is **invisible** in
  a tile, since the tiles hold no real text — only fills and borders would show.

- **A table's own space above/below** (`marginTop`/`marginBottom`, cm, beside the two horizontal
  ones) — ODF `fo:margin-top`/`-bottom` on the table style, which LibreOffice honours like a
  paragraph's. Rendered on the `.tableWrapper` (`TableView`, plus the inline style for the static
  paths). Word has no table-level spacing, so it round-trips through ODF only. the Math Guide's callout
  tables carry 0.109/0.409cm and lost half a line each without it. The space **above** rides
  `--space-before`, so the document's spacing model adds it to the block above instead of
  collapsing against it, exactly as a paragraph's does.

## Cell metrics measured against LibreOffice

- **No space above a cell's first block.** LibreOffice adds none there (its
  `AddParaTableSpacingAtStart`); Word does, so `editor.css` drops it for the `add` spacing
  model only. Measured on the Math Guide: the table row grew 1mm per row without it. `pageBreaks.ts`
  excludes cell leaves from its page-top-drop detection, or that missing padding would read
  as a decoration to add back.
- **A cell paragraph that names no style has no space below it.** Neither word processor passes
  the default style's spacing into a cell: LibreOffice puts cell text in its Table Contents style
  (probed — an auto-height row stays exactly as tall as its lines, and a bottom-aligned cell
  reaches the row bottom), Word's table styles carry `w:spacing w:after="0"`. The **space above**
  is LibreOffice's alone, so the `add` model zeroes that too. `editor.css` renders it, and both
  exporters write the zeros onto the paragraph (`cellParaStyle`/`cellSpacingOf`) — only when the
  default style has spacing at all, so files without it export unchanged. Without this the space
  fills the cell and vertical alignment (`tableCellAlign.ts`) has no slack left to move text in,
  which is what makes it look dead.
- **A painted border is always a whole pixel**, whatever width the file declares — Chromium
  floors it, LibreOffice reserves the declared width (the Math Guide's cells ask for a 0.05pt hairline).
  The excess comes off the cell's `padding-bottom` (`--border-over`, `tableCellBorders.ts`;
  the bottom side only, since `border-collapse` draws one line per boundary), which is why the
  cell padding rides four custom properties rather than one shorthand. 0.25mm a row, a page
  over the Math Guide's length.
- **`<th>` carries no UA defaults.** A repeating ODF header row (`table:table-header-rows`)
  becomes a `tableHeader`, and the browser centres and bolds it — neither Word nor LibreOffice
  does. `editor.css` resets both, so the cell follows its own style (the "header row" preset's
  bold still comes from `.cell-header`).
