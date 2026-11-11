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
and puts it where the update put the text around it, only where the update clearly rebuilt
that text: in the update's new text, each side of the run's 40 characters of context
matches whole or up to where that text starts or ends (a cut), one side whole, at least
eight characters (fewer where the context is shorter), one of them new. A replacement's
text (typing or pasting over a selection) matches only by chance and in part, so the run
stays deleted with the text it replaced. A text the update rewrote in place (a sort) counts
one side gone at its start or end. A block of nothing but the client's text goes beside
the rebuilt block that held what stood beside it. No match, no move.

Only the author of the text moves it, so nothing races. The move runs in a microtask, after
the repairer's write of the same update's repairs (Yjs calls the observers that queue it
before `afterTransaction`); elsewhere it is rebased past the overlay like any local edit.
Not while an input method composes (it waits for `compositionend`). Each part of the run typed in one undo step goes in a
transaction of its own outside the history, and only the items it wrote into the target
text (or the block it made) join that step: undoing the newest step takes its part alone,
and nothing else joins it. The left-behind run is then deleted, and a block an undo kept
only for it (the deleted block still held another client's text) is dropped in a
transaction of its own: y-tiptap writes a multi-block change as a rebuild of its
neighbours. The caret moves along. Own text means this client id's: text typed before Yjs
reassigned the id, or in an earlier session, is no longer rescued; another client's text
that this client's undo or redo put back stays the other's (below).

### Repairs (`editor/yjsRepair.ts`)

y-tiptap applies another client's update (or an undo) inside its mutex, so what the plugins'
`appendTransaction` repairs after it (table cells, note sections, order and numbers, list
starts) is not written. Every client draws it; one, the **repairer**, writes it. The others
keep it as an overlay: the plugin `collabRepair` holds the shared doc as this client knows
it (`base`), and y-tiptap's write after a local edit gets `base` with the edit's steps
moved onto it (rebased as `prosemirror-collab` does), never the overlay. The repairer's
version arrives as an update, the redraw takes the overlay away and nothing is left to
repair. So each repair is written once, under a real client id, in a transaction of its
own (`REPAIR_ORIGIN`, outside every undo stack), and per-client inputs (notes counted per
page from one's own pagination) stay local instead of answering each other.

- **Who repairs.** In a session the client bound longest: `rank` in the awareness, 0 for
  the starter, one past every rank a joiner sees, the id breaking ties. The role moves only
  when its holder's awareness goes; the next one then writes what it holds. Alone, and in
  the scripts' pairs, the first client. A client goes from everyone's awareness when the
  relay sees its line end (`gone`); a presence merely late (a busy tab) drops no one, as
  that would leave two clients repairing until it comes.
- **An edit into the overlay** (typing in a cell only the overlay pads) cannot be moved
  onto `base`, so it is **held** (`held` in `collabRepair`): drawn at once, with every later
  edit of this client behind it in order, but not written. After the next redraw the held
  steps are moved onto the new doc: written if what they reached into is shared now, held
  again if not, dropped with `collab: edit inside a repair not yet shared, lost` where they
  no longer fit, and a notice beside the status bar tells the typist (`dropped`). A client that becomes the repairer while holding writes the repair under
  `REPAIR_ORIGIN` and its held edits as its own, undoable. Writing a held edit at once
  would bring the repair twice; holding it keeps one writer per repair and the caret where
  it was. A repair after one's own edit is part of that edit, as alone.
- **Moves.** A move is a rewrite in Yjs, so the notes plugin moves as little as it can:
  the fullest note section stays, the others' notes join it, blocks past it go ahead of it,
  and anchor order keeps the longest run of notes already in order. What is typed into a
  moved note meanwhile is the rescue's.
- `holdsForeign` (the undo's delete filter) counts another client's text and inline
  objects, not its empty elements, so a padding cell keeps no row of an undone insert.
  Yjs puts what an undo or redo restores back under the undoer's id; `Authors` follows
  each restored item's `redone` copy and keeps the copy's range as its author's, so a later
  undo (an Enter before a rebuilt block) still leaves the other's text in place.
  An undo that takes the last items of a list, table or note section whose others another
  client took out takes the emptied element along (no empty one fits the schema, and the
  binding would pause everywhere); one that would leave a parent holding a misfit keeps
  its item.
  Yjs merges adjacent copies into one item and, following a copy, deletes to the item's
  end; the filter first splits at the copy's end, so undoing a tab typed just before the
  other's text, both restored by an undone rebuild, takes the tab alone.
- A footnote anchor whose note holds another client's text survives its author's undo, as
  the notes repair would drop the note, and that text, without it.

A table row longer than most loses empty cells past that width (`tableRepair.ts`) before
prosemirror-tables' `fixTables` pads the short ones, so a column undone after another's row
went in leaves no extra column. The notes plugin runs its passes to a fixed point in one
appended transaction: ProseMirror hands a plugin's appended transaction to the other
plugins only. The document admits note sections anywhere (`extensions.ts`), so two first
notes added at once make two sections Yjs can hold and the projection keeps.

`collab-repair.test.ts` relays three clients' conflicting edits (a column and a row, two
first footnotes, typing) in random orders: one doc everywhere, the repairs in it once, and
nothing written by any client but the repairer after its own edits. Typing into a cell
only the overlay pads shows at once and arrives once, whether the repairer writes or B
takes over from one that is gone; B's undo takes back the text and keeps the cell.

### Binding guard

Shared content that does not fit the schema pauses the binding (y-tiptap's
`onInvalidContent`) instead of y-tiptap deleting it from the shared doc: no edits, no
writes, `collab: paused`, until an update fits again (`collab: resumed`).
`YjsUndo.onPause` tells the session, whose `paused` turns the status bar's session button
into "Editing paused" and adds a notice to its dialog, both gone on resuming. y-tiptap
restores the caret by walking the fragment; where a position falls outside, the update
would be lost to the throw. `attachRepair` wraps the binding's observer: a `RangeError`
there redraws the document from the fragment (`collab: caret not restorable`), and a
redraw that is not the fragment's projection, or not valid, pauses the binding the same
way. The soak run counts redraws and fails on a pause; `session.mjs` puts an unknown
element into the body and sees both clients' notices come and go.

### Restored items (`editor/yjsRedo.ts`)

Yjs 13.6.33's undo traces a restored item's left and right neighbours separately through
the copies earlier undos made (yjs#823, open). After a copy was split, both can reach one
item, so the restored item gets an origin right of its right origin: the undoing client
placed it after `left`, every peer and a reload of its own state elsewhere. A's undo of a
join after a split's undo gave `…lazy dog.` on A and `…lazy og.d` on B, the same state
vectors and delete sets, with `gc` off too. `yjsRedo.ts` wraps `Item.integrate` in undo
transactions: if `right` is not reachable from `left`, the item goes directly after `left`
(the fallback proposed upstream, PR #795), which every replica decodes alike.

## Matrix

Columns as the test checks them. **same**: both docs and fragments equal. **valid**:
`doc.check()`, rectangular tables, notes numbered 1…n. **clean**: applying the other's
update did not throw. **kept**: B's text at its place (A's deliberate deletion excepted).
**quiet**: no update after the exchange but the repairer's (A's) one. **undo**: A's undo
leaves both at B's doc alone (in the B's undo rows, B's undo takes its last step alone).
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
| types over the end of the one before and it | types | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | text injected |
| pastes over the end of the one before and it | types | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| makes it a heading / splits it; B's undo | types twice | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
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

- **Delete vs typing** (paragraph, row, column, table, typing over a selection that ends in
  it): the deletion was meant; B's caret lands in the next block, which shows it. A's undo restores the old content without B's
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
- **Two rebuilds of one block at once** (both make it a list item, say) leave a copy
  each, with the text in it; an undo takes back its maker's copy and leaves the other.
- **Rescue placement** is by text: where the update's new text repeats the run's
  surroundings more than once, the first best match wins.
- **Typing over a range the other client's paste rewrote in place:** y-tiptap writes the
  pasted paragraph into the old one by a prefix/suffix diff, so B's typing is not deleted
  but stays where Yjs merges it among A's new characters (`TZedwo lazy days.`), as with any
  concurrent typing into a replaced range. The rescue leaves it there.
- **Waiting for the repairer.** Until its version arrives (one relay round; once the relay
  sees its holder's line end, up to awareness's 30 s if the relay still counts a frozen tab)
  an edit inside the overlay is held: shown, not yet sent, and this client's later edits
  wait behind it.
- **Derived values read from a client's own state** (notes counted per page, from that
  client's pagination) can differ between clients: the shared doc holds the repairer's,
  each editor shows its own, and a client's edit writes its own with it.
