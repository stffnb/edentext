# `src/lib/export/`

This directory writes ODF, DOCX, PDF, and browser downloads. `saveFile.ts` applies
password protection after each format-specific pass; templates follow the document format.

`buildOdt` is a DOM-free pipeline: TipTap JSON passes through `odf-kit`, then content and
style XML post-processing. ODF features `odf-kit` cannot express travel through sentinels;
their replacement passes are order-dependent. Preserve the pipeline order and cover new
sentinels in every relevant document, header/footer, table-cell, and note path.

The final ODT writes `mimetype` first and stored; already-compressed pictures stay stored
and remaining entries are deflated once. DOCX post-pack passes that add parts must also add
relationships and content types. Keep schema-sensitive XML order intact.

Headings and body defaults must match the importers and `HEADING_STYLE_OVERRIDES`. Emit
named styles and direct formatting separately so values matching product defaults remain
implicit. `saveDocument` settles the format before constructing bytes; do not infer it from
the browser save dialog.
A block's own size and font (`fontSize`, `fontFamily`) render its unmarked text, so both go
onto the runs too: DOCX via `runForce`, ODT cells via `emitSegment` (the body's FSZ style covers it).

A shape's text is drawing text to LibreOffice, where a link holds plain text: `shapeLinks` writes a span outside `text:a`, since one inside comes back empty (probed).

Recorded changes (paragraph marks: `carryParagraphMarks`, see `docs/architecture/review.md`): an ODF deletion region is one stretch of one paragraph, since the import puts its text back at its marker, so the runs of one change that other text or a block boundary separates go out as regions of their own. Text one author inserted and another struck goes out as LibreOffice writes it (probed): the deletion region with the insertion's `text:insertion` after it; in DOCX, the `w:del` inside the `w:ins` (`applyStackedRevisionsDocx`). A deletion's registry block is the kind it was cut from (`text:h` for a heading's text), and every empty element a sentinel turns into (a change marker, an index mark) keeps the space after it as `<text:s/>` where a space or the paragraph start precedes it (`keepSpacesAcross`, `registrySpaces`): odf-kit wrote those spaces around text, and LibreOffice folds them away (probed). An atom (picture, formula, field, note anchor, text box) takes its change as text does: in ODF its sentinel carries the mark into the region; in DOCX it is bracketed and `applyAtomRevisionsDocx` wraps its runs in the `w:ins`/`w:del`, a field there as a complex one (`w:fldSimple` may not sit in a revision) with `w:delInstrText` when deleted. LibreOffice itself keeps neither a formula's mark in DOCX nor a deleted formula in ODT (it reads back as its replacement picture), probed.

A list item in a table cell writes every paragraph and sub-list it holds, in order (`buildCellContent`); `mergeListItemBlocks` leaves cells alone.

Read `docs/architecture/export.md` before changing ODF/DOCX export, post-pack passes,
sentinels, heading defaults, review printing, or header/footer export. Read the focused
architecture document for tables, frames, formulas, formatting, notes, or encryption.

The raster PDF and print paths (`pdf.ts`) capture the page copy in strips of pages, since one
canvas for a long document exceeds every engine's limit and comes out blank; each strip keeps
only the blocks it reaches and a measured stand-in above them. Anything html2canvas cannot
evaluate (counter() markers, outline counter-set) becomes literal text first, boxed like the
live pseudo-element, or the copy's layout drifts from the editor's pagination.
A strip clones only the parts it keeps (`utils/pageStrip.ts`, also the navigator's thumbnails), and page JPEGs are cropped and encoded in
`pageWorker.ts` workers while the next strip renders.

The vector PDF (`printPdf`) builds one print page; a browser opens its print dialog on it, the desktop app turns it into the PDF file directly (`desktopPrintToPdf`).

Everything a save loads (ODT with odf-kit's lazy chunk, DOCX, templates, encryption) is loaded once the editor is idle (`App.svelte`): a deploy deletes the build's lazy chunks, and saving must still work in a tab opened before it. The Pages deploy keeps earlier assets for 30 days (`assets.txt`) for everything else.
