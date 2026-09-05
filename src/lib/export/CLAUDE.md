# `src/lib/export/`

`odt.ts` (ODF), `docx.ts` (Word), `pdf.ts` (html2canvas + jsPDF), `saveFile.ts`.
Frames, tables and pagination have their own deep-dives in `docs/architecture/`.

A password set for the document is applied in `saveFile.ts`'s two write primitives, after
every pass here and after the template conversion — see `docs/architecture/encryption.md`.

**Save As is one entry per format** (`saveDocument`): the format is settled before the bytes
are built, because the download route (Brave ships with the File System Access API off) cannot
read a changed name back from the browser's dialog — and Chrome's macOS save panel has no format
popup and admits only the first picker type's extensions anyway. The chosen format is the
document's from then on; a template follows the document's format (`.ott`, or `.dotx` for `.docx`).

`saveFile.ts` picks the path: `showSaveFilePicker` where there is one, else a download —
Gecko has none and Brave disables the whole File System Access API by default. The first
fallback download shows a one-time hint (`edentext-download-hint`) that the browser's
"always ask where to save" setting picks the location.

## Heading defaults (`HEADING_STYLE_OVERRIDES`, `styles/headings.ts`)

- **Headings** follow LibreOffice too (`HEADING_STYLE_OVERRIDES`): 18 / 16 / 14 / 13 / 12 / 12pt (levels 4 and 6 italic) with
  the Heading style's 0.423cm/0.212cm margins on every level, bold, and **sans** (`HEADING_FONT` = Arial; on screen the bundled
  `@font-face` maps it to Liberation Sans, metric-identical, mirroring Liberation Serif →
  Times New Roman for the body). Levels **7–10** continue level 6 at 12pt (alternating italic):
  probed, LibreOffice writes those styles with no properties at all and resolves them from its
  own pool, so there is no file value to follow. HTML stops at `h6`, so 7–10 render as unknown
  elements that `editor.css` gives `display: block`.
  Levels 1–10 (`MAX_HEADING_LEVEL` = `HEADING_STYLE_OVERRIDES.length`);
  both constants live in `styles/headings.ts` and feed the importers, the TOC, the DOCX heading styles,
  `utils/fontSize.ts`, and `editor.css` (kept in sync by `tests/unit/font-size-display.test.ts`).
  The importers no longer override a file's own heading formatting: they only suppress values
  that equal these defaults, exactly as for body text.

## ODF export (`odt.ts`)

`buildOdt(json, margins, orientation)` (the DOM-free pipeline returning the `.odt` bytes; `App.svelte` writes them via the File System Access API or a download — see `export/saveFile.ts`) calls `tiptapToOdt(json, opts)` from `odf-kit`, then runs **several content.xml / styles.xml post-processing passes** (unzip → string-replace → re-zip via `rezipOdt`). The ~30 intermediate archives are **stored, not deflated** — only the next pass's `unzipSync` ever reads them, and deflating every entry per pass made the pipeline ~10× slower (measured 853ms → 87ms on a 3-image document). `zipFinal` produces the returned `.odt`: mimetype first and stored (ODF requirement), already-compressed picture formats (png/jpg/gif/webp) stored, the rest deflated once. odf-kit alone can't express everything the editor supports, so:

