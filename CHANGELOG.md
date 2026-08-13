# Changelog

## [0.1.0] · MVP

### Stack
- Vite + Svelte 5 (runes mode) + TypeScript
- TipTap 3 / ProseMirror (individual extensions, no starter-kit)
- odf-kit for ODT generation, `fflate` for (un)zipping `.odt`/`.docx`
- `docx` for Word (.docx) export/import
- `jspdf` + `html2canvas` for PDF export
- Hunspell (`hunspell-asm`, WASM) with `dictionary-en` / `dictionary-de` for spell check
- Vitest (+ jsdom) for testing; `svelte-check` for type-checking
- No backend — fully client-side

### Implemented

**Architecture**
- WYSIWYG editor built on TipTap 3 (individual extensions, no starter-kit); toolbar active-states stay reactive via a `tick` counter (Svelte 5 same-reference workaround)
- Fixed A4 paper canvas (794 × 1123 px @ 96 dpi) with CSS-simulated pagination and visual page breaks
- LocalStorage auto-save (debounced 1 s); restores document, theme, zoom, margins, orientation, etc. on reload
- Fully client-side / serverless; hand-coded SVG favicon
- Placeholder text on an empty document

**Text formatting**
- Bold, Italic, Underline, Strikethrough
- Subscript / Superscript
- Font family picker (lists only fonts installed on the machine; remembers recently used fonts)
- Font size
- Font color and highlight color (color picker with custom colors)
- Headings H1–H6 with LibreOffice's sizes (18/16/14/13/12/12 pt, levels 4 and 6 italic), including un-bolding a heading

**Styles**
- Named paragraph styles with LibreOffice's inheritance model: a style has a parent, a follow-on style and its own properties; changing a style updates every paragraph using it. Built-ins Default text → Heading → Heading 1–6 / Title / Subtitle / Quote, with LibreOffice's values (18/16/14/13/12/12 pt headings)
- Named character styles (Emphasis / Strong Emphasis / Source Text + own ones) as a mark on a text run
- Style gallery in the toolbar lists both families; assigning a style keeps hard formatting (Word/LibreOffice behavior), Ctrl+M clears direct formatting but keeps the style
- Style manager ("Manage styles…"): inheritance tree, live property editing (empty field = inherit again), new / update from selection, rename, delete, reset a built-in — for paragraph and character styles alike
- Round-trips as real styles, not baked formatting: ODF `style:style` (`style:family="paragraph"`/`"text"`, `style:parent-style-name`, `style:next-style-name`) and DOCX `w:pStyle`/`w:rStyle` with `w:basedOn`/`w:next`; import adopts the file's used styles plus their parent chains, so only formatting beyond the style stays direct
- Named table styles as the third family (Word's table styles / LibreOffice's AutoFormats): 14 built-ins — Grid (+ rows / columns only), List shaded / columns, Plain, four colored box lists, Grid & List Accent, Academic, Financial. Picking one from the gallery in the table toolbar paints header row, banded rows/columns, first/last column and total row, and a styled table re-bands itself when rows or columns are added
- Word's Table Style Options as six checkboxes beside the gallery (header row, total row, first/last column, banded rows/columns): an area is painted only when the style defines it *and* the table opts in, and turning the header row off shifts the banding by one row. The toolbar's header row / first column buttons drive the same flags, so both surfaces always agree
- Table styles are edited in the same style manager (third tab: area picker for fill and font, outer / row line / column line controls, new / rename / remove), also reachable from the insert-table dropdown
- Round-trip: the style name travels as an ODF `style:family="table"` (`style:parent-style-name`) and DOCX `w:tblStyle`, the options as ODF's `table:use-*-styles` and Word's `w:tblLook`. Fills and borders are materialized into the cells and the region's font is baked onto the runs, so the table looks right in Word/LibreOffice even though ODF has no banding concept — the style definitions themselves live in the app, as LibreOffice's AutoFormats do
- Banded rows and columns start on the **first** body row/column, as in Word and LibreOffice — the stripe used to begin one row late. A document with a table style assigned re-bands itself when it is next opened
- A paragraph style's own rule line and colored field are read from the style, not only from direct formatting, so a Word Title keeps the line under it — with the gap the file asks for (`w:pBdr w:space` / ODF `fo:padding`), on the ruled sides only
- A Word table's indent follows the file's compatibility mode: up to Word 2010 `w:tblInd` is measured to the cell's text, so the table hangs its left cell margin into the page margin and the first column's text lines up with the body — from Word 2013 it is the table's edge
- A Word file's own table style is read the other way round: its conditional areas (`w:tblStylePr` — header row, banded rows, first/last column) are baked into the cells on import, shading, borders and bold/colour alike, so a document styled with Word's Light Grid or Medium Shading opens looking like it does in Word and LibreOffice
- A new document starts from the built-in styles, like Word's/LibreOffice's default template

