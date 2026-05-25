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
- Light / Dark / Auto appearance mode (settings menu in toolbar)

### Not yet implemented
- ODT import / open existing file
- font size
- Images, tables
- DIN A4 print layout / page breaks
- Multi-document management
- PWA / offline support
- i18n
- ...

---

<!-- Add new entries above this line in the format: -->
<!-- ## [x.y.z] — YYYY-MM-DD -->
