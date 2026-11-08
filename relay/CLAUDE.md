# relay/

The collaboration relay (`docs/architecture/collab.md`). It is its own npm project and depends only on `ws`; the root keeps `ws` as a dev dependency for `tests/relay.test.ts`.
`npm run relay` in the root starts it on port 4390, and the Vite dev server proxies `/relay` to it (`RELAY_PORT` to change it).

- Protocol: a WebSocket on `/relay`. The first frame is text, `{"t":"hello","v":1,"room":"<id>","token":null}`. The room is a hash of the session key, never the key itself. The answer is `{"t":"welcome","peers":n}`, or `{"t":"full"}` and close code 4001. A bad hello closes with 4000, too many rooms with 4003. Everyone in a room gets `{"t":"peers","n":…}` when someone comes or goes.
- Binary frames go unchanged to everyone else in the room. They are AES-GCM ciphertext, so the relay cannot read them. Text frames after the hello are dropped.
- Nothing is stored: a room is a set of sockets in memory and disappears with its last client. No content and no room id is logged. What the relay still sees: addresses, times, frame sizes, how many share a room.
- Limits from the environment: `PORT`, `HOST`, `MAX_PEERS` (0 = none; a paid `token` will lift it), `MAX_FRAME` (bytes, 16 MiB, enough for a start snapshot with pictures; larger closes with 1009), `MAX_ROOMS`. A ping every 30 s drops dead connections. `/health` answers `ok`.