**Paragraphs & lists**
- Text alignment: left, center, right, justify
- Line spacing and paragraph spacing (space before / after)
- Increase / decrease indent (paragraphs and lists)
- Bulleted and ordered lists — nested, with multiple numbering styles (decimal, alpha, roman; `.` or `)` suffix) and whole-list indent; Tab / Shift-Tab to nest / un-nest
- Word-style nesting defaults for ordered lists: an indented level numbers 1. → a. → i. (repeating) instead of restarting at "1." everywhere; explicit styles per level still override. Plus legal/outline numbering (1., 1.1., 1.2.1. …) as a list type — rendered via CSS counters, round-trips to ODF `text:display-levels` and DOCX `%1.%2.` lvlText chains
- Nested ordered levels advance the cycle relative to the level above and inherit its suffix (a level-1 `a)` gives `i)` then `1)`); the numbering style chosen for a level is reused when you nest into it again
- Customizable bullet symbols per list level (picker on the bullet-list split button: • ◦ ▪ ❖ ➢ ⇨ ✓ – >); round-trips to ODF `text:bullet-char` and DOCX `w:lvlText`, and the DOCX/ODT import maps Wingdings/Symbol bullets (arrows, diamonds, checkmarks …) to their Unicode equivalents instead of flattening them to plain dots. Symbols Liberation Serif lacks render from a bundled 2 KB DejaVu Sans subset (`EdenSymbols.woff2`), so markers look compact and identical on every platform instead of a stretched OS fallback
- Tab stops per paragraph: left, centre, right and decimal, honoured in the rendered text (CSS only has a fixed tab grid, so each tab is measured and placed); a hanging indent implies a stop at the text position. Set them on the ruler; round-trips to ODF `style:tab-stops` and DOCX `w:tabs`
- Paragraph borders and shading: per-side borders with presets (all / single edges / none), width and color, plus a background fill, on paragraphs and headings; typing `---`, `___` or `===` on a line of its own turns it into a rule line (Word/LibreOffice AutoCorrect). Round-trips to ODF `fo:border-*`/`fo:background-color` and DOCX `w:pBdr`/`w:shd`
- AutoCorrect while typing (LibreOffice's Tools ▸ AutoCorrect Options, one checkbox per rule): typographic quotes per document language (`"…"` / `„…“`), its dash matrix (`A - B` → `A – B`, `A--B` → `A—B`), its replacement table (`-->` → `→`, `(C)` → `©`, `...` → `…`), capitalize the first letter of a sentence — with an abbreviation exception list — and TWo INitial CApitals. URL recognition and auto-list ride the same switches
- Automatic hyphenation for the whole document (Layout ▸ Hyphenation): the browser hyphenates in the document's own language, which shortens a justified paragraph the way LibreOffice does. Round-trips as ODF `fo:hyphenate` on the base style — where LibreOffice keeps it, in its *text* properties — and Word's `w:autoHyphenation`
- Manual line breaks (Shift+Enter)

**Insert**
- Tables: insert via size picker, Word-style row/column drag-resize, add / delete rows & columns, delete table, cell borders, merge cells and split cells (N×M, Word/LibreOffice-style), cell background shading, header row / first column toggles, named table styles (see Styles); a table splits cleanly across page boundaries
- Repeat the header row: the first row is drawn again at the top of every page the table continues on, as in Word and LibreOffice. Round-trips to ODF `table:table-header-rows` and Word's `w:tblHeader`. A row that fits a page never splits anyway (the editor paginates a table between its rows), so Word's "don't allow row to break" needs nothing
- Table border control (Word/LibreOffice-style): per-side cell borders with presets (all / outside / inside / single edges / none), line width and color; buttons show active states matching the current pen and toggle borders off; round-trips to ODF `fo:border-*` and DOCX `w:tcBorders`
- Images: inline or floating with text wrap (left / right / top-bottom), resize handles, rotation, live size badge; insert via toolbar, drag-and-drop, or paste. A floating frame is placed by the file's own offsets, and two top-and-bottom frames set against opposite ends of the text share one band, side by side
- A CMYK JPEG's embedded ICC profile is dropped on import: Chromium colour-manages through it where LibreOffice and Word convert naively, which turned a contract's logo from vivid blue to dull teal and its black to grey. It also removes what is often most of the file (a 757 KB logo → 102 KB, easing the localStorage ceiling below)
- EMF metafiles are drawn (`import/emf.ts`): the picture is rebuilt as SVG from the metafile's own records — paths, filled shapes, text with its font and colour, embedded bitmaps — so a plot pasted out of MATLAB or Excel arrives as a picture instead of a placeholder
- Anything wider than the sheet — an oversized formula, a frame reaching past the margin — is cut at the page edge, as it is in LibreOffice
- Charts are drawn from the file — DrawingML `chartN.xml` and ODF `chart:chart`, bar / line / area / scatter / pie, with their titles, axis titles, gridlines, axis bounds and series colours (read-only; see the limitations below)
- Special characters picker
- Date and time fields: picker with 7 date and 4 time formats (live samples) and an "update automatically" toggle — fixed fields keep the inserted moment, auto fields refresh on open. Round-trips to ODF `text:date`/`text:time` (minted `number:date/time-style`) and DOCX `DATE`/`TIME` fields; the field carries the surrounding font
- Page numbering options (Layout ▸ Page numbers): the five formats both word processors offer (1 / i / I / a / A) and a start value. Round-trips to ODF `style:num-format` on the page layout plus `style:page-number` on the first paragraph — where LibreOffice keeps the start, ODF having no document-level one — and to Word's `w:pgNumType`
- Table of contents: generated from headings (H1–H5) with live page numbers and dot leaders, click an entry to jump to its heading; round-trips to ODF `text:table-of-content` and a Word TOC field
- Comments: annotate a selection (Review tab or the context menu) and work through them in the reviewing pane — edit, resolve, remove, click one to jump to the text it marks. Round-trips to ODF `office:annotation`/`office:annotation-end` (with LibreOffice's `loext:resolved`) and to Word's `w:commentRangeStart`/`-End` + `word/comments.xml`; a LibreOffice point comment, which has no range, attaches to the run before it
- Footnotes and endnotes (Ctrl+Alt+F / Ctrl+Alt+D): a footnote is drawn at the foot of the page its anchor sits on, with the separator line above it and the body text moved up to make room; endnotes are collected on their own page at the document end. Notes renumber themselves as anchors move, and deleting an anchor deletes its note. An options dialog covers numbering format, start value, restart, position, prefix/suffix, the two styles and the separator's length, thickness, spacing, alignment and colour. Round-trips to ODF `text:note` + `text:notes-configuration` and to Word's `word/footnotes.xml`/`endnotes.xml` + `w:footnotePr`
- Formulas: dialog with a LaTeX field and live preview; only the LaTeX is stored, the MathML the browser typesets, the ODF formula object and the OMML are derived from it. Inline or as a centered display line, double-click to edit. Round-trips as a real embedded ODF formula object (`draw:object` + `Formula{n}/content.xml`, our LaTeX kept in the MathML `annotation`) and as Word's `m:oMath`. STIX Two Math is bundled, so stretched brackets and ∑/∫ look the same on every platform
- Hyperlinks: create / edit / remove (toolbar + Ctrl+K), Ctrl/Cmd+click to open, hover hint showing the URL; ODF `text:a` round-trip
- Bookmarks and cross-references: name a selection, then insert a reference to it (its text, its number or its page); the reference follows the text it points at. Round-trips to ODF `text:bookmark-start`/`text:bookmark-ref` and Word's `Bookmark` + `REF`/`PAGEREF` fields
- Manual page break (Ctrl+Enter); round-trips to ODF `fo:break-before`
- Text boxes and basic shapes (rectangle / rounded rectangle / ellipse): editable block content, fill and border colors, border width, resize/rotate handles, text wrap (inline / left / right / top-bottom) like images; floating toolbar for wrap, shape kind and colors. Round-trips to ODF `draw:frame`/`draw:text-box` + `draw:custom-shape` and DOCX DrawingML `wps:wsp`/`wps:txbx` (imports Word's `mc:AlternateContent` and legacy VML text boxes too)

**Page & layout**
- Page margins (cm) and page orientation (portrait / landscape)
- Page format picker (Layout panel): 15 Word/LibreOffice sizes — A3–A6, ISO B4–B6, JIS B4/B5, Letter, Legal, Tabloid, Executive, Folio, Statement — each showing its cm dimensions; drives the on-screen page, pagination, and ODT/DOCX/PDF export, and is detected & adopted on import
- Right-to-left pages (ODF `style:writing-mode="rl-tb"`, Word's `w:bidi`): the body's base direction, so a multi-column page fills its columns **from the right** as LibreOffice does, and bidi resolves a Hebrew or Arabic line the way the file means it. Round-trips through both formats
- Mirrored page margins (ODF `style:page-usage="mirrored"`, Word's `w:mirrorMargins`): the declared left/right are the inner/outer pair, and an even (left-hand) page swaps them — body text and the header/footer band alike. Round-trips through both formats
- Multi-column (newspaper) layout: 1–3 columns with adjustable gap, applied to the whole document (no selection) or to selected paragraphs, Word-style — text fills column 1 to the page bottom, then column 2, and flows across pages with mid-paragraph line breaks; a section followed by other content balances its columns. Round-trips to ODF `text:section`/`style:columns` and DOCX continuous sections with `w:cols`
- Page margins per section: a section's own `w:pgMar` / ODF page layout is read, rendered and written back, and an ODF page style that hands over to another (`style:next-style-name`, the title-page idiom) gives its layout to the section's first page and the successor's to the rest. The ruler and the header/footer layer still show the document's own pair
- Headers & footers: page-number / page-count fields, configurable edge distances, and variants — different first page and different odd & even pages (edit a page's zone directly; blank first/even zones supported). Press Enter to add blank lines that grow a zone into the page while body text reflows so the page break sits above the footer / below the header, never overlapping. Inline images/logos can be inserted in a zone. Round-trips to ODF (`style:header-first`/`-left`, `draw:frame`) and DOCX (`w:titlePg`/`w:evenAndOddHeaders`, `ImageRun`)
- Zoom (20–300 %)
- Horizontal ruler above the page: click to place a tab stop of the selected type, drag to move it, drag it off to remove it; three markers set the paragraph's first-line, left and right indent. Toggle in the extended toolbar
- Show formatting marks (spaces, tabs, paragraph marks)

**Editing aids**
- Word/LibreOffice keyboard shortcuts throughout: Ctrl+L/E/R/J alignment, Ctrl+Alt+1–5 headings and Ctrl+Shift+N default style, Ctrl+1/2/5 line spacing, Ctrl+Shift+P / Ctrl+Shift+B super/subscript, Ctrl+Shift+. / Ctrl+Shift+, grow/shrink font, Ctrl+Space clear formatting, Ctrl+Shift+Space non-breaking space, Ctrl+Shift+- soft hyphen, Alt+Shift+D / Alt+Shift+T date & time field, Ctrl+O open, F3 / Shift+F3 find next/previous, Ctrl+F10 formatting marks — alongside the existing Ctrl+B/I/U, Ctrl+M, Ctrl+K, Ctrl+Enter, Ctrl+F/H, Ctrl+S/P and Tab/Shift+Tab. All bindings live in one table, so tooltips stay in sync and they can be remapped later
- Undo / Redo with a labelled history dropdown
- Search & Replace (Ctrl+F / Ctrl+H): live match highlighting, match count, next / previous, match-case and whole-word options, replace current / replace all
  A `.*` toggle searches by regular expression, and the replacement expands `$1`…`$9` / `$&` from the match's captures (LibreOffice's syntax; Word has no equivalent)
- Right-click context menu for text: cut / copy / paste / paste without formatting, link insert-edit-remove, clear formatting — with the spelling suggestions merged in on top. Shift+right-click keeps the browser's own menu; images, text boxes and header/footer stay with their existing UI
- Spell check in English and German with squiggles and suggestions in the context menu (add / ignore word); selectable document language. Powered by Hunspell (WASM), so German compound words (Fußgänger, Krankenversicherung …) are recognised; dictionaries are lazy-loaded per language on demand
- Word / character count statistics (whole document and selection)

**UI & theming**
- Light / Dark / AllBlack / Auto appearance modes (settings menu in toolbar)
- Primary toolbar plus an expandable extended toolbar (horizontal scroll on narrow windows)
- Status bar with page number, word count, language and zoom controls
- About dialog
- UI internationalization (English / German): language picker, auto-detects the browser
  language on first load, persisted; covers toolbar, dialogs, menus, status bar and warnings

**File & export**
- ODT export via odf-kit with extensive content.xml / styles.xml post-processing (custom node types, tables with borders, images, fonts and colors); filename derived from the first heading (fallback `document.odt`)
- ODT import / open existing file: parses content.xml / styles.xml directly, adopts the file's margins and orientation, and reports graceful-degradation warnings
- Opens `.ott` templates (OpenDocument Text Template): read like an `.odt`, but as a new untitled document — the first Save writes a fresh `.odt` and never overwrites the template (Word/LibreOffice behavior)
- Embedded font loading: fonts embedded in an opened `.odt`/`.docx` (Word `.odttf` de-obfuscated) are registered via the FontFace API so text renders in its real face even when the font isn't installed; persisted per-document in IndexedDB so it survives a reload. Fonts the document only names but neither embeds nor installs are still flagged as substituted
- Word (.docx) export and import — round-trips the editor's formatting (text, fonts, lists, tables, images, headers/footers, page geometry) and opens real Word documents
- Document properties (title, subject, author, keywords, comments) in the File menu — LibreOffice's File ▸ Properties / Word's File ▸ Info. Round-trips through ODF `meta.xml` (one `meta:keyword` per keyword) and DOCX `docProps/core.xml`
- PDF export — Raster (pixel-exact copy of the editor with a selectable text layer) and Vector (crisp, fonts embedded, via the browser print dialog)
- Print (printer button / Ctrl+P) — opens the browser print dialog with a pixel-exact raster of the document (tables, headers/footers and page breaks intact)

### Not yet implemented

The gap against Word/LibreOffice, most valuable first. Reviewed 2026-08-08.

**Content an imported document loses**
- Track changes / revisions: no recording, no accept/reject, no author colors (`text:tracked-changes`, `w:ins`/`w:del`); imported revisions are flattened to their current state
- Charts are **drawn** from the file (`import/chart.ts`: DrawingML `chartN.xml` and ODF `chart:chart`), but as a picture, not a chart object — a re-export carries the drawing and the numbers behind it are no longer editable. The same holds for an **EMF** metafile (`import/emf.ts`): it is drawn, but as the SVG picture it was rebuilt into, and only from the record set a plot consists of — a hatched brush, a clipping region or a rotated bitmap is skipped. **WMF/SVM** metafiles and OLE objects still keep their box and a placeholder label, and export writes that back out: WMF is a different (16-bit) record format, SVM is StarOffice-proprietary, and an OLE object cannot be rendered without its application
- Shapes beyond rect / round-rect / ellipse: lines, arrows, connectors, polygons, freeform, and rotated shape text (dropped on import with a warning)
- Text boxes in the DOCX export: lists inside a box are flattened to literal-marker paragraphs (`•` / `1.`) and images inside a box are dropped — the box XML is injected by a post-pack string pass (`export/docx.ts` `applyTextBoxesDocx`) that mints no numbering.xml or media/rels entries. The ODT export has neither limitation

**Missing while writing**
- Hyphenation beyond the document switch: a per-paragraph "don't hyphenate", and the zone / ladder count (`fo:hyphenation-ladder-count`, `w:hyphenationZone`) — CSS exposes neither
- Captions with numbered figures/tables ("Abbildung 1: …") and the lists built from them (list of figures / tables). The TOC machinery exists, the other index families do not
- Restarting the page numbering **per section** (only the document's own format and start value exist)
- Heading levels 7–10 (Word and LibreOffice go that far; HTML stops at `h6`)
- Alphabetical index and bibliography
- Line numbering (LibreOffice Tools ▸ Line numbering / Word Layout ▸ Line numbers)
- Section-level page **size and orientation**: only the margins are per section. A file whose sections disagree on the page size keeps the last one's
- Table extras: sort, sum/formula in a cell, number recognition
- A list level's own hanging indent: the marker sits at the 0.635 cm both exports write (`LIST_HANGING_CM`), so a wider *left*-set marker overflows where Word moves the text to the next list tab (a **right**-set one — `w:lvlJc`, which is what the built-in Roman numberings use — grows into the margin and is fine). Reading the value back naively also moves the markers of our own ODT exports — LibreOffice draws its own flat hanging at exactly the value odf-kit writes for level 2; see `tests/render-parity/README.md` before building on it
- Images live as data-URIs in the autosaved JSON, so an image-heavy document can exceed the ~5 MB localStorage quota; `storage/autosave.ts` warns once and a reload restores the last version that still fit. IndexedDB (as `embeddedFontStore.ts` already uses) would lift the ceiling
- Linked / chained text frames
- Find & Replace by formatting or by style (the regular-expression half is implemented)
- Save as template (`.ott` / `.dotx`), multi-document management, recent-files list
- Watermark; page background and page border
- Thesaurus, grammar check, word completion, AutoText / building blocks
- Vertical writing modes (ODF `tb-rl`) and Asian typography (ruby). Right-to-left **pages** are supported (see above); a per-*paragraph* direction is not — the page's own carries the whole body
- Password-protected ODT/DOCX; digital signatures
- Navigator / outline view, split view
- PWA / offline support
- A committed corpus of documents we author ourselves, so CI can test against real files
  (`.gitignore` excludes all of `tests/render-parity/fixtures/` today)

**Out of scope for now**
- Mail merge, data sources, form fields
- Master documents
- Real-time collaboration (there is no backend by design)
- Macros / scripting

### Known limitations

Deviations from Word/LibreOffice the browser does not let us remove. Anything
merely unimplemented belongs in the list above, not here.

- Zoom 100% does not visually match Word/LibreOffice at 100% on the same
  screen. Root cause: the editor uses the browser's fixed 96 CSS DPI
  (794×1123 px for A4 — see `editor.css`, `pageBreaks.ts`), while Word and
  LibreOffice render against the OS-reported physical screen DPI so that
  1 cm on paper ≈ 1 cm on screen. Possible future fix: add a user-side
  calibration (DPI value or visual ruler) that scales the `zoom` factor.
  Decided 2026-05-26 not worth the effort for now.
- An image or text box cannot be dropped at a free point on the page. It is
  anchored to a text position: inline, or floating left / right / top-bottom,
  and dragging it re-anchors it to the paragraph under the cursor rather than
  placing it. Root cause: `float` is the only way to make browser text wrap
  around a box. CSS Exclusions, which would wrap around a freely placed one,
  are unimplemented in every engine, and `position: absolute` takes the frame
  out of flow so text runs underneath it.
  A file's own offsets are drawn: both round-trip (`wrapOffset`/`wrapOffsetY` =
  `svg:x`/`svg:y`, `positionH`/`positionV`) and both place the frame, the vertical
  one for top-and-bottom wrap, where no text sits beside it. What stays out of
  reach is a frame a word processor puts *inside* running text: Chromium moves
  every line after a full-width float below it, so such a frame lands after the
  paragraph's text instead. Noted 2026-08-08, revised 2026-08-09.
- A line takes one word more or fewer than LibreOffice, for two reasons neither
  of which CSS exposes. LibreOffice **compresses** inter-word spaces to fit a
  line (measured on the thesis: 91 of 349 full-width justified lines, up to
  0.83 px per space at 12 pt) where CSS justification only expands; and it
  quantizes every glyph advance where Chromium keeps it fractional, so the two
  drift apart along the line (identical word widths, 0.45 mm apart by the
  150th mm). A matching negative `word-spacing` was tried and reverted — it
  fixes the break but shortens every last line; see
  `tests/render-parity/README.md`. A third case is a run with no break
  opportunity in it that is longer than the space left (a row of leader dots, a
  long URL): LibreOffice fills the line and breaks the run at the margin, where
  Chromium moves the whole run to the next line. `overflow-wrap: anywhere` would
  match it but also breaks runs LibreOffice keeps whole and shrinks a table
  column to its narrowest glyph. Noted 2026-08-09, revised 2026-08-11.
- A line **inside a table cell** has slightly less room than in Word/LibreOffice,
  so it may take one word fewer. Root cause: with `border-collapse` Chromium
  takes the collapsed border's whole pixel off the cell's *content* width, while
  a word processor lays the line out between the cell margins whatever the
  border is — measured at 80.64 px of text in a 95.77 px column against
  LibreOffice's 21.59 mm. Giving the pixel back through the horizontal padding
  was tried and reverted: it fixes the line it was measured on and breaks
  another two tables on, so the real offset is under 0.2 mm — the same engine
  rounding as above. See `tests/render-parity/README.md`. Noted 2026-08-13.
- The **first line of a page** sits slightly lower than LibreOffice's. Root cause:
  a font carries two ascents, and the two engines pick different ones to place
  the first baseline against the text-area top — LibreOffice the OS/2 typo
  ascent, Chromium the hhea one its line box is built from. Read out of the
  bundled TTFs that is 0.7500 against 0.9521 em for Carlito (Liberation Serif
  0.6934 against 0.8911): **1.85 mm at 26 pt**, 0.84 mm at 12 pt. Every line
  after it matches — the line pitch is the same 1.2207 em on both sides — so it
  is visible only on a page opening with a large heading. CSS exposes no way to
  choose the other ascent. Noted 2026-08-13.
- A text box anchored inside a paragraph loses the vertical offset it was
  anchored by: it is a block node here, so the importer lifts it out and it
  simply follows that paragraph (measured 4.7 mm on the thesis' figure page).
  It also costs flow height a word processor does not spend: Word's picture
  caption is a text box declared 0.05 pt tall that overflows its own box, so
  LibreOffice reserves nothing for it and the empty paragraph after it holds the
  caption. Here it is a block, ~55 px — enough to push two lines off the thesis'
  page 15 and keep it one page behind through page 45. Noted 2026-08-09.
- Line height follows the paragraph, not the line: the block's CSS strut applies
  to every line, where a word processor takes each line's own runs. A paragraph
  whose runs all agree takes theirs, so only a paragraph of *mixed* sizes struts
  too low. A fix (`line-height: 0` + inline decoration) measured right on a
  purpose-built fixture but cost the contract fixture 22 issues; reverted. Detail
  in `tests/render-parity/README.md`. Noted 2026-08-08.
- A plain text box's height is a *minimum* (content grows the box, like the
  editor). LibreOffice recomputes auto-grow heights on open, so a re-saved box
  keeps its content but sheds excess empty height. Shapes (rect/ellipse) export
  with fixed geometry instead. Noted 2026-07-03.
- A list marker does not size the line it labels. Word and LibreOffice put the
  numbering's own font on that line, so a marker whose font reaches deeper than
  the text grows it (measured: a Courier New bullet on 11 pt Carlito text adds
  0.031 em ≈ 0.12 mm, which is ~1 mm down a page of bullets). Root cause: the
  marker is an out-of-flow `::before` (`editor.css`) because CSS gives an
  outside `::marker` no position; and an outside `::marker` has no metric
  influence either — probed, changing its `font-family` moves nothing, only its
  `font-size` does, and that grows the line *above* the baseline where a word
  processor grows it below. Noted 2026-08-11.
- **Deliberate, not a defect:** an inline formula is typeset here, not placed as
  a box. LibreOffice stores each one as an OLE frame and positions that frame
  (`style:vertical-pos="middle"`/`"from-top"`); we render MathML, whose own
  baseline is the typographically right one, so the frame's vertical placement is
  ignored on import. Honouring it was tried and measured worse — every inline
  formula in the Math Guide sank ~1 mm and the corpus went from 100 to 125
  reported differences. It also means a render-parity run cannot compare a
  formula-heavy page: the two sides typeset the glyphs independently.
  Noted 2026-08-11.
- A paragraph a style hides (`text:display="none"`) is dropped on import, but a
  hidden **heading** still renders where LibreOffice draws nothing. Root cause:
  the editor has no block it can hold without drawing one, and that heading is
  the outline the running head's `text:chapter` field reads — a chapter marker
  exists for nothing else. Dropping it was tried and reverted: the running head
  went blank on every page quoting it, which is a whole line wrong on each
  against one line wrong once. A real fix needs a hidden-block attr that
  pagination and `collectChapterStarts` (`Editor.svelte`) both understand.
  Noted 2026-08-12.
- **Deliberate, not a defect:** a table of contents shows live page numbers.
  LibreOffice and Word print the numbers cached in the file until the reader
  updates the index, so a document whose cache is stale disagrees with us (the
  deputy-standards fixture caches page 7 for a heading that is on page 8 in both
  renderings). Noted 2026-08-11.

---

<!-- Add new entries above this line in the format: -->
<!-- ## [x.y.z] — YYYY-MM-DD -->
