# `src/lib/import/`

`odt.ts` + `styleResolver.ts` (ODF), `docx.ts` + `docxStyles.ts` (Word),
`imageFormats.ts` (shared). The DOCX importer mirrors the ODF one section for section.
A password-protected file is decrypted before either importer sees it — see
`docs/architecture/encryption.md`.

## ODF import (`odt.ts`, `styleResolver.ts`)

The **Open .odt** button (`App.svelte`) parses an uploaded file with `importOdt(bytes)` and replaces the document via `setContent` (after a confirm when the current doc is non-empty), also adopting the file's page margins/orientation. It parses `content.xml`/`styles.xml` directly (fflate + `DOMParser`) rather than odf-kit's reader, which flattens cell blocks and drops row heights / list number formats. Which importer runs is chosen by extension, but a **failed read is retried as the other format** — a renamed or mis-saved file is what both word processors go by content for; a file that is neither reports the error for the extension it carries.

- **`StyleResolver`** flattens ODF style indirection: named + automatic styles from both XML files, `style:parent-style-name` chains rooted in `style:default-style`, font-face declarations (`style:font-name` → family), `rel-column-width`/`column-width`, `min-row-height`, list styles, and page geometry. `fo:font-family` and `style:font-name` shadow each other across chain levels (`layerTextProps`). A **percentage `fo:font-size`** (`"130%"` — how LibreOffice defines its heading styles) is resolved against the inherited size while walking the chain (`resolvePercentSize`); without it the file's size is dropped and our default silently replaces it.
- **LibreOffice's paragraph properties are not all inherited one by one.** Its two vertical
  margins live in one item, so a style declaring only `fo:margin-top` (or only `-bottom`) takes
  the **default style's** value for the other, never the parent chain's (`layerParaProps`;
  probed — it is what makes a heading whose style sets only `fo:margin-bottom` sit flush).
  The export therefore spells out the inherited margin beside a style's lone one (`ownStyleAttrs`).
  `fo:line-height` is stored as the ODF percentage itself (115% → `1.15`, as both DOCX paths and
  the export use it) and suppressed against the block's own style, so a 100% under a 115% style
  stays as direct formatting.
