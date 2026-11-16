# Export

`odt.ts` writes ODF, `docx.ts` writes DOCX, `pdf.ts` renders PDF, and `saveFile.ts` chooses
the browser write route. See `frames.md`, `tables.md`, `formatting.md`, `formulas.md`,
`notes.md`, and `encryption.md` for feature-specific contracts.

## Save contract

The document format is chosen before bytes are built. A browser save dialog cannot reliably
report a changed extension, so Save As selects ODT or DOCX first; templates follow that format.
An untitled document therefore opens the format chooser before its first save. `saveFile.ts`
uses the File System Access API where available and falls back to a download otherwise.

Password protection is applied after every format-specific transformation and template
conversion. Never encrypt an intermediate package. The output name derives from the first
non-empty heading when possible and otherwise uses the format default.

## Shared invariants

Importers suppress compatible defaults, so export must not manufacture direct formatting for
body, heading, or list values that the named style or product default already supplies. Named
styles and direct formatting travel separately; direct values override the named reference.
`HEADING_STYLE_OVERRIDES` is shared by styles, import, export, and CSS.

Both ODF and DOCX need post-pack work beyond their libraries. Preserve pass order, unique
sentinel delimiters, and coverage of document body, table cells, headers/footers, text boxes,
footnotes, and endnotes. A newly added package part needs its content type and relationship;
schema-sensitive XML children retain their prescribed order.

## ODF pipeline

`buildOdt` is DOM-free: TipTap JSON passes through `odf-kit`, then content and style XML passes,
and finally `rezipOdt`. Intermediate archives are stored because they are immediately unpacked
again. The final ODT writes `mimetype` first and stored, preserves already-compressed pictures,
and deflates remaining entries once.

Sentinels carry editor features that `odf-kit` cannot express through every serializer path.
Replacement passes restore inline breaks, tabs and collapsible spaces (every space opening a
paragraph or following another, counted across runs — LibreOffice reads raw `a  b` as `a b`), images, custom paragraph attributes, named
styles, page and section breaks, text boxes, fields, revisions, notes, and other format-specific
nodes. Keep the source definitions and replacement order in `odt.ts` authoritative; do not add
a second serialized representation of the same feature.

Custom paragraphs, headings, and tables use the unknown-node path where native serialization
would drop required attributes. Table cells and list items may need staged blocks because the
library otherwise serializes only a reduced shape; staged content must retain its document order
and survive subsequent inline passes.

Images bypass the native path to preserve geometry, table-cell placement, rotation, wrapping,
and package entries. Floating frames need a graphic style with the appropriate anchor and wrap;
as-character frames remain inline. A floating one is anchored to the **character** it sits on:
the paragraph anchor names no place in the text, and Writer writes such a frame back as the
paragraph's first child, which moved a picture floated beside the last words of a paragraph up
to its first. Text boxes and shapes require their own frame style and must
retain the distinction between auto-growing text boxes and fixed shapes. See `frames.md`.

Named paragraph, character, and list styles are emitted into the right ODF style families.
Automatic styles inherit from their named parent when direct formatting remains. Pair vertical
margins when a direct override changes either side: LibreOffice otherwise resolves the omitted
side from the default style instead of the parent chain.

Header/footer zones ride the body path: `buildOdt` appends each zone's blocks behind the body
between `HFZ` marker paragraphs, so every content pass covers them, and `cutZones` moves each
region into its master page, copying the automatic styles it reaches into styles.xml under
`Hz*` names (a zone may sit in several masters, so its `xml:id`s go). DOCX writes a zone through
`blocksToDocx`; its sentinel passes run over header and footer parts with their own
relationships, and a zone's list instances are registered before packing, since the package
writes numbering.xml ahead of its header parts.

ODF sections write their own page layout and master-page variants. Header/footer distances are
part of page geometry, not body margins. Each master writes an explicit zone, including blank
ones where needed, so a section cannot inherit an unintended prior zone. Mirrored margins,
right-to-left pages, running fields, and page-number formats travel with their applicable page
layout or master. A first page with its own margins, distances or area frames gets a one-page
master on its own layout, handing over by `style:next-style-name` (LibreOffice's title page;
section 1 splits Standard). DOCX has no first-page margins: `w:titlePg` switches zones only, and
LibreOffice splits such a page into a section of its own, which needs the layout's page end.

## DOCX post-pack

The `docx` package handles ordinary runs, paragraphs, and many fields, but post-pack passes add
parts and XML it cannot emit. Text boxes, shapes, some numbering, embedded fonts, custom XML
bibliography sources, and selected fields may require raw package changes. Every added image,
font, or relationship has a unique id and a matching part, relationship, and content type.

