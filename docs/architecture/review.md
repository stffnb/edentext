# Recorded changes

Text changes are the `insertion`/`deletion` marks (`editor/extensions/trackChanges.ts`, described in its `CLAUDE.md`). This document holds what a mark cannot carry and the file forms, each probed against LibreOffice 26.2 with its own recorded edits.

## Paragraph marks

`revMark` on a paragraph or heading is the mark that ends it: `{ insertion?, deletion? }`, both when one author struck what another inserted. `revisions()` merges it with the text of its change, so a change spans blocks: `spans` are its inline stretches, `marks` its blocks, and `text` shows the mark as a newline. Touching stretches of one author and date are one change, since a file numbers each run and mark separately.

Only a mark with a next paragraph can be recorded (`nextParagraph`): a cell, a frame or the document ends in a block with nothing to join, and a block a table follows stays.

Removing a mark follows LibreOffice (probed, accept and reject alike):

- a block left empty goes, and the next stays unchanged; an Enter rejected leaves the first half when both are empty or the second is what the Enter opened, as a page break stays above the cut (`splitFrom`);
- otherwise the next block's text joins it, under the first block's format and the second's mark.

Deleted `Heading first` + `body second` across the mark gives one heading; with the whole heading deleted, the body keeps its own format. The author's own pending mark goes at once; a joined block of only inserted text takes over the second block's format record, since rejecting leaves that block.

## Tables

A row carries a `revMark` as a paragraph does; so does each cell of a column, recorded when every row got a new cell or has a merged cell widened through it. A file holds such a column as its cells' text only, since LibreOffice's reject takes the whole table otherwise (probed), so after a reload rejecting leaves the empty column. A row or column change gathers its cells and the text in them into one revision (`gatherChanges`), within one table: the same author and moment elsewhere is another change, as a file's coarse dates and one compare's hunks have it. Removing one takes the line with `removeRow`/`removeColumn`, with the last line the table; a row someone typed into stays. A deleted row a merged cell runs through rebuilds that cell and passes unrecorded; a column through one only narrows it and is recorded. In ODF the line's style says `loext:text-changes-only="false"`, the change sits on the text in it, and only a line without text gets the tracked U+200D LibreOffice writes.

Blocks taking an empty block's place go in front of it, which is where the plain edit leaves them; the empty block's mark is struck, so rejecting brings it back.

A table cutting a paragraph records the split as a mark in front of it, which no file can hold: LibreOffice's reject and ours after a reload keep the two halves. The list cut of a table inserted in a list is not recorded.

## Notes and text boxes

A note anchor and a text box take a change as an atom does: `revisions()` treats a recorded box as one inline piece with everything in it, and a mark step never reaches a box, so `markRange` sets it with `setNodeMarkup`. The note's body follows its anchor through the notes' own repair. In ODF a deletion's registry block holds the whole `text:note` or frame, and a region around a frame says nothing about the paragraphs in it.

## Formatting

The `formatChange` mark holds the format marks its run had (`old`, JSON). A mark step of a transaction is the record (`recordFormats`): each run it touches keeps what it had before the transaction, the first record stands, a run back at its old format loses the change, and the author's own insertion takes none. One transaction is one change, however many runs and blocks it covers (`gatherChanges`, by id).

A block's own format (type, style, alignment, spacing, indents, tabs: all attrs but `UNFORMATTED_ATTRS`) is its `revFormat`, read from attr, markup and swap steps the same way: the first record stands and a block back at it has none.

Lists are part of a block's format: `old.list` holds the lists around it, outermost first, so toggling a list, moving an item a level and changing the list type or its bullet or numbering are all a `revFormat`, read from any `ReplaceAroundStep`. Rejecting lifts the block out and wraps it back, into the lists beside it (`restoreLists`), from the document start so nested items find their parents.

Accepting drops the mark; rejecting puts `old` back run by run, a block's attrs and type with it. "Original" shows the current format, since a mark cannot be undone by CSS; the print path prints `settledDoc`.

## Headers and footers

A zone records like the body while its editor is open; a stored zone's editor (`zoneExtensions` without `live`) only shows it, so setting its content marks nothing.

Most zones have no editor, so the review reads the stored docs (`editor/zoneReview.ts`): the pane lists the body's changes, then each shown zone's, with `Revision.zone` naming the zone, and a click opens the zone on the first page showing it and selects the change. Accepting or rejecting a zone's change settles the stored doc (`settledDoc`) and writes it as a `StateStep` in a body transaction, so "all" over body and zones is one undo step, and an open zone takes the result over like an undo (`ZONE_SETTLED`). Next and Previous run through the body, then the zones in the pane's order. The margin bars and balloons stay on the body: there a zone's change shows only in the zone. A zone shared by sections or by running and even pages is one row by id, and settling reaches each copy.

