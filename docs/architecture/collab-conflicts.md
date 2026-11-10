# Concurrent edits

What two clients end with when each does one thing to the same paragraph, table, recorded
change or comment before hearing of the other's. `node tests/collab/conflicts.mjs` (in
`test:collab`) runs every pair below; its expected values are today's behaviour, so a
change to any of them fails the run.

## Why it happens

Yjs merges text character by character, but y-tiptap cannot move or retype a node: a block
that changes type (heading, list item), moves, joins another, or a table rebuilt (merge,
sort) is deleted and inserted anew, a copy of the text its author saw. Text the other client
types into the deleted element at that moment stays in it and would be gone. An inline node
(footnote anchor, picture) or Enter splits the paragraph's `Y.XmlText`; the part after the
cut is a new one, so text typed there would stay at the cut. Attributes (style, alignment,
indent, marks) change in place and keep everything. Three mechanisms handle what follows.

### Rescue (`editor/yjsRescue.ts`)

After each update from another client, each client looks for its own text the update took
away (its block deleted) or left behind (the text on both sides gone, the run still there)
and puts it where the update put the text around it: the place in the update's new text
whose 40 characters before and after match best, at least three of them, one new. Only the
author of the text moves it, so nothing races; the move goes into the shared doc as an
ordinary edit outside the history, and its characters join the undo step that typed them.
A text the update rewrote in place (a sort) counts one side gone at its start or end. A
block of nothing but the client's text goes beside the rebuilt block that held what stood
beside it. A block an undo kept only for the rescued text (the deleted block still held
another client's text) is dropped once the text has left it, in a transaction of its own:
y-tiptap writes a multi-block change as a rebuild of its neighbours. The caret moves along.
No match, no move: a block deleted outright stays deleted, typing and all.

### Repairs (`editor/yjsRepair.ts`)

y-tiptap applies another client's update (or an undo) inside its mutex, so what the plugins'
`appendTransaction` repairs after it (table cells, note order and numbers, list starts)
stayed local: the editors drifted apart over the same Yjs body, and a later local edit sent
the repair under its own author. Now a microtask after such a transaction writes the
document into the fragment, with a client id hashed from the Yjs state (state vector and
delete set) and the document: two clients repairing the same state write the same items,
and Yjs keeps one. Repairs therefore have to depend on the document alone. The id's low
byte (`0xa5`) marks it; an update holding only repair items gets no repair in reply, which
bounds two clients whose repairs differ (a value read from their own settings) to one round.
`holdsForeign` (the undo's delete filter) ignores repair items. A table row longer than most
loses empty cells past that width (`tableRepair.ts`) before prosemirror-tables' `fixTables`
pads the short ones, so a column undone after another's row went in leaves no extra column.

The notes plugin runs its passes (one section, anchor order, numbers) to a fixed point in
one appended transaction: ProseMirror hands a plugin's appended transaction to the other
plugins only. The document admits note sections anywhere (`extensions.ts`), so two first
notes added at once make two sections Yjs can hold; the plugin merges them into one at the
end. Before, the second section did not fit the schema: y-tiptap's projection left it out,
positions computed on the fragment fell beyond the document (`RangeError` in
`restoreRelativeSelection`), and the next local edit deleted it with its note.

### Binding guard

y-tiptap restores the caret by walking the fragment; where the document drawn from it
differs, a position falls outside it and the whole update would be lost to the throw.
`attachRepair` wraps the binding's observer: a `RangeError` there redraws the document from
the fragment (`_forceRerender`) and logs `collab: caret not restorable`. The soak run counts
those lines.

## Matrix

Columns as the test checks them. **same**: both docs and fragments equal. **valid**:
`doc.check()`, rectangular tables, notes numbered 1…n. **clean**: applying the other's
update did not throw. **kept**: B's text at its place (A's deliberate deletion excepted).
**quiet**: no update after the exchange. **undo**: A's undo leaves both at B's doc alone.
`~` varies between runs. Measured 2026-11-10, Chromium; Before is R3's measurement.

| A | B | same | valid | clean | kept | quiet | undo | Before |
|---|---|---|---|---|---|---|---|---|
| types elsewhere in the paragraph (control) | types | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| splits it before B's place (Enter) | types | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | kept ✗ |
| splits it behind B's place | types | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| joins it to the one before (Backspace) | types | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | kept, undo ✗ |
| makes it a heading / a heading a paragraph | types | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | kept, undo ✗ |
| makes it a list item, indents / outdents it there | types | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | kept, undo ✗ |
| other paragraph style, alignment, indent | types | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| drags it below the next one | types | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | kept, undo ✗ |
| deletes it whole | types | ✓ | ✓ | ✓ | (✓) | ✓ | ✗ | accepted |
| puts a footnote / a picture in it | types | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | kept ✗ |
| comments a word / Replace All of a word | types | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| inserts a column | inserts a row | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | same ~, quiet, undo ✗ |
| deletes a row / a column / the table | types in it | ✓ | ✓ | ✓ | (✓) | ✓ | ✗ | accepted |
| merges two cells | types in one | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | kept, undo ✗ |
| merges cells | merges overlapping ones | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | same ~, kept ~, quiet, undo ✗ |
| widens a column | inserts one | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| sorts the table | types in a cell | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | kept ✗ |
| accepts / rejects a change, accepts all | types in it / records | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| deletes a comment | answers it | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | accepted |
| updates the TOC | edits a heading | ✓ | ✓ | ✓ | ✓ | ~ | ✗ | accepted |
| adds the document's first footnote | adds one before it | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | clean, kept, quiet ✗ |
| adds a footnote (one exists) | adds one before it | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | quiet, undo ✗ |

## Accepted

- **Delete vs typing** (paragraph, row, column, table): the deletion was meant; B's caret
  lands in the next block, which shows it. A's undo restores the old content without B's
  typing.
- **Comment deleted vs answered:** the comment comes back with the answer (no text lost; A's
  deletion is undone). A's undo then adds the comment a second time over it; deleting
  again works.
- **TOC:** the index shows the heading as it was when A updated, as it would alone; an
  update still running when B's edit arrives takes it in (one more update, so quiet varies).
  An index update is off the undo stack alone too.

## Limits

- **Overlapping merges** keep every text and settle on one rectangular table, but A's undo
  cannot give back B's merge of a cell A's merge deleted.
- **Rescue placement** is by text: where the update's new text repeats the run's
  surroundings more than once, the first best match wins.
- **Derived values read from a client's own state** (notes counted per page, from that
  client's pagination) can differ between clients; the repair rule above stops the replies
  after one round, and the editors can then show different numbers until the next edit.
