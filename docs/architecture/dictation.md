# Dictation

A microphone button on the Home tab (and in the island's Home tools) types what is spoken
at the cursor. Recognition is the browser's own (Web Speech API) or, once the user enters
one, their own speech recognition server (`dictation-local.md`); no speech model ships
with EdenText.
Where neither works the button is not shown, and Settings ▸ Editing points to the
system's dictation instead (Windows logo key + H, Edit ▸ Start Dictation on macOS), which
types into the editor like a keyboard.

## Where the audio goes: local first

`dictationEngines()` lists the engines in the order a session tries them, and the first
whose `ready(lang)` says yes takes it. The dictation service picked in Settings ▸ Editing
(`dictationService()`, `dictation-local.md`) decides which: a speech server is then the only
engine, so a failing server ends the session with its error instead of drifting to
another service. With the browser picked:

1. the browser's own recognition on this machine (`processLocally`, where
   `SpeechRecognition.available({ langs, processLocally: true })` answers `'available'`);
2. the browser's cloud service (Google in Chrome and Edge, Apple in Safari), `where:
   'cloud'`, which is never the silent default: the first time it would run,
   `DictationConsent.svelte` asks, and only the yes, kept in `edentext-dictation`, lets it
   start. Settings ▸ Editing takes the yes back.

A language pack that is only `'downloadable'` is not installed by the app.

## Modules

| File | Role |
|---|---|
| `dictation/engine.ts` | The engine interface (`where`, `live`, `ready(lang)`, `start(lang, events)`, `stop(discard?)`; events `interim`, `busy`, `final`, `error`) and `dictationEngines()`, the order above |
| `dictation/speechServer.ts` | The user's speech server: `PhraseCutter` (the pause detector), WAV encoding, `transcribe()` and the engine (`live: false`) |
| `dictation/microphone.ts`, `capture.worklet.js` | `getUserMedia` into an AudioWorklet that hands the samples to the page |
| `dictation/webSpeech.ts` | Web Speech as two engines, local and cloud: continuous with interim results, restarted after each pause until stopped; five ends within a second each without a result give up as `failed`. Not offered in Electron or Brave, whose API has no service behind it |
| `dictation/session.svelte.ts` | The one app-wide session: listening, error, the language; routes `interim` and `final` to the editor with the focus (`bindDictation` in `App.svelte`) |
| `dictation/commands.ts` | `compose(before, text, lang, after)`: spoken commands, spacing and capitals, pure |
| `editor/extensions/dictation.ts` | `setDictationInterim` (plugin state, drawn over the page) and `insertDictation` |
| `storage/dictation.svelte.ts` | `edentext-dictation`: `{enabled, consent, server, model, serverConsent}`, absent while all are at their defaults |
| `components/DictationButton.svelte` | Both chromes' split button, its language menu and the error hint |

## Into the document

- **Interim words are no content.** They are plugin state, drawn as an element over the
  page at the selection (`overlay.ts`, in the run's font), so history, autosave, recording
  and the unsaved mark stay still, and the line breaks do not move. An engine without live
  text (`live: false`, the speech server) reports `busy` instead, drawn as a waiting mark `…`.
- **A settled phrase is one transaction and one undo step** (`closeHistory`), inserted
  over the selection the ordinary way: it takes the marks at the cursor, and while changes
  are recorded it is the user's tracked insertion. AutoCorrect does not run on it
  (it reads typed characters only), so nothing is corrected twice.
- **The target is the editor with the focus at that moment**: the body (text boxes and
  notes are inside it) or an open header/footer zone. Moving the cursor moves the dictation.
- **Language**: the one picked in the button's menu for this session, else the run's or
  paragraph's at the cursor when the session starts, else the document's.
- **Stops** on the button, `Esc`, Alt+` (Word's key), the tab going to the background,
  another document (the words in flight are dropped, also those of a session stopped just before), switching it off, focus moving into
  a field or a dialog outside the editors, a document that cannot be edited, and an engine
  error, which the button shows for a few seconds.

## Composing (`compose`)

Text the recognizer wrote keeps its marks and capitals (an abbreviation's stop starts no
sentence); only what a command set is ours to finish:

- Spoken commands per recognition language (`COMMANDS`, one row per primary subtag; German
  and English so far): new paragraph, new line, comma, period/full stop, question and
  exclamation mark, colon, semicolon. They are matched as whole words, so "Punkt" inside
  a sentence becomes a full stop, as in other dictation software. A command takes the comma
  before it and the marks after it along, which a punctuating recognizer adds ("New
  paragraph."). An engine that `punctuates` (the speech server) gets the two breaks only.
- One space to a word on either side; no space before punctuation, except before `; : ! ?`
  in French, which keeps the recognizer's own; no spaces at all in Japanese and Chinese.
- A capital at a paragraph start, after a sentence end in the text before (not after a
  single letter's stop, as in "e.g."), and inside the phrase after a sentence mark or
  paragraph a command set. Lowercase is never forced, since a recognizer's capital may be a noun.

## Measured: Web Speech (Phase 0, 2026-11-15, headless)

| Engine | `SpeechRecognition` | `available()` local / cloud (en-US, de-DE) | `start()` |
|---|---|---|---|
| Chromium 156 (Playwright) | yes, also `webkitSpeechRecognition` | `downloadable` / `available` | `not-allowed` without microphone permission; with a fake device: `start`, `audiostart`, runs |
| Electron 45.2.3 | yes | `unavailable` / `available` | `start`, `audiostart`, then `network`: no Google key, so the button stays hidden |
| WebKit 27.2 (Playwright) | no (Playwright's build lacks it; Safari has `webkitSpeechRecognition`) | – | – |
| Firefox 157 | no (behind a preference) | – | – |

Probe scripts: kept outside the repo. Brave hides the button by `navigator.brave`, by its
known `network` failure, not by measurement. The measurements of models in the browser
are in `dictation-local.md`.

## Check by hand

Real recognition needs a microphone, a person and the browser's service:

- [ ] Chrome: one paragraph in German and one in English; whether the engine punctuates
      and capitalizes itself, and whether spoken "Komma"/"comma" arrives as a word or a mark.
- [ ] Safari: the same; whether final results come in pieces that need joining, and how
      soon a session ends (the restart should hide it).
- [ ] Edge: starts and returns text.
- [ ] Chrome with a language pack installed (`processLocally`): no consent question, works offline.
- [ ] Brave and Firefox: no button; Settings shows the system-dictation hint.
- [ ] A speech server with a real microphone in Firefox, Brave, Safari (mixed content from
      `https`) and the signed desktop app on macOS (microphone prompt, no crash).
- [ ] macOS dictation (Edit ▸ Start Dictation) and Windows Win+H in the body, a header, a
      text box and a footnote, also while changes are recorded.
- [ ] Microphone permission denied, no microphone, offline: the button's hint names it.

## Desktop and embed

Electron has no working Web Speech engine (above), so the desktop app dictates only
through a speech server; its microphone permission, entitlement and Flatpak socket are
in `dictation-local.md`. The embed option `dictation: false` and `microphone` in `public/embed.js`'s
`allow` wait for the embed packaging branch.

## Later

A model inside the app is not planned: none is bundled in the source or in `dist/`. The AI
provider's transcription endpoint could be a further engine on the same route as the
speech server.