DOCX ids are unique per part only, so the importer scopes a zone's by its part (`scopeRevisions`). In ODT a zone's changes sit in a `text:tracked-changes` of its own, first child of `style:header`/`style:footer`; `cutZones` moves them there with the zone, and a zone in several master pages repeats the registry under the same ids, which LibreOffice reads per zone (probed).

Authors share one colour table over the body and all zones, the body's first; the stored zones repaint when it changes.

## Moves

A move is a deletion and an insertion sharing a `moveId`, each a change of its own in the document; `moved` says both halves are there, and then the pane lists one row, either half settles both (`wholeChanges`) and both draw double. A half whose partner went (its author took the insertion back) is a plain change.

A drop and a chapter moved in the navigator are recorded (`MOVING`, `replayTracked`); text the author inserted moves for real, as it would be deleted. Typing beside moved text is a change of its own. When a document's last blocks move away, the mark before them goes in their stead, since the last block has none. Cut and paste is a deletion and an insertion, as in both word processors.

**DOCX:** `w:moveFrom`/`w:moveTo` inside a `w:moveFromRangeStart`/`w:moveToRangeStart` pair of one `w:name`, which is what pairs them. LibreOffice ignores the move forms in a paragraph mark (probed: its reject leaves the block split), so ours stay `w:ins`/`w:del` under the id of the move's text, and the importer finds the move through that id; Word's, in `w:pPr` ahead of the range, take the range the paragraph opens.

**ODF:** `<loext:move-id>` between `dc:creator` and `dc:date` in the change info, the same number on both halves, from 2 on: LibreOffice reads 1 as a half without a pair and drops it on the way out (probed).

## Reviewing

The pane filters by author, kind and day (`filterRevisions`), a move counting as a kind of its own; with a filter set it accepts or rejects what it shows, in one undo step (`settleRevisions`). The filter is the pane's alone: the page and the ribbon's "all" go on covering everything.

A change can carry a reviewer's comment (`comment` on its mark, paragraph mark or `revFormat`), written on the card. A comment is part of a change: stretches with different ones are different rows. ODF holds it as `text:p` in `office:change-info` after the date, one per line, on either half of a move; LibreOffice saves one more empty, which the import drops (probed). DOCX has no form for it and a block's format change no ODF form, so there it goes on save.

