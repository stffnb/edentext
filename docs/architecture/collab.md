# Collaboration

Shared editing runs on Yjs through `@tiptap/y-tiptap`. The engine choice and the spike
behind it live on the branch `spike/collab`. This file covers what is built.

## Undo

A shared session cannot use ProseMirror's history: it would take back the other authors'
edits too. Everything that reads the history therefore asks the active backend
(`src/lib/editor/undo.ts`): `run` for the `undo`/`redo` commands (and `can()`), `depths`,
`isUndoRedo` for the readers of an undo transaction (side stores, zone restore, the recorder,
the history log) and `closeGroup` (image drag). Editing alone keeps ProseMirror's history.
`attachYjsUndo` (`undoYjs.ts`) switches to Yjs. The document is copied into the fragment
`body` unchanged, and the undo stack starts empty from there.

- **One manager, two types.** The fragment `body` holds the text. The map `state` holds the
  stores that `StateStep`s carry: `layout`, `styles`, `notes`, `language`, and `hf:i:key`
  as a whole zone's JSON. Each `StateStep` the body dispatches is mirrored into the map. A
  change the manager (or another client) makes there returns as a body transaction of
  `StateStep`s with the `STATE_RESTORED` meta, which the existing listeners apply as an undo
  (`watch.write`, `writeZone`). So a page setup or a header goes back the way it does alone.
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
  only its own client's typing, page layout and header, on both sides. An undo while
  recording leaves no recorded change.
- 177 pages (`05-breaks` × 100), one inserted character, median: 4.9 ms alone, 7.0 ms on
  Yjs. One undo: 9 ms against 19 ms.

Not covered yet: `test:dom` runs the built app, which has no `?undo=yjs`. Cross-client
grouping (a step's range mapped through remote edits) is checked only through the
two-client test.
