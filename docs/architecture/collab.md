# Collaboration

Shared editing runs on Yjs through `@tiptap/y-tiptap`. This file covers why, and what is
built: a session from the File menu, joined through a link, over a relay that cannot read it.

## Engine

A spike (2026-11-08) ran Yjs and `prosemirror-collab` against the same checks on twelve
corpus documents. Both passed every one, so the choice is about cost, not feasibility.

- **Why Yjs.** Its relay orders nothing and stores nothing: it passes on encrypted frames.
  `prosemirror-collab` needs one place that fixes the order of steps, so a relay with a
  version counter and a step log, online for every session. Yjs also sends fewer and
  smaller messages and joins long documents faster (`collab-soak.md`).
- **What it costs.** Undo is rebuilt (`undoYjs.ts`) on y-tiptap and Yjs internals, pinned
  exactly and updated as one Dependabot group (`collab`). Every store beside the text needs
  its counterpart in the map `state`. Typing at 177 pages costs 7.0 against 4.9 ms per
  character (Undo, Checks). Yjs is attached only in a session; alone the editor keeps
  ProseMirror's history and pays nothing.
- **When to revisit.** If the relay has to keep state anyway, for instance sessions that
  live on without anyone in them, the main reason for Yjs is gone.

What the spike left untested (engines, long documents, IME, image drag, the assistant, four
clients, line heights) the session checks cover; its results are in `collab-soak.md`, big-document timings in `collab-perf.md`.

## Undo

ProseMirror's history would take back the other authors' edits too, so whatever reads the
history asks the active backend (`src/lib/editor/undo.ts`): `run` for `undo`/`redo` (and
`can()`), `depths`, `isUndoRedo` for the readers of an undo transaction (side stores, zone
restore, the recorder, the history log) and `closeGroup` (image drag). `attachYjsUndo`
(`undoYjs.ts`) switches to Yjs, copying the document into the fragment `body` unchanged;
the undo stack starts empty from there.

- **One manager, two types.** The fragment `body` holds the text. The map `state` holds the
  stores that `StateStep`s carry. `layout` lies there field by field (`layout/<field>`,
  `sections` as one), `styles` style by style (`styles/<family>/<encoded name>`, beside
  `styles/<family>` with the names in order, and `styles/outline`), so two authors
  changing different fields or styles keep both; the same entry goes to the last writer.
  `notes`, `language` and each zone (`hf:i:key`) stay one value. A `StateStep` keeps whole
  values; mirroring it writes only the entries that differ between `from` and `to`. The
  client that brings the text fills the map with every store's entries before the history
  starts (`stateValues`); a joiner never does, and a zone gets its old value on its first
  write. A change the manager (or another client) makes there returns as a body
  transaction with the `STATE_RESTORED` meta, one `StateStep` per store, assembled from all
  its entries once the update's observers ran (earlier, the binding wrote the old document back): fields sorted, styles in their family's order, the rest by name, so every
  client builds the same value. The existing listeners apply it as an undo (`watch.write`,
  `writeZone`), so a page setup or a header goes back the way it does alone.
- **Grouping as in the history.** Yjs merges by time alone, so fast edits in different places
  became one step together with edits from before them. `undoYjs.ts` stops capturing where
  prosemirror-history would open a group: an edit not touching the last one's range (its
  `isAdjacentTo`), a side-store change on its own, `closeGroup`. A pause of 500 ms ends a
  step as before. A repeated `composition` meta keeps one step open. y-tiptap's own stop on
  every transaction outside the history is switched off, since a page-number round could
  otherwise split a typed word. The monkey test counts about as many steps on both (22/12/18, 22/14/19).
- **Delete filter.** y-tiptap keeps every paragraph with content on undo, so undoing an
  Enter left the new paragraph behind. Ours keeps an element only while it holds another
  client's live text or inline object (`collab-conflicts.md`, which the rescue then moves).
- **Labels** for the toolbar list ride the stack items (`meta.label`), read by `historyLog`.
  A document opened in a session clears the manager (`reset`) instead of re-creating the
  state, which would rebuild the sync plugin's binding.

Registering the sync plugins rebuilds every plugin view; `pageBreaks.ts`'s `destroy`
resets its timers, so the next view paginates.

