# Collaboration

Shared editing runs on Yjs through `@tiptap/y-tiptap`. This file covers why, and what is
built: a session from the File menu, joined through a link, over a relay that cannot read it.

## Engine

A spike (2026-11-08) ran Yjs and `prosemirror-collab` against the same checks on twelve
corpus documents. Both passed every one, so the choice is about cost, not feasibility.

- **Why Yjs.** Its relay orders nothing and stores nothing: it passes on encrypted frames.
  `prosemirror-collab` needs one place that fixes the order of steps, so a relay with a
  version counter and a step log, online for every session. Yjs also sends fewer and
  smaller messages and joins long documents faster (tables below).
- **What it costs.** Undo is rebuilt (`undoYjs.ts`) on y-tiptap and Yjs internals, so the
  stack is pinned exactly and updated as one Dependabot group (`collab`). Every store
  beside the text needs its counterpart in the map `state`. Typing on long documents costs
  more: 7.0 against 4.9 ms per character at 177 pages (Undo, Checks).
- **Only in a session.** Yjs is attached while a session runs; alone the editor keeps
  ProseMirror's history and pays nothing.
- **When to revisit.** If the relay has to keep state anyway, for instance sessions that
  live on without anyone in them, the main reason for Yjs is gone.

What the spike left untested (other engines, long documents, IME, image drag, the
assistant, four clients, other line heights) the session checks now cover.

Spike results (Chromium, dev server, one machine; `pm` is `prosemirror-collab`):

| Check | Yjs | pm |
|---|---|---|
| Join, idle, 8 rounds of concurrent random edits, pagination, NodeViews, carets, recording | ✓ | ✓ |
| Overlapping comments, recorded changes by two authors, 3 clients × 10 rounds of structural edits | ✓ | ✓ |
| 3 clients with 0–250 ms random delay; one offline for 1.5 s: converge | ✓ | ✓ |
| Messages sent in the latency run (A/B/C) | 21/21/23 | 33/173/128, 277 refused |
| Bytes per keystroke on the wire | ~53 | ~317 (step JSON) |
| Applying a remote message while typing, average / max | 0.8 / 1.4 ms | 0.25 / 1.1 ms |

Long documents (`05-breaks` repeated), spike binding without batching:

| | 177 pages | 442 pages |
|---|---|---|
| Keystroke alone / Yjs / pm, median | 5.0 / 9.9 / 4.8 ms | 11.7 / 23.6 / 14.5 ms |
| Remote update applied, Yjs / pm | 8.7 / 2.7 ms | 22 / 6.8 ms |
| Join, Yjs: time, payload | 0.7 s, 1.2 MB | 1.3 s, 2.9 MB |
| Join, pm: time, payload | 1.6 s, 2.2 MB | 6.9 s, 5.4 MB |

Under latency `prosemirror-collab` resent every unconfirmed step on each transaction, so
refusals piled up; a real client would keep one batch in flight. Neither engine marks a
remote transaction for the history, and `trackChanges.ts` treats it as a rebuild, so
recording never marks or replays another client's edits.

## Undo

A shared session cannot use ProseMirror's history: it would take back the other authors'
edits too. Everything that reads the history therefore asks the active backend
(`src/lib/editor/undo.ts`): `run` for the `undo`/`redo` commands (and `can()`), `depths`,
`isUndoRedo` for the readers of an undo transaction (side stores, zone restore, the recorder,
the history log) and `closeGroup` (image drag). Editing alone keeps ProseMirror's history.
`attachYjsUndo` (`undoYjs.ts`) switches to Yjs. The document is copied into the fragment
`body` unchanged, and the undo stack starts empty from there.

- **One manager, two types.** The fragment `body` holds the text. The map `state` holds the
  stores that `StateStep`s carry. `layout` lies there field by field (`layout/<field>`,
  `sections` as one), `styles` style by style (`styles/<family>/<encoded name>`, beside
  `styles/<family>` with the names in order, and `styles/outline`), so two authors
  changing different fields or styles keep both; the same entry goes to the last writer.
  `notes`, `language` and each zone (`hf:i:key`) stay one value. A `StateStep` keeps whole
  values; mirroring it writes only the entries that differ between `from` and `to`. The
  client that brings the text fills the map with every store's entries before the history
  starts (`stateValues`); a joiner never does, and a zone gets its old value on its first
  write. A change the manager (or another client) makes there returns as a body
  transaction with the `STATE_RESTORED` meta, one `StateStep` per store, assembled from all
  its entries: fields sorted, styles in their family's order and the rest by name, so every
  client builds the same value. The existing listeners apply it as an undo (`watch.write`,
  `writeZone`), so a page setup or a header goes back the way it does alone.
