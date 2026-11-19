# `src/lib/styles/`

This directory models named paragraph, character, list, and outline styles. Table styles
are documented in `docs/architecture/tables.md`.

`styleSheet.ts` holds the framework-free registry and parent-chain resolution;
`sheet.svelte.ts` is the persisted reactive singleton. Paragraph styles have layout and
text properties, character styles have text properties, and direct formatting always wins.
Style definitions retain only their own values so missing properties inherit from parents.

Only top-level paragraphs and headings carry a `styleName`; list items and table cells use
their resolved formatting. A named list style belongs on the outermost list and nested lists
inherit it. A direct list override exports as a resolved automatic list instead of retaining
the named reference.

`HEADING_STYLE_OVERRIDES` is the fallback for unstylable imported headings and must agree
with built-in styles, CSS, importers, exporters, and its unit tests. Keep imported properties
implicit when the resolved file style or editor default already supplies them.

Read `docs/architecture/styles.md` before changing style resolution, inheritance, named-style
I/O, list styles, character styles, the style manager, or chapter numbering.

`FONT_PROFILES` (`styleSheet.ts`) holds what a family's substitute does differently, one row
per family: its CSS names, generic tail, single line height, Word's stroked bold for a face
without one (`fauxBold`) and full-width quotes from `EdenText Quotes` for a Chinese face. Arabic text falls through to the bundled `Noto Naskh Arabic` (a `unicode-range` face in the generic tails `--font-serif`/`--font-heading`/`--font-mono`, `global.css`) wherever the western font has no Arabic of its own.
A family without a line height there takes Chromium's `line-height: normal` where installed
(`singleLineHeight`), which matches Word's win-metric line for faces whose hhea agrees.
A fixed-pitch family (a row's `mono`, or a name LibreOffice reads as one: `MONO_NAME`) falls
back to `--font-mono`, the bundled Liberation Mono, as LibreOffice substitutes a mono face.
A name with a weight, width, slant or vendor suffix (`Arial Bold`, `Arial-BoldMT`) falls back to its
base family's stack and class (`baseProfile`), as LibreOffice strips the suffix and never applies its
weight (probed). Limitation: Chromium on macOS resolves PostScript names itself, so `Arial-BoldMT`
renders bold there while LibreOffice sets it regular; CSS cannot refuse a name the platform knows.
