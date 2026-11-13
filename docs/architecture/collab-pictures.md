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
  starter's are held at binding and sent to nobody. A key not held yet is asked for; when it comes, every store naming it is put into effect again
  (`refresh`), after an open zone's own edits went into the map.

- **Start file.** `startSession`'s file (`meta.snapshot`) leaves every picture over 4 kB
  out, in body and stores alike (`mapSrcs` keys them, the exporter drops a keyed picture):
  the joiner's body and stores come from the shared doc, which names each by key with its
  size, so text shows at once and the pictures are asked for like any other.
- **Leaving.** Others still loading pictures from this tab (`serving`, its answers not yet
  sent) make leaving and closing the tab ask first; a kept copy that lacks pictures says how
  many and is kept only when confirmed, with grey boxes in their place.
- **Saving, printing, PDF, copying** with pictures still on their way wait for them
  (`untilHeld`) under the notice "Pictures are still loading…"; only one nobody here has
  stops them (`picturesPending`). A copy or cut goes to the clipboard once they came.

## Wire

- `PICTURE` `[to][key length][key][head length][head][body]`: a base64 data-URI goes as
  its head (`data:image/png;base64,`) and its decoded bytes, a quarter less than the
  text. One that is not base64, or whose base64 would not encode back the same, goes as
  text with an empty head. Neither: the sender lacks it. The receiver takes a picture
  only under the key its data-URI gives.
- A new picture goes to everyone (`to` 0), unless nobody else is in the room: whoever comes
  asks for it. `WANT` and its answer go to one client, and the relay passes them to that
  client alone. A `WANT` gets each key it names once, one picture per task; one from a
  client that was there when the picture went to everyone waits for that, which its edit
  overtakes, instead of sending the picture twice; nor does a client ask one whose message in
  parts is still coming in to it, which may be that picture.
- Pictures travel in the channel's bulk lane (`channel.ts`): parts sealed one at a time
  (WebCrypto off the page's thread where it exists) and sent only while the socket holds less
  than 128 kB (4 MiB in a hidden tab, whose timers wake once a second). The relay says how
  many bytes of each sender arrived (`got`); from that the lane measures the uplink's rate and
  shortest round trip and keeps no more than 150 ms of pictures beyond the round trip in
  flight, in parts of half that (32–256 kB), since browser and system buffers below the page
  would otherwise hold seconds of them. Edits, carets, pings and the sync go first, so a
  keystroke waits behind at most that. A receiver the relay calls `slow` gets no part until it is
  `drained`; messages to others go on meanwhile, each receiver's in order.
- A missing picture is asked of one client at a time, at most three per client and those
  nearest the viewport first (`distanceOf`, where its grey box shows), all keys for it in one
  frame; each that arrives, and each scroll, asks for the next nearest. One that does not
  answer within 10 s of silence is passed over. A lack means "not yet": the
  key stays wanted, and is asked again of a client newly confirmed (its awareness answered
  a ping) and of one that lacked it and since got it. That client remembers who asked
  (256 keys) and tells them so (`HAS` `[to][from][keys]`, signed); it does not send it unasked,
  so nobody gets a picture twice. The grey box shows while a picture is missing; the note
  only once every client the relay counts is known and none has it, and it goes when the
  picture comes.
- When a client's line ends, the relay says `gone` with its id, and the others drop its
  awareness at once, so no ask waits on it. A client on a new line sends its awareness
  with a new clock, which the others take back.

## Measured

Big documents (joining, typing while pictures go out, the relay's buffer): `collab-perf.md`.

Chromium, 2026-11-10, 1.73 MB JPEG in `13-images`, bytes per client, before keys in
brackets: insert 1.73 MB (same); five moves 2 kB (1.73 MB each); the mover's doc after
them and a delete +1.2 kB (3.48 MB); a start picture, in the start file only, 1.31 MB
(3.04 MB); a late joiner 1.75 MB, the others too. Those were base64; as bytes a
picture costs three quarters of that, and each `WANT` answer reaches only the asker.
