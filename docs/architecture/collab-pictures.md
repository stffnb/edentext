# Pictures in sessions

How a session moves pictures (`src/lib/collab/pictures.ts`); the overview is in
`collab.md`, the relay's side in `relay/CLAUDE.md`.

## Keys

A picture over 4 kB is named by its content key, `idb:<key>` as in autosave, and its
data-URI is held in memory (`imageStore.ts`). Moving, resizing or undoing it then moves
only the key; the bytes travel once to each client.

- **Body.** The plugin keys every picture a transaction brings in the same dispatch,
  before the sync plugin writes the fragment. A drag deletes and inserts the node, which
  now carries only its key. Leaving puts the pictures back, outside the history.
- **Stores** (headers and footers, any `StateStep` value): `attachYjsUndo` takes a codec
  that packs every `src` written into the map `state` and unpacks what comes out. The
  app's stores keep the pictures themselves, so export, autosave and print read them
  as outside a session. A store's picture new here goes to all like the body's; the
  start file's are held at binding and sent to nobody. A key not held yet is asked for; when it comes, every store naming it is put into effect again
  (`refresh`), after an open zone's own edits went into the map.

## Wire

- `PICTURE` `[to][key length][key][head length][head][body]`: a base64 data-URI goes as
  its head (`data:image/png;base64,`) and its decoded bytes, a quarter less than the
  text. One that is not base64, or whose base64 would not encode back the same, goes as
  text with an empty head. Neither: the sender lacks it. The receiver takes a picture
  only under the key its data-URI gives.
- A new picture goes to everyone (`to` 0), unless nobody else is in the room: whoever comes
  asks for it. `WANT` and its answer go to one client, and the relay passes them to that
  client alone. A `WANT` gets each key it names once.
- Pictures travel in the channel's bulk lane (`channel.ts`): 256 kB parts, sealed one per
  task and sent only while the socket holds less than 128 kB (4 MiB in a hidden tab, whose
  timers wake once a second). Edits, carets, pings and the sync go first, so typing never
  waits behind a picture.
- A missing picture is asked of one client at a time, all keys for it in one frame; one
  that does not answer within 10 s of silence is passed over. When everyone has been
  asked, or the relay says nobody else is in the room, it is lost: a grey box and a
  note. Only while others are there but their awareness has not come is it waited for,
  so a holder leaving just as the ask goes out leaves no picture waiting. Someone
  coming asks again.
- When a client's line ends, the relay says `gone` with its id, and the others drop its
  awareness at once, so no ask waits on it. A client on a new line sends its awareness
  with a new clock, which the others take back.

## Measured

Chromium, 2026-11-10, 1.73 MB JPEG in `13-images`, bytes per client, before keys in
brackets: insert 1.73 MB (same); five moves 2 kB (1.73 MB each); the mover's doc after
them and a delete +1.2 kB (3.48 MB); a start picture, in the start file only, 1.31 MB
(3.04 MB); a late joiner 1.75 MB, the others too. Those were base64; as bytes a
picture costs three quarters of that, and each `WANT` answer reaches only the asker.
