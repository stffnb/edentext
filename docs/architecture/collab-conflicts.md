# Concurrent edits

What two clients end with when each does one thing to the same paragraph, table, recorded
change or comment before hearing of the other's. `node tests/collab/conflicts.mjs` (in
`test:collab`) runs every pair below; its expected values are today's behaviour, so a
change to any of them fails the run. Measured 2026-11-10 in Chromium, Firefox and WebKit.

## Why it happens

Yjs merges text character by character, but y-tiptap cannot move or retype a node: a block
that changes type (heading, list item), moves, joins another, or a table rebuilt (merge,
sort) is deleted and inserted anew. Text the other client types into the deleted element
at that moment stays in the deleted element and is gone. A's undo then brings back only
A's own deletion, not B's text. An inline node (footnote anchor, picture) or Enter splits
the paragraph's `Y.XmlText`; the part after the cut is a new one, so B's text typed there
lands at the cut. Attributes (style, alignment, indent, marks) change in place and keep
everything.

Tables: each client's `fixTables` (prosemirror-tables) repairs a ragged table on its own,
and two repairs of the same table collide. Whether that settles after a few updates or
keeps going (each round widening a row) depends on timing.

## Matrix

Columns as the test checks them. **same**: both docs and fragments equal. **valid**:
`doc.check()`, rectangular tables, notes numbered 1…n. **clean**: applying the other's
update did not throw. **kept**: B's text at its place (A's deliberate deletion excepted).
**quiet**: no update after the exchange. **undo**: A's undo leaves both at B's doc alone.
`~` varies between runs. Severity: high = silent loss, medium = wrong place or traffic,
low = cosmetic.

| A | B | same | valid | clean | kept | quiet | undo | Severity |
|---|---|---|---|---|---|---|---|---|
| types elsewhere in the paragraph (control) | types | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| splits it before B's place (Enter) | types | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | medium |
| splits it behind B's place | types | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| joins it to the one before (Backspace) | types | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | high |
| makes it a heading / a heading a paragraph | types | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | high |
| makes it a list item, indents / outdents it there | types | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | high |
| other paragraph style, alignment, indent | types | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| drags it below the next one | types | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | high |
| deletes it whole | types | ✓ | ✓ | ✓ | (✓) | ✓ | ✗ | low |
| puts a footnote / a picture in it | types | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | medium |
| comments a word / Replace All of a word | types | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| inserts a column | inserts a row | ~ | ✓ | ✓ | ✓ | ✗ | ✗ | medium |
| deletes a row / a column / the table | types in it | ✓ | ✓ | ✓ | (✓) | ✓ | ✗ | low |
| merges two cells | types in one | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | high |
| merges cells | merges overlapping ones | ~ | ✓ | ✓ | ~ | ✗ | ✗ | medium |
| widens a column | inserts one | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| sorts the table | types in a cell | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | medium |
| accepts / rejects a change, accepts all | types in it / records | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| deletes a comment | answers it | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | low |
| updates the TOC | edits a heading | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | low |
| adds the document's first footnote | adds one before it | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | high |
| adds a footnote (one exists) | adds one before it | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | low |
| offers its state later than 300 ms (P3) | asks to sync | – | – | – | – | – | – | medium |
| loses its line without a close (P8) | – | – | – | – | – | – | – | medium |

What B sees on screen, per red field:

- **Join, heading, list, indent/outdent in a list, drag:** B's last words in that paragraph
  vanish without a hint; the paragraph shows A's version, and B's caret jumps to a
  neighbouring paragraph, where B's next keys land. Undo on either side does not bring
  the words back.
- **Enter before B's place, footnote or picture inserted before it:** B's words jump to the
  cut (end of the first half, beside the anchor or picture).
- **Delete paragraph, row, column, table:** wanted loss; B's caret lands in the next
  block. A's undo restores the old content without B's typing.
- **Column and row inserted at once:** both repair the table; extra empty cells appear, and
  sometimes the repairs keep going, a column wider each round, until someone edits.
- **Merge while B types in a merged cell:** B's words in that cell vanish. Overlapping
  merges lose one cell's text in some runs and race like the column case.
- **Sort while B types:** B's words end up in whatever row now sits where B's cell was.
- **Delete comment vs answer:** the comment comes back with the answer (no text lost; A's
  deletion is undone). A's undo then adds the comment a second time over it.
- **TOC:** the index shows the heading as it was when A updated, as it would alone; an
  index update is off the undo stack alone too.
- **First footnote on both sides:** each makes a notes section; the second is invalid and
  y-tiptap deletes it, so one footnote is gone and the binding throws a `RangeError`
  (`restoreRelativeSelection`) while applying the update.
- **Footnote with one already there:** both renumber, a few repair updates follow and
  settle; A's undo then takes back the renumbering, not A's footnote.
- **P3, P8** are the sync's (`collab.md`, Gaps) and are fixed in R1: a late offer waits
  for the next sync; a dead line keeps showing `live`.

## Recommendations

Not yet decided by the user; nothing below is built.

| Conflict | Recommendation | Effort | Long-term best |
|---|---|---|---|
| Block change, drag, join, merge cells, sort (high) | fix | 3–5 days | A rescue on the author's side: after a remote update, own text inserted in the last seconds whose element the update deleted goes into the element that replaced it (matched by the deleted element's text). Only the author moves it, so nothing races; one mechanism covers every delete-and-insert. A hint at the other's caret while converting is a cheap first step, not a fix. |
| Displaced text (Enter, footnote, picture) | fix with the rescue | +1 day | The same rescue keyed on the left neighbour's successor instead of the parent. |
| Table repair race | fix | 1–2 days | No `fixTables` for remote transactions; one deterministic normaliser (pad short rows at the end, never drop content) run by one client, the lowest client id present, so repairs cannot collide. |
| First footnote on both sides | fix | 1 day | One notes section by construction: merge a second section into the first in the notes plugin, deterministically; catch the binding's `RangeError` and report y-tiptap's `restoreRelativeSelection` upstream. |
| Footnote renumbering after the exchange | fix later | 1–2 days | Numbers derived when drawn (decorations), not stored in the doc in a session, so there is nothing to repair. |
| Delete vs typing (paragraph, row, column, table) | accept | – | The deletion was meant; the caret moving away shows it. |
| Comment deleted vs answered | accept | – | Nothing is lost; deleting again works. |
| TOC stale | accept | – | Same as alone; the next update fixes it. |
| P3, P8 | in R1 | – | – |