- **Custom node types** (`injectCustomTypes`): paragraphs/headings carrying `lineHeight`/`textAlign`/spacing attrs — or runs with a `fontWeight` textStyle attr, which odf-kit's native path drops — are renamed to `__cust_p__`/`__cust_h__` and emitted via odf-kit's `unknownNodeHandler` (odf-kit ignores those node attrs otherwise). Tables are renamed to `__cust_table__` and built by `exportTable` with an explicit cell border (odf-kit's native table path emits no borders → invisible in LibreOffice/Word).
- **Hard breaks & tabs** (`replaceHardBreaks`/`replaceTabs`/`applyInlineSentinels`): `hardBreak` nodes become `LBR`-sentinel text and tab chars become `TAB`-sentinel text so both survive every odf-kit path (a literal `\t` would collapse to a space), then the sentinels are rewritten to `<text:line-break/>`/`<text:tab/>` in content.xml.
- **Images** (`replaceImages`/`applyImages`): odf-kit's native image path rounds dimensions to whole cm and doesn't reach our cell path, so images bypass it. `replaceImages` (a pre-pass) swaps each `image` node for an `IMG`-sentinel text run and collects the bytes (decoded data-URI) + cm geometry (px→cm via `round3`); the sentinel rides every odf-kit path including table cells. `applyImages` (after `applyCellBlocks`) rewrites each sentinel to a `<draw:frame text:anchor-type="as-char" svg:width/height><draw:image xlink:href="Pictures/imageN.png"/></draw:frame>`, adds the binary `Pictures/` entries to the zip, and appends a `<manifest:file-entry>` per picture to `META-INF/manifest.xml`. Integer px ⇄ round3-cm ⇄ px is sub-pixel exact, so size is unchanged. A rotated image also gets a `draw:transform="rotate(<rad>) translate(...)"` (ODF rotate is CCW radians, ours CW degrees; the translate re-centres it on the unrotated box). A **floating** image (`wrap !== 'inline'`) instead uses `text:anchor-type="paragraph"` + a minted `<style:style style:family="graphic">` carrying `style:wrap` + `style:horizontal-pos` (image-left → `wrap="right" horizontal-pos="left"`; topBottom → `wrap="none" horizontal-pos="center"`; through → `wrap="run-through"` + `style:run-through`) injected into content.xml automatic-styles.
- **Tables:** column widths come from the editor's per-column weights (`tableColumnWidthsCm`, summing exactly to the text width, with `table:align="margins"`). **Table margins:** a table's `marginLeft`/`marginRight` shrink that width and are written by `applyTableMargins` into the table's automatic style (`style:width` + `fo:margin-left`/`-right`; odf-kit names table styles `Table1`, `Table2`, … in document order, matching the descriptor list `exportTable` fills). odf-kit serializes each cell to a single `<text:p>` of runs; `exportTable` emits all of a cell's content into that paragraph separated by a `SEG` sentinel and records a `CellBlock[]` descriptor, then `applyCellBlocks` splits on `SEG` and rebuilds real `<text:h>`/`<text:p>`/`<text:list>` (incl. nested lists) with minted automatic paragraph styles. **Merged cells:** `exportTable` passes each cell's `colspan`/`rowspan` as odf-kit `CellOptions.colSpan`/`rowSpan`; odf-kit emits `table:number-columns/rows-spanned` and auto-generates the `<table:covered-table-cell>` placeholders (which never match the `applyCellBlocks` cell regex, so `cellBlocks` stays one-per-real-cell aligned). Import already reads spans/covered cells in `convertTable`. **Cell shading:** a cell's `backgroundColor` attr is passed as `CellOptions.backgroundColor` (normalized), which odf-kit mints into the cell style as `fo:background-color`. **Cell borders:** the per-side border attrs (tableCellBorders.ts) are passed as `CellOptions.borderTop/Right/Bottom/Left` (`'none'` or `'<W>pt solid #RRGGBB'`) overriding the table-level default border per side.
- **Text boxes / shapes** (`replaceTextBoxes`/`applyTextBoxes`): a box is inline, so it becomes **two** things. `replaceTextBoxes` (after `replacePageBreaks`, before the inline passes) recurses over every node's content like `replaceImages` and swaps each box for a `TBX`-sentinel `P{i}` run **where it sits in its paragraph** — which rides every odf-kit path, table cells included — while its own blocks are **staged** at top level between `S{i}`…`E{i}` marker paragraphs (U+E008), so every existing pass serializes them unchanged (custom attrs, list styles, inline sentinels, images) and document-order-indexed passes stay aligned. The staging is only a place to serialize in: where a box sits and where its content is written out are no longer the same spot, which is what lets a box in a cell work with no change to the cell machinery. `applyTextBoxes` (after `applyImages`) cuts each `S…E` region out, keeps the serialized blocks, and writes `<draw:frame><draw:text-box fo:min-height>` (plain box; `svg:height` also emitted for non-auto-grow consumers) or `<draw:custom-shape>` + preset `<draw:enhanced-geometry>` (`utils/shapes.ts`; see `docs/architecture/frames.md`) over the `P{i}` sentinel, in whatever `<text:p>` the box really sits in. It mints a `TbxFr{n}` graphic style (fill/stroke/padding + the image wrap props; `draw:auto-grow-height="true"` for boxes, both auto-grows explicitly **false** for shapes or LibreOffice's autofit shrinks them to their text). A plain box's style chains to **`style:parent-style-name="Frame"`** — that parent is what makes LibreOffice read it as a Writer text *frame*; without it it is a drawing object whose text loses lists, nested images and borders (probed on a re-save). It is also why an **as-char** box's style spells out `style:vertical-pos="top" style:vertical-rel="baseline"`: under that parent a frame naming no vertical position hangs below the line, where a style-less as-char frame (an image) stands on it. Frames take `fo:background-color` (written beside `draw:fill`) and `fo:border` — `draw:stroke` is ignored there — and vertical text as `style:writing-mode` in the graphic properties; a *shape* instead needs `<style:paragraph-properties style:writing-mode="tb-rl"/>` (both probed). `rewriteStylesXml` declares a minimal `Frame` base style (zeroed margins/padding/border, or the built-in leaks 2mm margins and a hairline). An in-line box has **no horizontal position of its own** — the paragraph it sits in aligns it — so nothing is minted for that; a band-wrapped one carries `wrapAlign` in its graphic style. DOCX is the same pair: `inlineToRuns` drops a marker **run** where the box sits, and `applyTextBoxesDocx` swaps only that run, leaving the paragraph and the text beside it alone.

