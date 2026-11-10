# relay/

The collaboration relay (`docs/architecture/collab.md`). It is its own npm project and depends only on `ws`; the root keeps `ws` as a dev dependency for `tests/relay.test.ts`.
`npm run relay` in the root starts it on port 4390, and the Vite dev server proxies `/relay` to it (`RELAY_PORT` to change it).

- Protocol: a WebSocket on `/relay`. The first frame is text, `{"t":"hello","v":1,"room":"<id>","token":null}`. The room is a hash of the session key, never the key itself. The answer is `{"t":"welcome","peers":n,"frame":MAX_FRAME,"beat":BEAT_MS}`, or `{"t":"full"}` and close code 4001. A bad hello closes with 4000, too many rooms with 4003. Everyone in a room gets `{"t":"peers","n":…}` when someone comes or goes.
- Binary frames go unchanged to everyone else in the room. They are AES-GCM ciphertext, so the relay cannot read them. Text frames after the hello are dropped.
- Every `beat` ms each client in a room gets `{"t":"beat"}`. Browsers cannot see WebSocket pings, so a client that hears nothing for three beats drops the line as dead (half-open) and dials again; without `beat` in the welcome it never does.
- `frame` and `beat` were added without a new `v`: clients ignore fields and messages they do not know, and against a relay without `frame` a client splits at 1 MiB. Clients split longer messages into sealed parts themselves (`src/lib/collab/channel.ts`), so the relay never sees a message, only frames.
- Nothing is stored: a room is a set of sockets in memory and disappears with its last client. No content and no room id is logged. What the relay still sees: addresses, times, frame sizes, how many share a room.
- Limits from the environment: `PORT`, `HOST`, `MAX_PEERS` (6, as measured in `docs/architecture/collab-soak.md`; 0 = none), `MAX_FRAME` (bytes per frame, 16 MiB; larger closes with 1009; clients send at most 1 MiB), `MAX_ROOMS`, `BEAT_MS` (15 s; 0 = none). A ping every 30 s drops dead connections. `/health` answers `ok`.
