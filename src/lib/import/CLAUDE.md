# `src/lib/import/`

This directory imports ODF and DOCX into the TipTap schema; `imageFormats.ts` is shared.
Password-protected files are decrypted before either importer runs.

`importLimits.ts` bounds ZIP input to 128 MiB compressed, 10,000 entries, 32 MiB XML parts,
64 MiB media parts, 64 MiB other entries, 256 MiB total expansion, and a 1000:1 ratio before
extraction; it rejects over-budget archives and XML declaring entities. A doctype naming
only an external DTD is dropped and the part read — old formula objects carry one — and a
part an embedded object points at never fails the document, only its own frame.
TIFF conversion also rejects more than 100 frames, 40 million pixels, or 160 MiB decoded RGBA
before it allocates an image buffer; unsupported images retain the importer's placeholder path.

ODF is parsed directly from `content.xml` and `styles.xml`; the library reader loses
structures the editor needs. Choose the importer from the extension, but retry the other
format after a failed parse so renamed files still open. Return unsupported content as
warnings where it can be safely flattened or omitted.

`StyleResolver` resolves named and automatic ODF styles through their parent chains;
`DocxStyles` provides the equivalent DOCX resolution. Keep only values that differ from
the resolved named style as direct formatting. Values equal to LibreOffice-compatible
editor defaults must remain implicit, or each round trip accumulates formatting.

Fit imported content to the editor schema without changing its semantic role: paragraph,
heading, list, table, frame, note, and field paths have separate constraints. A DOCX `GOTOBUTTON`/`MACROBUTTON` without a result shows its instruction's text, a GOTOBUTTON's as a `#target` link (`buttonFieldFromInstr`). Keep ODF and
DOCX behavior aligned unless the formats expose an unavoidable difference.
A heading in a cell or a list carries no style name but renders by its level's `Heading N`,
so a file style of that name is imported even where no top-level block uses it; under any
other style it renders as the built-in, so its formatting is measured against that. A paragraph in a list or a cell loses its style's name to its effect, in both formats; the ODT export writes the style as its parent for that (and for LibreOffice).
`repairContent.ts` checks the imported body against the schema on open; content it rejects is
refitted and reported as a warning. It is a safety net: an importer still emits valid structure.

Both formats carry western, asian and complex-script text properties side by side. The
**font** is read as a pair: `fontFamily` from the western slot, `fontFamilyAsian` from the
asian one (`style:font-name-asian`, `w:rFonts w:eastAsia`), on every run whatever its script,
each suppressed against its own half of the style chain (`fonts`/`asianFonts`). Size, weight
and slant still come from the set the run's own characters belong to (`scriptProps`,
`ASIAN_SCRIPT_RE`), per ODF text node; DOCX has no asian size or weight, and its
complex-script set is not read. A DOCX chain without `w:sz` is 10pt, as in Word; where a
paragraph mark gives the block another size or font, runs without their own keep the style's
(`keepRunDefault`), since the editor's unmarked text renders the block's. The default style's asian font is dropped where it is the
western one or the language's Han default (`dropDefaultAsianFont`) — what an export writes back
unasked. The **language** is a pair the same way: `lang` from `fo:language`/`w:val`,
`langAsian` from `style:language-asian`/`w:eastAsia`, each suppressed against its own default
(`BlockDefaults.lang`/`langAsian`); DOCX's `RunProps` keeps them apart (`langEastAsia`) so a
run naming one inherits the other. The document's main language is the asian default where
the body is mostly East Asian (`mainOfPair`, `mostlyAsian`), the other one `languageOther`.

A header/footer zone converts through the body's block converter (`'zone'` kind, a
`zone` ctx flag), so a **text box** anchored in one keeps its PAGE field — what Word's
page-number gallery puts there, on every page of the document.

The `sectionBreak` marker is **ordinal** — the editor counts the blocks carrying it to
index the header/footer sets — and only a paragraph, a heading, a table or an index
carries it (`SECTION_CARRIERS`, the types `pageBreak.ts` gives the attr to). A group opening
with anything else is not modelled as a section at all and its set is dropped with it:
marking a later block would leave two sections on one page, and dropping only the marker
would shift every section after it onto the page setup of the one before.
`tests/corpus/17-sections.docx` (opening with a heading), `18-table-sections.docx` (with a
table) and `19-index-sections.docx` (with an index) hold the shapes that have to keep
working. A section can also **end inside a block-level `w:sdt`**: Word wraps an index in
one and puts the `sectPr` on the control's own last paragraph, where a walk of the body's
children never reaches it (`closingSectPr`). Missing it merges two sections, so the index
keeps the page setup of the section before and opens on its page rather than a new one.

ODF keeps a section's master page on the **first thing on its page**, which for a table is
its own table style and for an index its first body paragraph — both probed against
LibreOffice's own conversion. So `masterPageOf` walks the table family too, and naming a
master is a page break there as it is on a paragraph.

Direct paragraph properties beat the numbering level's: a list item's own `w:ind w:left`
is the list's indent, and a table's `w:tblW w:type="pct"` its width as a share of the
section's text width — the grid is only the columns' weights there, and reading it as a
width collapses a full-width table to a few millimetres.

A DOCX **range marker** (bookmark, comment range) reaches `trackBookmark`/`trackComment`
wherever it sits: a wrapper (revision, move, smart tag, link, simple field) is walked like the
paragraph (`handleInline`), content collapsed to one node or skipped hands its markers on
(`trackRanges`), and one beside table rows or cells moves into the bordering cell paragraph
(`parseXml`). A missed end leaves its range open to the document end; a comment there hides
every later one, as overlapping ranges collapse to the outermost. LibreOffice writes ODF's
`office:annotation-end` beside a deletion, never into the change registry.

An ODF list with `text:continue-numbering="true"` continues the **latest top-level list of
its style**, `text:continue-list` the one with that `xml:id`; both import as `start`, plus
`continueNumbering` where counting on from the ordered list before it gives that start
(`keepContinuation`); a DOCX numId resuming after a break does the same. Both exports write
the link back (`text:continue-list`, the shared `w:num`). An item opening with a sub-list
stays an item without a label, unless that sub-list restarts — our own export's form of an
item's further sub-list, which goes back on the item before.

`utils/shapePresets.json` is generated (`scripts/make-shape-presets.mjs`, MPL-2.0 from LibreOffice): never edit it by hand.

A recorded paragraph mark lands in `revMark` (`docs/architecture/review.md`). A recorded change carries its mark onto line breaks and atoms (picture, formula, field) as onto text; a note anchor takes none and a box is no single character. A deleted DOCX field's instruction is `w:delInstrText`. A deletion region with a `text:insertion` after it, or a `w:del` inside a `w:ins`, is text one author inserted and another struck: it takes both marks. A deletion's registry holds a heading's text as `text:h` and a list item's inside `text:list`/`text:list-item` (LibreOffice's form, probed); both are read.

Read `docs/architecture/import.md` before changing parsing, style resolution, default
suppression, image conversion, headers/footers, or format-specific edge cases. Read the
focused architecture document for tables, frames, formulas, formatting, notes, or encryption.

Exercise `npm test` for importer changes; use `npm run test:lo` for format I/O changes.