- **A text box's own parts, DOCX** (`applyTextBoxesDocx`): the `docx` package can't emit a DrawingML shape, so the box XML is a hand-built string — and its content needs parts the package never hears about. The pass holds the whole unzipped package, so it mints them itself: a picture becomes `word/media/tbx{n}.{ext}` plus a `Relationship` above the package's highest `rId` (Content_Types already declares the raster defaults), a list an `<w:abstractNum>`/`<w:num>` pair above its highest id, appended **before** the first `<w:num>` because every abstract definition has to precede them. The numbering ids only exist once the packed file is in hand, so the paragraphs carry a `TXBX_NUM` sentinel that the same pass substitutes.
- **Templates** (`template.ts`): a `.ott`/`.dotx` is the built document with one label changed — ODF's package media type (in `mimetype` **and** in the manifest, the mimetype entry staying first and stored) and OOXML's content type for `/word/document.xml`. The template's format follows the document's (`handleSaveTemplate`).
- **Formulas** (`replaceFormulas`/`applyFormulas`): an `MTH`-sentinel run becomes an as-char `<draw:frame><draw:object xlink:href="./Formula{n}"/>` plus a `Formula{n}/content.xml` sub-document (MathML root) and its two manifest entries. **No `svg:width`/`svg:height`** — a sized frame makes LibreOffice scale the object instead of typesetting it. DOCX emits `<m:oMath>` (or `<m:oMathPara>` when displayed) from the same post-pack pass as the text boxes. See `docs/architecture/formulas.md`.
- **`applyEndnoteImagesDocx`** — the `docx` package registers a footnote's pictures in `word/_rels/footnotes.xml.rels` and leaves the endnotes' `rId{file}` placeholders standing, so an endnote's picture pointed at a relationship no reader could follow. The pass mints the relationship in that part's rels and fills the id in.
- **Right-to-left pages**: ODF gets `style:writing-mode="rl-tb"` on the page layout (`rewriteStylesXml`), DOCX a `<w:bidi/>` in every `w:sectPr` from a post-pack pass (`applyBidiDocx`) — the package exposes only the paragraph-level flag. A **paragraph's** own direction (`textDirection.ts`) rides that same flag in DOCX and the `ParaStyle`/PBX-spec pipe in ODF, so it reaches cells and list items as well as top-level blocks.
- **Mirror margins** (`applyMirrorMarginsDocx`, `export/docx.ts`): the `docx` package writes only the per-section `w:pgMar`, so Word's document-level `w:mirrorMargins` goes into `word/settings.xml` in the same post-pack pass; ODF's flag rides `rewriteStylesXml`. Both formats already hold left/right as the inner/outer pair, so only the flag has to travel.
- **Bookmarks & cross-references** (`replaceBookmarks`/`applyBookmarks`): the `BMS`/`BME`/`XRF` sentinels are spliced into the **run text** rather than emitted by a run builder, so they ride every odf-kit path (cells, custom paragraphs, lists) with no per-emitter change; one post-pass rewrites them to `<text:bookmark-start/>`/`<text:bookmark-end/>`/`<text:bookmark-ref>`. DOCX needs no pass at all — the `docx` package has `Bookmark`, `SimpleField` (`REF`/`PAGEREF`) and `InternalHyperlink`. See `docs/architecture/formatting.md`.
- **Captions** (`replaceSequenceFields`/`applySequenceFields`): a `SEQ` sentinel becomes a `<text:sequence>` carrying LibreOffice's own `text:formula="ooow:<name>+1"` (what makes its reader recount on load) plus a `<text:sequence-decl>` per counter used; DOCX gets a `SimpleField` `SEQ Figure \* ARABIC`. Both keep the editor's resolved rank as the field's cached result.
- **Tracked changes** (`replaceRevisions`/`applyRevisions`): ODF splits the pair. An insertion keeps its text inline and is bracketed by `TCI` sentinels → `<text:change-start/>`/`<text:change-end/>`; a deletion's text is **cut out of the run** and left as one `TCD` → `<text:change/>`, the text itself going into the `<text:tracked-changes>` registry `applyRevisions` builds right after `<office:text>` (a `<text:deletion>` holds the deleted paragraphs, a `<text:insertion>` only its `<office:change-info>`). The registry's `<dc:creator>`/`<dc:date>` need `ensureDcNamespace` — odf-kit declares no `dc:` prefix in content.xml. The registry also carries **whether recording goes on** (`text:track-changes`), so it is written for that alone when a document records but holds no change yet — LibreOffice writes the same empty element (probed). Word keeps that flag in settings.xml instead, which the `docx` package exposes as `features.trackRevisions` (its schema quote names the element). DOCX needs no string pass: `InsertedTextRun`/`DeletedTextRun` from the `docx` package emit `w:ins`/`w:del` + `w:delText`, with `docRevisionId` numbering them per document as it does comments.
- **Indexes, DOCX** (`indexFieldParagraphs`): TOC/INDEX/BIBLIOGRAPHY are complex fields whose result is the editor's cached rows (indent per level, leader tab, pages) — Word for Mac never updates fields on open, so a result-less field rendered as no index at all. `w:updateFields` still asks a capable reader to regenerate + hyperlink; the importer skips a field's own paragraphs and the node view rebuilds the rows live. A row carries `w:pStyle` where the index names a level style (`levelStyles`, `import/CLAUDE.md`) — `usedStyleNames` counts those names, so the styles reach styles.xml — and only otherwise the 0.5cm-per-level indent.
- **Bibliography** (`replaceBibEntries`/`applyBibEntries`, `applyBibliographyDocx`): a `BIB` sentinel becomes a `<text:bibliography-mark>` whose attributes are the whole source record and which **wraps** the text the citation shows (unlike an index mark, which is a point). The `<text:bibliography>` index writes an entry template per type actually cited, spelling out the same "key: author, title, year" the node view prints — LibreOffice regenerates the rows from it, so a template that said anything else would rewrite them. DOCX cites by tag (`CITATION "key"`) and keeps the sources in a **custom-XML part** the `docx` package knows nothing about, so the post-pack pass mints all four pieces itself: `customXml/item1.xml` (`b:Sources`), its `itemProps1.xml`, both relationships and the properties part's content type. (Probed: LibreOffice's own DOCX export writes the `CITATION` field but no sources at all.)
- **Ruby** (`replaceRuby`/`applyRuby`, `applyRubyDocx`): an `RBY` sentinel becomes a `<text:ruby>` holding both halves plus one minted `style:family="ruby"` automatic style (centred, above — probed: LibreOffice writes that style straight back out, adding only its own `loext:` mirror of the position). Word's is a `<w:ruby>` run the `docx` package cannot emit, so a post-pack pass swaps the sentinel run for it; the `w:rubyPr` sizes are half-points of the 12pt body default, which is what LibreOffice's own export writes.
- **Cell formulas** (`applyCellFormulas`, `formulaCellContent`): ODF puts the formula on the **cell**, so the pass walks `<table:table-cell` in the same document order `applyCellBlocks` does and writes `table:formula="ooow:…"` + the cached `office:value`. The `ooow:` is a namespace prefix, so `ensureOoowNamespace` declares it — undeclared, LibreOffice reads it as part of the formula. Word instead keeps a field *inside* the cell, so the DOCX side swaps the cell's first paragraph for one `SimpleField` — and the cell's **number format** rides that field's `\#` switch (`\@` for a date), where ODF puts it on the cell style (a minted data style plus a copy of the shared cell style that references it). The data style names the document's language, or LibreOffice prints its own locale's separators and currency symbol. The `\#` picture is written with that language's separators too (`cellFormatCode`): Word reads a picture with the reader's regional settings, so a German Word takes `"0.00"`'s dot as grouping and prints 84 as "084"; the importer reads a picture back by shape, whichever locale wrote it. See `docs/architecture/tables.md`.
- **`mergeListItemBlocks`/`applyListItemBlocks`** — odf-kit writes a list item's **first paragraph only**, so the item's further blocks ride it `SEG`-separated and the pass splits them back out inside the same `<text:list-item>`. They are re-emitted at the item's end (after a nested list, which is where they usually belong) wearing the item's own paragraph style. DOCX needs none of it: `listToParagraphs` writes the extras as unnumbered paragraphs at the item's indent, which is Word's own shape.
- **`applyTableHeaderRows`** — `<table:table-header-rows>` around the first row when the table asks for the repeat **or** that row's cells are header cells: ODF spells both with the one element, as `w:tblHeader` does, so a header row reads back as one (and as repeating, in both formats).
- **`applyListItemStyles`** — per-item alignment/spacing/line-height for top-level lists (odf-kit's ListBuilder has no per-item options) via minted automatic styles.
- **`applyListIndents`** — a top-level list's whole-list `indent` (cm) added to its `L#` list-style per-level `fo:margin-left`/`text:list-tab-stop-position` (label-alignment mode ignores the paragraph margin, so the shift must live in the list style). Import reverses it in `convertList` (level-1 margin minus the 1.27cm base).
- **`applyNestedListTypes`** — odf-kit emits nested lists as bare `<text:list>` sharing the top-level list style, so a nested list of a different kind/format (e.g. ordered inside bullets) gets its own minted 6-level list style.
- **`applyListStyleNames`** — a list carrying an unoverridden `listStyleName` is repointed from its `L#` automatic style to the named `<text:list-style>` `applyNamedStyles` writes into styles.xml (its nested lists stay bare and inherit); runs after every `L#`-keyed pass. The list collectors resolve attrs through `effectiveListLevel`, so an overridden styled list keeps a fully resolved `L#` clone; `applyListLevelKinds` runs first and switches an `L#` level element's species where the style's level kind differs from the node's (a `<ul>` depth the style numbers), format/char baked in — see `src/lib/styles/CLAUDE.md`. **DOCX**: `Numbering.refForStyle` shares one abstract per style (each list its own `w:num` instance, so numbering restarts) and `applyListStylesDocx` injects the `w:styleLink` + the `w:type="numbering"` style's real numId post-pack — the library can express neither. A list with a `start` attr keeps a private clone (the shared abstract starts every instance at the style's start). Probed: LibreOffice ignores DOCX numbering styles both ways (its import mints `WWNum#`, its export flattens to the look) — the identity is a Word capability; ODF carries it in both products.
- **`applyListStartValues`** — odf-kit drops an ordered list's `start` attr; a Word list continued across an intervening paragraph (same numId, split into separate `orderedList` nodes with `start` > 1 by the importer) gets `text:start-value` on its first `<text:list-item>` so numbering keeps counting instead of restarting at 1.
- **`applyTableRowHeights`** — dragged row heights → `style:min-row-height` automatic table-row styles.
- **`collapseRunWhitespace`** — strips the bare `\n` separators odf-kit inserts between runs inside a paragraph (they'd otherwise collapse to spurious spaces mid-word).
- **`rewriteStylesXml`** — `style:page-usage="mirrored"` on the page layout when the margins mirror (the left/right pair is already the inner/outer one), default font Liberation Serif → Times New Roman, heading sizes/margins → the editor's values, Standard's `fo:margin-bottom` → 0 (odf-kit emits 0.212cm; every paragraph and list item inherits it, and the editor has no paragraph spacing — see below).
- **`normalizeColor`** — coerces colors to `#RRGGBB` (ODF requirement; rejects/normalizes `rgb()` and short hex).
- **Schema conformance** (guarded by `tests/schema-validation.test.ts`; LibreOffice forgives all of this, Word's strict reader does not): `applyOdfVersion` stamps every ODF part **1.3** — the version LibreOffice writes, and the first with `style:header-first` — over odf-kit's 1.2. `draw:image` carries the `xlink:type/show/actuate` trio (`xlink:type` is mandatory beside `xlink:href`); `text:time-value` is an xsd dateTime, never a `PT…S` duration (the ODT importer still reads the legacy duration); `index-entry-link-start/-end` only in TOC entry templates; `text:dont-balance-text-columns` on `style:section-properties`. DOCX: `orderDocxSettings` (last pass) re-sorts `w:settings` children into the fixed CT_Settings sequence the prepend-passes scramble; `w14:paraId` in comments.xml requires `mc:Ignorable="w14"` on the root. `w:numPr` sits after the keep flags in a heading style's `w:pPr`, and `w:pBdr` sides are re-sorted post-pack (`orderParagraphBorders`: the library writes top, bottom, left, right). `tests/package-lint.test.ts` guards the invariants the schemas cannot express (unique style ids, no dangling style/num/rel references, balanced ranges, manifest completeness).

- **Every master of a section writes the running zone, blank where its own page has none.**
  The page layout takes the band off the page margin for the whole section (`layoutFor`), so
  a master without the zone puts its body up into the band — the page a section opens on and
  the pages after it are separate masters, and it cost a chapter opening 0.8cm of its margin.
- **A section past the first spells its zones out, blank ones included.** A `w:sectPr`
  naming no `w:headerReference` is Word's "Link to Previous" and repeats the section above
  it — measured: a chapter's running head landed on the pages a blank section was meant
  for. Both zones write an empty part rather than none (`spellOut`, `mkHeaders`).
- **A section begins a page in DOCX** (`w:type` nextPage, as naming a master page does in ODF);
  only a columns group inside a section flows on continuously — the importer reads a
  continuous break as a columns boundary, so a real section on one lost its break.
- **Odd/even is document-wide in DOCX** (`w:evenAndOddHeaders`): a section not asking for it
  gets its running zones copied into its even parts, or Word links them to the section above.
  `w:fmt` rides every `w:sectPr` as well: Word has no document default behind it.
- **An ODF section master's layout is built from its own zones** (`layoutFor`: page margin =
  edge→zone distance on a side that has a zone, the body margin on one that has none — a
  shared layout put a footer-less chapter's body at the footer distance). A variant zone
  travels with its running one, in the schema's order (running, left, first); the watermark
  is injected after the section masters exist, so their pages show it too.
- **A section opening on a side hands over after its first page** (`masterPageXml` part
  `right`/`left` → `rest`): a right-only master makes every page of it a right page in
  LibreOffice, with a blank one between any two — measured: a book's 93 pages became 189.
- **A tab in a document-level zone is `<text:tab/>`** (`applyHfPostProcess`): odf-kit writes it
  bare, and LibreOffice reads a bare tab as a space.
- **DOCX styles are named for Word's map**: the default style is `Normal` with `w:default="1"`
  (LibreOffice keeps any other name beside its Standard as "… (WW)", and a reader without the
  flag falls back to docDefaults); `w:position` is half-points (LibreOffice ignores a unit);
  `w:footnotePr` rides every `w:sectPr` (LibreOffice reads none from settings.xml);
  `lastModifiedBy` is the author (LibreOffice shows the modifier); a page field carries a
  result; a later columns group of a section names no zones ("Link to Previous" — a
  reference of its own makes LibreOffice switch page styles there, with a page break).
- **`style:name` is an NCName**: every other character travels as LibreOffice's `_hex_`
  (`odfStyleName`, "&" → `_26_`), the display name carries the real one; a sentinel's
  payload is serialized text, so its XML escapes come off first.
- **A box spanning the text column keeps where it sits across it**, banded or behind the
  text alike; only a side wrap has its side dictated by the wrap itself.
- **An index row's tab stop is written even with no page number running to it** — it is
  where the row's leader is kept, and a stop no tab reaches draws nothing.
- **The note configuration is written whether or not a note exists** (`applyNotePrDocx`,
  outside the `docNoteIds.size` gate, as Word keeps its own in settings.xml): a document
  numbering its first footnote from 3 must still say so.

- **A note writes the paragraph style it names** (`noteStyleName`, and `usedStyleNames`
  defines it): the stock `FootnoteText` is 10pt, so a note whose file gives it the body
  size would shrink. See `docs/architecture/notes.md`.

- **A heading writes its own `w:outlineLvl`** beside its `w:pStyle`: the style carries the
  look, the level says it is a heading at all, and a document setting its chapters in a
  style of its own leaves the importer nothing else to go by.
- **SVG is rasterized on the way into a .docx** (`rasterizeSvgImages`, before the walk —
  the emitters that place pictures are synchronous): Word reads no SVG, and an EMF arrives
  as one too, so a vector picture is drawn to PNG at 2× its placed size. Off the main
  thread there is no canvas and the picture is skipped, as it always was.

- **Factory style slots** (`FACTORY_SLOTS`, `buildStyles`): the `docx` package always writes its own Title/Heading1–6 into styles.xml, so the registry's versions ride `styles.default.title/headingN` instead of `paragraphStyles` — a second definition under the same `w:styleId` makes Word **and** LibreOffice drop the `basedOn` chain (headings lose their sans/bold). Table and numbering styles are **spliced post-pack** (`applyRawStylesDocx`): passing them as `importedStyles` makes the package's Styles merge replace its whole factory set, `w:docDefaults` (default font/size/language) included.

The filename is derived from the first non-empty heading (max 50 chars, sanitized), falling back to `document.odt`.

## Printing the review markup (`reviewPrint.ts`)

A printed document says what the screen says: a bar in the margin beside every changed or
commented block, and the comment bodies as a list after the document. The list is not a
nicety — a comment's text is nowhere on the page, so a bar alone could only say that one
exists. A resolved comment prints nowhere, and a document with no markup prints exactly as
before (no list, no CSS, no margin shift). The Review tab's **Print markup** toggle
(`storage/printMarkup.svelte.ts`) turns the whole thing off, as both products offer;
`printPdf` rebuilds its options field by field, so a new one has to be copied there too.

**The display mode prints too** (`storage/markup`, Word's "Display for review"): a page in
*no markup* prints as it reads. The two paths that rasterise the live `.paper` inherit its
attributes with the clone; `printPdf` builds its page from the document instead, so it
takes them as `markupAttrs`. `printMarkup` still governs the bar and the list beside it.

- **The margin strip is paid for.** The print engine clips to the page area, so a bar at a
  negative offset is silently dropped — measured, not assumed. `printPdf` takes
  `BAR_STRIP_CM` out of the left `@page` margin and gives it back as `.paper` padding,
  which leaves the text column exactly where it was.
- **The two paths differ in resolution.** The raster paths (`exportPdf`, `printRaster`)
  clone the live `.paper`, so they get `ChangeBarLayer`'s own per-range bars for free —
  `buildClone` only drops the `.active` weight, an editing state. `printPdf` rebuilds from
  `generateHTML`, where no layout exists yet: `markReviewBlocks` marks whole top-level
  blocks (CSS has no line box to hang a bar on, and only a top-level block's left edge is
  the text column's), so a long paragraph with a small change is marked whole.
- **An entry names its page**, which with the quoted text is what makes it findable in a
  printout nobody can click — the format LibreOffice prints its own end-of-document
  comments in. Only the raster paths can say it (`withAnchorPages`): they print the
  editor's own pagination, while the vector path re-paginates in the browser and its entry
  simply has no page. The page comes off one `cycle`, so mixed section paper is out — the
  same limitation `Editor.svelte`'s own current-page readout has.
- **The list is a page, not a flow, in the raster paths.** The live `.paper` is an already
  paginated layout nothing can flow into, so `renderCommentPages` lays the list out and
  rasters it on its own; a page starts at an entry boundary, since a raster sliced mid-line
  cuts the text in half. One entry taller than a page is clipped. The vector path just
  appends the section next to `.tiptap` — a sibling, or the editor's own heading and list
  rules would restyle it — and lets the browser paginate.

## Header/footer export

- **Export:** a synthetic `__cust_hf__` node routes to `unknownNodeHandler`, which calls odf-kit's `setHeader`/`setFooter` (`applyHfRuns`); `hardBreak`→`LBR`, `pageNumber`→`addPageNumber`, `pageCount`→`PGC` sentinel. A zone image is an as-char `<draw:frame>`, or — floating — a page-anchored one plus a minted `HfBg*` graphic style (`run-through` behind the text, positioned from the page corner). `applyHfPostProcess` (on styles.xml) rewrites the sentinels to `<text:line-break/>`/`<text:page-count>`, applies the paragraph alignment to the `Header`/`Footer` styles, and converts geometry to Word's model: page margin = the zone's edge distance (`headerDistanceCm`/`footerDistanceCm`), header/footer `min-height` = body margin − distance, so the **body** still starts at the editor's margin.

Sentinel order matters — the passes assume it. Full list of sentinels in use:
`LBR`/`TAB` (inline), `IMG`, `SEG` (cell blocks), `TBX` U+E008 (text boxes),
U+E009 (columns), U+E00A (date/time fields), `STY` U+E00D (paragraph styles),
`CST` U+E00E (character styles), `TEF` U+E00F (text effects), `PBX` (paragraph boxes), `SEC` U+E010
(section breaks), `LEAD` U+E011 (a tab stop's leader, inside `style:type`), `MTH` U+E012 (formulas),
`BMS`/`BME` U+E013/U+E014 (a bookmark's range), `XRF` U+E015 (cross-references),
`CHP` U+E016 (the chapter field), `FNT` U+E017 (footnotes/endnotes),
`CMS`/`CME` U+E018/U+E019 (a comment's range), `SEQ` U+E01A (a caption's number),
`TCI` U+E01B (a tracked insertion's range), `TCD` U+E01C (where a tracked deletion was),
`TXBX_NUM` U+E01D (DOCX only: a numbering id a box's list has yet to be given),
`IXE` U+E01E (an alphabetical-index entry), `BIB` U+E01F (a citation),
`NOHYP` U+E020 (DOCX only: a paragraph whose w:pPr must gain w:suppressAutoHyphens),
`RBY` U+E021 (a ruby annotation), `PLH` U+E022 (a placeholder field — ODF
`<text:placeholder>`, DOCX a `w:sdt` content control tagged `edentext-placeholder`).
