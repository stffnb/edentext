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
- **`lineHeight.ts`** (`LineHeight`) — `lineHeight` attr on paragraph/heading. `LINE_HEIGHT_RATIO = 1.15`: ODF line spacing multiplies the font's *natural* line height (Liberation Serif ≈1.15× em), CSS multiplies the font size — so the on-screen value is scaled to match what LibreOffice renders. A spacing above single puts **all** of its extra leading below each line (probed: at 150% LibreOffice starts line 1 flush under the block above and adds 6.9pt after every line, the last included); CSS half-leads it, so `editor.css` shifts the block up by that half with `position:relative; top:`, which leaves the flow alone — but **`offsetTop` reports the drawn position, not the flow one**, so `pageBreaks.ts` (`topWithin`) takes the shift back off; without that a block pushed to a page top landed half a leading low.
- **`paragraphSpacing.ts`** (`ParagraphSpacing`) — `spaceBefore`/`spaceAfter` in **pt**, round-tripping 1:1 to `fo:margin-top`/`fo:margin-bottom`. Space after is a margin, space before rides `--space-before` (`storage/spacingModel.ts` decides padding vs margin); pageBreaks.ts drops it where a page break put the block at a page top, as LibreOffice does.
- **`blockFontSize.ts`** — the font of the paragraph mark (Word `w:pPr/w:rPr`, ODF the paragraph's own text properties).
- **`pageBreak.ts`** — the text-flow attrs of a paragraph/heading: `breakBefore: 'page'`, plus `keepNext`/`keepLines` (see `docs/architecture/pagination.md`). Owns `Mod-Enter`.
- **`formattingMarks.ts`** (`FormattingMarks`) — decorations marking spaces (`·`) and tabs (`→`) when `.paper.show-formatting-marks` is set.
- **`bulletList.ts`** / **`orderedList.ts`** — the TipTap lists plus a marker-type attr: `setBulletChar` (innermost list, `null` = default cycle) and the ordered numbering cycle (`utils/orderedListTypes.ts`, multilevel targets the outermost list).
- **`link.ts`** — hyperlink mark; owns `Mod-k`, which fires the event `Toolbar.svelte` listens for to open the link dialog. A `#name` href targets a bookmark: `Editor.svelte`'s `handleClick` scrolls to it instead of opening a tab. The `plain` attr (`data-plain`, `editor.css`) suppresses the editor's own blue: Word paints a link through its **Hyperlink character style**, which arrives as an ordinary mark, so every DOCX link is plain and one carrying no style is drawn like the text around it — while LibreOffice paints every ODF `text:a` styled or not (probed), so those never are. The DOCX exporter paints `#0563C1` only on a non-plain link, which is how a round trip tells its own links from a file's.
- **`bookmark.ts`** / **`crossReference.ts`** — a named range of text (a mark) and the live references to it (`REF`/`PAGEREF`). `ToolbarExpanded.svelte` owns both dialogs, as it does the link one.
- **`searchReplace.ts`** — Find & Replace: decorations highlight all matches, commands navigate/replace. Touches the document only for actual replacements.
- **`spellCheck.ts`** — decorations from `spell/controller.ts`; `spellErrorAt` feeds the context menu.
- **`tableOfContents.ts`** — a generated TOC: block atom listing every heading down to `maxLevel` (ODF `text:outline-level`, Word's `TOC \o` range, default 5 — listing deeper than the file asks inflates the block by pages). `title: ''` is an index that deliberately has none (its heading is a separate paragraph, as Word and LibreOffice write it); only a missing title falls back to "Table of Contents". `levelStyles` is the named paragraph style each level's entries use (ODF's per-level entry template, which is what LibreOffice regenerates from — the cached body paragraphs point at automatic styles derived from it): the rows carry it as `data-style`, so the document stylesheet gives them the file's own indent, space-before and font, and `editor.css`'s 0.5cm-per-level fallback applies only to an index that names none.
- **`trailingNode.ts`** — keeps an empty paragraph after a trailing table, text box or columns section (they are isolating, so the caret would otherwise have nowhere to go).
- **`headerFooter.ts`** (`hfExtensions`) — the header/footer schema: `Document` constrained to one paragraph, the body's marks, `HardBreak`, `TextAlign`, and the `pageField.ts` atoms. No image, no date field, no table.
- **`pageField.ts`** — inline atoms `pageNumber`/`pageCount`/`chapterField`, rendered as `<span data-page-field>`; `HeaderFooterLayer.svelte` patches each span's text to the real per-page value. `chapterField` is the running head (ODF `text:chapter`, Word `STYLEREF`): its `level` is the outline level to show, `text` the file's cached name, and the page's own chapter is the last heading at or above that level to have started (`Editor.svelte` collects the heading→page map on each pagination pass, only when a zone shows one).
- **`shortcuts.ts`** — see `src/lib/editor/CLAUDE.md`.

`extensions.ts` deliberately keeps TipTap's `resizable: false` (its columnResizing plugin stays
unloaded) and supplies the custom table view + drag plugins instead.
