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
each client in turn undoes all its steps and redoes them: the others' letters stay, its own
are gone, and redo gives the document back.

A finding that matches a known conflict (`collab-conflicts.md`, R3) is printed as `known` and
the run goes on; anything else fails it. A finding that leaves the clients apart restarts the
session from the starter's document, so one finding does not hide the next. Known are: a
RangeError from `restoreRelativeSelection`; a table repaired on both sides (traffic while
idle, or documents apart over the same Yjs body, after a row, column or merge op); undo
after a block rebuilt, split, joined or deleted, or after the columns flow rewrote text (as
alone: the monkey run leaves the history unchecked there). Any other throw is new.

By default the run leaves out every op behind those conflicts (block styles but Standard and
Quotations, lists and indents, Enter, Backspace, Delete, Tab, selections typed over, notes,
pictures, formulas, text boxes, breaks, table structure, columns), so only new ones show
and `test:collab` stays green on them; `SOAK_SKIP=none` draws every op and classifies.
Further: `SOAK_SEED`, `SOAK_CLIENTS` (4), `SOAK_ROUNDS` (4), `SOAK_OPS` (8 per client and
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
- **RangeError in `restoreRelativeSelection` without a footnote** (high): six undos threw
  `Position N out of range` from y-tiptap's `restoreRelativeSelection`, and three rounds
  raised it uncaught, none with a note on both sides. The site is R3's; the trigger is
  wider: the binding computes the restored caret against the Yjs fragment while the
  ProseMirror document differs from it. Catching it there, as R3 recommends, covers both.
- **A derived attr apart over the same Yjs body** (medium): once a note's label (`text`)
  stayed `""` on one client and `1` on three, with all four Yjs bodies equal. Likely cause,
  not yet reduced: a plugin's `appendTransaction` after a remote transaction runs inside
  y-tiptap's mutex, so its fix stays local; that would hold for every such repair.
- **Undo after a split** is the matrix's displacement seen from the other side: text that
  Enter, an inline node or typing over a selection moved into a new element belongs to that
  element's author, so its writer's undo leaves it. The default skip list holds these ops
  since; without them 36 rounds (1152 ops, every disruption) ended with each client's undo
  and redo exact.
- **Read-back** (low): the starter's `.odt` twice read back a mark spelled otherwise:
  `Liberation Serif` against `Times New Roman` (the monkey run lists that one as open) and
  `rgb(192, 0, 0)` for `#C00000`, a colour taken from the DOM somewhere in a session.

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

`perf/keystroke-cost` is not on this branch. Its range-limited plugins read `changedRanges`
(the steps' maps), which holds for y-tiptap's single `ReplaceStep` too. That step reaches
from the first to the last top-level block a batch changed, though, so with typists far
apart the range covers most of the document between them and the saving shrinks.

Not measured: Firefox and WebKit, IME, a machine per client.

## MAX_PEERS

Proposal: **6**, the user decides. Four people were soaked and six measured: on short and
mixed documents six stay fluent, and a limit above four leaves room for a reload or a second
tab, each a connection of its own until the old one closes. On long documents typing slows
from the second client on whatever the limit; a smaller limit would not help there, a cheaper
remote apply and pagination would.