### Checks

- `?undo=yjs` (dev server only) attaches the Yjs backend to a local doc.
  `UNDO=yjs npm run test:monkey` runs the monkey test on it: undo back to the opened
  file, redo forward, zones, recording.
- `node tests/collab/undo.mjs`: two clients, relayed by the script. Each undo takes back
  only its own client's typing, page layout, header and style, on both sides. An undo
  while recording leaves no recorded change. Two styles, a style added and another deleted,
  and margins against orientation, each changed on both sides before the updates cross or
  while the other's still gathers, all stay; idle, nothing is sent. An image dragged right
  after typing beside it reaches the other client and goes back in one undo, leaving the
  typing. In Chromium an IME composition (CDP's `Input.imeSetComposition`) while the other
  client's typing arrives ends as one word on both and goes back in one undo; Firefox and
  WebKit have no IME to drive (synthetic events take another path), so only by hand there.
- 177 pages (`05-breaks` × 100), one inserted character, median: 4.9 ms alone, 7.0 ms on
  Yjs. One undo: 9 ms against 19 ms.

Another author's change to a store whose own change still gathers in `noteState`'s 500 ms
window lands that change first (`commitState`, from the map's observer), so both authors'
entries stay and each undo takes its own. Not covered: `test:dom` runs the built app, which
has no `?undo=yjs`; cross-client grouping only the two-client test checks.

## Sessions

```
browser ──AES-256-GCM(kind byte + Yjs update / state vector / awareness / picture, in parts)──▶ relay ──▶ browsers
```

- **Two links, one secret** (`collab/key.ts`). *Collaborate…* makes 32 random bytes W, the
  write link `…#collab=<W>`. HKDF-SHA-256 derives from W the read key R and an Ed25519 seed;
  the read link `…#view=<R>.<public key>` cannot give W back. Browsers never send the part
  after `#`; the room, the same for both links, is a truncated SHA-256 of R. Every frame is
  sealed with AES-256-GCM under R and a fresh 12-byte nonce, in line order: WebCrypto in a secure
  context, else `@noble/ciphers` (same frames, so both mix). A write link writes until a new session.
- **Signed frames.** What changes a receiver's state (`UPDATE`, `OFFER`, whose delete set
  applies as an update, `ANSWER`, `PICTURE`, a writer's awareness, `PONG`) carries a
  signature by the writers' shared key, over the whole message before its parts and checked
  after they join; everyone drops it unsigned or badly signed. Readers send only `ASK`,
  `PULL`, `WANT`, `PING`, `ECHO`, `NOTHING` and `VIEWER` (name and colour, kept apart from the
  awareness: no caret, no zone, never asked for a picture, listed once its id answers a
  ping). They neither offer in a sync (they answer an `ASK` with `NOTHING`, unsigned, which counts as that one relay id's answer and changes nothing else) nor answer a `WANT`; with only readers there, a joiner
  waits as in an empty room. A reader's tab (`collab/reading.svelte.ts`) takes no input, has
  no assistant and opens no zone; once bound, a filter refuses every transaction with steps
  not from the shared doc (y-tiptap's sync meta, `STATE_RESTORED`), as commands run when not
  editable too. What still reaches its Yjs doc is never sent; leaving, it may keep a copy. Its UI: `src/lib/components/CLAUDE.md`.
- **Replays.** A signed awareness state takes effect only once its `peer` answered a fresh
  nonce (`PING`, signed `PONG`), and drops on the relay's `gone`: a replayed state of a
  writer who left holds no zone, also at a newcomer; those that saw it reject it by clock.
  Replayed updates, answers and pictures change nothing. A frame that names its sender (`from`, a presence's `peer`) is dropped unless the relay names the same, so one tab cannot pose as many readers or have answers sent to another client. A `gone` sent while a line was down never arrives: knowing more peers than the relay counts, a client pings each and drops those silent for 3 s.
- **Relay** (`relay/server.mjs`, `relay/CLAUDE.md`; hosting it: `collab-relay.md`): rooms as sets of sockets in memory,
  frames passed on unchanged, to the one client a clear `to` names where there is one (the
  sync's replies, pictures), nothing stored or logged, a receiver 2 MiB behind announced `slow` so the others hold its pictures back; `MAX_PEERS` counts connections,
  readers too, as the relay cannot tell them from writers. An id stays with the connection whose hello claimed it with a random secret, so no other client takes its frames or its `gone`; an app and a relay of different protocol versions say so (`mismatch`).
- **Where the relay is:** `VITE_COLLAB_RELAY` is a `wss://` URL, or `same-origin` for `/relay`
  beside the app (dev proxy, Docker, Helm), where sessions are offered only once
  `relay/health` answers. Embedded, there are none.
- **Sync** (`collab/session.ts`) once per welcome: `ASK`; every peer `OFFER`s its state
  vector and delete set. When all have (a reader with `NOTHING`), or 300 ms after the first offer, the asker `PULL`s an
  `ANSWER` from the offer ahead most, then from any still ahead, a later offer too. Only
  then do the offered delete sets apply (alone, one may empty what a pulled insert fills).
  Then it `UPDATE`s all at once what the non-empty offers lack (an empty one is a joiner,
  which pulls itself), edits pulled from others included, so an edit that reached only some
  clients reaches all; none lacking an edit or deletion, it sends nothing. A client without
  the doc asks again when someone comes. A sync ends with the line and restarts when the
  room shrinks or no peer frame comes for 10 s. Edits leave right after the change when
  none left in the last 50 ms, else in that batch (from a hidden tab, whose timers wait, always at once), the caret right after them; the rest of a presence (zone, name) goes at once, after the edits before it. Arriving edits apply at once while the last batch, with the page layout it set off, cost this tab under 8 ms, else gather for twice that cost (50–100 ms); a caret waits for the edits that came before it.
- **Parts and failures** (`collab/channel.ts`): a message beyond the welcome's `frame`
  (at most 256 kB) goes as sealed numbered parts. Edits, offers and answers over 1 kB are deflated first (`CompressionStream('deflate-raw')`, flagged in the sealed envelope; a browser without it sends them as they are), and every client inflates them with fflate a slice at a time, dropping one that would grow past 256 MiB. Such long messages and pictures wait in a bulk lane, sent part by part while the socket holds little, behind edits, carets, pings and the sync (`collab-pictures.md`); nothing goes to everyone while the relay counts nobody else. A receiver keeps at most four unfinished messages and 256 MiB per sender, which the relay puts in front of every frame, and drops them when the sender goes: a sender can fill only its own room. Retries back off from 0.5 to 30 s; three
  connections lost within 5 s of their welcome show `failing` until one holds for 5 s; a
  line silent for three `beat`s (15 s, a deadline each message sets anew, so a long-hidden tab's throttled timers do not hold it off) is taken as half-open and redialled. Back online, shown again or restored (`online`, `visibilitychange`, `pageshow`), a redial waiting goes at once from the shortest pause, and a line silent for a beat is redialled unless a message comes within a second (a tab back from a freeze hears what waited first); `offline` drops the line at once.
- **Start and join.** The starter puts its document, exported as `.odt` (`buildBytes`),
  into the map `meta` with the app version and the name, then binds the body
  (`attachYjsUndo`). A tab opened from the link waits for a peer and refuses another
  version. It loads that file through `applyImport` (fonts, layout, styles, zones,
  properties), binds the body to the received fragment, and applies the stores already in
  the map `state` (`applyState`); later store changes travel through that map.
- **Pictures** (`collab/pictures.ts`, `collab-pictures.md`) over 4 kB lie in the shared doc
  and its stores (headers, footers) as their key, `idb:<key>` as in autosave, the bytes in
  memory (`imageStore.ts`): the start file carries none, a new one goes to all as bytes
  (`PICTURE`) from whoever puts it in. One missing is asked of each other client in turn (`WANT`, awareness
  `peer`); a lack means not yet, so a newly confirmed client or one that got it since (`HAS`) is asked again; while nobody in the room has it: a grey box and a note. Files, autosave, clipboard and vector PDF get
  pictures; saving, printing, PDF and copying wait for one still on its way under a notice, and fail only when nobody here has it. Leaving puts them back in.
- **Headers and footers** go as whole zones, so one person edits a zone at a time
  (`collab/zones.svelte.ts`, awareness field `zone`): the others see the name at it and
  cannot open it. Opened at once, the higher client id yields and may lose its first keys.
  A closed tab frees it at once, a silent line (closed lid) when a relay ping fails, in 10 s.
- **Storage.** The starter's autosave stores everyone's edits; its awareness says `keeps`.
  A joining tab is `volatile` (no copy, slot or prune); a starter's reload does not rejoin.
  Leaving, a joiner is asked (`CollabDialog`'s `asking`) to keep the document: `leave.ts`
  puts JSON, `docStore` entries, pictures and fonts into a new slot and reloads there
  without the link; discarding reloads into the tab's own or an empty slot. Open, New or a
  template asks to leave first (`opening`), then opens alone (a joiner's in a new slot).
  Nobody `keeps` for 2 s: joiners get a notice, their tab warns on closing. Alone 5 s: `empty`.
- **Chat** (`collab/chat.svelte.ts`, `ChatPane.svelte`): short messages to everyone here, `CHAT` from writers (signed) and `SAY` from readers (unsigned, taken only from a listed reader), the text as UTF-8 and nothing else; who sent it is the relay's id, named from the lists, so a reader never shows under a writer's name. Only the tabs present hold them, in memory: not in the doc, a file, autosave or a later joiner's tab. A receiver drops texts over 2000 characters, more than five per sender in 10 s, and keeps the last 200; the sender keeps to both. Comings and goings are lines drawn from the lists, not sent. The field is shut while the line is not `live`; nothing waits to be sent. A chat frame leaves the channel's `heard` time alone, so steady chatting never hides a stalled sync.
- **Carets** (`carets.ts`) come from the awareness, in the person's (or recorded-change) colour, hidden in print: bars in a layer after the view, placed each frame the view changed, and selections as CSS highlights, as an element inside a word changes how the browser hyphenates and breaks it. y-tiptap's cursor plugin only publishes the own selection. y-tiptap's undo plugin
  destroys its manager on any `registerPlugin`, so `undoYjs.ts` keeps it until `detach`. **Presence** (`names.ts`, `presence.svelte.ts`, `CollabPeople.svelte`): without a name the dialog asks once on starting or joining (`naming`); skipped, one is `Guest n`, n from the relay id so every client agrees. A name is cut to 40 graphemes without control characters and only shown as text. A colour is picked on joining: the person's recorded-change colour, else one from the name, else the first free; of two with one colour (by `since`, then relay id) the later re-picks from what everyone shows, so nothing is added to the protocol and nobody's colour moves when another comes or goes. Up to four circles with initials (two below 600 px) stand before the session button, readers as rings, `+n` opens the list. A click scrolls to that person's caret (`data-client`) or held zone (`zone` and `zonePage` in the awareness, marked by `HeaderFooterLayer`), leaving the selection alone; Follow keeps it in view on each awareness change until this user scrolls, clicks or types, or the person leaves. Both only read what arrives anyway. Who came or went comes from the chat's lines: arrivals without a 2.5 s pause make one line, a departure waits 8 s for the same name and kind, so a reload says nothing; while the chat is shut they show bottom left (`CollabNews.svelte`).

### Checks

`node tests/collab/session.mjs` starts a relay and the dev server and goes through the File
menu. B joins by the link and gets A's document: JSON, pages and zones. Both type, and each
undo takes back only its own typing. A page setup and a style change arrive, the caret
shows with its name, each key goes as its edit and then its caret and applies on arrival, the relay's frames hold no typed text and no name, and an idle session
sends no updates. A 2.9 MB picture goes to the relay once, as bytes, and adds 0.5 kB to the
doc; B's copy, saved `.odt` and A's autosave hold it; five moves and a delete send 5 kB.
Frames carry at most 256 kB; a late joiner gets everything from one ask and one answer, the
picture from one client; a header's picture goes by its key too; replies go to their asker
alone; a fourth joins, types and converges. A joiner whose pulled peer drops its answer and
line, while a third types, still goes live; a late offer is pulled from and gets what it
lacks, and the others get what was pulled; one back from offline pauses on no offered deletion; a waiting joiner asks a client coming back, which pushes it no copy. B cannot open a
header A holds; opened together, the lower id keeps it; a closed tab frees it, a stalled line within two pings, a busy holder keeps it. A client back on its line drops a writer who left meanwhile, zone and all. Open and New
ask first, then open alone; others keep theirs. The starter leaves unasked, the others are
told and go on; a reload rejoins. A joiner keeping its copy reloads into it unwarned,
picture, styles and zones, also on a second reload. The last joiner's tab warns on closing;
a cut-short link and an empty room say so. A reader gets document, zones, styles and pictures
and follows typing; keys, paste, commands, undo, a header and the assistant change nothing
and it signs nothing, but a hint says why; each dialog shows its links. A patched reader's unsigned, falsely signed or altered updates,
offers, answers, pictures and presences change no document, zone, caret or list; replayed
presences hold no zone, at a newcomer neither. A reader dialling in under a writer's id gets none of its frames nor makes it leave or free its header, a picture asked for thirty times in one frame goes once, and forty readers made up in one tab are listed nowhere, while a real one still is. A reader in the room holds up no join, and a patched one answering an ask many times and under the starter's id, while the starter's offer is late, ends no sync early. A picture whose only holder leaves unsent is a
grey box with a note within seconds, as the relay says who left, and the line stays `live`. Pictures put in alone go nowhere; on a 2 MB/s uplink the starter's typing reaches a joiner within 1 s while its pictures still load, a save started then waits for them under a notice and holds them all, and a third joining meanwhile gets them all. Two writers and four
readers fill a room of six, so a seventh is refused; with the writers gone the reader is told, a new reader finds it
empty, and the reader's kept copy is editable. Chat: a writer's, a joiner's and a reader's messages reach the other two by name, the reader's marked, in one order; the relay sees no text or name, A's `.odt`, `.docx`, autosave and shared doc none either. The pane drags and keys wider, docks left beside the page and keeps both after a reload, apart from the comments pane's; a reload or a late joiner starts empty. A closed pane counts new messages without taking the typist's focus. A patched reader's unsigned or falsely signed `CHAT`, a `SAY` from an unlisted id and a 1 MB text show nowhere, 50 in a second at most five, markup as text, only `http(s)` addresses as links. Idle with the pane open, nothing is sent; a line down shuts the field and its return opens it. Taller lines (6 against 7 pages) stay quiet too. The assistant on the starter, answered by
the script (`page.route`): its text and page setup reach the joiner, which keeps its
recorded marks and adds none; the starter's undo takes back each on both sides. A relay
dropping every connection after its welcome makes the line `failing` (notice, 4–5
connections in 12 s) until it holds. A line that hears and sends nothing leaves `live`
within a few beats, asks nothing while down, and comes back; offline leaves `live` at once, and back online a line that is down is live again within 2 s. `tests/relay.test.ts` and
`tests/collab.test.ts` cover rooms, limits, beats, addressing, sealing, links, signatures, parts and their cap per sender, claimed ids and the protocol version. All
scripts run in the three engines (`BROWSER`); concurrent edits: `collab-conflicts.md`; load,
soak and typing speed: `collab-soak.md`. `node tests/collab/presence.mjs`: the name is asked once without one, never with one; two guests are named alike everywhere; six people, two of them Ben, get six colours that hold when one goes; a rename reaches circle, list and caret label; four circles, a fifth `+1`, a reader a ring; going to a caret on page five or a header keeps the selection and sends nothing; following holds over three pages, ends on scrolling and on leaving, works for a reader and stays quiet; one line per arrival, two at once in one, none for oneself or a reload; `@Ben` reaches Ben alone and stays plain text in the `.odt`; markup, 500 characters, blanks, an emoji and Arabic stay text.

### Limits

What anyone holding a link may ask of the others, measured 2026-11-13 (Chromium) per sender
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

Gaps: the relay keeps nothing, so a session lives only while someone is in it. Seen once, not on a rerun nor in five runs on a fresh dev server and dep cache (2026-11-11): in Firefox a joiner not live within 20 s on a just-started dev server. Writers share one signing key, so it tells writers from readers, not writers apart, and a
write link stays valid for the session. A reader can still cost the others what any participant can: asks
(`ASK`, `PULL`, `WANT`) in a loop, each answered in full, and connections up to `MAX_PEERS`. Readers alone in a room give nobody the doc. What pictures cost: `collab-pictures.md`.
