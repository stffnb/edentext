# Footnotes and endnotes

Covers `editor/extensions/notes.ts`, the reservation loop in `pageBreaks.ts`, the
`storage/noteSettings.ts` model, and the ODF/DOCX halves in `export/` and `import/`.

## Model

Three nodes. The anchor rides the text, the note text is a **block**, and every note
lives in the one `noteSection` at the document end (`Document` is
`'(block | textBox | columns)+ noteSection?'`).

| Node | Content | Attrs |
|---|---|---|
| `noteRef` | inline atom | `id`, `kind`, `text` (the resolved label, cached like a Word field's result) |
| `note` | `inline*` | `id`, `kind`, `label` (a mark the file set by hand), `text`, `styleName` |
| `noteSection` | `note+` | — |

**Why the note text is a top-level block and not inline content of its anchor.** Only
then does its DOM hang directly under `.tiptap`, which is `position: relative` — the same
document-px space `pageBreaks.ts` and `.band-layer` already compute in. Inline in the
paragraph, the containing block would be that paragraph, whose own `position: relative`
(the line-height shift) would have to be defeated with an `!important` special case, the
way `editor.css` does for a page-anchored frame. It also makes **endnotes nearly free**:
they simply stay in the flow at the document end.

A note holds one paragraph of inline content. An imported note of several paragraphs is
flattened to hard breaks, exactly as `convertHfZone` does for a header/footer zone.

**The note's own marker is a widget decoration, not generated content.** A CSS `::before`
draws no text node, so it reaches neither the PDF, the clipboard nor a `Range`
measurement — the index draws its leader dots as real characters for the same reason. It
is not document content either: there is nothing to edit, delete or serialize.

**A note carries the file's own paragraph style** as `styleName` → `data-style`, so the
document stylesheet gives it that file's font, size and colour; `editor.css` supplies
LibreOffice's 10pt only for a note that names none. Its **indent** is the exception: a
note style declares a hanging pair (`fo:margin-left` with a negative `fo:text-indent`) and
`ParaProps` has no first-line half, so applying the margin alone would move every note
right by the indent. The hanging pair therefore stays the editor's — see
`tests/render-parity/FINDINGS.md`.

**The sync plugin** (`appendTransaction`) keeps one note per anchor, in anchor order, and
renumbers each class. It runs in two rounds by design — structure first, numbering on the
pass after — because doing both at once would need positions out of a document the same
transaction is still rewriting. An anchor pasted twice gets a fresh id and a clone of the
note it was copied from; an anchor that ends up *inside* a note is dropped, and inserting
one there is refused (LibreOffice and Word refuse it too). A settings change is no
document change, so the dialog's path carries the `RESYNC_NOTES` meta.

## Placement (`pageBreaks.ts`)

A footnote is out of the flow (`position: absolute`, `left`/`right` = the page margins)
and `pageBreaks.ts` gives it its `top`. Endnotes stay in flow and the first one carries
`forceBreakBefore`, because LibreOffice starts the endnote list on a new page (probed).

The reservation runs **inside** one pagination pass — reading it back across passes would
break the file's own rule that a pass must not read its own last answer:

1. `collectLeaves` skips footnote notes and walks the section for the endnotes.
2. Each footnote's height is measured once: out of flow at a fixed width, it does not
   depend on the page it lands on.
3. `placeLeaves(reserved)` takes a per-page reservation off each `contentEnd`. A bounded
   loop (`MAX_NOTE_FIT_PASSES` = 3) re-runs it until the reservation and the pages its own
   anchors land on agree.
4. The anchor's page comes from the leaf that holds it plus the breaks above it: every
   break carries the leaf offset it applies from (`naturalY`), so an anchor below a line
   split follows its half of the paragraph onto the next page.
5. The placements key includes each note's **doc position and top**: without the top a
   frozen layout leaves every footnote on the page it used to belong to, without the
   position an edit above the section leaves the decorations on a stale one.

**Deliberate ceiling:** a note is never split across pages. A page whose notes outgrow its
content area keeps one line of body text and lets them overflow. Splitting the note, as
LibreOffice does, is the upgrade path (`ponytail:` comment at the cap).

## LibreOffice's defaults, as probed

Read out of a document `soffice` saved from a two-note source. These are the editor's
defaults — an editor-only default would land in every imported file as direct formatting.

| | value |
|---|---|
| Footnote numbering | `1, 2, 3`, start 1, **restart: document-wide** (not per page), position: bottom of page |
| Endnote numbering | `i, ii, iii`, start 1 |
| `Footnote` / `Endnote` style | parent `Standard`, 10pt, `fo:margin-left` 0.6cm with `fo:text-indent` −0.6cm (hanging) |
| `Footnote anchor` / `Endnote anchor` | `style:text-position="super 58%"` |
| `Footnote Symbol` / `Endnote Symbol` | empty — the note's own marker is plain text on the baseline, only the anchor is raised |
| `style:footnote-sep` | width 0.5pt, `rel-width` 25%, `adjustment` left, solid, `#000000`, 0.1cm above and below |

Rendered geometry from the same probe: the footnote area is carved out of the **bottom of
the content area**, above the bottom margin; the endnote list starts at the content top of
a fresh page.

**The separator is drawn a pixel wider than it measures.** 0.5pt is 0.66px, which Chromium
rounds away to nothing, so `editor.css` paints it at `max(1px, …)`. The reservation still
uses the true weight — the same thing a hairline border does.

The three separator lengths are registered with `@property … syntax: '<length>'`, so
`getComputedStyle` resolves them to px for the reservation; an unregistered custom
property reads back as the literal `"0.1cm"`. The dialog writes all six onto `:root`.

## ODF (`export/odt.ts`, `import/odt.ts`)

Export follows the text-box hoist: the anchor becomes an `FNT A{i}` sentinel run
(U+E017) and the note is re-emitted as its own top-level paragraph opening with
`FNT B{i}`, so its runs ride **every** existing pass — marks, character styles, links,
bookmarks, fields and formulas included. `applyNotes` runs last of the content.xml passes
and cuts each region back out into

```xml
<text:note text:id="ftn1" text:note-class="footnote">
  <text:note-citation>1</text:note-citation>
  <text:note-body><text:p text:style-name="Footnote">…</text:p></text:note-body>
</text:note>
```

`rewriteStylesXml` writes the six named styles, a `<text:notes-configuration>` per class,
and `<style:footnote-sep>` into the page layout. ODF counts `text:start-value` from 0, so
the first note carries `startAt - 1`. Import mirrors all of it;
`StyleResolver.noteSettings()` reads the configuration back.

## DOCX (`export/docx.ts`, `import/docx.ts`)

The `docx` package carries both parts natively (`footnotes`/`endnotes` maps plus
`FootnoteReferenceRun`/`EndnoteReferenceRun`), so no post-pack pass is needed for the
notes themselves — each class counts from 1, because each has its own part. Import parses
`word/footnotes.xml` and `word/endnotes.xml`, **skipping the entries that carry a
`w:type`**: those are Word's separator and continuation-separator notes, referenced from
nowhere. Word opens a note with its own marker run and a tab; the leading tab is stripped,
since the editor draws the marker and the indent from the note's own style.

The numbering settings ride `<w:footnotePr>`/`<w:endnotePr>` in `word/settings.xml` — a
post-pack pass beside `applyMirrorMarginsDocx`, as the package exposes neither. Word's
`eachSect` is ODF's `chapter`; the separator is not Word's to describe (it draws a fixed
one), so it keeps the editor's.
