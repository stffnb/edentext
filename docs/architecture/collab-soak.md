# Shared sessions under load

What random editing by several clients at once finds, and how typing feels while others
type. Session design: `collab.md`; concurrent edits to one place: `collab-conflicts.md`.

## Soak run

`node tests/collab/soak.mjs` (the last part of `test:collab`) starts the relay and the dev
server, opens a corpus document on the starter and lets three more clients join by the link.
Each round, every client draws `SOAK_OPS` ops from the monkey run's table
(`tests/monkey/ops.mjs`: typing, keys, marks, block styles, lists, tables, notes, frames,
columns, undo) at once. Every typed word carries its client's own letter (α, β, …), so the
run can count whose text is where. Between rounds one of these happens, drawn from the seed:

- the relay delays every frame by 0–250 ms, in order per sender (`startRelay`'s `lag`), so
  senders overtake each other;
- a client's line is cut for 2–5 s, or goes deaf without a close until the client notices,
  and it keeps editing meanwhile;
- a client reloads and joins again, or leaves and a new one joins.

After each round, once all are live and nobody has sent an update for a second: every client
holds the same document, the same map `state` and the same page count; the session then
stays silent for 3 s; every document passes `doc.check()` and every table is rectangular;
no page threw. At the end the starter's `.odt` reads back (the monkey run's comparison), and
each client in turn undoes all its steps and redoes them: no word of another's letters goes,
its own are gone, and redo gives the document back. A word is its stem: from the letter back
to a space or any client's letter, as the text after it is someone else's; it is lost where
it occurs nowhere after the undos (fewer copies are no loss; both documents go to
`soak-<seed>-<round>-lost.json`). A cycle that leaves more of another's letters is one
finding, `copied`, with its document diff.

A finding that matches an accepted conflict (`collab-conflicts.md`) is printed as `known` and
the run goes on; anything else fails it. A finding that leaves the clients apart restarts the
session from the starter's document, so one finding does not hide the next. Known are: text
typed into what another deleted (a selection typed over, Backspace or Delete, a row, column or
table), and undo after such a deletion, after a block another client rebuilt (the copy is
its maker's, so the typist's undo no longer reaches what it holds) or after the columns flow
rewrote text (as alone: the monkey run leaves the history unchecked there). Any throw is new;
the binding's redraw after a caret it could not restore (`collab: caret not restorable`) is
counted and printed, not failed.

By default the run leaves out the deleting ops and the columns flow, so only new findings
show and `test:collab` stays green on them; block styles, lists, Enter, notes, pictures,
formulas, text boxes, breaks and table structure are drawn. `SOAK_SKIP=none` draws every op
and classifies. Further: `SOAK_SEED`, `SOAK_CLIENTS` (4), `SOAK_ROUNDS` (4), `SOAK_OPS` (8 per client and
round), `SOAK_DOC`, and for the long run `SOAK_RUNS` seeds within `SOAK_MINUTES`. A seed
fixes every client's ops and the disruptions, not their timing, so a failing seed shows the
same ops but may not fail again. Diverged documents and the ops of the round go to the OS
temp dir (`soak-<seed>-<round>-*.json`).

### Findings (2026-11-10, Chromium)

About 140 rounds with four clients: two 13-minute runs (seeds 11–17 with every op, 21–28
without the known ones), a 10-minute one (31–36, the harness fixed below) and short ones.
New, beyond the matrix:

- **Pagination after others' edits (fixed).** Every arriving batch ran a full pagination
  pass at once; see the numbers below. Now it waits like a typed edit, at most 1 s
  (`pagination.md`).
- **RangeError in `restoreRelativeSelection` without a footnote** (fixed): six undos threw
  `Position N out of range` from y-tiptap's `restoreRelativeSelection`, and three rounds
  raised it uncaught. The binding computes the restored caret against the Yjs fragment, so a
  document drawn differently from it (a note section the schema refused, a repair kept
  local) puts positions outside; both causes are gone and a throw left redraws instead
  (`collab-conflicts.md`, Binding guard).