- **A complex-script run takes the `-complex` font and size** (`complexScriptProps`). ODF carries western, asian and complex properties side by side and a word processor picks per character, so a Hebrew paragraph whose style declares only `style:font-size-complex="16pt"` is set at 16pt — read as the western 12pt its line pitch comes out 1.6mm short of LibreOffice's. Decided per **run**, the finest split the model has, so a document with no complex script is untouched; our own export writes all three alike, so the value round-trips.
- **Hidden text is not laid out.** `text:display="none"` drops the paragraph a paragraph style hides (with a warning) and the stored value of a field element that carries the attribute. A hidden **heading** is the exception and renders: it is the document's outline, which the running head's `text:chapter` reads (an ODF chapter marker exists for nothing else), and the editor has no way to hold a block it does not draw.
- **A run is measured against the block's own size**, not the yardstick's: a list item whose style sets 11pt would otherwise drop every 12pt run as "the style supplies it" and render it at 11 (`convertParaLike`, `runDefaults`).
- **The yardstick is the style the block can name.** Only a **body** block carries a `styleName`, so a paragraph in a cell or a text box is measured against the *default* paragraph style instead of its own — otherwise everything its style provides is suppressed as "the style will supply it" and nothing ever does (a Word caption in a text box arrived without its italic or its colour). It must be the default style and not the editor's fallback: `p:not([data-style])` re-applies exactly that, so a cell paragraph's `fo:line-height="100%"` under a 115% `Standard` is real direct formatting. **Spacing is the exception** — `:is(td, th) > p:not([data-style])` outranks the style's rule and zeroes it, so a cell paragraph's margins stay direct; a list item's `li p` rule loses on specificity and a heading is not a `p` at all, so neither zeroes. **A heading is the other exception**: it keeps its level in a cell and the editor re-applies the level's own size and font there, so its mark is measured against those, not the default style's — else every cell heading came back carrying its size as direct formatting.
- **`style:contextual-spacing`** drops a paragraph's own spacing towards a neighbour of the same style (LibreOffice's `List` styles carry it; Word's `w:contextualSpacing` is the same rule). The editor has no such mode, so the suppressed side becomes an explicit 0 — and in a list, where each item wraps its own paragraph, the neighbour is the adjacent *item's*.
- **Default suppression** keeps round trips (editor → LibreOffice → editor) from accreting explicit attrs: values matching the editor's defaults (12pt body, `HEADING_STYLE_OVERRIDES` sizes/margins, **0 paragraph spacing**, list margin 0, Times New Roman/Liberation Serif, `#000000` text) are imported as `null`/no mark, with small tolerances for producer unit rounding (pt↔cm↔twips). This is why the editor's defaults must equal Word's/LibreOffice's (below) — an editor-only default is indistinguishable from a failed style resolution and silently lands in every imported document.
- **A heading is bold by default only where the bold built-in still renders it.** `blockDefaults` suppresses a run mark the block's style supplies, and the editor's `Heading` parent supplies bold — but a file that declares its own heading style re-parents it to `Standard` (`collectStyleSheet`), so nothing supplies bold there and an explicit `w:b` / `fo:font-weight` has to stay a mark or the heading renders regular. Gated on the style's own `w:basedOn` / `style:parent-style-name` (`styleBasedOn`, `styleParent`), which is exactly what decides whether the built-in's parent survives.
- **A run's underline is suppressed only where it draws the *same* line.** `lineSig` compares the run's shape and colour against the style's, so a red or wavy underline under a plainly underlining style survives — only a bare one repeating its style is dropped, which is what neither format can tell from a failed resolution. Both importers, `marksFor`; a strike compares its `double` the same way.
- **Mapping:** `text:h` → heading (level clamped to `MAX_HEADING_LEVEL`), per-depth `text:list-level-style-*` defs decide bullet vs ordered and `listStyleType` (reverse lookup `orderedTypeFromFormat`) — unless the list style is a **named** one (`StyleResolver.isNamedListStyle`): then the outermost list gets `listStyleName` (display name decoded), no per-level attrs are derived, and `collectStyleSheet`/`listStyleFromOdf` put the definition into `sheet.list`, tables handle covered cells / `number-columns-repeated` / header rows / colspans / cell shading (`StyleResolver.cellBackgroundColor` → `backgroundColor`) / cell borders (`StyleResolver.cellBorders` + `borderAttrFromOdf` → the per-side border attrs) / table margins (`tableMargins` reads the table style's `fo:margin-*`, `style:width`/`style:rel-width` and `table:align` against `Ctx.contentWidthCm` — so a table narrower than the text width stays narrow instead of being stretched; DOCX does the same from `w:tblInd` + the `w:tblGrid`/`w:tblW` width), `text:s`/`text:tab`/`text:line-break` become spaces/`\t`/`hardBreak`, `draw:frame`/`draw:image` → an `image` node (`convertFrame`: bytes read from the zip's `Pictures/` entry into a data-URI, `svg:width`/`-height` cm → px, `svg:title` → `alt`, `draw:transform` rotate → `rotation`; a non-`as-char` anchor or a graphic style's `style:wrap` → floating `wrap` mode via `StyleResolver.graphicProps` — an **explicit `as-char` anchor is always inline**: LibreOffice's named Graphics style carries a `style:wrap` that would otherwise float every inherited frame), text fields keep their stored value. **Text boxes / shapes** (`convertDrawElement`): `draw:frame`+`draw:text-box` → a `textBox` node (`convertTextBoxFrame`: height = `fo:min-height` else `svg:height`; fill/stroke read straight from `graphicProps`' `draw:fill(-color)`/`draw:stroke`/`svg:stroke-*`, values equal to the editor defaults suppressed, none → explicit `null`); `draw:rect`/`draw:ellipse`/`draw:custom-shape` with a rect/round-rectangle/ellipse preset → a `textBox` with the matching `shapeKind` (`convertShape`), and `draw:polygon`/`polyline`/`path`/`connector` — or a preset no gallery covers but whose `draw:enhanced-path` is a plain outline — → a box carrying that outline as `shapePath` (`convertFreeform`, `docs/architecture/frames.md`; a geometry built from modifier formulas still reads as "Unsupported shapes were removed"). A box is an inline node, so it stays exactly where the frame sits — in the paragraph's own content, beside the runs around it, cells and list items included; only a box **inside another box** is unwrapped in place, with a warning. The DOCX importer mirrors all of this — its drawing root is the `w:drawing`'s **direct** `wp:inline`/`wp:anchor` child, since a box holding a picture nests a second drawing and a subtree search reads *its* root instead, dropping the box and the caption in it (`convertWpsShape` for DrawingML `wps:wsp` — probed before the image `a:blip` path, `convertPict` for legacy VML; Word's `mc:AlternateContent` uses only the `mc:Choice` branch so the VML fallback can't double-import). A **group** (`wpg:wgp`, read before either) has no node of its own: `convertGroup` maps each child out of the group's child coordinate space (`a:chOff`/`a:chExt`) and gives the first the group's own placement — which is what reserves an inline group's box in the line — while the rest run through the text over it, offset by their place in the group. The frames over an inline group take their static position from the paragraph, so a group that shares its line carries them there; a group inside a group is dropped.
- **Image formats (`import/imageFormats.ts`, shared by both importers):** `<img>` only renders a fixed set of formats, so `imageDataUrl(bytes, path)` resolves the mime by extension **then** magic-number (mislabelled/extensionless entries still work) and returns `null` for anything unrenderable — the importer then skips it with a specific "format the browser can't display" warning instead of a broken `<img>`. A frame's multiple `<draw:image>` alternatives (ODF) and a Word `a:blip`'s `svgBlip` alternative are probed for the first *displayable* one, and `<draw:a>`-wrapped frames are unwrapped (the hyperlink dropped). **Non-web formats we can decode client-side** (currently **TIFF**) are converted to PNG up front by `convertUnsupportedImages(bytes)` — an async pass `applyImport` runs before the synchronous import, passing a `path → PNG data-URI` map (`ConvertedImages`) into `importOdt`/`importDocx` (default empty, so tests stay sync). The decoder (`utif2`) is a **dynamic `import()`** → its own lazy chunk, loaded only when a convertible image is actually present, so ordinary docs pay nothing. **EMF** goes through the same lazy pre-pass into an SVG picture (`import/emf.ts`, below). **SVM/WMF** still have no decoder (SVM is StarOffice-proprietary, WMF a different 16-bit record format) → skipped with the format warning; LibreOffice/WASM conversion was ruled out (no backend; WASM LO is ~300MB). Both passes read the **same inflated archive** — `unzipArchive(bytes)` keeps it per byte array, so a picture-heavy file is inflated once however many passes read it (a quarter second on a 14 MB file) — and a picture is encoded with the browser's `Uint8Array.toBase64` where there is one, the chunked `String.fromCharCode` loop standing in where there is not (300 ms against 15 ms for 600 pictures). A **CMYK** JPEG loses its ICC profile (`stripCmykIccProfile`): Chromium colour-manages through it, LibreOffice and Word convert naively, and the file's own colours are the ones every word processor shows (measured on the contract fixture's logo: blue (0,80,131) → (0,77,183) against LibreOffice's (0,32,183), black (57,53,54) → (11,11,18) against (0,0,0)).
- **Embedded fonts** (`extractDocxFonts`, `StyleResolver.scanFontFaces` → `fonts/embeddedFonts.ts`): a file may carry the faces its text is set in, and without them a document in an uninstalled font reflows. DOCX keeps them as `word/fonts/*.odttf` referenced from `fontTable.xml` (`w:embedRegular`/`-Bold`/`-Italic`/`-BoldItalic`), each obfuscated with its own `w:fontKey` — the first 32 bytes XORed with the GUID's 16 bytes reversed, which is its own inverse; ODF stores plain TTFs under the `<svg:font-face-uri>` of a `<style:font-face>`. Both land in the import result's `fonts`, which `App.svelte` registers via `FontFace` **before** the content is loaded (so the text renders in the right face and `unavailableFonts` doesn't flag it) and persists per document in IndexedDB.
- **EMF (`import/emf.ts`)**: `emfToSvg(bytes)` replays the record stream into SVG — window/viewport plus world transform mapped per point, a DC stack (`SAVEDC`/`RESTOREDC`), pens/brushes/fonts (incl. the stock objects), the 16- and 32-bit poly records, path brackets, `RECTANGLE`/`ELLIPSE`, `EXTTEXTOUT` (its per-character advances become `textLength`, so labels keep their width) and `STRETCHDIBITS` (the DIB re-wrapped as a .bmp data-URI). **Text is stored as raw code units**, so a symbol font leaves lone surrogates behind — they must be stripped or `encodeURIComponent` throws and the whole picture is lost. Unknown records are skipped; a file that yields nothing returns null and keeps the placeholder.
- **Charts (`import/chart.ts`, DOCX)**: `word/charts/chartN.xml` is parsed and **drawn as an SVG picture** of the frame's own size — series values from the `numCache` the producer left, colours from the named theme accent (`themeAccents`), title/axis titles/gridlines, and the value axis' own `c:scaling` bounds where the file fixes them. Bar (incl. stacked and `barDir="bar"`), line, area, scatter and pie; anything else keeps the placeholder. Read-only — the editor has no chart object, so a re-export carries the picture, not the chart. **ODF** charts go through the same drawing (`odfChartDataUrl`, `convertChartFrame`): `<chart:chart>` in the `draw:object`'s sub-document, series values read out of its own `local-table` by cell range, colours from the series' `draw:fill-color`, bounds from the y-axis style's `chart:maximum`/`-minimum`.
- **Word's horizontal line** (`hrBorderAttr`, DOCX): a `w:pict` > `v:rect` flagged `o:hr` is not a shape but the paragraph's own **bottom rule** — the editor has no rule node. Height and `fillcolor` become the rule (`1.5pt`/`#A0A0A0` where the file names none), its width and `o:hralign` are dropped (a paragraph rule spans the text width) and a real `w:pBdr` bottom keeps precedence: only one line can be drawn.
- **Content controls** (`inlineChildren`, DOCX): a `w:sdt` inside a paragraph — Word wraps every citation and bibliography entry in one — is walked through to its `w:sdtContent`, or the runs inside it never reach the paragraph (a fixture measured against LibreOffice lost every `[7]`-style reference and broke its lines one page short). The exception is one tagged `edentext-placeholder`: it survives whole as a `placeholderField` node, its export-minted gray stripped so the presentation color never becomes a mark. ODF's `text:placeholder` becomes the same node, the shown text's `<>`/`‹›` brackets stripped.
- **Formulas** (`convertFormulaFrame`): a `<draw:frame>` whose `<draw:object>` resolves to a sub-document with a `math:math` root (or holds one inline) → a `formula` node. Our own `<annotation encoding="application/x-tex">` is preferred; LibreOffice strips it, so the MathML is parsed back to LaTeX instead. **`display` comes from the paragraph** (`aloneInParagraph`), not the object — LibreOffice writes `display="block"` on every formula it re-saves. DOCX: `m:oMath`/`m:oMathPara` sit beside the `w:r` runs in their own namespace, so `convertInline` probes them ahead of its `namespaceURI !== W` guard (that guard silently dropped every Word formula). See `docs/architecture/formulas.md`.
- **Bookmarks & cross-references**: `text:bookmark-start`/`-end` (ODF) and `w:bookmarkStart`/`End` (DOCX) become a `bookmark` **mark** on the text they cover; the open ranges live in `Ctx` because Word writes them beside paragraphs as well as beside runs, and a range may close in a later paragraph. A **point** bookmark has no range to mark and is dropped, `_GoBack` with it. `text:bookmark-ref` and `REF`/`PAGEREF` fields (the `fldChar` machine and `w:fldSimple` alike, including a field Word left unresolved) become `crossRef` nodes carrying the producer's cached text. A `w:hyperlink w:anchor` with no `r:id` is an internal link → `#name`. See `docs/architecture/formatting.md`.
- **The document's page setup is the first section's** — zones, margins, paper and edge distances of the master its leading block uses (`masterPagesOf`: `Standard` where it names none, and a table or list at the top starts on Standard too); a later section carries its own where they differ (`hfSetOfMasterPage`), so a chapter master's setup is kept as the section's. Blocks measure against their *own* section's text width (`Ctx.contentWidthCm`, moved on at every master switch — a table's margins, an inline image's fit, the tab-stop suppression; measured: 17.0cm against a real 14.7 on one file), an index's stop against the document's as well, where the export keeps it. **Naming a master breaks the page** (LibreOffice's "page break with page style") — probed: even a style naming the master the page already uses breaks, which is how a book starts each chapter fresh, so only the document's first block is exempt. The *section* (its own header/footer set) starts only where the master really changes. An empty `style:master-page-name=""` is LibreOffice's explicit "no change" and ends the parent-chain walk, so an ancestor's master can't break every child style. `fo:break-after="page"` becomes the next block's `breakBefore`, the only break the editor stores. A master with a `style:next-style-name` is itself the different-first-page flag: its own (possibly absent) zones govern page one — **unless the two name each other**. A `next-style-name` cycle is LibreOffice's Left Page / Right Page, one mirrored setup rather than a hand-over: the right master's geometry governs, the left master's zones become the even variant, and `style:page-usage="left"`/`"right"` marks the margins `mirrored` **only where that twin really exists** — on a single-sided layout it means a page that starts on the right (`HfSet.startsOn`, which takes a blank page rather than the pair), and swapping its pair drew an index 9mm off. Reading it as a hand-over cost a book-style body its running head on every second page and its inner/outer margins with it.
- **A page-anchored frame** (`text:anchor-type="page"`) is out of the flow: it rides a paragraph of its own that collapses to nothing, and the node view places it from its page's corner (`anchorPage`, `image.ts`) — that paragraph must stay `position: static` (`editor.css`, `!important` over the line-height rule's own `position: relative`), or it becomes the frame's containing block instead of the page and offsets it by a page margin. Behind the text by default (`style:run-through="background"`); a cover page's own graphic instead declares `"foreground"` (`inFront` attr) to sit in front and hide what the page hoists behind it (a redundant logo, a title paragraph the graphic already carries). In a cell it falls back to an ordinary floating frame.
- **A header/footer zone is fitted to its schema** (`fitZoneSchema`): the zone editor has fewer marks and nodes than the body, and one it doesn't know makes `generateHTML` throw — which renders the whole zone blank. Unknown marks are dropped, unknown nodes leave their text.
- **A band-wrapped DOCX frame flush left is at no side of its own** (`anchorWrap`): the exporter writes exactly that — `wp:align` left with `allowOverlap="0"` — for a frame with no `wrapAlign`, and reserves the overlap for the side-by-side pair a real left/right band frame makes. Read as an alignment, a full-width figure came back floating.
- **An as-char text box is placed by its paragraph**, which is where its alignment stays — the box keeps only the `style:horizontal-pos` a band-wrapped frame declares of its own. Its `fo:padding` is read too — the editor's own 0.15cm ring is only the default.
- **A cell's number format** is on its *style* in ODF (`style:data-style-name` → a `number:number-style`/`percentage-style`/`currency-style`/`date-style`, read for its family, decimals and grouping) and on the field in DOCX (the `\#` picture, or `\@` for a date, which is not part of the formula and is cut out of it). Only a formula cell keeps one, and the file's own currency symbol and date order give way to the document language's.
- **Vertical text in a box** is the style's writing mode in ODF (a frame's graphic properties — where LibreOffice writes it — or a drawing shape's paragraph properties; both top-to-bottom modes) and `w:bodyPr vert` in DOCX (`vert`/`eaVert`/`mongolianVert`/`wordArtVert`; `vert270` reads bottom-to-top, which the browser cannot lay out, so it is not one). VML says the same as `layout-flow:vertical` on the textbox. The box's **vertical anchor** (`textVAlign`) is `draw:textarea-vertical-align` in the graphic properties and `w:bodyPr anchor` in DOCX (`ctr` → middle, `b`/`just`/`dist` → bottom).
- **Ruby**: `text:ruby` and `w:ruby` are one atom here (`ruby.ts`), so only the two texts are read — the base out of `text:ruby-base` / `w:rubyBase`, the reading out of `text:ruby-text` / `w:rt`. A file's own alignment and position are dropped; both products' defaults are what the exports write.
- **A TOC field's entry styles**: Word regenerates its rows from the styles named `toc 1`…`toc 9` (the ids are localized — `Verzeichnis1` in a German file — so `w:name` is what identifies them), and the cached rows are skipped, so `tocLevelStyles` reads them straight off styles.xml into the node's `levelStyles`. `registryName` maps them onto **Contents 1…10**, LibreOffice's own names, which is what keeps one document's ODF and DOCX legs pointing at the same registry entry. Without them the index falls back to the editor's 0.5cm per level and drops the file's own space-after — measured on a 60-row index: a 5.1mm row pitch against LibreOffice's 6.9mm.
- **Bibliography**: a `text:bibliography-mark`'s every `text:` attribute but the identifier and the type is a source field, whatever the file names it, so nothing is lost on a format we have no UI for. Word's `CITATION` names a tag only — the record comes from `customXml/item*.xml` (each is probed for a `b:Sources` root), and a tag no source declares still cites with the field's cached text. `BIBLIOGRAPHY` and `text:bibliography` both become the index node — and Word caches that field's rows as a **`w:tbl`** inside the field, so every block between the field's `separate` and its `end` is skipped, not only the paragraphs; imported, that table printed the whole list a second time (measured: two pages). `b:Sources StyleName` picks the citation style (`citationStyleFromDocx`).
- **Tracked changes**: ODF points at a registry, so `odfRevisions(body)` reads `<text:tracked-changes>` first and the body walk resolves each `text:change-start`/`-end` and `text:change` against it (the open insertions live in `Ctx` — a range may close in a later paragraph). A `text:change` is a deletion whose text is *only* in the registry: it is emitted there and then, marked. Word needs no registry — `w:ins`/`w:del` wrap their runs, whose text sits in `w:delText` rather than `w:t` for a deletion. Whether the document goes on **recording** is read too (`recordChanges`): the registry's `text:track-changes`, which ODF defaults to true where the element carries none, and Word's `w:trackRevisions` on/off in settings.xml.
- **Footnotes and endnotes** round-trip: `text:note` (ODF) and `word/footnotes.xml`/`endnotes.xml` (DOCX) become a `noteRef` anchor plus a `note` in the document-final `noteSection`, and the numbering configuration becomes `NoteSettings`. See `docs/architecture/notes.md`.
- **Graceful degradation** (collected as `warnings`, surfaced once): comments dropped, hyperlinks flattened to text, nested tables flattened to paragraphs, non-`Pictures` drawings dropped, unreadable pictures skipped (each with a warning). Page size is normalized to A4. Floating/wrapped images are imported as left/right/top-bottom wrap (free x/y positions collapse to the nearest side; see `image.ts`).

