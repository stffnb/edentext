# Running the relay

For whoever hosts EdenText: what shared sessions need on the server. Protocol and limits in
detail: `relay/CLAUDE.md`; the session design: `collab.md`.

## What it is

A small Node server (`relay/server.mjs`, only `ws` as dependency) that passes encrypted frames
between the browsers in a session. It keeps rooms in memory and stores and logs nothing, so a
session lives only while someone is in it, and one instance (one replica) serves all rooms. A
restart ends no document: the browsers dial again and sync among themselves.

## Starting it

- From the repository: `npm run relay` (port 4390). On its own: `cd relay && npm ci --omit=dev && node server.mjs`.
- Container: `docker run -p 4390:4390 ghcr.io/stffnb/edentext-relay` (built from `relay/Dockerfile`).
- Kubernetes: the Helm chart runs it beside the app and serves it at `/relay` (`charts/edentext`).
- `/health` (and `/relay/health`) answer `ok`; the WebSocket is on `/relay`.

## Where the app finds it

`VITE_COLLAB_RELAY`, read at build time (`npm run build`, `docker build --build-arg`):

- a `wss://host/relay` URL: the relay runs elsewhere; sessions are always offered.
- `same-origin` (the published app image, the dev server): the app uses `/relay` on its own
  host and offers sessions only once `relay/health` answers there. A reverse proxy must pass
  `/relay` to the relay with the WebSocket upgrade and a long read timeout, as the chart's nginx does
  (`location /relay { proxy_pass http://relay:4390; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_set_header X-Real-IP $remote_addr; proxy_read_timeout 1h; }`),
  and then run the relay with `TRUST_PROXY=1`, so its limit per address counts the clients, not the proxy.
  The app image alone has no such proxy, so it shows no *Collaborate…* entry.
- unset: no sessions (a plain `npm run build`); embedded, there are none either.

A page served over HTTPS needs `wss://`. Over plain HTTP sessions work too; only the copy buttons
are off, as for the rest of the app.

## Settings (environment)

| Variable | Default | Effect |
|---|---|---|
| `PORT`, `HOST` | 4390, all | where it listens |
| `MAX_PEERS` | 6 | connections per room; the next gets `full`. Readers count, and so does a reload's second connection while the old one closes. 0 = no limit |
| `MAX_ROOMS` | 10000 | rooms at once; a hello beyond closes with 4003 |
| `MAX_CONNS`, `MAX_CONNS_PER_IP` | 2000, 20 | connections in all and per address (an IPv6 one by its /64), before their hello too; past either an upgrade gets HTTP 429. 0 = no limit |
| `ALLOWED_ORIGINS` | empty | the origins whose pages may connect, separated by commas or blanks, e.g. `https://docs.example.org app://edentext` (`app://edentext` is the desktop app); any other gets HTTP 403. Empty allows every origin. This keeps other web pages from using the relay through their visitors' browsers; a program outside a browser can send any origin |
| `DIALS_PER_MIN` | 60 | upgrades per address and minute (up to that many at once); past it HTTP 429, so nobody comes back under ever new ids to escape the browsers' limits per sender. 0 = no limit |
| `TRUST_PROXY` | off | `1`: the address is the `X-Real-IP` header from the proxy in front (`proxy_set_header X-Real-IP $remote_addr;`), else every connection would count as the proxy's. Set it only behind such a proxy, as anyone can send the header |
| `MAX_FRAME` | 1 MiB | bytes per frame; browsers send at most 256 kB and split longer messages |
| `STUCK_MS` | 30 s | a receiver that holds more than 8 MiB this long reads nothing and is dropped; its browser dials again. 0 = never |
| `MAX_BUFFERED` | 256 MiB | what all receivers hold together; past it the one furthest behind is dropped until the rest fit. The memory limit of the relay's host or pod must lie above this plus about `MAX_CONNS` × `MAX_FRAME` and the process itself. 0 = no limit |
| `BEAT_MS`, `PING_MS` | 5 s, 5 s | keep-alive to the browsers, which take a line silent for three beats as dead, and the ping that drops a dead line within two rounds |

A receiver on a slow line holds about 2 MiB at the relay: beyond that the relay tells the
others it is `slow`, and they hold back the pictures for it until it is `drained`, while their
typing still goes through. The relay itself stays blind (it keeps reading every sender and
cannot tell a picture from a keystroke); for a client that ignores the message it stops reading
that sender once a receiver holds 8 MiB, so memory stays bounded per room, and it drops a receiver stuck there (`STUCK_MS`) or the one furthest behind once all hold `MAX_BUFFERED` (`relay/CLAUDE.md`).
Each sender also hears how many of its bytes arrived (`got`, at once per 32 kB, else after
20 ms), so it can pace its pictures by its own uplink. All three messages are optional, so
they need no new protocol version.

App and relay speak protocol version 3 (`relay/CLAUDE.md`; since 3 the browsers may deflate
long messages, which an app of version 2 cannot read); against a relay of another version the
app says it does not match the server, so update both together.

`token`: every hello carries `"token": null`. It is reserved; the relay does not read it.
There are no accounts or passwords.

## What the relay sees

- **Never:** the keys (the part of the link after `#` stays in the browser), document text,
  styles, pictures, names, carets, comments, chat messages, or whether a client holds the write or the read
  link. Everything is sealed with AES-256-GCM before it leaves the browser.
- **Does:** IP addresses and times, the room id (a truncated hash of the read key, the same for
  both links, from which no key follows), how many share a room, frame sizes and their timing,
  and which random session id sends to which, with the random secret each client claims its id
  by. It writes none of this anywhere; a proxy in front of it may log addresses and paths.

Anyone holding a link can join; a write link stays valid until a new session is started.