- **Grouping as in the history.** Yjs merges by time alone, so fast edits in different places
  became one step together with edits from before them. `undoYjs.ts` stops capturing where
  prosemirror-history would open a group: an edit not touching the last one's range (its
  `isAdjacentTo`), a side-store change on its own, `closeGroup`. A pause of 500 ms ends a
  step as before. A repeated `composition` meta keeps one step open. y-tiptap's own stop on
  every transaction outside the history is switched off, since a page-number round could
  otherwise split a typed word. The monkey test counts about the same steps on both
  (22/12/18 against 22/14/19).
- **Delete filter.** y-tiptap keeps every paragraph with content on undo, so undoing an
  Enter left the new paragraph behind. Ours keeps an element only while it holds another
  client's live content.
- **Labels** for the toolbar list ride the stack items (`meta.label`), so `historyLog`
  reads the stacks instead of inferring them from depths.
- A document opened in a session clears the manager (`reset`) instead of re-creating
  the state, which would rebuild the sync plugin's binding.

Registering the sync plugins rebuilds every plugin view. `pageBreaks.ts` kept its
pending frame id across such a rebuild, and pagination then never ran again; its `destroy`
now resets the timers.

### Checks

- `?undo=yjs` (dev server only) attaches the Yjs backend to a local doc.
  `UNDO=yjs npm run test:monkey` runs the monkey test on it: undo back to the opened
  file, redo forward, zones, recording.
