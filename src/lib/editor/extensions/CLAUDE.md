# `src/lib/editor/extensions/`

One file per feature (`image.ts`, `indent.ts`, …), never `XyzExtension.ts`. All are assembled in
`../extensions.ts`, which also lists the TipTap built-ins in use (Bold, Italic, Highlight
`multicolor`, TextStyle/FontFamily/FontSize, Heading, HardBreak, lists, Table family, History,
Placeholder, TextAlign). `Document` is widened to `'(block | textBox | columns)+'`.

Five topics are large enough to have their own deep-dive — read the file before changing them:

| Extension | Deep-dive |
|---|---|
| `pageBreaks.ts`, `columns.ts`, `columnsFlow.ts` | `docs/architecture/pagination.md` |
| `image.ts`, `textBox.ts` | `docs/architecture/frames.md` |
| `table*.ts`, `tableStyle.ts` | `docs/architecture/tables.md` |
| `textEffects.ts`, `indent.ts`, `tabStops.ts`, `listMarker.ts`, `paragraphBox.ts`, `dateTimeField.ts`, `bookmark.ts`, `crossReference.ts` | `docs/architecture/formatting.md` |
| `formula.ts` | `docs/architecture/formulas.md` |
| `paragraphStyle.ts`, `characterStyle.ts` | `src/lib/styles/CLAUDE.md` |

## The rest, one line each

- **`fontColor.ts`** (`FontColor`) — `color` attr on the TextStyle mark; also emits `data-color` so theme CSS (allBlack) can target color-bearing spans.
- **`fontWeight.ts`** (`FontWeight`) — `fontWeight` attr on TextStyle (set `normal` to un-bold a heading without changing the node type).
- **`lineHeight.ts`** (`LineHeight`) — `lineHeight` attr on paragraph/heading. `LINE_HEIGHT_RATIO = 1.15`: ODF line spacing multiplies the font's *natural* line height (Liberation Serif ≈1.15× em), CSS multiplies the font size — so the on-screen value is scaled to match what LibreOffice renders. A spacing above single puts **all** of its extra leading below each line (probed: at 150% LibreOffice starts line 1 flush under the block above and adds 6.9pt after every line, the last included); CSS half-leads it, so `editor.css` shifts the block up by that half with `position:relative; top:` — flow, and so pagination, unchanged.
- **`paragraphSpacing.ts`** (`ParagraphSpacing`) — `spaceBefore`/`spaceAfter` in **pt**, round-tripping 1:1 to `fo:margin-top`/`fo:margin-bottom`.
- **`blockFontSize.ts`** — the font of the paragraph mark (Word `w:pPr/w:rPr`, ODF the paragraph's own text properties).
- **`pageBreak.ts`** — the text-flow attrs of a paragraph/heading: `breakBefore: 'page'`, plus `keepNext`/`keepLines` (see `docs/architecture/pagination.md`). Owns `Mod-Enter`.
- **`formattingMarks.ts`** (`FormattingMarks`) — decorations marking spaces (`·`) and tabs (`→`) when `.paper.show-formatting-marks` is set.
- **`bulletList.ts`** / **`orderedList.ts`** — the TipTap lists plus a marker-type attr: `setBulletChar` (innermost list, `null` = default cycle) and the ordered numbering cycle (`utils/orderedListTypes.ts`, multilevel targets the outermost list).
- **`link.ts`** — hyperlink mark; owns `Mod-k`, which fires the event `Toolbar.svelte` listens for to open the link dialog. A `#name` href targets a bookmark: `Editor.svelte`'s `handleClick` scrolls to it instead of opening a tab.
- **`bookmark.ts`** / **`crossReference.ts`** — a named range of text (a mark) and the live references to it (`REF`/`PAGEREF`). `ToolbarExpanded.svelte` owns both dialogs, as it does the link one.
- **`searchReplace.ts`** — Find & Replace: decorations highlight all matches, commands navigate/replace. Touches the document only for actual replacements.
- **`spellCheck.ts`** — decorations from `spell/controller.ts`; `spellErrorAt` feeds the context menu.
- **`tableOfContents.ts`** — a generated TOC: block atom listing every heading (levels 1–5).
- **`trailingNode.ts`** — keeps an empty paragraph after a trailing table, text box or columns section (they are isolating, so the caret would otherwise have nowhere to go).
- **`headerFooter.ts`** (`hfExtensions`) — the header/footer schema: `Document` constrained to one paragraph, the body's marks, `HardBreak`, `TextAlign`, and the two `pageField.ts` atoms. No image, no date field, no table.
- **`pageField.ts`** — inline atoms `pageNumber`/`pageCount`, rendered as `<span data-page-field>`; `HeaderFooterLayer.svelte` patches each span's text to the real per-page value.
- **`shortcuts.ts`** — see `src/lib/editor/CLAUDE.md`.

`extensions.ts` deliberately keeps TipTap's `resizable: false` (its columnResizing plugin stays
unloaded) and supplies the custom table view + drag plugins instead.
