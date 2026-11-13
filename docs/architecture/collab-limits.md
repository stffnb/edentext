# Limits in a shared session

What anyone holding a link may ask of the others, and what bounds it. Session design:
`collab.md`; the relay's own limits: `relay/CLAUDE.md`, `collab-relay.md`.

## Measured

Measured 2026-11-13 (Chromium) per sender
as one receiver sees it, from the soak (seeds 1–4, four writers and a reader: reloads, lines
cut and deaf, frames delayed), `session.mjs` without its forged-frame checks, and the join
bench (`collab-perf.md`, 25 pictures of 2 MB). Most seen from one sender:

| Kind | In 1 s | In 10 s | In 60 s | Run |
|---|---|---|---|---|
| `ASK` | 1 | 2 | 3 | session (redials, stalls) |
| `PULL` | 1 | 2 | 2 | session, soak |
| `WANT` (keys) | 9 | 25 | 25 | join bench; at most 3 keys a frame |
| `PING` | 1 | 2 | 2 | soak, session |
| `VIEWER` | 2 | 3 | 5 | soak, session |
| `ECHO`, `NOTHING` | 1 | 1 | 1 | soak, session |

Every message longer than 200 kB came from a writer that had answered a ping, or from the
sync's pulled peer; the relay held at most 2.5 MiB for a receiver (join bench).

## Per sender

Each client therefore takes these kinds from one sender (the relay's id, readers and writers
alike) only from a bucket per kind (`RATES` in `session.ts`): `ASK`, `PULL` and `NOTHING` 5 at
once and one more every 10 s, `PING`, `ECHO` and `VIEWER` 6 and one per 10 s, `WANT` 50 keys
and 10 a second; that is three to six times the most measured. A frame past it is dropped
unanswered, as are a `WANT`'s keys past it. A dropped ask leaves its sync without offers, so
one nobody answered starts over after 10 s although others' frames keep the line busy; a
dropped `WANT` key goes to the next client once that one sends nothing for 10 s. The buckets
outlive a client's going, so dialling again does not refill them; 32 senders are kept, the
oldest forgotten. Ever new ids would refill them, which the relay's `DIALS_PER_MIN` bounds.
A `PING` is answered only with a nonce of 16 bytes, so nobody gets a writer to sign
something longer of its choosing; the bucket bounds how many it signs.
A `PULL` naming the same state vector as the `ANSWER` still on its way to that sender is not
answered again; its next `ASK`, a new sync maybe on a new line, clears that. A `WANT` for a
picture still being sent to its asker is not answered twice, key by key (`pictures.ts`).
Unfinished messages and inflating are bounded per sender (`channel.ts`'s `limit`): 256 MiB
from a writer that answered a ping, the sync's pulled peer (whose first `ANSWER` comes before
its ping is answered) and a client asked for a picture; 8 MiB from anyone else, as the kinds a
reader sends are short. All senders together hold at most 320 MiB. A sender one of whose
signed frames failed its check gets none checked again (32 such senders kept): no writer's
frame ever fails, and checking a long one costs milliseconds.

## What stays open

By design or for later:

- A reader can fill the room with connections of its own, as `MAX_PEERS` counts readers too; the relay's limits per address (`MAX_CONNS_PER_IP`, `DIALS_PER_MIN`) soften that.
- Attributes inside a Yjs update are not checked one by one; what protects is the checks when rendering and the page's Content-Security-Policy.
- A link holds as long as the session runs; locking someone out means starting a new session.
- The relay is trusted with the order of frames and the sender id it stamps; it can neither read nor forge their content.
- A reader may replay a writer's signed frames, which pass their check: each costs the receiver a check and a no-op apply, unlimited so far.
- Half-received frames at the relay count toward no budget: up to `MAX_CONNS` × `MAX_FRAME` (`relay/CLAUDE.md`).
