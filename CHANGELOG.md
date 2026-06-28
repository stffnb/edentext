# Changelog

## [0.1.0] — 2026-05-25 · MVP

### Stack
- Vite + Svelte 5 (runes mode) + TypeScript
- TipTap (individual extensions, no starter-kit)
- odf-kit for ODT generation
- No backend — fully client-side

### Implemented

**Architecture**
- WYSIWYG editor built on TipTap 3 (individual extensions, no starter-kit); toolbar active-states stay reactive via a `tick` counter (Svelte 5 same-reference workaround)
- Fixed A4 paper canvas (794 × 1123 px @ 96 dpi) with CSS-simulated pagination and visual page breaks
- LocalStorage auto-save (debounced 1 s); restores document, theme, zoom, margins, orientation, etc. on reload
- Fully client-side / serverless; hand-coded SVG favicon (no external assets)
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
- Tab stops (real tab character) and manual line breaks (Shift+Enter)

**Insert**
- Tables: insert via size picker, Word-style row/column drag-resize, add / delete rows & columns, delete table, cell borders, merge cells and split cells (N×M, Word/LibreOffice-style), cell background shading; a table splits cleanly across page boundaries
- Images: inline or floating with text wrap (left / right / top-bottom), resize handles, rotation, live size badge; insert via toolbar, drag-and-drop, or paste
- Special characters picker
- Hyperlinks: create / edit / remove (toolbar + Ctrl+K), Ctrl/Cmd+click to open, hover hint showing the URL; ODF `text:a` round-trip
- Manual page break (Ctrl+Enter); round-trips to ODF `fo:break-before`

**Page & layout**
- Page margins (cm) and page orientation (portrait / landscape)
- Headers & footers with page-number / page-count fields and configurable edge distances
- Zoom (20–300 %)
- Show formatting marks (spaces, tabs, paragraph marks)

**Editing aids**
- Undo / Redo with a labelled history dropdown
- Search & Replace (Ctrl+F / Ctrl+H): live match highlighting, match count, next / previous, match-case and whole-word options, replace current / replace all
- Spell check in English with squiggles and a suggestions context menu (add / ignore word); selectable document language
- Word / character count statistics (whole document and selection)

**UI & theming**
- Light / Dark / AllBlack / Auto appearance modes (settings menu in toolbar)
- Primary toolbar plus an expandable extended toolbar (horizontal scroll on narrow windows)
- Status bar with page number, word count, language and zoom controls
- About dialog

**File & export**
- ODT export via odf-kit with extensive content.xml / styles.xml post-processing (custom node types, tables with borders, images, fonts and colors); filename derived from the first heading (fallback `document.odt`)
- ODT import / open existing file: parses content.xml / styles.xml directly, adopts the file's margins and orientation, and reports graceful-degradation warnings
- PDF export — Raster (pixel-exact copy of the editor with a selectable text layer) and Vector / Print (crisp, fonts embedded, via the browser print dialog)

### Not yet implemented

Planned word-processor features (to match Word/LibreOffice):
- Table cells: header-row toggle
- Footnotes / endnotes (currently dropped on import)
- Clear formatting (remove all marks)
- Multi-column (newspaper) layout
- Table of contents (generated from headings)
- Comments / annotations (currently dropped on import)
- Horizontal rule
- Page numbering options (start value / format) + different first-page header
- Heading levels H4–H6 (currently clamped to H3)
- Paragraph borders / shading
- Track changes (revisions)
- Text boxes / shapes / drawings (currently dropped on import)
- Equations / formulas
- Cross-references / bookmarks
- Named paragraph / character styles (style gallery)

Other:
- Custom right-click context menu (formatting, cut/copy)
- Multi-document management
- PWA / offline support
- i18n
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

---

<!-- Add new entries above this line in the format: -->
<!-- ## [x.y.z] — YYYY-MM-DD -->
