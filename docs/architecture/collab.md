# Collaboration

Shared editing runs on Yjs through `@tiptap/y-tiptap`. The engine choice and the spike
behind it live on the branch `spike/collab`. This file covers what is built: a session
started from the File menu and joined through a link, over a relay that cannot read it.

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

## Sessions

```
browser ──AES-256-GCM(kind byte + Yjs update / state vector / awareness)──▶ relay ──▶ browsers
```

- **The link is the key.** *Collaborate…* (`CollabDialog.svelte`) makes 32 random bytes
  and a link `…#collab=<key>` (`collab/key.ts`). Browsers never send the part after `#`,
  so the relay only learns the room, a truncated SHA-256 of the key. Every frame is
  sealed with AES-256-GCM and a fresh 12-byte nonce, through `@noble/ciphers`, which also
  works where `crypto.subtle` is missing. Anyone with the link can read and write. Access
  can only be taken back by starting a new session.
- **Relay** (`relay/server.mjs`, `relay/CLAUDE.md`): rooms as sets of sockets in memory,
  frames passed on unchanged, nothing stored or logged. It still sees addresses, times,
  frame sizes and how many share a room. `MAX_PEERS` counts connections, and the hello
  carries a `token` field, reserved and not read.
- **Where the relay is:** `VITE_COLLAB_RELAY` is a `wss://` URL, or `same-origin` for
  `/relay` beside the app (dev server proxy, Docker image, Helm chart). With
  `same-origin` the app offers sessions only once `relay/health` answers, so an image
  served without a relay shows no menu entry. Embedded, there are none.
- **Sync** (`collab/session.ts`): three frame kinds. `ASK` is a state vector, and everyone
  answers it with the update it lacks. `UPDATE` is a Yjs update. `PRESENCE` is an
  awareness update with name, colour and caret. A client asks when it connects and
  whenever the relay reports a new peer. Updates leave and arrive in 50 ms batches
  (`Y.mergeUpdates`), always as a task of their own, never inside a dispatch.
- **Start and join.** The starter puts its document, exported as `.odt` (`buildBytes`),
  into the map `meta` with the app version and the name, then binds the body
  (`attachYjsUndo`). A tab opened from the link waits for a peer and refuses another
  version. It loads that file through `applyImport` (fonts, layout, styles, zones,
  properties), binds the body to the received fragment, and applies the stores already
  in the map `state` (`applyState`). Store changes after that travel through the same
  map as the undo uses. A header or footer is written as a whole zone, so two people in
  one zone at the same moment get the last writer's.
- **Storage.** The starter keeps editing its own document, and autosave stores everyone's
  edits there. A joining tab is `volatile`: it keeps no copy and claims no slot. Its
  slot id would be the first document's, so `main.ts` also skips the prune there. The
  link stays in the address bar, so a reload joins again. Leaving clears it.
- **Carets** come from y-tiptap's cursor plugin over the awareness, drawn as zero-width
  decorations in the person's colour (the recorded-change colour when they have one)
  and hidden in print. y-tiptap's undo plugin destroys its manager whenever the plugin
  views rebuild (any `registerPlugin`), so `undoYjs.ts` keeps it alive until `detach`.

### Checks

`node tests/collab/session.mjs` starts a relay and the dev server and goes through the
File menu. B joins by the link and gets A's document: JSON, pages and zones. Both type,
and each undo takes back only its own typing. A page setup and a style change arrive
on the other side, and the caret shows with its name. The relay's frames hold no typed
text and no name. An idle session, also after the style change, sends no updates. A late
joiner gets everything, styles included, and a fourth client joining after it types
and converges with the other three. After the starter leaves,
the others go on, and a reload rejoins. A cut-short link says so. A client with taller
lines (6 against 7 pages on an index document) stays quiet as well: the index's page
numbers do not flip between the two. The assistant on the starter, from a provider the
script answers itself (`page.route`, no model and no network): its text replacement and
page setup reach the joiner; with both recording, the joiner keeps the assistant's marks
and adds none of its own; the starter's undo takes back the page setup, then the text, on
both sides. `tests/relay.test.ts` and `tests/collab.test.ts`
cover the relay's rooms and limits and the sealing. Both scripts run in Chromium, Firefox
and WebKit (`BROWSER`, each leg of the CI's browser matrix).

Gaps: the relay keeps nothing, so a session lives only while someone is in it. Pictures
travel twice to a joiner (start file and fragment) and stay in the Yjs history. Two
clients of different EdenText versions refuse each other.
