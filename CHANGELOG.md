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
- Headings H1–H3, including un-bolding a heading

**Paragraphs & lists**
- Text alignment: left, center, right, justify
- Line spacing and paragraph spacing (space before / after)
- Increase / decrease indent (paragraphs and lists)
- Bulleted and ordered lists — nested, with multiple numbering styles (decimal, alpha, roman; `.` or `)` suffix) and whole-list indent; Tab / Shift-Tab to nest / un-nest
- Word-style nesting defaults for ordered lists: an indented level numbers 1. → a. → i. (repeating) instead of restarting at "1." everywhere; explicit styles per level still override. Plus legal/outline numbering (1., 1.1., 1.2.1. …) as a list type — rendered via CSS counters, round-trips to ODF `text:display-levels` and DOCX `%1.%2.` lvlText chains
- Nested ordered levels advance the cycle relative to the level above and inherit its suffix (a level-1 `a)` gives `i)` then `1)`); the numbering style chosen for a level is reused when you nest into it again
- Customizable bullet symbols per list level (Word-style picker on the bullet-list split button: • ◦ ▪ ❖ ➢ ⇨ ✓ – >); round-trips to ODF `text:bullet-char` and DOCX `w:lvlText`, and the DOCX/ODT import maps Wingdings/Symbol bullets (arrows, diamonds, checkmarks …) to their Unicode equivalents instead of flattening them to plain dots. Symbols Liberation Serif lacks render from a bundled 2 KB DejaVu Sans subset (`EdenSymbols.woff2`), so markers look compact and identical on every platform instead of a stretched OS fallback
- Tab stops (real tab character) and manual line breaks (Shift+Enter)

**Insert**
- Tables: insert via size picker, Word-style row/column drag-resize, add / delete rows & columns, delete table, cell borders, merge cells and split cells (N×M, Word/LibreOffice-style), cell background shading, header-row toggle (bold + shading); a table splits cleanly across page boundaries
- Table border control (Word/LibreOffice-style): per-side cell borders with presets (all / outside / inside / single edges / none), line width and color; buttons show active states matching the current pen and toggle borders off; round-trips to ODF `fo:border-*` and DOCX `w:tcBorders`
- Images: inline or floating with text wrap (left / right / top-bottom), resize handles, rotation, live size badge; insert via toolbar, drag-and-drop, or paste
- Special characters picker
- Table of contents: generated from headings (H1–H3) with live page numbers and dot leaders, click an entry to jump to its heading; round-trips to ODF `text:table-of-content` and a Word TOC field
- Hyperlinks: create / edit / remove (toolbar + Ctrl+K), Ctrl/Cmd+click to open, hover hint showing the URL; ODF `text:a` round-trip
- Manual page break (Ctrl+Enter); round-trips to ODF `fo:break-before`
- Text boxes and basic shapes (rectangle / rounded rectangle / ellipse): editable block content, fill and border colors, border width, resize/rotate handles, text wrap (inline / left / right / top-bottom) like images; floating toolbar for wrap, shape kind and colors. Round-trips to ODF `draw:frame`/`draw:text-box` + `draw:custom-shape` and DOCX DrawingML `wps:wsp`/`wps:txbx` (imports Word's `mc:AlternateContent` and legacy VML text boxes too)

**Page & layout**
- Page margins (cm) and page orientation (portrait / landscape)
- Multi-column (newspaper) layout: 1–3 columns with adjustable gap, applied to the whole document (no selection) or to selected paragraphs, Word-style — text fills column 1 to the page bottom, then column 2, and flows across pages with mid-paragraph line breaks; a section followed by other content balances its columns. Round-trips to ODF `text:section`/`style:columns` and DOCX continuous sections with `w:cols`
- Headers & footers with page-number / page-count fields and configurable edge distances
- Zoom (20–300 %)
- Show formatting marks (spaces, tabs, paragraph marks)

**Editing aids**
- Undo / Redo with a labelled history dropdown
- Search & Replace (Ctrl+F / Ctrl+H): live match highlighting, match count, next / previous, match-case and whole-word options, replace current / replace all
- Spell check in English and German with squiggles and a suggestions context menu (add / ignore word); selectable document language. Powered by Hunspell (WASM), so German compound words (Fußgänger, Krankenversicherung …) are recognised; dictionaries are lazy-loaded per language on demand
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
- Word (.docx) export and import — round-trips the editor's formatting (text, fonts, lists, tables, images, headers/footers, page geometry) and opens real Word documents
- PDF export — Raster (pixel-exact copy of the editor with a selectable text layer) and Vector (crisp, fonts embedded, via the browser print dialog)
- Print (printer button / Ctrl+P) — opens the browser print dialog with a pixel-exact raster of the document (tables, headers/footers and page breaks intact)

### Not yet implemented

Planned word-processor features (to match Word/LibreOffice):
- Footnotes / endnotes (currently dropped on import)
- Clear formatting (remove all marks)
- Comments / annotations (currently dropped on import)
- Horizontal rule
- Page numbering options (start value / format) + different first-page header
- Heading levels H4–H6 (currently clamped to H3)
- Paragraph borders / shading
- Track changes (revisions)
- Lines / arrows / connectors / freeform and other shape presets (currently dropped on import with a warning; text boxes + rect/round-rect/ellipse are supported)
- Equations / formulas
- Cross-references / bookmarks
- Named paragraph / character styles (style gallery)

Other:
- Custom right-click context menu (formatting, cut/copy)
- Multi-document management
- PWA / offline support
- ...

### Known issues / deferred
- Zoom 100% does not visually match Word/LibreOffice at 100% on the same
  screen. Root cause: the editor uses the browser's fixed 96 CSS DPI
  (794×1123 px for A4 — see `editor.css`, `pageBreaks.ts`), while Word and
  LibreOffice render against the OS-reported physical screen DPI so that
  1 cm on paper ≈ 1 cm on screen. Possible future fix: add a user-side
  calibration (DPI value or visual ruler) that scales the `zoom` factor.
  Decided 2026-05-26 not worth the effort for now.
- Lists and headings inside a table cell are exported as plain text, not as
  real ODF structures. odf-kit's `CellBuilder` is run-based (text runs only),
  so a cell cannot hold a true `<text:list>` or `<text:h>`. On export
  (`export/odt.ts`): headings render as bold runs at the heading font size,
  and list items render as separate lines with literal markers (`•`, `1.`,
  `2.`…), nested lists indented. Content is preserved and readable, but loses
  list/heading semantics (no auto-numbering, not recognised as a heading).
  Noted 2026-06-06.
- Text boxes in the DOCX export: lists inside a box are flattened to
  literal-marker paragraphs (`•` / `1.`), and images inside a box are dropped —
  the box XML is injected by a post-pack string pass (`export/docx.ts`
  `applyTextBoxesDocx`) that cannot mint numbering.xml or media/rels entries.
  ODT export has neither limitation. Noted 2026-07-03.
- A plain text box's height is a *minimum* (content grows the box, like the
  editor). LibreOffice recomputes auto-grow heights on open, so a re-saved box
  keeps its content but sheds excess empty height. Shapes (rect/ellipse) export
  with fixed geometry instead. Noted 2026-07-03.

---

<!-- Add new entries above this line in the format: -->
<!-- ## [x.y.z] — YYYY-MM-DD -->
