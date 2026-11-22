# Styles

This directory models paragraph, character, list, and outline styles. Table styles are owned
by `docs/architecture/tables.md`; direct formatting behavior is also described in
`docs/architecture/formatting.md`.

## Model and inheritance

`styleSheet.ts` is the framework-free registry and resolver; `sheet.svelte.ts` is its persisted
reactive wrapper. Paragraph styles contain layout and text properties, character styles contain
text properties, and each definition stores only values it owns. Parent chains resolve
root-first, nearest value wins, and cycles must be safe.

Direct formatting wins over a named style. A missing style property inherits; do not replace an
inherited value with an editor-only default. `HEADING_STYLE_OVERRIDES` is the fallback for
unstyled headings and must agree with built-in styles, CSS, import/export behavior, and tests.

## Assignment and rendering

Only top-level paragraphs and headings carry `styleName`. List items and table-cell paragraphs
use resolved formatting because their style plumbing cannot be applied as a document-level
named style. `setParagraphStyle` changes block type for an outline style while retaining direct
formatting. Splitting a heading starts a body paragraph; clearing direct formatting keeps the
named style and hyperlinks.

`styleCss` projects resolved styles into document-scoped CSS. Heading fallbacks apply only to
headings without a style name. A paragraph style's rules (`borderTop`…, `'<W>pt <line> #RRGGBB'`)
draw only where set and not `'none'`, which overrules a parent's; `borderPadding` pads the ruled
sides only. The style manager's paragraph tab edits all four and the padding.
A ruled or shaded paragraph's box starts where a hanging first line does, as LibreOffice draws
it: every indent source sets `--ind`/`--indent-first`, and the box moves left by `--box-hang`
and takes it back as padding (`editor.css`), so the text stays put. List markers need the list item's resolved text properties, not
only the nested paragraph's. Inline marks and node attributes retain their normal precedence.

## List styles

A named list style belongs on the outermost list. Nested lists inherit it. Each level resolves
as node override, then named style level, then the depth-cycle default. The resolved level kind
controls whether that depth displays numbers or bullets, regardless of the stored list-node
species; applying a list style normalizes the subtree to those kinds.
A level carries its label geometry too (`hanging`, `markerSuffix`: ODF `fo:text-indent` and
`text:label-followed-by`, Word `w:hanging` and `w:suff`); a right-set label ends at the text
start less the hang, as LibreOffice measures it.

Export a named list reference only when no effective level is overridden. ODF list styles have
no parent chain, so an override exports as a fully resolved automatic list style. Importers must
reconstruct named styles and assign the name to the outer list rather than flattening it into
per-level attributes.

## Named-style I/O

Named file styles are registry entries; automatic styles and node/run properties are direct
formatting. On import, resolve the file style chain first and retain only values that differ
from it. Also suppress values supplied by compatible editor defaults, otherwise each round trip
accumulates direct formatting.

ODF exports named styles to `styles.xml`; blocks use named references or automatic clones whose
parent is the named style when direct formatting remains. DOCX exports registry styles with
stable Word identifiers and parent/follow relationships; paragraphs use those identifiers.
Import maps standard Word names to registry names while retaining the file's resolved values.

Character styles follow the same contract for runs: a named text-style reference survives I/O,
and remaining run properties are measured against the resolved character style. Keep ODF and
DOCX mappings aligned; see `docs/architecture/import.md` and `export.md` for format mechanics.

Kerning is inherited and both enabled and disabled states must survive I/O. The two formats
encode it differently, so never infer a missing explicit state from browser rendering alone.

## Style management

The manager edits only own properties; an empty input restores inheritance. Creating or updating
from a selection computes the difference from the parent, assigns the style, and removes the
direct formatting now supplied by it. Rename, delete, and parent changes must retag affected
blocks and preserve valid parent chains. Built-ins reset rather than delete.

Paragraph, character, list, and table styles have separate editing capabilities. Keep table
style controls in the table architecture and chrome entry-point behavior in the ribbon/component
documentation.

## Outline numbering

`StyleSheet.outline` stores one document-wide definition: format, prefix, suffix,
`displayLevels`, start value, label formatting, indentation, and tab stop per level. Heading
levels increment their own counter and reset deeper levels. Headings in cells, lists, and frames
are outside that document outline. A tab stop at the level's indent follows a heading's own
hanging indent (`--indent-first`), so a wrapped title lines up under itself (probed in LibreOffice).

The visible label and table-of-contents label use the same counting rules. ODF writes the
definition as an outline style; DOCX writes matching numbering referenced by heading styles.
Keep the heading level explicit so import does not mistake a numbered heading for a list item.

The style manager's Chapters tab edits it level by level (`setOutline`); its presets are
`decimalOutline` (1 / 1.1 / 1.1.1), `romanOutline` (I. / A. / 1. / a) / (1)) and
`chapterOutline` (level 1 only, "Chapter 1" or 第1章 from the UI language). Its one indent field sets
indent, hanging first line and tab together, the only label position DOCX can state.
The numbering button on a heading switches it as well, as a word processor's multilevel
list bound to the heading styles does (`orderedList.ts`).

**A run in a taller face does raise the line.** A run whose own font or character style
sets a `--natural-line` takes the paragraph's line-height expression with that value
(`editor.css`), so the tallest run sizes the line as in both word processors, and a
fixed spacing stays fixed. The reverse stays: the paragraph's font is the CSS strut, so
a paragraph whose runs are all in a shorter face than its own keeps its own line height.
One run mixing scripts takes the western face's line even where the asian one is taller.
LibreOffice sets a line at max(ascent) + max(descent + line gap) over its fonts, the
spacing's extra on top; CSS splits each face's gap above and below, so a Courier run in a
Times paragraph raised the line by its whole descent excess plus half the gap. The bundled
Liberation Serif and Sans (and the Times New Roman and Arial faces they stand in for) fold
the gap into their descent (`*-override` in `global.css`). Probed at 12pt, 100/115/200%:
the Courier line is 0.5pt taller in LibreOffice; the editor's grew 1.68px, now 0.67px.
A face loaded from the system without an `@font-face` of ours keeps the split.