- `node tests/collab/undo.mjs`: two clients, relayed by the script. Each undo takes back
  only its own client's typing, page layout, header and style, on both sides. An undo
  while recording leaves no recorded change. Two styles, a style added and another
  deleted, and margins against orientation, each changed on both sides before the
  updates cross, all stay. An image dragged right after typing beside it reaches the
  other client and goes back in one undo, leaving the typing. In Chromium an IME
  composition (CDP's `Input.imeSetComposition`) while the other client's typing arrives
  ends as one word on both and goes back in one undo; Firefox and WebKit have no IME to
  drive, and synthetic composition events take another path in ProseMirror, so there it
  is checked by hand only.
- 177 pages (`05-breaks` × 100), one inserted character, median: 4.9 ms alone, 7.0 ms on
  Yjs. One undo: 9 ms against 19 ms.

Not covered yet: `test:dom` runs the built app, which has no `?undo=yjs`. Cross-client
grouping (a step's range mapped through remote edits) is checked only through the
two-client test.

Known gaps: a remote change to a store while one's own change to it still waits in
`noteState`'s 500 ms window loses one's own, and the commit may take the remote value as
one's own; fixing it means rebasing `w.from`. A document opened during a session clears
the manager but does not refill the map `state`.

## Sessions

```
browser ──AES-256-GCM(kind byte + Yjs update / state vector / awareness, in parts)──▶ relay ──▶ browsers
```

- **The link is the key.** *Collaborate…* (`CollabDialog.svelte`) makes 32 random bytes
  and a link `…#collab=<key>` (`collab/key.ts`). Browsers never send the part after `#`,
  so the relay only learns the room, a truncated SHA-256 of the key. Every frame is
  sealed with AES-256-GCM and a fresh 12-byte nonce, through `@noble/ciphers`, which also
  works where `crypto.subtle` is missing. Anyone with the link can read and write. Access
  can only be taken back by starting a new session.
- **Relay** (`relay/server.mjs`, `relay/CLAUDE.md`): rooms as sets of sockets in memory,
  frames passed on unchanged, nothing stored or logged. It still sees addresses, times,
  frame sizes and how many share a room; `MAX_PEERS` counts connections.
- **Where the relay is:** `VITE_COLLAB_RELAY` is a `wss://` URL, or `same-origin` for
  `/relay` beside the app (dev server proxy, Docker image, Helm chart). With
  `same-origin` the app offers sessions only once `relay/health` answers, so an image
  served without a relay shows no menu entry. Embedded, there are none.
- **Sync** (`collab/session.ts`) once per welcome: `ASK`; every peer `OFFER`s its state
  vector and delete set. When all have, or 300 ms after the first, the asker `UPDATE`s what
  the lowest non-empty offer lacks (an empty one is a joiner, which pulls itself) and
  `PULL`s an `ANSWER` from the offer ahead most, then from any still ahead, a later offer
  too, which at the end gets what it lacks. A client without the doc asks again when
  someone comes. A sync ends with the line and restarts when the room shrinks or no peer
  frame comes for 10 s. Edits and carets go in 50 ms batches, each as a task of its own.
- **Parts and failures** (`collab/channel.ts`): a message beyond the welcome's `frame`
  (at most 1 MiB) goes as sealed numbered parts. Retries back off from 0.5 to 30 s; three
  connections lost within 5 s of their welcome show `failing` until one holds for 5 s; a
  line silent for three `beat`s (15 s) is taken as half-open and redialled.
- **Start and join.** The starter puts its document, exported as `.odt` (`buildBytes`),
  into the map `meta` with the app version and the name, then binds the body
  (`attachYjsUndo`). A tab opened from the link waits for a peer and refuses another
  version. It loads that file through `applyImport` (fonts, layout, styles, zones,
  properties), binds the body to the received fragment, and applies the stores already
  in the map `state` (`applyState`); later store changes travel through that map.
- **Headers and footers** go as whole zones, so one person edits a zone at a time
  (`collab/zones.svelte.ts`, awareness field `zone`): the others see the name at it and
  cannot open it. Opened at once, the higher client id yields and may lose its first keys.
  A closed tab frees it at once; a client gone without `pagehide`, after awareness's 30 s.
- **Storage.** The starter keeps editing its own document, and autosave stores everyone's
  edits there. A joining tab is `volatile`: no copy, no slot, no prune in `main.ts` (its
  slot id is the first document's). A reload joins again by the link; leaving clears it.
- **Carets** come from y-tiptap's cursor plugin over the awareness: zero-width decorations
  in the person's (or recorded-change) colour, hidden in print. y-tiptap's undo plugin
  destroys its manager on any `registerPlugin`, so `undoYjs.ts` keeps it until `detach`.

### Checks

`node tests/collab/session.mjs` starts a relay and the dev server and goes through the File
menu. B joins by the link and gets A's document: JSON, pages and zones. Both type, and each
undo takes back only its own typing. A page setup and a style change arrive, the caret
shows with its name, the relay's frames hold no typed text and no name, and an idle session
sends no updates. Frames carry at most 1 MiB; a late joiner gets everything, a 2.9 MB
picture too, from one ask and one answer; a fourth joins, types and converges. A joiner
whose pulled peer drops its answer and line, while a third types, still goes live; a late
offer is pulled from and gets what it lacks; a waiting joiner asks a client coming back,
which pushes it no copy. B cannot open a header A holds; opened together, the lower id
keeps it; a closed tab frees it. After the starter leaves, the others go on; a reload
rejoins; a cut-short link says so. A client with taller lines (6 against 7 pages) stays quiet too.
The assistant on the starter, answered by the script (`page.route`): its text and page
setup reach the joiner, which keeps its recorded marks and adds none; the starter's undo
takes back each on both sides. A relay dropping every connection after its welcome makes
the line `failing` (dialog, 4–5 connections in 12 s) until it holds. A line that hears and
sends nothing leaves `live` within a few beats, asks nothing while down, and comes back.
`tests/relay.test.ts` and `tests/collab.test.ts` cover rooms, limits, beats, sealing and
parts. Both scripts run in Chromium, Firefox and WebKit (`BROWSER`, as the CI's matrix).

Gaps: the relay keeps nothing, so a session lives only while someone is in it. It cannot
address a frame, so every answer reaches every peer, and a late offer's edits reach only
the asker, the others at their next sync. IME input is driven in Chromium only. Seen once
each, not on a rerun: in Firefox a joiner not live within 20 s on a just-started dev
server; in WebKit an uncaught "Fetch API cannot load …/loadFailure.ts" on the starter. A
link holder can make a client keep many half-sent messages of up to 256 MiB each for 60 s.
Pictures (2026-11-10, Chromium, 1.73 MB in `13-images`): `src` goes into the fragment as
it is. Inserting sends 1.73 MB, resizing 0.4 kB; a drag deletes and inserts the node, so it
sends it again, and the mover's doc keeps both copies (3.48 MB) for its undo. A late joiner
gets 1.75 MB with one, two or three clients there. A start picture comes in the start file
and the fragment: 11.7 MB joins in 2.2 s (20.5 MB), 22 MB in 3.1 s (38.5 MB). With 64 kB
frames, joining, edits, a picture and a late joiner all converge.