`tests/roundtrip.test.ts` (export→import) and `tests/lo-roundtrip.test.ts` (export→LibreOffice re-save→import, needs `soffice`) verify the round trip; run with `npm test` / `npm run test:lo`.

**A note body's marker tab is exactly one.** Both products open a note with the marker run
and one tab, which the editor draws from the note's own indent — stripping every leading tab
instead ate a tab the note's own text began with.

**A `<text:h>` that is a list item's own block is chapter numbering**, the numbered heading
both word processors write, and stays a paragraph — the editor numbers a chapter from its
outline. One *after* the item's paragraph is a heading nested in the item and reads back as one.

**A manual page break is read on a list paragraph too**, in both formats (ODF `fo:break-before`,
Word `w:pageBreakBefore`): a numbered item can open a page. Only a **cell** paragraph's is
dropped — neither word processor honours one inside a table.

## Header/footer import

- **Import:** `StyleResolver.masterPageHF()` reads `style:header`/`style:footer` + the header/footer-style heights; `pageGeometry()` reconstructs the body margin (page margin + zone height + spacing) and `edgeDistancesCm()` returns the raw page margins as the zone distances. `style:page-usage="mirrored"` — or `"left"`/`"right"`, which is one side of a book and mirrors just as surely — marks the left/right pair as **inner/outer**, so an even page swaps them (`margins.mirrored`, set only when true). `style:writing-mode` starting `rl` is a right-to-left page (`rtl`); DOCX reads the section's `w:bidi` for the same thing. The band LibreOffice lays out is **`max(declared height, zone content + the zone's own gap)`**, and the body starts at the page margin plus it — unless the gap is **dynamic** (`style:dynamic-spacing="true"`, which is what LibreOffice writes for a Word header), where it is absorbed rather than added and the band is `max(height, content)`. Probed at min-height 7.51mm, gap 6.51mm, 12pt lines: `false` → 11.37 / 21.11 / 35.71mm for 1 / 3 / 6 lines, `true` → 7.51 / 14.60 / 29.21. Probed on a 20mm top margin, 10pt zone: one line + `fo:margin-bottom` 0 → body at 24.07mm, the same with 5mm → 29.07, three lines → 37.21, one line under `fo:min-height="20mm"` → 40.00 (the floor wins, the gap is not added on top). A zone paragraph that *wraps* counts as the lines it renders, and its own `fo:padding` counts too. The **last** paragraph's `fo:margin-bottom` is no part of the band, in either zone — probed: a header of one 10pt line with a 12mm bottom margin puts the body at the 6mm min-height, and a footer's is dropped the same way, while a margin *between* two of the zone's paragraphs counts in full (two lines 12mm apart → a 20.16mm band). The collapsed paragraph therefore carries only the margins between the source paragraphs, so a zone's own trailing margin does not survive a re-save; nothing renders differently for it. Missing that put a page's body 10.3mm low on every page of one file. The importer folds only `max(height, gap)` into the page margin — the floor it can know without laying the zone out — and the gap plus the zone's and the paragraphs' `fo:padding` join the collapsed paragraph's spacing on the body-facing side (`convertHfZone`'s `bandCm`), so the runtime's **measured** band (`src/lib/components/CLAUDE.md`) sees them; `max(margin, dist + measured)` is then LibreOffice's `rawTop + max(height, content + gap)` exactly. Verified against a copy of one file's own header: LibreOffice puts the body at 33.71mm, the editor at 33.79. `convertHfZone` → single-paragraph doc (extra paragraphs → hard breaks; a text-less zone that carries a background/border rule line is kept, box props merged with the bottom rule from the last paragraph); `convertInline(…, hfFields=true)` keeps `text:page-number`/`-count` as field nodes. A master page whose `style:next-style-name` points at *another* master governs one page only (the "different first page" idiom): its own zones become the first-page variants and the successor's the running ones — read as the running header instead, a title-page master repeats on every page of its section and its height pushes each block onto its own page. A zone's positioned (non-`as-char`) frame keeps its wrap and its `svg:x`/`svg:y` from the page corner: it is out of flow (a letterhead or full-page title background), so `HeaderFooterLayer` paints it per page behind the body and the zone's reach ignores it — inline it would reserve a page-tall line of body space. A **text box** has no block node to live in, so its paragraphs become lines of the zone ahead of the one anchoring it (warned): Word's own converter flattens the same document the same way, and dropping it cost one letterhead 7.6mm of band on every page. `hfIsEmpty` counts a rule-/shading-only paragraph as non-empty so it renders and exports.
A **table in a DOCX zone** goes the same way as a text box: its cells' paragraphs become
the zone's lines (`hfParagraphs`), and since the one-cell table is what every Word
template draws its rule line with, the cell's own borders and shading become the
collapsed paragraph's box (`hfCellBox`, `w:tcBorders` over the table's `w:tblBorders`).
Its rows' `w:trHeight` beyond the lines they hold rides that paragraph's **space above**
(`hfRowExtraPt`), which is both what the measured band grows by and what puts the rule at
the row's foot — a header zone draws its space above, where a footer's carries the ODF
gap to the body and only measures it (`HeaderFooterLayer`). Read as no zone at all, a
2.2cm header band left every page's body 8mm high.

## Language on import

A block's or a run's language is formatting only where it **differs** from the level above
it: a run against its paragraph's, a paragraph against the document's (`documentLanguage()`
in both resolvers). The paragraph's own language comes from its style's text properties in
ODF and from the paragraph mark (`w:pPr/w:rPr/w:lang`, which is where Word keeps it) in
DOCX, and becomes `BlockDefaults.lang` — the yardstick its runs are measured against. A
DOCX run that names none inherits the block's, **not** `docDefaults`', or every run of a
paragraph in its own language would arrive carrying a mark. Header and footer zones take
the document's language the same way, unlike the size and font their style provides, which
do have to become marks there.

## Defaults on DOCX import

**Table borders** come from the table's own `w:tblBorders`, else its table style's along the
`w:basedOn` chain (per side, nearest declaring style wins). A side nobody declares is **not
drawn**: Word's Normal Table has no border, and the gridlines it shows on screen are not
printed. ODF says the same for an undeclared `fo:border`, so both importers agree.

**`w:tblInd` changes meaning with the file's compatibility mode.** Word 2010 and earlier
(`compatibilityMode` ≤ 14, or no `word/settings.xml`) measure it to the cell's **text**, so
the table hangs its left cell margin into the page margin; Word 2013 (15) measures it to the
table's edge. LibreOffice follows the setting — probed both ways on the same file — so
`tblIndIsToText` gates the subtraction and a table's `marginLeft` may come out negative.

**A table style's conditional areas** (`w:tblStylePr`: header row, banded rows, first
column, …) are **baked into the cells** — fill and borders as attrs, the area's `w:rPr` as
real marks on its runs — because the file's own style is not in the editor's registry,
which is where an assigned style's regions otherwise come from. An area covers a grid box:
its `top`/`bottom`/`left`/`right` apply where the cell sits on that box's edge, its
`insideH`/`insideV` anywhere within. A **band's box is the whole banded region**, not the
one row it shades — that is what makes `insideH` the line *between* two band rows, which
is how a style with no inner rules (Word's Medium Shading) comes out borderless. A cell's
own box spans the rows its `w:vMerge` covers — counted ahead of the covered rows
(`vMergeRows`) — or a merge reaching the last row loses its bottom edge to that same rule.
Areas
layer in Word's ascending precedence, over the table's borders and under the cell's own
`w:tcPr`; banding counts from the first *body* row, so the row under a header row is band 1.
`w:tblLook` decides which areas apply at all — named flags where the file has them, the
older `w:val` bitmask otherwise, and no element at all means none.

**A table style's `w:pPr` ranks *below* the paragraph style**, so a cell's spacing layers
docDefaults ← the table style ← the cell paragraph's own style chain ← direct `w:pPr`
(`paragraphSpacing(id, under)`). The chain has to be baked in because a cell carries no
style name; read as an override the way a table style zeroing `w:after` reads, every table
loses the space after its cells' paragraphs and a long document comes out pages short.

**A `w:cols` gap the section's text cannot hold is no gap at all.** `w:space` is twips, and
a producer writing EMU there (360000 = 1cm in EMU, 635cm read as twips) would otherwise
leave columns of no width. Under that width LibreOffice lays the declared gap out literally
— probed to 10.16cm on a 15.24cm text — so only the unholdable value is dropped.

**A floating table becomes a frame holding the table.** Word's `w:tblpPr` takes a table
out of the flow — a cover page's layout table is one, and what follows starts where the
table does. It arrives as the `textBox` its schema takes one table in, riding the block
that follows it (the paragraph LibreOffice anchors its own frame to), with the side the
`w:tblpX` half puts it on as the wrap and the table's own width as the frame's — which
is also the width its margins are then measured against. LibreOffice keeps Word's table
in exactly that frame and writes it back as `w:tblpPr`, so both legs round-trip it.

**A heading in a cell carries its own 0.** No style name reaches a cell, so the editor
draws the level's 12pt/6pt margins (`styles/headings.ts`) there — where a Word heading
whose style chain sets no spacing has none. The baked-in chain's silence is therefore
written as an explicit 0 (`convertParaLike`, the `kind === 'cell'` branch), while a cell
*paragraph*'s 0 stays unset as before. Missing it put every such heading 4.2mm low.

**A `w:numStyleLink` abstract carries no levels** — it defers to its numbering style's own
numbering, so `DocxStyles.level()` resolves through the link (style → its `w:numPr` → the
`w:styleLink` abstract); unresolved it read as `{}` and every linked list silently imported
as a bullet list. A linked numId's list gets `listStyleName` (the style's `w:name`), no
per-level attrs, and its definition lands in `sheet.list` (`listStyleFromDocx`).

**A shape's fill and stroke resolve the theme.** `<a:schemeClr>` is what a template's own
colours are named by, so `themeColors` reads theme1.xml's scheme by slot — plus the
`tx1`/`bg1`/`tx2`/`bg2` aliases Word's default mapping gives it — and `drawingColor`
applies the `lumMod`/`lumOff`/`tint`/`shade` modifiers per channel (they are defined on
luminance; channel-wise is within a shade of it and needs no colour space). Read as
sRGB-only, a cover page came back with no blocks and no divider lines at all.

Body text with no resolved font falls back to the *document's own theme minor font*
(`docx.ts` `runMarks`), not the editor default — Word's implicit body default. Headings don't
(they keep the editor heading default); DOCX page margins default to Word's 2.54cm.

- **Odd/even is per zone.** A master declaring only `style:footer-left` still repeats its
  header on left pages; reading the pair as one flag blanked the running head on every
  even page. A left element that is *present but empty* still blanks its zone.
- **The page-number format is the section's, not the document's.** `style:num-format` sits
  on the page layout governing the body (`HfSet.pageNumberFormat`), which is how a roman
  front matter precedes a decimal body; Word's is `w:pgNumType w:fmt` per section, and the
  document's own comes from the **first** section, as the paper and the margins already do.
- **The running head keeps the name the field cached.** A `STYLEREF` field's result runs
  are the chapter a reader shows before it repaginates, so `chapterField.text` takes them
  (`emitField`, both the `fldSimple` and `fldChar` forms).

- **A header row is `w:tblHeader` on the row**, which says what ODF's
  `<table:table-header-rows>` says: its cells become `tableHeader`, and the export writes
  the flag for a row whose cells are header cells even where the table asks for no repeat.
- **An index's look rides its first row.** The field opens on that row, so the leader and
  the right tab stop the page number runs to are read off the very paragraph the node is
  built from; a stop at the text width names no position of its own and is dropped, as on
  the ODF side. The level styles are a family per index kind (`INDEX_LEVEL_STYLES`) —
  `Contents n` for a contents, `Illustration Index n`, `Table index n`, `Index n` — since
  Word regenerates each kind's rows from its own.
- **A text box's ring is `w:bodyPr/@lIns`** (EMU), suppressed against the editor's own
  0.15cm as the ODF side suppresses `fo:padding`.
- **Chapter numbering** — `text:outline-style` on the ODF side, the heading styles'
  `w:numPr` on Word's — becomes `StyleSheet.outline`; see `src/lib/styles/CLAUDE.md`.
  A numbered heading is therefore **never a list item** (`paragraphNum` returns null for
  anything with an outline level): read as one, every chapter came back wrapped in an
  `orderedList` that swallowed the `w:pageBreakBefore` in front of it — `blockAttrs`
  reads the break for `kind === 'body'` only.
- **The first block naming the master the document opens on switches nothing**
  (`Ctx.leadingMaster`): LibreOffice names it on the first paragraph of every converted file,
  and a section there shifted every zone set by one. A hand-over master whose one page shows
  its successor's own zones (the left ones on a left page) opens the section on that side,
  not a different first page (`sameAsRest`).
- **LibreOffice's own forms**: a DOCX preset shape keeps its OOXML name (`ooxml-rect` →
  `shapeFromPrst`); a drawn shape's outline is `draw:stroke` alone (its Frame ancestor's
  hairline `fo:border` is a text frame's); `loext:content-control` is read through, ours
  (tag `edentext-placeholder`) as a placeholder field; an alphabetical index opens with a
  separator template that names no page number, so the first entry level decides.
- **DOCX defaults**: a file flagging no `w:default` style means `Normal`; Word's `Strong`
  character style is the registry's Strong Emphasis.
- **A heading is found by `w:outlineLvl`, not only by its style's name.** A file may set
  its chapters in a style of its own ("Appendix 1") whose `w:basedOn` chain reaches
  Heading1; `styleOutlineLvl` walks that chain, and the exporter writes the level on the
  paragraph too, so nothing rests on a style being called "Heading n".