- **A derived attr apart over the same Yjs body** (fixed): once a note's label (`text`)
  stayed `""` on one client and `1` on three, with all four Yjs bodies equal. A plugin's
  `appendTransaction` after a remote transaction ran inside y-tiptap's mutex, so its fix
  stayed local; the repairer now writes them (`collab-conflicts.md`, Repairs).
- **Undo after a split** is the matrix's displacement seen from the other side: text that
  Enter, an inline node or typing over a selection moved into a new element belongs to that
  element's author, so its writer's undo leaves it. Text the other author had not seen is
  rescued into the step that typed it (`collab-conflicts.md`); text it had seen is part of
  its copy, which the run classifies as known. Without these ops 36 rounds (1152 ops, every
  disruption) ended with each client's undo and redo exact.
- **An undo takes others' text** (fixed; seeds 2 and 3, 2026-11-10). Two causes: (1)
  undoing an inserted footnote removed its anchor while the note held another client's
  text, and the notes repair dropped the orphaned note with it; the anchor now stays. (2)
  Yjs's undo puts deleted text back as the undoer's own items, so a later undo of the step
  that made the block (an Enter before a heading rebuild) deleted it with the other's text;
  restored copies now keep their original author (`collab-conflicts.md`, Repairs). (3)
  Seed 1 (merged branches, 1 run in 3): an undone heading rebuild restored the undoer's
  tab and another's text as one merged item, which the tab's undo deleted whole; fixed.
  Seed 3's remaining `lost` was a miscount: an undo took duplicates that an earlier
  client's undo and redo made of a block two clients rebuilt; no word went. That
  duplication now shows as `copied`, known while two rebuilds of one block leave two copies.
  Seed 4's `lost` (2026-11-11) was one too: the words counted were whitespace tokens, which
  the undoer's own text beside a word changed (`nipsmβ<textBox>` → `nipsmβostrud`); every
  stem of the others was still there. Hence the stems.
- **Editing paused after an undo** (fixed; seed 3, 2026-11-11): `Invalid content for node
  bulletList: <>` on the undoing client only, as its undos ran in one task and the others
  got the end state. An undo took the last item of a list it had added to, after another
  client took the list's other items out; the list stayed, empty. It now goes with its
  last item (`collab-conflicts.md`, Repairs).
- **Read-back** (low): the starter's `.odt` twice read back a mark spelled otherwise:
  `Liberation Serif` against `Times New Roman` (the monkey run lists that one as open) and
  `rgb(192, 0, 0)` for `#C00000`, a colour taken from the DOM somewhere in a session.

After the fixes (2026-11-10, Chromium, seed 1, rebuilding ops drawn): four rounds, 128 ops,
every round one document, quiet, valid, no throw and no redraw; four undo findings, all
after a block another client copied. The starter's `.odt` read back a link mark (autolink
on typed text) without its `target`, a read-back gap of its own.

