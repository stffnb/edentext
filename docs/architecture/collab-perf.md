# Session performance baselines

Where the measured times of shared sessions live and how to measure them again, so a later
change can be compared with them. Design: `collab.md`, `collab-pictures.md`, `collab-relay.md`.

| What | Script | Numbers |
|---|---|---|
| Joining a big document, typing while pictures go out | `npm run bench:bigjoin` | below |
| How typing feels with several writers, viewer page breaks | `node tests/collab/fluency.mjs` | `collab-soak.md`, "How typing feels" |
| Typing on a slow line while a joiner loads (pass/fail, < 1 s) | `tests/collab/session.mjs` | its check output |

## Big-document join

`tests/collab/bigjoin.mjs` (not part of `test:collab`) builds the document in the starter's
tab, so no real document is needed: 84 chapters of generated text, lists and tables, 140–150
pages, with 25 seeded noise pictures (20 JPEG 2000×1500, 5 PNG 830×830; 49 MB). It starts the
relay itself (`BIGJOIN_PORT`, default 4401; relay +1, proxy +2) and the dev server, opens
Chromium (`BROWSER` as in `tests/browser.mjs`), and prints one JSON line (`BIGJOIN_OUT`
appends it to a file).

- `SCEN=S1`: the pictures are in the document when the session starts (the start file);
  `S2`: they go in, all at once, right after it starts, while the starter is alone; `S0`: none.
