# Dictation

A microphone button on the Home tab (and in the island's Home tools) types what is spoken
at the cursor. Recognition is the browser's own (Web Speech API); nothing in EdenText
records or uploads audio. Where the browser has no working recognizer the button is not
shown, and Settings ▸ Editing points to the system's dictation instead (Windows logo
key + H, Edit ▸ Start Dictation on macOS), which types into the editor like a keyboard.

## Where the audio goes: local first

`dictationEngines()` lists the engines in the order a session tries them, and the first
whose `ready(lang)` says yes takes it:

1. the browser's own recognition on this machine (`processLocally`, where
   `SpeechRecognition.available({ langs, processLocally: true })` answers `'available'`);
2. a local model (Stage 2, not built yet; see the measurements below);
3. the browser's cloud service (Google in Chrome and Edge, Apple in Safari), `where:
   'cloud'`, which is never the silent default: the first time it would run,
   `DictationConsent.svelte` asks, and only the yes, kept in `edentext-dictation`, lets it
   start. Settings ▸ Editing takes the yes back.

A language pack that is only `'downloadable'` is not installed by the app.

## Modules

| File | Role |
|---|---|
| `dictation/engine.ts` | The engine interface (`where`, `live`, `ready(lang)`, `start(lang, events)`, `stop(discard?)`; events `interim`, `busy`, `final`, `error`) and `dictationEngines()`, the order above |
| `dictation/webSpeech.ts` | Web Speech as two engines, local and cloud: continuous with interim results, restarted after each pause until stopped; five ends within a second each without a result give up as `failed`. Not offered in Electron or Brave, whose API has no service behind it |
| `dictation/session.svelte.ts` | The one app-wide session: listening, error, the language; routes `interim` and `final` to the editor with the focus (`bindDictation` in `App.svelte`) |
| `dictation/commands.ts` | `compose(before, text, lang, after)`: spoken commands, spacing and capitals, pure |
| `editor/extensions/dictation.ts` | `setDictationInterim` (plugin state, drawn over the page) and `insertDictation` |
| `storage/dictation.svelte.ts` | `edentext-dictation`: `{enabled, consent}`, absent at on/not consented |
| `components/DictationButton.svelte` | Both chromes' split button, its language menu and the error hint |

## Into the document

- **Interim words are no content.** They are plugin state, drawn as an element over the
  page at the selection (`overlay.ts`, in the run's font), so history, autosave, recording
  and the unsaved mark stay still, and the line breaks do not move. An engine without live
  text (`live: false`, a local model) reports `busy` instead, drawn as a waiting mark `…`.
- **A settled phrase is one transaction and one undo step** (`closeHistory`), inserted
  over the selection the ordinary way: it takes the marks at the cursor, and while changes
  are recorded it is the user's tracked insertion. AutoCorrect does not run on it
  (it reads typed characters only), so nothing is corrected twice.
- **The target is the editor with the focus at that moment**: the body (text boxes and
  notes are inside it) or an open header/footer zone. Moving the cursor moves the dictation.
- **Language**: the one picked in the button's menu for this session, else the run's or
  paragraph's at the cursor when the session starts, else the document's.
- **Stops** on the button, `Esc`, Alt+` (Word's key), the tab going to the background,
  another document (the words in flight are dropped), switching it off, focus moving into
  a field or a dialog outside the editors, a document that cannot be edited, and an engine
  error, which the button shows for a few seconds.

## Composing (`compose`)

Every rule only adds what is missing, so text from a recognizer that punctuates and
capitalizes itself passes unchanged, and one that writes out the words gets them replaced:

- Spoken commands per recognition language (`COMMANDS`, one row per primary subtag; German
  and English so far): new paragraph, new line, comma, period/full stop, question and
  exclamation mark, colon, semicolon. They are matched as whole words, so "Punkt" inside
  a sentence becomes a full stop, as in other dictation software.
- One space to a word on either side; no space before punctuation, except before `; : ! ?`
  in French, which keeps the recognizer's own; no spaces at all in Japanese and Chinese.
- A capital at a paragraph start, after a sentence end in the text before, and after each
  sentence end or break inside the phrase. Lowercase is never forced, since a recognizer's
  capital may be a noun.

## Measured: Web Speech (Phase 0, 2026-11-15, headless)

| Engine | `SpeechRecognition` | `available()` local / cloud (en-US, de-DE) | `start()` |
|---|---|---|---|
| Chromium 156 (Playwright) | yes, also `webkitSpeechRecognition` | `downloadable` / `available` | `not-allowed` without microphone permission; with a fake device: `start`, `audiostart`, runs |
| Electron 45.2.3 | yes | `unavailable` / `available` | `start`, `audiostart`, then `network`: no Google key, so the button stays hidden |
| WebKit 27.2 (Playwright) | no (Playwright's build lacks it; Safari has `webkitSpeechRecognition`) | – | – |
| Firefox 157 | no (behind a preference) | – | – |

Probe scripts: kept outside the repo. Brave hides the button by `navigator.brave`, by its
known `network` failure, not by measurement.

## Measured for the local model (Phase 0.5, 2026-11-15)

Transformers.js 4.3.2 (Apache-2.0) on onnxruntime-web 1.31 (MIT) in headless Chromium 156
on an Apple M1, `onnx-community/whisper-*` from the Hugging Face hub, multilingual models,
language given. WASM runs `q8` weights, WebGPU an `fp32` encoder with a `q4` decoder (the
library's usual WebGPU pair, hence the larger download). Input: four sentences per
language spoken by the macOS voices Anna (German) and Daniel (English), 2.7–3.2 s each,
fed as 16 kHz samples, one call per sentence as a pause detector would cut them. "First
text" is loading (download included, empty cache) plus the first sentence; "per sentence"
the mean time for one sentence after that. Error rate: word error rate over the 30 words
per language, case and punctuation ignored.

| Model | Backend | Download | First text de / en | Per sentence de / en | Error rate de / en |
|---|---|---|---|---|---|
| tiny | WASM | 41 MB | 3.7 s / 3.3 s | 0.9 s / 0.6 s | 19 % / 0 % |
| tiny | WebGPU | 120 MB | 6.8 s / 5.3 s | 0.9 s / 0.4 s | 14 % / 3 % |
| base | WASM | 77 MB | 7.2 s / 6.1 s | 1.9 s / 2.3 s | 0 % / 0 % |
| base | WebGPU | 206 MB | 9.0 s / 8.1 s | 1.0 s / 0.6 s | 19 % / 0 % |
| small | WASM | 249 MB | 19.8 s / 15.9 s | 8.4 s / 4.9 s | 0 % / 0 % |
| small | WebGPU | 586 MB | 28.3 s / 26.6 s | 2.1 s / 1.6 s | 0 % / 0 % |

- Synthetic voices in a quiet room are easy: the error rates rank the sizes, they do not
  predict a real speaker. tiny misheard German words ("mit Wachanderssekretariat" for
  "Mittwoch an das Sekretariat"); base with the `q4` decoder did the same, base with `q8`
  did not, so the decoder's quantization matters more than the backend.
- The download is once per browser (Cache API); "first text" after that drops to the
  model's load time plus one sentence.
- Licences: the OpenAI Whisper weights are MIT (GitHub) and Apache-2.0 (their Hugging Face
  cards); `onnx-community/whisper-small` says Apache-2.0, the tiny and base conversions name
  none of their own and point to the OpenAI models. To be settled before shipping one.
- Probe scripts and raw results stay outside the repo (no dependency was added).

## Measured: local engines across the twelve languages (Phase 0.6, 2026-11-15)

Same setup as above (headless Chromium 156, Apple M1, WebGPU adapter `apple`/`metal-3`
with `shader-f16`), now five sentences (about 40 words) per UI language, each spoken by a
native macOS voice: Anna, Daniel, Mónica, Thomas, Alice, Luciana (pt-BR), Milena, Lesya,
Melina, Kyoko, Tingting (zh-Hans) and Meijia (Taiwanese Mandarin, zh-Hant). Every language
has one. Synthetic speech in silence flatters every engine alike, so the rates rank the
engines; a real speaker will score worse on all of them.

- **Whisper** (Transformers.js): one call per finished sentence, as a pause detector would
  cut it; "lag" is that call's mean time, after one warm-up call. A real pause detector
  adds the silence it waits for (about 0.3–0.5 s) on top. Download counts every file.
- **Vosk** (`vosk-browser` 0.0.8, Kaldi in a worker, small models): the sentences streamed
  in 100 ms chunks at real-time pace with 1.5 s pauses. "Word" is how long after a word
  ends in the audio it first shows in the partial text; "final" is how long after the last
  word the settled result arrives, which includes Vosk's own end-of-speech wait.
- **Error rate**: WER, case and punctuation ignored; CER for ja and zh. For zh it is
  against the script asked for, with the rate after an OpenCC conversion in brackets.

| Language | Whisper base, WebGPU fp16/fp16 (146 MB) lag · error | Whisper base, WASM q8 (77 MB) lag · error | Whisper small, WebGPU fp16 (485 MB) lag · error | Vosk small: size · word / final · error |
|---|---|---|---|---|
| de | 0.5 s · 2 % | 1.1 s · 0 % | 1.3 s · 0 % | 47 MB · 0.29 / 1.27 s · 5 % |
| en | 0.5 s · 0 % | 1.1 s · 0 % | 1.2 s · 0 % | 41 MB · 0.34 / 1.05 s · 2 % |
| es | 0.5 s · 2 % | 1.1 s · 2 % | 1.4 s · 0 % | 40 MB · 0.29 / 1.22 s · 7 % |
| fr | 0.5 s · 10 % | 1.1 s · 12 % | 1.5 s · 8 % | 42 MB · 0.30 / 1.26 s · 0 % |
| it | 0.5 s · 13 % | 1.4 s · 10 % | 1.4 s · 8 % | 50 MB · 0.25 / 1.10 s · 0 % |
| pt | 0.5 s · 5 % | 1.1 s · 5 % | 1.3 s · 5 % | 32 MB · 0.49 / 1.48 s · 7 % |
| ru | 0.6 s · 6 % | 1.2 s · 18 % | 1.4 s · 9 % | 46 MB · 0.23 / 1.10 s · 9 % |
| uk | 0.7 s · 27 % | 1.2 s · 33 % | 1.6 s · 9 % | 78 MB (v3-nano) · 0.74 / 1.60 s · 30 % |
| el | 0.8 s · 33 % | 1.5 s · 37 % | 1.9 s · 19 % | no small model (only a 1.1 GB narrowband one) |
| ja | 0.6 s · 12 % | 1.1 s · 12 % | 1.6 s · 5 % | 50 MB · 0.41 / 0.84 s · 4 % |
| zh-Hans | 0.5 s · 28 % (0 %) | 1.2 s · 17 % (0 %) | 1.4 s · 30 % (3 %) | 44 MB · 0.32 / 1.10 s · 3 % |
| zh-Hant | 0.5 s · 3 % (3 %) | 1.1 s · 3 % (3 %) | 1.5 s · 32 % (5 %) | same model · 0.31 / 1.06 s · 47 % (3 %) |

- **Decoder precision**: fp16 on WebGPU kept the q8 accuracy (German 2 % against 19 % with
  `q4`) and is the fastest pair; a `q8` decoder on WebGPU took 0.8–2.0 s, as its integer
  operators run outside the GPU, and was not more accurate.
- **Weaker machine**: Chromium's CPU throttling ×4 (`Emulation.setCPUThrottlingRate`) put
  Whisper base on WASM at 3.6–4.5 s per sentence. It does not reach Vosk's worker, so for
  Vosk the compute alone was timed: 0.20–0.34 s per second of audio on the M1 (ja and zh
  the most), which leaves a machine four times slower at or past real time.
- **Chinese script**: Whisper writes Traditional for the Taiwanese voice but switches between
  Traditional and Simplified sentence by sentence for the mainland one; Vosk and the other
  streaming candidate write Simplified only. Either way the text needs an OpenCC conversion
  to the asked-for script, after which both are at 0–5 %.
- **Vosk output** has no punctuation and no capitals (German nouns come lowercase), writes
  ja and zh as space-separated words, and `vosk-browser` has had no release since 2022.
  All models above are Apache-2.0; the Ukrainian one is the v3 nano model.
- **Streaming alternative**: sherpa-ncnn's streaming Zipformer (k2-fsa's WASM build,
  Apache-2.0, 141 MB, bilingual Chinese and English only) showed text 0.25–0.4 s after the
  end of speech, at 2 % WER in English (uppercase, unpunctuated, the first two words of
  the stream lost) and 2 % CER in Chinese (Simplified); compute 0.23–0.28 s per audio
  second, 0.8–0.9 with ×4 throttling. No such build exists for the other ten languages.

**Conclusion.** Whisper base on WebGPU with an fp16 encoder and decoder meets the
1–1.5 s bound with room to spare (0.5–0.8 s plus the pause detector) and is accurate
enough for de, en, es, pt and ru, with fr and it close behind; zh needs the script
conversion, ja is borderline. It is not for uk and el, where only Whisper small comes near
(9 % and 19 %, 1.6–1.9 s, 485 MB). Without WebGPU the WASM fallback is fluid only on a
fast machine. Vosk is the only option with live words (0.2–0.5 s) and is small and
accurate for the Romance languages, ja and zh, but lacks punctuation and capitals and
Greek, and an unmaintained runtime.

## Check by hand

Real recognition needs a microphone, a person and the browser's service:

- [ ] Chrome: one paragraph in German and one in English; whether the engine punctuates
      and capitalizes itself, and whether spoken "Komma"/"comma" arrives as a word or a mark.
- [ ] Safari: the same; whether final results come in pieces that need joining, and how
      soon a session ends (the restart should hide it).
- [ ] Edge: starts and returns text.
- [ ] Chrome with a language pack installed (`processLocally`): no consent question, works offline.
- [ ] Brave and Firefox: no button; Settings shows the system-dictation hint.
- [ ] macOS dictation (Edit ▸ Start Dictation) and Windows Win+H in the body, a header, a
      text box and a footnote, also while changes are recorded.
- [ ] Microphone permission denied, no microphone, offline: the button's hint names it.

## Desktop and embed

Electron has no working engine (above), so the button stays hidden in the desktop app and
its microphone permission, the macOS usage description and entitlement and the Flatpak
`--socket=pulseaudio` come with the local model (Stage 2). The embed option
`dictation: false` and `microphone` in `public/embed.js`'s `allow` wait for the embed
packaging branch.

## Later

The local model (Stage 2) is the second engine; the AI provider's transcription endpoint
could be a third. Both bring dictation to Firefox, Brave and the desktop app.