Found and fixed in the harness: cutting the line also closed the dev server's socket, whose
client then reloaded the page (a joiner's editor and undo history gone mid-round). Known
conflicts showed as expected: undo after the columns flow or a rebuilt block, text lost in a
joined or rebuilt block, and the table repair.

## How typing feels

`node tests/collab/fluency.mjs` (Chromium; `FLUENCY_CLIENTS`, `FLUENCY_DOCS`) opens a short
document (`02-blocks`), one with pictures and tables (`docs/showcase/newsletter.odt`) and a
long one (`05-breaks` × 100, 177 pages), shares it and lets client A type 80 keys at about
eight a second, every eighth a `#`, while the others type about five characters a second
each, one above A and the rest spread over the document. In A's tab it times every dispatch
(own keys and others' updates apart), every frame callback by name (`calculate` is the
pagination pass) and the gaps between frames; B notes when each `#` arrives and when the
next frame shows it. Then A writes a line above B's caret. `FLUENCY_MINUTES` instead lets
four clients type for that long and prints the tabs' heap after a collection and the size of
the Yjs document every minute.

All clients run as tabs of one browser on one machine (M1, 8 cores, 8 GB), so with four and
six the others' work competes with A's for the processor: those rows are worse than one
person per machine would see, on the long document by a lot.

Measured 2026-11-10, Chromium 156, dev server. Keystroke: the synchronous dispatch of one
of A's keys, median / p95 in ms. Remote: applying one arriving batch in A's tab. Shown: from
the key at A to the frame that shows it at B, median (p95). Gap: the longest stretch without
a frame in A's tab, ms.

| Document | Clients | Keystroke | Remote | Shown | Gap |
|---|---|---|---|---|---|
| short, 1 page | 1 / 2 / 4 / 6 | 1.0 / 0.9 / 0.9 / 1.0 (p95 ≤ 2.2) | – / 1.0 / 1.0 / 1.5 | – / 112 / 111 / 111 (≤ 150) | 17 / 17 / 33 / 50 |
| pictures and tables, 2 pages | 1 / 2 / 4 / 6 | 2.2 / 2.1 / 1.9 / 2.6 (p95 ≤ 6) | – / 2.9 / 3.6 / 7.7 | – / 115 / 99 / 145 (≤ 179) | – / 17 / 17 / 83 |
| 177 pages, before the fix | 1 / 2 / 4 / 6 | 4.4 / 10.8 / 24 / 51 | – / 12.6 / 60 / 79 | – / 578 / 1568 / 5798 | 150 / 683 / 2183 / 10233 |
| 177 pages | 2 / 4 / 6 | 9.0 / 22 / 62 (p95 14 / 36 / 387) | 11.3 / 25.5 / 100 | 219 / 635 / 5092 | 700 / 1267 / 5700 |

What it means, against about 16 ms per key for a visible stutter and 50 ms for sluggish:

- Short and mixed documents stay far below both with six clients. Others' text shows after
  about 110 ms: two 50 ms batches (sender and receiver) and the relay. The first frame gap
  of 2.7 s with one client on the mixed document is its pictures decoding after the load.
- On 177 pages a key alone costs 4.4 ms; with one other typist 9 ms, with three 22 ms
  (stutters), with five 62 ms. Pagination was the largest part: before the fix every batch
  ran a pass of its own (228 passes, 50 ms each, 11 of 14 s of the main thread with two
  clients); now 138 passes of 19 ms. The rest is y-tiptap: applying a batch rebuilds the
  changed top-level blocks from the fragment (11–25 ms), and every own key is mirrored into
  the fragment (the 7 against 4.9 ms in `collab.md`).
- The rows for four and six on 177 pages include the other tabs' pagination on the same
  processor; per person on their own machine the cost is nearer the two-client row plus the
  extra arriving batches.
- B's caret never moved to other text. Text written above it on the same page moved it down
  one line (26 px) on screen; the view does not hold B's line in place, and it never
  scrolled.
- Memory, four clients typing for ten minutes on the short document (11,000 characters,
  4 pages): each tab's heap after a collection went from 39–40 to 44–50 MB, the Yjs
  document (`encodeStateAsUpdate`) from 18 to 52 kB, about 3 bytes per typed character.
  Nothing there grows out of proportion.

The range-limited plugins from `perf/keystroke-cost` read `changedRanges` (the steps'
maps), which holds for y-tiptap's single `ReplaceStep` too. That step reaches
from the first to the last top-level block a batch changed, though, so with typists far
apart the range covers most of the document between them and the saving shrinks.

Not measured: Firefox and WebKit, IME, a machine per client.

## MAX_PEERS

Default **6** (decided 2026-11-10). Four people were soaked and six measured: on short and
mixed documents six stay fluent, and a limit above four leaves room for a reload or a second
tab, each a connection of its own until the old one closes. On long documents typing slows
from the second client on whatever the limit; a smaller limit would not help there, a cheaper
remote apply and pagination would.