- `NET=10|40|none`: the starter's uplink in Mbit/s, throttled by a token-bucket TCP proxy in
  front of the relay (`THROTTLE=proxy`, 256 kB queue; `cdp` uses Chromium's emulation).
  The joiners' lines are not throttled.
- `THIRD=5000`: a third client joins 5 s after the second. `LIMIT` caps the wait in ms.
- The starter types `#` every 700 ms throughout. `aKeyLive` is the time from its keydown to
  its next small frame at the relay, leaving out keys typed while it was alone (nothing goes
  to an empty room, so those wait for a joiner); `aKeySlow` lists keys over 500 ms.
- `VIEW=0.5`: once the text is in, the joiner scrolls to the picture that far down the list,
  as a reader opening the link and jumping into the middle would.
- `B`/`C`: seconds from opening the link to `firstText` (over 20 blocks shown), `screen` (text
  shown and no grey box in view), `allPics`, `live`, plus long tasks; `aLong` is the
  starter's; `relay.maxBufferedMB` the relay's buffered bytes over all sockets, sampled every
  100 ms.

Each row is one run of `npm run bench:bigjoin` with the variables named in it (`S2 10 +C` is
`SCEN=S2 NET=10 THIRD=5000 LIMIT=200000`). Machine: Apple M1, 8 GB, macOS 15.7, Node 26,
Chromium 156 (Playwright), nothing else running in a browser; "now" measured 2026-11-13.
Runs vary by about ±0.3 s in the keystroke times and by several seconds in a third joiner's.

| | before | parts 1–4 | now |
|---|---|---|---|
| joiner sees text (S1 10) | 47.9 s | 1.9 s | 1.8 s |
| joiner looking at the middle sees its screen complete (S1 10, `VIEW=0.5`) | 47.9 s | 25.2 s | 3.9 s |
| joiner has all pictures (S1 10 / S1 40 / S1 none) | 47.9 s | 45 s | 45.0 / 12.7 / 7.2 s |
| start file in the shared doc (S1) | 49 MB | 0.02 MB | 0.02 MB |
| second / third joiner has all pictures (S2 10 +C) | – / 3 of 25 | 45 / 74 s | 80 / 76 s |
| same, unthrottled (S2 none +C) | – | 7.9 / 14.2 s | 7.5 / 8.1 s |
| starter's keystroke to relay while sending, p50 / p95 (S2 10 +C) | 0.04 / 28.3 s | 0.42 / 0.83 s | 0.07 / 0.15 s |
| same while answering joiners' asks (S1 10) | 19.3 / 39.3 s | 0.41 / 0.86 s | 0.05 / 0.14 s |
| same, p95, at 40 Mbit/s / unthrottled (S1 40 / S2 none +C) | – / 0.3 s | – / 0.06 s | 0.15 / 0.05 s |
| starter's longest task, start file / sending | 2.4 / 2.9 s | 0.3 / 0.3 s | 0.3 / 0.3 s |
| relay's buffer, unthrottled (S2 none +C) | 47 MB | 2.5 MB | 2.9 MB |

"before" is `integrate/collab` at `ba11ca24`; "parts 1–4" adds the two-lane channel, asks that
wait, `slow`/`drained`, the start file without pictures and WebCrypto (`e43ce407`); "now" adds
pacing by the relay's receipts (`got`) and asks nearest the view first. The 25.2 s is "now"
with the old asks (all at once, in document order). At 10 Mbit/s the second and third joiner
share the starter's uplink, so the second now finishes with the third instead of first; both
need twice 49 MB through 1.25 MB/s.

## Latency

How soon others see a key, how a join splits into its steps, and how fast a dead line is
noticed. Fluency rows: `FLUENCY_CLIENTS=2,4 node tests/collab/fluency.mjs` (method in
`collab-soak.md`; "frames per key" counts every frame A sends while typing, over its keys).
Join rows: `npm run bench:bigjoin` with `SCEN=S1 NET=none` (150 pages, 25 pictures) and a
`MODE`: the joiner's steps are the session's `collab:*` performance marks (dial, socket open,
`welcome`, first `OFFER`, `ANSWER`, bound) beside the milestones above, in seconds from opening
the link. `cold` serves the joiner the built app (`vite preview`, build with
`VITE_COLLAB_RELAY=same-origin`) on a new profile, its download at `GUEST_NET` Mbit/s by
Chromium's emulation (the relay line too), `WARM=1` from the service worker of a first visit.
`hidden` makes the starter's tab look hidden and runs its timers as Chrome runs a hidden tab's
(headless Chromium never hides one): to the next second, with `INTENSIVE=1` chained timers to
the next minute. `rejoin` reloads the joiner once it has everything; `drop` (the relay's default beat)
makes the joiner's line deaf without a close, then takes it offline by emulation.

| | before | after |
|---|---|---|
| key at A to B's screen, short / mixed, 2 clients, median (p95) | 113 (126) / 122 (140) ms | 17 (31) / 15 (25) ms |
| same, 4 clients | 113 (140) / 98 (123) ms | 17 (32) / 21 (24) ms |
| same, 177 pages, 2 / 4 clients | 240 (339) / 342 (823) ms | 148 (210) / 229 (941) ms |
| A's key on 177 pages, 2 / 4 clients, median (p95); longest frame gap | 8.9 (13.2) / 12.9 (26.5) ms; 167 / 583 ms | 8.1 (10.1) / 10.9 (20.8) ms; 150 / 433 ms |
| frames A sends per key (edit, caret) | 2.0 (1.0, 1.0) | 2.0 (1.0, 1.0) |
| join, 150 pages: app up, socket open, `welcome`, first offer, answer | 0.79, 0.82, 0.83, 0.84, 1.02 s | 0.52, 0.54, 0.55, 0.56, 0.72 s |
| same: text shown, bound, pages laid out, all pictures | 1.62, 1.94, 2.16, 7.0 s | 1.17, 1.46, 1.69, 6.4 s |
| `ANSWER` for 150 pages, raw / deflate-raw | 776 / 68 kB | 776 / 68 kB |
| built app, new profile, 10 Mbit/s: app up, answer, text, all pictures | 1.11, 3.43, 4.04, 68.9 s | 1.01, 3.39, 3.88 s; 7 of 25 after 300 s |
| same at 40 Mbit/s | 0.47, 0.81, 1.36, 13.1 s | 0.44, 0.81, 1.26, 14.0 s |
| same at 10 Mbit/s from the service worker | 0.35, 1.42, 1.98 s; 15 of 25 after 300 s | 0.31, 1.39, 1.83 s; 23 of 25 after 300 s |
| starter's tab hidden / hidden over 5 minutes: text, all pictures | 1.33 / 1.25 s, 11.9 / 11.3 s | 1.13 / 1.05 s, 10.9 / 11.6 s |
| reload and rejoin: bytes sent again, all pictures | 49.9 MB, 6.6 s | 49.9 MB, 6.0 s |
| line deaf without a close: not `live` after, `live` again after it works | 58.8 s, 0.5 s | 15.2 s, 0.4 s |
| offline by emulation: not `live` after, `live` again after online | 57.0 s, 0.9 s | 0.01 s, 0.1 s |

"before" is `integrate/collab` at `539f7d96`, "after" `collab/latency` at `429d3341`, both measured
2026-11-13, one run each (the join rows vary by about ±0.3 s between runs). Edits leave at once
and apply on arrival while cheap, a reader's `NOTHING` ends a sync's wait, the relay beats every
5 s and `online`/`offline` act at once. A joiner whose download is throttled sometimes stops short of
all pictures, in both columns; not yet explained.
