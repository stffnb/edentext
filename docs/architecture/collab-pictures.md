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
  overtakes, instead of sending the picture twice.
- Pictures travel in the channel's bulk lane (`channel.ts`): 256 kB parts, sealed one at a
  time (WebCrypto off the page's thread where it exists) and sent only while the socket holds less than 128 kB (4 MiB in a hidden tab, whose
  timers wake once a second). Edits, carets, pings and the sync go first, so typing never
  waits behind a picture. A receiver the relay calls `slow` gets no part until it is
  `drained`; messages to others go on meanwhile, each receiver's in order.
- A missing picture is asked of one client at a time, all keys for it in one frame; one
  that does not answer within 10 s of silence is passed over. A lack means "not yet": the
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

Big documents, 2026-11-12, Chromium: 140–150 pages with 25 pictures (49 MB), the starter's
uplink through a 10 Mbit/s proxy, a third client 5 s after the second; first on the plain
line, then with the lanes and asks that wait, then with `slow`, the start file without
pictures and WebCrypto:

| | before | lanes | now |
|---|---|---|---|
| joiner sees text, pictures in the start file | 47.9 s | 48.7 s | 1.7 s (pictures 45 s) |
| third joiner, pictures put in during the session | 3 of 25 | 25 in 71 s | 25 in 76 s |
| starter's keystroke to relay while sending, p50 / p95 | 0.04 / 28.3 s | 0.6 / 1.0 s | 0.5 / 0.9 s |
| same while answering a start file | 19.3 / 39.3 s | 0.4 / 1.3 s | 0.3 / 0.8 s |
| same, unthrottled, p95 | 0.3 s | 3.5 s | 0.1 s |
| starter's longest task, start file / sending | 2.4 / 2.9 s | 1.7 / 0.5 s | 0.2 / 0.3 s |
| relay's buffer, unthrottled | 47 MB | 16 MB | 2.5 MB |

The last column leaves out keystrokes typed while the starter was alone, which wait for a
joiner as nothing goes to an empty room; the 3.5 s mostly counted those. At
10 Mbit/s what remains of a keystroke's wait lies below the page (socket buffers and the
proxy's 256 kB); pacing the pictures by measured rate would be the next step.

Chromium, 2026-11-10, 1.73 MB JPEG in `13-images`, bytes per client, before keys in
brackets: insert 1.73 MB (same); five moves 2 kB (1.73 MB each); the mover's doc after
them and a delete +1.2 kB (3.48 MB); a start picture, in the start file only, 1.31 MB
(3.04 MB); a late joiner 1.75 MB, the others too. Those were base64; as bytes a
picture costs three quarters of that, and each `WANT` answer reaches only the asker.