DOCX sections use explicit header/footer references, including empty parts, to prevent Word's
"Link to Previous" behavior from leaking a prior section's zones. Section page breaks, odd/even
and first-page variants, mirror margins, right-to-left layout, footnote settings, and page-number
format belong on the relevant section properties.
The `docx` package writes a section's `w:sectPr` into the section's last paragraph, or into an
empty paragraph of its own after a table, which Word shows as a blank line and LibreOffice folds
into the paragraph before, losing that paragraph's space below. `applySectionMarksDocx` first moves
every mark into a paragraph of its own, then onto the preceding paragraph, where Word writes it,
unless that paragraph holds no run (LibreOffice and the importer drop an empty paragraph carrying a
`w:sectPr`, probed, so the document's own blank line would vanish) or ends in a line break
(LibreOffice drops a break ending a section). A run inside a revision or field counts as content.

Named styles use Word-compatible identifiers and built-in factory slots. Do not create a second
factory definition for a built-in style: readers may discard the inheritance chain. Numbering
styles, table styles, and some raw style definitions are inserted after packing where the library
cannot preserve them.

Word stores some properties on runs that ODF inherits from paragraphs. Stamp those properties
where Word requires them, especially language, while keeping values implicit where its style
chain already supplies them. Rasterize vector images that Word cannot display before emission.

### Language by script

Both formats keep three languages side by side — western, asian, complex — and both word
processors read Chinese, Japanese and Korean text from the **asian** one alone. A run, a
paragraph and the document therefore carry a western and an asian language (`lang`,
`langAsian`), each tag written to the slot of its script (`fo:language`/`w:val`,
`style:language-asian`/`w:eastAsia`), which is also what makes the document's Han default font
(`w:rFonts w:eastAsia`, `style:font-name-asian`) the one that applies. The document keeps a main
language (spell check, dates, number formats) and the other slot's tag (`documentLanguageOther`);
the spell check reads the western one, so a Chinese document checks its Latin words. Both word
processors write an asian default (`zh-CN`) into every file whatever it is written in, so on
import that slot leads only where the body has more East Asian characters than Latin letters
(`mainOfPair`); a Chinese document re-saved by LibreOffice, which adds its own western default,
still reads as Chinese. LibreOffice lifts a run language spanning its paragraph onto the
paragraph.

### Font pair

A run, a paragraph mark and a style carry a western font and an asian one (`fontFamily`,
`fontFamilyAsian`), each written to its own slot: `style:font-name` (+ `-complex`) and
`style:font-name-asian`, `w:ascii`/`w:hAnsi`/`w:cs` and `w:eastAsia`. A half the model leaves
unset is not written, so it inherits, as it does on screen. odf-kit copies a run's one font into
all three slots, so `dropKitAsianFonts` removes the copy from its automatic styles before any
other pass, `odfExtraTextProps` adds a run's own asian font, and `declareReferencedFonts` gives
every name a `<style:font-face>`. The Standard style's asian slot is the Han default in an East
Asian document and the western default otherwise.

The Han default font follows the country: SimSun, PMingLiU for Taiwan, Hong Kong and Macau, and
Yu Mincho for Japan — the first face in LibreOffice's Japanese `CJK_TEXT` list (`VCL.xcu`) that
ships with both Windows and macOS, and the default of current Japanese Office.

## Feature boundaries

Tables preserve spans, widths, margins, borders, shading, header rows, formulas, number formats,
and list content; see `tables.md`. Frames preserve inline versus floating anchoring, geometry,
wrap, captions, and shape semantics; see `frames.md`. Formulas, bookmarks, cross-references,
captions, indexes, bibliography, ruby, placeholders, revisions, and notes retain their semantic
nodes where the format supports them; their focused documents define fallback behavior.

List levels: DOCX numbers nine (`w:ilvl` 0–8), ODF ten. The editor indents to the ninth
(`sinkListItemWithin`, `DOCX_LIST_LEVELS`), so its own lists fit both. A file's deeper list
is moved up onto the last level the format has (`clampListLevels`): its items follow the
item they were in and take that level's kind, which is how LibreOffice shows such a list.
The ODT keeps all ten, LibreOffice's own ceiling, since a file from it may use the tenth; both
importers read no deeper than their format. odf-kit writes six levels of each list style,
so `extendKitListLevels` adds the other four before the per-level passes rewrite them.

Review printing renders the visible markup mode consistently. Raster paths clone live paper;
the vector path rebuilds document markup. Comment bodies print as a final list when markup
printing is enabled, while resolved comments do not print. See `reviewPrint.ts` for layout detail.

## Validation

`tests/schema-validation.test.ts` guards XML schema conformance and
`tests/package-lint.test.ts` guards package invariants such as relationships, style ids, ranges,
and manifest entries. Run `npm test` for exporter changes and `npm run test:lo` for format I/O.
