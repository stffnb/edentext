# Changelog

## [0.1.0] — 2026-05-25 · MVP

### Stack
- Vite + Svelte 5 (runes mode) + TypeScript
- TipTap (individual extensions, no starter-kit)
- odf-kit for ODT generation
- No backend — fully client-side

### Implemented
- WYSIWYG editor with TipTap
  - Bold, Italic, Underline
  - Headings H1–H3
  - Undo / Redo (History extension)
  - Placeholder text on empty document
- Toolbar with active-state highlighting per button
  - Reactivity via `tick` counter (Svelte 5 same-reference workaround)
- Fixed A4 paper canvas (794 × 1123 px at 96 dpi)
- LocalStorage auto-save (debounced 1 s, restores on reload)
- ODT export via `tiptapToOdt()` from odf-kit
  - Filename derived from first H1/H2/H3 heading, fallback `document.odt`
- Favicon (hand-coded SVG, no external assets)
- Lists (ordered / unordered)
- Light / Dark / Allblack / Auto appearance mode (settings menu in toolbar)
- expandable extended toolbar
- DIN A4 print layout with visual page breaks
- add bottom toolbar to show page number
- Zoom feature
- font selection
- font size selection
- line spacing + paragraph spacing
- text alignment
- show formatting marks
- margins
- page orientation
- tables
- undo history
- ODT import / open existing file
- ...

### Not yet implemented
- Images
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
