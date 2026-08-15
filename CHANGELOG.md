# Changelog

<!-- Newest release first. New entries go here: ## [x.y.z] — YYYY-MM-DD -->

## [0.1.0] — 2026-08-16

First public release, deployed on GitHub Pages.

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
- A committed corpus of ten documents (`tests/corpus/`) CI runs against: each is authored with the `docx` lib directly — never with our own exporter, which would test it against itself — and converted to its ODT twin by LibreOffice. `corpus.test.ts` asserts that both formats of a document read the same, and that each survives our export and import in either format
- Placeholder text on an empty document

**Text formatting**
- Bold, Italic, Underline, Strikethrough
- Subscript / Superscript
- Font family picker (lists only fonts installed on the machine; remembers recently used fonts)
- Font size
- Font color and highlight color (color picker with custom colors)
- Headings H1–H10 with LibreOffice's sizes (18/16/14/13/12/12 pt, levels 4 and 6 italic), including un-bolding a heading. Levels 7–10 continue level 6 at 12pt — probed, LibreOffice writes those styles with no properties of their own and resolves them from its style pool, so there is no file value to follow. HTML stops at `h6`, so they render as unknown elements the editor's CSS makes blocks

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
- Word completion (the same dialog's own section, as LibreOffice keeps it): every word of at least eight letters is remembered as it is typed, and typing its first three letters offers the rest in grey after the caret — Enter takes the offer, Esc drops it. It is offered while typing only, so an Enter meant to split a paragraph never completes a word instead, and the offer stays outside the document until it is accepted. Minimum length, an appended space and clearing the collected words are all settable
- AutoText (LibreOffice's Tools ▸ AutoText, Word's Insert ▸ Quick Parts): keep a selected block of text under a name and a shortcut, then insert it from the library or by typing the shortcut and pressing F3 — LibreOffice's own key. An entry keeps its formatting, and the library belongs to the app rather than to a document, as it does in both products
- Ruby annotations (Insert ▸ Phonetic guide — LibreOffice's Format ▸ Asian Phonetic Guide, Word's Phonetic Guide): the reading printed over its base text, the selected text proposed as the base. Round-trips as ODF `text:ruby` with its ruby-family style and as Word's `w:ruby` run — verified through LibreOffice both ways, including our `.docx` converted to `.odt` by it
- A text box can run its text top-to-bottom (its toolbar's ⇊ button — LibreOffice's Format ▸ Text Attributes ▸ Text direction, Word's Text Direction): the browser lays the vertical flow out itself. Round-trips as the frame style's own writing mode in ODF — its *paragraph* properties, probed: in the graphic properties LibreOffice drops it — and as Word's `w:bodyPr vert`, with the VML fallback's `layout-flow:vertical` read too. Both verified through a LibreOffice re-save; converting our `.docx` to `.odt` LibreOffice itself loses the direction
- Automatic hyphenation for the whole document (Layout ▸ Hyphenation): the browser hyphenates in the document's own language, which shortens a justified paragraph the way LibreOffice does. Round-trips as ODF `fo:hyphenate` on the base style — where LibreOffice keeps it, in its *text* properties — and Word's `w:autoHyphenation`
- Manual line breaks (Shift+Enter)

**Insert**
- Tables: insert via size picker, Word-style row/column drag-resize, add / delete rows & columns, delete table, cell borders, merge cells and split cells (N×M, Word/LibreOffice-style), cell background shading, header row / first column toggles, named table styles (see Styles); a table splits cleanly across page boundaries
- Repeat the header row: the first row is drawn again at the top of every page the table continues on, as in Word and LibreOffice. Round-trips to ODF `table:table-header-rows` and Word's `w:tblHeader`. A row that fits a page never splits anyway (the editor paginates a table between its rows), so Word's "don't allow row to break" needs nothing
- Sort a table's rows (LibreOffice's Table ▸ Sort, Word's Layout ▸ Sort): the three keys both dialogs offer, each by any column, ascending or descending and with its own sort type — automatic (a cell that reads as a number sorts numerically, anything else by the document language's collation), numerically, or alphanumerically, which is the plain collation that puts "10" before "2". A later key decides only where the ones before it tie, rows alike in every key keep the order they were typed in, and the first row can be kept in place as a header
- A formula cell's own number format (in the Formula dialog, as Word has it): the general format, whole numbers, two decimals, grouped thousands, the two percentages, the document language's currency and its short date. ODF keeps it on the cell's style as a data style LibreOffice regenerates the value from, Word on the field as its `\#` switch — LibreOffice's own DOCX filter neither reads nor writes that switch, so the format survives the ODF leg and our own DOCX round trip
- The currency symbol and the date's order come from the document's language, not from a table of locales: LibreOffice renders our file exactly as the editor does (`$1,234.00` / `3/15/23` in English, `1.234,00 €` / `15.03.23` in German). A date is a serial day count from LibreOffice's own day 0, 1899-12-30. Word's formula dialog offers no date format, so the DOCX leg carries it in the field's `\@` date picture for us to read back
- Formulas in a cell (LibreOffice's Table ▸ Formula, Word's Layout ▸ Formula): `=SUM(ABOVE)`, `=AVERAGE(A1:A3)`, `=A1*2` — SUM, PRODUCT, AVERAGE, MIN, MAX, COUNT, ABS, INT, SIGN, MOD and ROUND over cell references, ranges and Word's directions, with arithmetic and parentheses. A formula cell shows its result on the field shade both word processors use and recomputes as the cells it reads change, a formula reading another formula included. It rides the cell as ODF's `table:formula` in LibreOffice's own language (`ooow:sum <A1:A3>`, a direction resolved to the range it stands for) with the result cached as `office:value`, and as Word's `=` field inside the cell — both re-read
- Number recognition (LibreOffice's Table ▸ Number Recognition): with it on, a cell whose text reads as a number is rewritten in the document language's number format when the cursor leaves it — `007,50` becomes `7,5`. **Off** by default, as it is in LibreOffice, and the parsing a formula does is independent of it, exactly as there
- Table border control (Word/LibreOffice-style): per-side cell borders with presets (all / outside / inside / single edges / none), line width and color; buttons show active states matching the current pen and toggle borders off; round-trips to ODF `fo:border-*` and DOCX `w:tcBorders`
- Lines and arrows (shape gallery: line, arrow, double arrow), which both importers used to drop: two endpoints rather than a box, so they hold no text, run across the frame's diagonal and take an arrow head that scales with the pen. The three kinds share their preset names on purpose — the heads a file declares are what tell them apart, so a Word `straightConnector1` with no heads opens as a plain line. ODF gets its own `<draw:line>` plus the one named `Arrow` marker LibreOffice itself writes; Word gets the `line` preset with `flipV` and `a:headEnd`/`a:tailEnd`. Verified against LibreOffice: the same three lines render identically from the .odt, the .docx and the editor
- Images: inline or floating with text wrap (left / right / top-bottom), resize handles, rotation, live size badge; insert via toolbar, drag-and-drop, or paste. A floating frame is placed by the file's own offsets, and two top-and-bottom frames set against opposite ends of the text share one band, side by side
- A CMYK JPEG's embedded ICC profile is dropped on import: Chromium colour-manages through it where LibreOffice and Word convert naively, which turned a contract's logo from vivid blue to dull teal and its black to grey. It also removes what is often most of the file (a 757 KB logo → 102 KB, easing the localStorage ceiling below)
- EMF metafiles are drawn (`import/emf.ts`): the picture is rebuilt as SVG from the metafile's own records — paths, filled shapes, text with its font and colour, embedded bitmaps — so a plot pasted out of MATLAB or Excel arrives as a picture instead of a placeholder
- Anything wider than the sheet — an oversized formula, a frame reaching past the margin — is cut at the page edge, as it is in LibreOffice
- Charts are drawn from the file — DrawingML `chartN.xml` and ODF `chart:chart`, bar / line / area / scatter / pie, with their titles, axis titles, gridlines, axis bounds and series colours (read-only; see the limitations below)
- Special characters picker
- Date and time fields: picker with 7 date and 4 time formats (live samples) and an "update automatically" toggle — fixed fields keep the inserted moment, auto fields refresh on open. Round-trips to ODF `text:date`/`text:time` (minted `number:date/time-style`) and DOCX `DATE`/`TIME` fields; the field carries the surrounding font
- Page numbering options (Layout ▸ Page numbers): the five formats both word processors offer (1 / i / I / a / A) and a start value. Round-trips to ODF `style:num-format` on the page layout plus `style:page-number` on the first paragraph — where LibreOffice keeps the start, ODF having no document-level one — and to Word's `w:pgNumType`
- Table of contents: generated from headings (H1–H5) with live page numbers and dot leaders, click an entry to jump to its heading; round-trips to ODF `text:table-of-content` and a Word TOC field
- Alphabetical index (References ▸ Index entry, then the Index in the same menu): mark a word — under a key of its own where the index should file it elsewhere — and the index lists every term once, sorted case-insensitively, with all the pages it was marked on. Round-trips as ODF `text:alphabetical-index-mark` + `text:alphabetical-index` (LibreOffice reads both back unchanged) and as Word's `XE` and `INDEX` fields
- Bibliography (References ▸ Citation, then the Bibliography in the index menu): a citation carries its whole source record — short name, type and its fields — so the document needs no database beside it, and the list prints one row per source cited, in document order and without page numbers, as both word processors do. Round-trips as ODF `text:bibliography-mark` + `text:bibliography` (LibreOffice reads every field back and regenerates the list from our entry templates) and as Word's `CITATION` and `BIBLIOGRAPHY` fields over a `b:Sources` custom-XML part — which LibreOffice's own Word export drops, so the record survives our leg and not its
- Section page setup: a section carries its own paper (Layout ▸ Orientation ▸ This section), so a wide table gets its landscape page amid portrait ones. The editor lays it out — the page grid is a table of per-page boxes rather than one repeating cycle, and every page below a section moves with it — and it round-trips as an ODF page layout of its own per master page and a `w:pgSz` per `w:sectPr`
- Comments: annotate a selection (Review tab or the context menu) and work through them in the reviewing pane — edit, resolve, remove, click one to jump to the text it marks. Round-trips to ODF `office:annotation`/`office:annotation-end` (with LibreOffice's `loext:resolved`) and to Word's `w:commentRangeStart`/`-End` + `word/comments.xml`; a LibreOffice point comment, which has no range, attaches to the run before it
- Track changes (Review ▸ Record changes): while recording, typed text is marked as an insertion and deleted text stays in the document struck through instead of going away, each carrying its author and date; consecutive typing is one change, and accept / reject work on the change at the cursor or on all of them. Round-trips to ODF's `text:tracked-changes` registry — `text:change-start`/`-end` around an insertion, `text:change` where a deletion was, its text kept in the registry — and to Word's `w:ins`/`w:del` + `w:delText`
- Footnotes and endnotes (Ctrl+Alt+F / Ctrl+Alt+D): a footnote is drawn at the foot of the page its anchor sits on, with the separator line above it and the body text moved up to make room; endnotes are collected on their own page at the document end. Notes renumber themselves as anchors move, and deleting an anchor deletes its note. An options dialog covers numbering format, start value, restart, position, prefix/suffix, the two styles and the separator's length, thickness, spacing, alignment and colour. Round-trips to ODF `text:note` + `text:notes-configuration` and to Word's `word/footnotes.xml`/`endnotes.xml` + `w:footnotePr`
- Formulas: dialog with a LaTeX field and live preview; only the LaTeX is stored, the MathML the browser typesets, the ODF formula object and the OMML are derived from it. Inline or as a centered display line, double-click to edit. Round-trips as a real embedded ODF formula object (`draw:object` + `Formula{n}/content.xml`, our LaTeX kept in the MathML `annotation`) and as Word's `m:oMath`. STIX Two Math is bundled, so stretched brackets and ∑/∫ look the same on every platform
- Hyperlinks: create / edit / remove (toolbar + Ctrl+K), Ctrl/Cmd+click to open, hover hint showing the URL; ODF `text:a` round-trip
- Bookmarks and cross-references: name a selection, then insert a reference to it (its text, its number or its page); the reference follows the text it points at. Round-trips to ODF `text:bookmark-start`/`text:bookmark-ref` and Word's `Bookmark` + `REF`/`PAGEREF` fields
- Manual page break (Ctrl+Enter); round-trips to ODF `fo:break-before`
- Text boxes and basic shapes — rectangle, rounded rectangle, ellipse, triangles, diamond, pentagon, hexagon, five-point star, trapezoid, parallelogram and the four block arrows: editable block content, fill and border colors, border width, resize/rotate handles, text wrap (inline / left / right / top-bottom) like images; a shape gallery in the floating toolbar and in the ribbon's Shape tab. Each outline is one polygon in `utils/shapes.ts` that the editor draws as SVG and the ODF export scales into its `draw:enhanced-path`, so the shape on screen is the shape in the file; Word gets the preset's name and draws its own. Round-trips to ODF `draw:frame`/`draw:text-box` + `draw:custom-shape` and DOCX DrawingML `wps:wsp`/`wps:txbx` (imports Word's `mc:AlternateContent` and legacy VML text boxes too)
- A drawing no gallery covers — a freeform, a polygon, a polyline, a bezier curve, a connector's elbow — keeps its own outline instead of being dropped: the box holds the file's path in the same 0…100 box a preset's points use, and the editor draws it. Read from all four dialects the two products write (ODF `draw:points`, `svg:d` on a `draw:path` or `draw:connector`, a `non-primitive` enhanced-path, DrawingML `a:custGeom` and VML's own reversed-case `path`), written back as ODF's enhanced-path and Word's custGeom — LibreOffice renders both exactly as the editor draws them. An outline that never closes is stroked only, as a polyline is in both products
- A text box carries its content into Word intact: a list inside one is a real Word list with its own numbering definition (nesting, marker symbols and start values included) and a picture inside one is a real picture, its bytes and relationship minted beside the package's own. Both were flattened to literal `•`/`1.` markers and dropped, respectively

**Page & layout**
- Page margins (cm) and page orientation (portrait / landscape)
- Page format picker (Layout panel): 15 Word/LibreOffice sizes — A3–A6, ISO B4–B6, JIS B4/B5, Letter, Legal, Tabloid, Executive, Folio, Statement — each showing its cm dimensions; drives the on-screen page, pagination, and ODT/DOCX/PDF export, and is detected & adopted on import
- Right-to-left pages (ODF `style:writing-mode="rl-tb"`, Word's `w:bidi`): the body's base direction, so a multi-column page fills its columns **from the right** as LibreOffice does, and bidi resolves a Hebrew or Arabic line the way the file means it. Round-trips through both formats
- Per-paragraph text direction (Paragraph dialog ▸ Text direction, where LibreOffice keeps it): a single quoted Hebrew or Arabic paragraph turns right-to-left inside a left-to-right document — and back. Round-trips as the block's own `style:writing-mode` / `w:bidi`, in table cells and list items too; the direction the page already has is inheritance, not formatting, so neither importer stamps it on every block
- Mirrored page margins (ODF `style:page-usage="mirrored"`, Word's `w:mirrorMargins`): the declared left/right are the inner/outer pair, and an even (left-hand) page swaps them — body text and the header/footer band alike. Round-trips through both formats
- Multi-column (newspaper) layout: 1–3 columns with adjustable gap, applied to the whole document (no selection) or to selected paragraphs, Word-style — text fills column 1 to the page bottom, then column 2, and flows across pages with mid-paragraph line breaks; a section followed by other content balances its columns. Round-trips to ODF `text:section`/`style:columns` and DOCX continuous sections with `w:cols`
- Page margins per section: a section's own `w:pgMar` / ODF page layout is read, rendered and written back, and an ODF page style that hands over to another (`style:next-style-name`, the title-page idiom) gives its layout to the section's first page and the successor's to the rest. The ruler and the header/footer layer still show the document's own pair
- Headers & footers: page-number / page-count fields, configurable edge distances, and variants — different first page and different odd & even pages (edit a page's zone directly; blank first/even zones supported). Press Enter to add blank lines that grow a zone into the page while body text reflows so the page break sits above the footer / below the header, never overlapping. Inline images/logos can be inserted in a zone. Round-trips to ODF (`style:header-first`/`-left`, `draw:frame`) and DOCX (`w:titlePg`/`w:evenAndOddHeaders`, `ImageRun`)
- Zoom (20–300 %)
- A section's own page setup: paper size and orientation per section (Layout ▸ Size / Orientation ▸ This section), beside the document's own. Pages of different sizes are each **centred** in the scroll, as both word processors draw them — sheet, text, header/footer, page border and line numbers alike
- Horizontal ruler above the page: click to place a tab stop of the selected type, drag to move it, drag it off to remove it; three markers set the paragraph's first-line, left and right indent. Toggle in the extended toolbar
- Show formatting marks (spaces, tabs, paragraph marks)

**Editing aids**
- Word/LibreOffice keyboard shortcuts throughout: Ctrl+L/E/R/J alignment, Ctrl+Alt+1–5 headings and Ctrl+Shift+N default style, Ctrl+1/2/5 line spacing, Ctrl+Shift+P / Ctrl+Shift+B super/subscript, Ctrl+Shift+. / Ctrl+Shift+, grow/shrink font, Ctrl+Space clear formatting, Ctrl+Shift+Space non-breaking space, Ctrl+Shift+- soft hyphen, Alt+Shift+D / Alt+Shift+T date & time field, Ctrl+O open, F3 / Shift+F3 find next/previous, Ctrl+F10 formatting marks — alongside the existing Ctrl+B/I/U, Ctrl+M, Ctrl+K, Ctrl+Enter, Ctrl+F/H, Ctrl+S/P and Tab/Shift+Tab. All bindings live in one table, so tooltips stay in sync and they can be remapped later
- Undo / Redo with a labelled history dropdown
- A paragraph of its own can opt out of the document's automatic hyphenation (Format ▸ Paragraph ▸ Text Flow, as LibreOffice has it). Only "off" travels — Word cannot turn hyphenation *on* for one paragraph — and only under a document that hyphenates: below that switch it says what is already true. Round-trips as ODF `fo:hyphenate="false"` in the paragraph's **text** properties and Word's `w:suppressAutoHyphens`
- Search & Replace (Ctrl+F / Ctrl+H): live match highlighting, match count, next / previous, match-case and whole-word options, replace current / replace all
  A `.*` toggle searches by regular expression, and the replacement expands `$1`…`$9` / `$&` from the match's captures (LibreOffice's syntax; Word has no equivalent)
  A `¶` toggle searches and replaces **formatting**, as LibreOffice's Format… and its Paragraph Styles box do: bold / italic / underline, font, size and colour, plus a paragraph style — on the search side and on the replacement side. A format narrows a text search to the runs carrying it, and with the search field empty the formatting is the search — every such run, or every paragraph in that style. A replacement with no text only reformats, so a whole document can be restyled without retyping it, and a heading style switches the block over as the style gallery does
- Right-click context menu for text: cut / copy / paste / paste without formatting, link insert-edit-remove, clear formatting — with the spelling suggestions merged in on top. Shift+right-click keeps the browser's own menu; images, text boxes and header/footer stay with their existing UI
- Spell check in English and German with squiggles and suggestions in the context menu (add / ignore word); selectable document language. Powered by Hunspell (WASM), so German compound words (Fußgänger, Krankenversicherung …) are recognised; dictionaries are lazy-loaded per language on demand
- Word / character count statistics (whole document and selection)
- Reviewing pane for tracked changes (Review ▸ Revisions), beside the comments one: every recorded change in document order — author, date, what was inserted or deleted — click to select the text, accept or reject in place. A change a paragraph boundary splits is one row and is applied whole. Each **author** draws in their own colour (LibreOffice's author palette, handed out in order of first appearance), so several reviewers stay apart on the page. Recording is the **document's** setting, not the editor's: it is read from the file, written back into it, and a new document starts with it off — an opened document is never marked up as the reader's own work
- Navigator pane (F5, or View ▸ Navigator): the document's chapters as an outline, click one to jump to it and the caret's own chapter stays marked. Beside each, LibreOffice's four chapter operations — move up / down and promote / demote a level, each carrying everything under the heading with it. A move swaps with the adjacent chapter at the same level and never crosses a heading above it, so a subheading stays in its own chapter. Below the outline, the tables, pictures and bookmarks LibreOffice's Navigator also lists, as jump targets
- Split view (View ▸ Split, Word's own Ctrl+Alt+S): two panes onto the same document, scrolled independently and both editable — read one page while writing on another, or copy between distant parts. The panes are stacked, as both word processors split a window, so they share a width and the second renders the pagination the first measures rather than laying the document out twice. The divider drags; whichever pane you last worked in keeps the caret, the floating toolbars and the ribbon's commands, and the other one stays where you left it
- Several pages side by side (View ▸ Multiple Pages, up to four): the page grid both reference products show a document in — rows filled left to right, scrolling as one canvas, every page editable. Neither of them stops at two (LibreOffice takes a column count, Word fits as many as the window allows), and both re-zoom for the view, so a whole row is fitted when the count changes. Each cell is a live view of its own, so a very long document is heavier here than in a single column

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
- Saves as a template too (File ▸ Save ▸ Template): the picker offers `.ott` and `.dotx`, and the chosen extension decides which exporter runs. A template is the document with one label changed — the ODF package's media type, Word's content type for the document part — so both word processors open it as an untitled copy
- Recent files in the File menu, as both word processors have: opening or saving a document puts it at the top of the list, and a click reopens the file itself where the browser can hand its handle back (the File System Access API re-asks for permission after a reload). A file that has moved or been declined is reported and dropped from the list rather than left to fail again; a browser without the API keeps the names only
- Pictures are autosaved to IndexedDB, not localStorage: the document JSON keeps a short key per picture, so an image-heavy document no longer runs into the ~5 MB quota that used to stop it saving. Each save sweeps the pictures the document has dropped, a picture used twice is stored once, and where IndexedDB is unavailable everything stays inline as before
- Embedded font loading: fonts embedded in an opened `.odt`/`.docx` (Word `.odttf` de-obfuscated) are registered via the FontFace API so text renders in its real face even when the font isn't installed; persisted per-document in IndexedDB so it survives a reload. Fonts the document only names but neither embeds nor installs are still flagged as substituted
- Citation styles for the bibliography (References ▸ Citation style): LibreOffice's cite-by-short-name, numbered (`[1]`, counting in citation order), APA, MLA and Chicago. The style sets both what a citation shows in the text and how each row of the list reads, and every citation restyles itself as the document is edited. It round-trips where both word processors keep it: as the ODF entry template LibreOffice regenerates its rows from — so the same rows come back out of LibreOffice — and as Word's `b:Sources StyleName`. The shapes are each style's common form, not a full CSL implementation
- List of figures and list of tables (References ▸ Table of contents ▸ the two caption indexes): the same generated index the table of contents is, over the captions of one category instead of the headings — single-level, with live page numbers and leader dots. Round-trips as ODF `text:illustration-index` / `text:table-index` (found by the counter's name, as LibreOffice finds them) and Word's `TOC \c "Figure"` field
- Page numbering restarts per section (Layout ▸ Page number format ▸ This section): the front matter counts i, ii, iii and the body starts at 1 again. Round-trips as ODF `style:page-number` on the paragraph that switches master page and Word's `w:pgNumType w:start` — a section that restarts is exported as a page-starting break, since both word processors ignore a start on a continuous one
- Line numbering (Layout ▸ Line numbers, LibreOffice's Tools ▸ Line Numbering): numbers in the left margin, continuous or restarting each page, every nth line, with or without empty lines. Measured off the rendered lines, so the preview and the saved file agree; round-trips as ODF `text:linenumbering-configuration` and Word's `w:lnNumType`
- Page design (Layout ▸ Page design): a page background colour, a border around the text area at a settable distance from it, and a text watermark with its own colour, angle and transparency — LibreOffice's Format ▸ Page Style ▸ Area/Borders and its Format ▸ Watermark. All three round-trip: ODF keeps them on the page layout and the master page's header, Word on `w:document` / `w:sectPr` / a VML shape in the header part
- Captions (References ▸ Caption, LibreOffice's Insert ▸ Caption): a caption paragraph in the `Caption` style with a running number that counts itself — one counter per category (figure / table), in document order, renumbering as the document is edited. Round-trips as an ODF `<text:sequence>` (with LibreOffice's own `ooow:Illustration+1` formula) and a Word `SEQ Figure \* ARABIC` field
- Synonyms (Ctrl+F7, Review ▸ Synonyms, the context menu) — a thesaurus, labelled for what it does rather than by its name in both products: the word at the caret, the sense groups it appears in, click one to replace it — and a box to look up any other word. The synonyms are LibreOffice's own, its MyThes data re-packed to one group per line (`scripts/make-thesaurus.mjs`, de 3.0 MB / 37k groups, en 6.7 MB / 143k). It loads on first use for the document's language and is scanned, not indexed: ~4 ms per lookup against the ~100 MB an index would cost
- Word (.docx) export and import — round-trips the editor's formatting (text, fonts, lists, tables, images, headers/footers, page geometry) and opens real Word documents
- Document properties (title, subject, author, keywords, comments) in the File menu — LibreOffice's File ▸ Properties / Word's File ▸ Info. Round-trips through ODF `meta.xml` (one `meta:keyword` per keyword) and DOCX `docProps/core.xml`
- File handlers: the installed app registers for `.odt` / `.ott` / `.docx` / `.dotx`, so the OS offers it for a double-clicked document and hands the file over through `launchQueue` — with its handle, so the first Save writes that same file. Word templates (`.dotx`) open like `.ott` does: read for their content, never bound as the file to save over
- Installable and offline (`public/manifest.webmanifest`, `public/sw.js`): nothing here talks to a server at runtime, so once the app's files are cached it is the whole working editor with the network gone — spell checker, fonts and all. The service worker reads the build's own hashed asset names out of the entry document, which precaches the shell with no build step; what the app loads lazily (a dictionary, the speller's WASM) is kept as it is asked for, so it joins from the second visit on. The document itself is network-first, or a cached one would keep naming the assets of the build it was cached with. Verified in a headless Chromium with the network cut: the app reloads, styles and all, and the manifest validates clean
- PDF export — Raster (pixel-exact copy of the editor with a selectable text layer) and Vector (crisp, fonts embedded, via the browser print dialog)
- Print (printer button / Ctrl+P) — opens the browser print dialog with a pixel-exact raster of the document (tables, headers/footers and page breaks intact)

### Not yet implemented

The gap against Word/LibreOffice, most valuable first. Reviewed 2026-08-15.

**Content an imported document loses**
- Charts are **drawn** from the file (`import/chart.ts`: DrawingML `chartN.xml` and ODF `chart:chart`), but as a picture, not a chart object — a re-export carries the drawing and the numbers behind it are no longer editable. The same holds for an **EMF** metafile (`import/emf.ts`): it is drawn, but as the SVG picture it was rebuilt into, and only from the record set a plot consists of — a hatched brush, a clipping region or a rotated bitmap is skipped. **WMF/SVM** metafiles and OLE objects still keep their box and a placeholder label, and export writes that back out: WMF is a different (16-bit) record format, SVM is StarOffice-proprietary, and an OLE object cannot be rendered without its application
- A drawing tool: a freeform, a polygon or a connector **imports, draws and saves** (see below), but there is no way to author one here. A Word connector preset (`bentConnector3`) is also still dropped — Word resolves that geometry and writes no path for it

**Missing while writing**
- Hyphenation's zone and ladder count (`fo:hyphenation-ladder-count`, `w:hyphenationZone`) — CSS exposes neither
- A formula reaching into another table — LibreOffice's `<Table1.A1>` has no counterpart in Word's field language, so it could not survive the DOCX leg. A cell's number format is offered as the closed set both dialogs list, so a foreign document's own currency symbol or date order is re-spelled in the document's language rather than kept
- A list level's own hanging indent: the marker sits at the 0.635 cm both exports write (`LIST_HANGING_CM`), so a wider *left*-set marker overflows where Word moves the text to the next list tab (a **right**-set one — `w:lvlJc`, which is what the built-in Roman numberings use — grows into the margin and is fine). Reading the value back naively also moves the markers of our own ODT exports — LibreOffice draws its own flat hanging at exactly the value odf-kit writes for level 2; see `tests/render-parity/README.md` before building on it
- Linked / chained text frames: text overflowing one frame continues in the next, which is a layout engine's job — CSS Regions would do it and no engine implements them
- Multi-document management: one document is open at a time, so there is no window list and no side-by-side compare
- Grammar check: there is no offline engine small enough to bundle, and the ones that exist are servers
- A vertical writing mode for the **page** (ODF `tb-rl` on the page layout): a text box can run its text top-to-bottom, the body cannot — pagination fills a page downwards. A ruby annotation's own alignment and position are not offered either; both products' defaults are what we write
- Password-protected ODT/DOCX; digital signatures. ODF encrypts each zip entry (AES-256-CBC, PBKDF2, the manifest carrying salt, IV and checksum), which WebCrypto can do; Word's is an OLE compound file we would have to write from scratch, so the two legs are nowhere near the same size

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
  line (measured on a fixture: 91 of 349 full-width justified lines, up to
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
  simply follows that paragraph (measured 4.7 mm on a fixture's figure page).
  It also costs flow height a word processor does not spend: Word's picture
  caption is a text box declared 0.05 pt tall that overflows its own box, so
  LibreOffice reserves nothing for it and the empty paragraph after it holds the
  caption. Here it is a block, ~55 px — enough to push two lines off a fixture's
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
