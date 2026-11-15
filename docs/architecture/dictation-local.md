# Dictation: local recognition

The user's own speech recognition server, the engine that brings dictation to Firefox,
Brave and the desktop app, and the measurements of speech models running in the browser.
None of them ships with EdenText, in the source or in `dist/`; the user brings the
server. The feature as a whole is in `dictation.md`.

## The speech server engine

For browsers without a working recognizer (Firefox, Brave, the desktop app) and for anyone
who wants the audio to stay on their machine, Settings ▸ Editing takes the address of the
user's own recognition server, an optional model name and a "Test connection" button,
which posts half a second of silence through the whole route.

- **Protocol**: OpenAI's `POST /v1/audio/transcriptions`, multipart with `file` (16 kHz
  mono 16-bit WAV), `model` when set, `language` (the primary subtag of the recognition
  language) and `response_format=json`; the reply's `text` is the phrase. A bare address
  or one ending in `/v1` gets that route; any other path is used as entered, so
  whisper.cpp's native `http://localhost:8080/inference`, which takes the same fields and
  answers `{"text": …}`, works too. whisper.cpp's `[BLANK_AUDIO]` marks are dropped.
- **Phrases**: `PhraseCutter` measures 20 ms windows against the room's noise floor (the
  quietest window of the last 3 s, held while a phrase runs; the first 0.3 s only measure).
  A phrase starts at a window three times louder than the floor, with 0.3 s before it,
  ends after a 0.6 s pause, and is sent the moment it ends. Past 15 s a 0.2 s pause cuts
  it, at 28 s it is cut anyway (Whisper's window is 30 s); under 0.2 s of sound is dropped.
  Requests run in parallel and their texts are inserted in the order spoken, each through
  `compose()` as one transaction, like a Web Speech final result. While phrases are out
  the cursor shows the waiting mark.
- **Errors**: no answer (address, CORS, mixed content, a 30 s timeout) is `network`, a
  refusal or a reply without `text` is `server`; either ends the session and shows at the
  button. The test in Settings adds the server's own message.
- **Consent**: a server on `localhost`, `*.localhost`, `127.x.x.x` or `[::1]` keeps the
  audio on this machine and needs none. Any other host asks once (`serverConsent` keeps
  the host agreed to; another address asks again).

**The installation's server**: `dictation: { enabled, server, model, locked }` in
`edentext.config.json` or the embed option (`ai.md` has the file's rules) presets it.
`dictationServer()` takes it while it is locked or the user has no address of their own; a
model typed over it still counts, and `enabled: false` hides dictation. A path alone
(`/stt/v1`, the Helm chart's and Docker image's proxy) is on the page's own server. Off
loopback the consent names the installation's server instead of "another computer", once
per host. It brings dictation to Firefox and Brave, and its failure ends the session at
the button like the user's own; nothing falls back to Web Speech.

**Setting one up** (both measured or read from their sources, 2026-11-15):

```sh
# whisper.cpp: built from source, CORS is on by default
sh ./models/download-ggml-model.sh base
./build/bin/whisper-server -m models/ggml-base.bin --port 8080 --inference-path /v1/audio/transcriptions
#   address http://localhost:8080 (without --inference-path: http://localhost:8080/inference)

# speaches (faster-whisper): needs ALLOW_ORIGINS for CORS and a model name
docker run --rm -p 8000:8000 -e ALLOW_ORIGINS='["*"]' -v hf-hub-cache:/home/ubuntu/.cache/huggingface/hub ghcr.io/speaches-ai/speaches:latest-cpu
uvx speaches-cli model download Systran/faster-whisper-small
#   address http://localhost:8000, model Systran/faster-whisper-small
```

Measured with whisper.cpp 1.9.5 (`ggml-base.bin`, Metal, Apple M1) through Chromium's fake
microphone playing three English sentences with 1.2 s pauses: each sentence was in the
document about 1.3 s after it ended, 0.6 s of that the pause, on both routes.

**What the browser must allow:**

- **CORS**: the page calls the server from its own origin, so the server must answer with
  `Access-Control-Allow-Origin` (`*` or the app's origin) and answer an `OPTIONS`
  preflight, which a browser's local-network check may send.
- **CSP**: `connect-src` already allows any `http:`/`https:` URL, and the worklet is a file
  of the app (`?no-inline`: `script-src` has no `data:`), so the policy needs no change.
- **Mixed content**: an `https://` page may call `http://localhost` and `http://127.0.0.1`
  in Chrome, Edge and Firefox, which treat loopback as secure; recent Chrome asks once for
  access to local network devices. Safari can block it as mixed content: there, serve the
  server over `https` or open EdenText itself over `http://localhost`. A server on another
  machine needs `https` from an `https` page in every browser. The desktop app
  (`app://edentext`) reaches `http://localhost` like Chrome.
- **Desktop**: `main.mjs` grants the `media` permission for audio only, never the camera;
  the macOS build carries `NSMicrophoneUsageDescription` and the
  `com.apple.security.device.audio-input` entitlement (`desktop/entitlements.mac.plist`,
  with electron-builder's defaults), the Flatpak `--socket=pulseaudio`.

## Measured: a model in the browser (Phase 0.5, 2026-11-15)

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
