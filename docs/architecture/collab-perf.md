# Session performance baselines

Where the measured times of shared sessions live and how to measure them again, so a later
change can be compared with them. Design: `collab.md`, `collab-pictures.md`, `collab-relay.md`.

| What | Script | Numbers |
|---|---|---|
| Joining a big document, typing while pictures go out | `npm run bench:bigjoin` | below |
| How typing feels with several writers, viewer page breaks | `node tests/collab/fluency.mjs` | `collab-soak.md`, "How typing feels" |
| Typing on a slow line while a joiner loads (pass/fail, < 1.5 s) | `tests/collab/session.mjs` | its check output |

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
- `B`/`C`: seconds from opening the link to `firstText` (over 20 blocks shown), `allPics`,
  `live`, plus long tasks; `aLong` is the starter's; `relay.maxBufferedMB` the relay's
  buffered bytes over all sockets, sampled every 100 ms.

Rows below: `SCEN=S1 NET=10`, `SCEN=S2 NET=10 THIRD=5000 LIMIT=200000` and
`SCEN=S2 NET=none THIRD=5000`, each run once with `npm run bench:bigjoin` and the variables in
front. Machine: Apple M1, 8 GB, macOS 15.7, Node 26, Chromium 156 (Playwright), 2026-11-12,
nothing else running in a browser. Runs vary by about ±0.3 s in the keystroke times.

| | before | lanes | now |
|---|---|---|---|
| joiner sees text, pictures in the start file (S1 10) | 47.9 s | 48.7 s | 1.9 s (pictures 45 s) |
| start file in the shared doc (S1) | 49 MB | 49 MB | 0.02 MB |
| third joiner gets all pictures (S2 10) | 3 of 25 | 25 in 71 s | 25 in 74 s |
| starter's keystroke to relay while sending, p50 / p95 (S2 10) | 0.04 / 28.3 s | 0.6 / 1.0 s | 0.4 / 0.8 s |
| same while answering a start file (S1 10) | 19.3 / 39.3 s | 0.4 / 1.3 s | 0.4 / 0.9 s |
| same, unthrottled, p95 (S2 none) | 0.3 s | 3.5 s | 0.1 s |
| starter's longest task, start file / sending | 2.4 / 2.9 s | 1.7 / 0.5 s | 0.3 / 0.3 s |
| relay's buffer, unthrottled (S2 none) | 47 MB | 16 MB | 2.5 MB |

"before" is `integrate/collab` at `ba11ca24`; "lanes" adds the two-lane channel and the asks
that wait; "now" adds `slow`/`drained`, the start file without pictures and WebCrypto. The
"lanes" 3.5 s mostly counted keys typed while alone. At 10 Mbit/s what remains of a
keystroke's wait lies below the page (socket buffers and the proxy's queue); pacing pictures
by measured rate would be the next step.