Protecting the changes (`recordLock`, `storage/trackChanges.svelte.ts`) keeps recording on and refuses accepting and rejecting until the password is given, as LibreOffice does; every accept and reject stays clickable and asks for it, lifting the protection and then going through (`whenUnlocked`); the commands refuse, so every way in does. **ODF:** the SHA-256 of the UTF-8 password, base64, as `RedlineProtectionKey` in `settings.xml` (probed; a 20-byte key is an older file's SHA-1). **DOCX:** `w:documentProtection w:edit="trackedChanges" w:enforcement="1"`, without a hash as LibreOffice writes it, so the password stays in ODT; saved as DOCX the lock stands with none, and saved from there as ODT it goes, LibreOffice's stand-in key being one no password opens. A hash in a DOCX file goes back out as read, but no password is checked here. It is a guard against mistakes: the file itself stays open to anyone.

## Comparing

Compare and Merge in the review tab take a file and write what separates it from this document into this one, as one undo step (`editor/compare.ts`): blocks are aligned by kind and text, those between them paired by place, and a pair differs by word. Each hunk goes through `trackedReplace`, so this document's own text and format stay and the recorder's promises hold. **Merge** takes this document as the older one and records under the file's author: accepting gives the file. **Compare** takes the file as the older one, as LibreOffice does, under our author: the same hunks with insertion and deletion swapped (`claimRevisions`), so accepting keeps this document and rejecting gives the file. The file is read as accepted; text struck here does not count.

Only text and structure differ: format does not, so a block differing in that alone is the same, and neither do headers, footers or the notes' text. A table of another shape is replaced whole, as is a long stretch with nothing in common (`MAX_CELLS`). A block without a form for a change, such as an index, passes unrecorded.

## Reading struck text

What reads the document as text reads it as accepting would leave it: formulas and sort keys (`liveText`), find and replace, and typing's word and sentence rules (`typedText`, which keeps offsets). In "Original" find reads the other way round: inserted text is what is gone. Spelling and grammar leave it out, and so do an attached file's text, the running head, a file's or tab's name and an `|outline` link. A copy, and the passage an AI rewrite is sent, is plain text as the view reads it (`copiedSlice`, the `transformCopied` prop), with no record of the changes; a selection wholly inside what would go keeps its text, so a struck word can be reused. What a dialog or a request takes from a selection reads the same way (`shownRange`).

## Views

Word counts (`shownStats`), index rows, the navigator and references (`blockText`) read as the view does: what it hides is not there. The cached rows of an index change on its next update.

A change the view hides, such as a deletion under simple markup, keeps its card beside where it stands, as its bar does; a comment on hidden text has none.

"No markup" and "Original" hide a kind of change with CSS. A block with nothing left, all its text and a paragraph mark on either end being of that kind, goes too (`goneBlocks`, the classes `pm-gone-*`), with a list item holding only it.

A merge whose two sides keep text stays two lines on the page: `display: inline` on both blocks loses alignment, indents and spacing, which belong to the block, and cannot join list items. Accepting and rejecting are right regardless, and the print path really merges: it prints `settledDoc`. The raster PDF copies the page and shows what the page shows.

## Formats

**DOCX:** `w:ins`/`w:del` in `w:pPr/w:rPr`.

**Character format:** DOCX `w:rPrChange`; ODF a `text:format-change` region around the run, with no old values, so rejecting after a reload drops the direct formatting, as in LibreOffice (probed: `old` null). A deleted run's format change goes unsaved in ODF.

**Paragraph mark in a list item:** ODF has no form for a struck mark that joins a paragraph of a list item holding several: the merged paragraph would part into two items on reading, so the mark goes unsaved and the blocks stay as they are.

**Paragraph format:** DOCX `w:pPrChange`. The paragraph mark's run and the flags the package cannot write are outside it, so the importer takes those from the current block. Of list changes only a paragraph made a list has a form (no `w:numPr` in the old properties); any other is saved as done, unrecorded. ODF has no form LibreOffice reads back: the new format is saved, the record is not.

**ODF insertion:** the region runs from a `text:change-start` at the end of one paragraph to the `text:change-end` at the start of the next.

**ODF deletion:** the body holds **one** paragraph with `text:change` where the mark was, and the registry one block per side, the last holding what came after the mark. LibreOffice splits a selection: the region `[tail, empty]` and a second region `[head]`. Over list items the registry wraps both in `text:list`, the body keeps one item. LibreOffice's body keeps the first block's style, or the second's when the first is deleted whole; it loses the other's format on save, while the registry can carry it.

Our export writes LibreOffice's form with each side's real format in its registry block, which is what the import parts the paragraph by (`withParagraphMarks`). A mark across a change of list level (a list and the text beside it, an item and its sub-list) keeps no list side in ODF, as in LibreOffice: that structure survives DOCX only.

`tests/lo-revisions.test.ts` has LibreOffice open what we write for every edit of `tests/trackChangesCases.ts`, accept and reject all, and compares the paragraphs with ours.

## Not recorded yet

An edit the recorder would lose passes unrecorded and logs an error (`keepsEdit`): what accepting the replay leaves is held against what the edit leaves, text, objects and spanned cells, for everything but text replaced within a block, and a replay that changes nothing may only stand for an edit taking out what is gone anyway. The monkey fails on that error.

A table inserted in a list cuts it unrecorded; rejecting the table joins the parts again (`rejoinList`), by their attrs and, for a numbered list, the second part counting on; rejecting anything that cut lists does the same around it (`rejoinCut`). Accepting keeps the cut. A table or list inserted at the document's very end leaves an empty paragraph when rejected, since the last block has no mark of its own. While recording, autolink and the input rules only rewrite what is all new text, as they have no change of their own to go with the typing; over text that was there or is struck, what was typed stays as typed. A list dragged across list levels into a nested item, then joined by Backspace before rejecting, can leave a sub-list under the dropped list's type. A selection reaching from one list into another, dropped into a list, can leave the item after it in the other list when rejected, as the drop's open end took that item in. A paragraph that joined two lists and goes out again leaves the second part of them starting over, as the join kept only the first list's attrs.

Regrouping what is there passes unrecorded (`REBUILDING`, and any transaction outside the history): columns, a split or merged cell, a sort, an index inserted, the columns flow's own cuts. So do what neither format records as a change or this one has no form for: links, bookmarks, comments, a table's own format and header row. A selection an index replaces goes recorded. A merge taking in a cell of only struck text, as of a struck row or column, gives its blocks a struck mark, so they go with the text on accepting. When it takes in a whole table, no cell is left to carry a struck column, and the column stays in the grid.

## Probed for later steps

- **Column in DOCX:** LibreOffice drops `w:cellIns`/`w:cellDel`.

The UNO API removes rows and columns unrecorded; a probe needs the dispatcher. pyuno does not run on macOS here, so the leg and the probes are Basic macros in a fresh profile's `Standard` library.

In a shared session `@` in a comment, reply or chat box offers the people present (`MentionSuggest.svelte`), and the assistant where it is on, so it is never pushed aside; the comment keeps only the text `@Name`, so ODT and DOCX see a typed comment. The one named finds it on their own side (`collab/mentions.svelte.ts`): a comment or reply arriving during the session that names their user name after an `@` (`mentions` in `ai/tools.ts`, the pattern `mentionsAi` uses, any case, whole word) brings a notice leading to it, a marked card until the caret or a click reaches it, and a count in the status bar while the comments pane is shut; a chat message is marked and counted apart. Without accounts nobody absent is told.
