// The user's own speech recognition server (docs/architecture/dictation-local.md): the
// microphone is cut into phrases at pauses, each goes as a 16 kHz WAV to an OpenAI-compatible
// transcription route the moment it ends, and the texts settle in the order spoken.

import type { DictationEngine, DictationError, EngineEvents } from './engine';
import { listen, type Microphone } from './microphone';

/** `installation`: the server the page's own installation runs, named so in the consent. */
export type SpeechServer = { address: string; model: string; installation?: boolean };

const RATE = 16000;
const REQUEST_MS = 30_000;

/** Where phrases are posted: a bare address or one ending in /v1 gets the OpenAI route,
 *  any other path is taken as is (whisper.cpp's /inference takes the same form). A path
 *  alone is on the page's own server, as an installation's proxy is. */
export function transcriptionUrl(address: string): string | null {
  let s = address.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s) && !s.startsWith('/')) s = `http://${s}`;
  try {
    const u = new URL(s, location.href);
    const path = u.pathname.replace(/\/+$/, '');
    if (!path) u.pathname = '/v1/audio/transcriptions';
    else if (path.endsWith('/v1')) u.pathname = `${path}/audio/transcriptions`;
    return u.href;
  } catch {
    return null;
  }
}

/** Whether the server runs on this machine, so the audio never crosses a network. */
export function loopback(url: string): boolean {
  const host = new URL(url).hostname;
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\./.test(host);
}

/** Mono samples as a 16-bit PCM WAV file. */
export function wav(samples: Float32Array, rate = RATE): Blob {
  const data = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const tag = (at: number, s: string) => { for (let i = 0; i < 4; i++) data.setUint8(at + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); data.setUint32(4, 36 + samples.length * 2, true); tag(8, 'WAVE');
  tag(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
  data.setUint32(24, rate, true); data.setUint32(28, rate * 2, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true);
  tag(36, 'data'); data.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => data.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return new Blob([data.buffer], { type: 'audio/wav' });
}

// Down to 16 kHz by averaging each output sample's span of input, a box filter that keeps speech.
function resample(pcm: Float32Array, from: number): Float32Array {
  if (from === RATE) return pcm;
  const step = from / RATE;
  const out = new Float32Array(Math.floor(pcm.length / step));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * step), b = Math.max(a + 1, Math.floor((i + 1) * step));
    let sum = 0;
    for (let k = a; k < b; k++) sum += pcm[k];
    out[i] = sum / (b - a);
  }
  return out;
}

/** A refusal with the server's own words, or no answer at all ('network'). */
export class SpeechServerError extends Error {
  constructor(readonly code: DictationError, detail = '') { super(detail); }
}

function detail(json: unknown, body: string, status: number): string {
  const j = json as { error?: string | { message?: string }; detail?: unknown } | null;
  const said = typeof j?.error === 'string' ? j.error : j?.error?.message ?? (typeof j?.detail === 'string' ? j.detail : '');
  return said || body.slice(0, 120).trim() || `HTTP ${status}`;
}

/** The text the server hears in `audio`; `lang` goes as its ISO 639-1 code. */
export async function transcribe(server: SpeechServer, lang: string, audio: Blob, signal?: AbortSignal): Promise<string> {
  const url = transcriptionUrl(server.address);
  if (!url) throw new SpeechServerError('server');
  const form = new FormData();
  form.append('file', audio, 'phrase.wav');
  if (server.model.trim()) form.append('model', server.model.trim());
  const language = lang.toLowerCase().split(/[-_]/)[0];
  if (/^[a-z]{2,3}$/.test(language)) form.append('language', language);
  form.append('response_format', 'json');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', body: form, signal: ctrl.signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new SpeechServerError('network', e instanceof Error ? e.message : '');
    }
    const body = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(body); } catch { /* not JSON: reported below */ }
    const text = (json as { text?: unknown } | null)?.text;
    if (!res.ok || typeof text !== 'string') throw new SpeechServerError('server', detail(json, body, res.status));
    // whisper.cpp marks silence and noise in brackets.
    return text.replace(/\[[A-Z_ ]+\]/g, '').trim();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Half a second of silence through the whole route: address, CORS, model and reply. */
export async function checkSpeechServer(server: SpeechServer, lang: string): Promise<void> {
  await transcribe(server, lang, wav(new Float32Array(RATE / 2)));
}

// The pause detector: 20 ms windows against the room's noise floor, the quietest window of
// the last 3 s, held while a phrase runs. A phrase starts at a loud window (with a little
// audio before it) and ends after a pause; a long one at a shorter pause, any at 28 s.
const WINDOW_S = 0.02;
const FLOOR_S = 3;
const SETTLE_S = 0.3;
const PAUSE_S = 0.6;
const SHORT_PAUSE_S = 0.2;
const PREROLL_S = 0.3;
const MIN_SPEECH_S = 0.2;
const LONG_S = 15;
const MAX_S = 28;
const MIN_LOUD = 0.01;

/** Cuts a stream of samples at `rate` into phrases at pauses. */
export class PhraseCutter {
  private readonly size: number;
  private part: number[] = [];
  private windows: Float32Array[] = [];
  private levels: number[] = [];
  private threshold = MIN_LOUD;
  private inPhrase = false;
  private loud = 0;
  private quiet = 0;

  constructor(private readonly rate: number, private readonly emit: (pcm: Float32Array) => void) {
    this.size = Math.round(rate * WINDOW_S);
  }

  push(samples: Float32Array): void {
    for (const v of samples) {
      this.part.push(v);
      if (this.part.length === this.size) {
        this.window(Float32Array.from(this.part));
        this.part = [];
      }
    }
  }

  /** Ends the phrase in progress, as at a pause. */
  flush(): void {
    if (this.inPhrase) this.cut();
    this.part = [];
  }

  private window(w: Float32Array): void {
    let sum = 0;
    for (const v of w) sum += v * v;
    const rms = Math.sqrt(sum / w.length);
    // The first moments only measure the room, so a noisy one does not open a phrase.
    const settled = this.levels.length >= SETTLE_S / WINDOW_S;
    if (!this.inPhrase && settled) this.threshold = Math.max(MIN_LOUD, 3 * Math.min(...this.levels));
    const loud = settled && rms > this.threshold;
    this.levels.push(rms);
    if (this.levels.length > FLOOR_S / WINDOW_S) this.levels.shift();
    this.windows.push(w);
    if (!this.inPhrase) {
      if (loud) [this.inPhrase, this.loud, this.quiet] = [true, 1, 0];
      else if (this.windows.length > PREROLL_S / WINDOW_S) this.windows.shift();
      return;
    }
    if (loud) [this.loud, this.quiet] = [this.loud + 1, 0];
    else this.quiet++;
    const length = this.windows.length * WINDOW_S, pause = this.quiet * WINDOW_S;
    if (pause >= PAUSE_S || (length >= LONG_S && pause >= SHORT_PAUSE_S) || length >= MAX_S) this.cut();
  }

  private cut(): void {
    // Most of the trailing pause stays out; the recognizer needs only a short tail.
    const keep = this.windows.length - Math.max(0, this.quiet - SHORT_PAUSE_S / WINDOW_S);
    if (this.loud * WINDOW_S >= MIN_SPEECH_S) {
      const pcm = new Float32Array(keep * this.size);
      this.windows.slice(0, keep).forEach((w, i) => pcm.set(w, i * this.size));
      this.emit(pcm);
    }
    [this.windows, this.inPhrase, this.loud, this.quiet] = [[], false, 0, 0];
  }
}

function micError(e: unknown): DictationError {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') return 'noMicrophone';
  return 'failed';
}

/** The engine for the user's server: no live text, a waiting mark while phrases are out. */
export function speechServerEngine(server: SpeechServer, microphone = listen): DictationEngine {
  const url = transcriptionUrl(server.address) ?? '';
  const remote = !!url && !loopback(url);
  type Session = { stop(discard: boolean): void };
  let session: Session | null = null;
  // The session stopped last, whose phrases may still be out.
  let ended: Session | null = null;
  return {
    where: remote ? 'cloud' : 'local',
    host: remote ? new URL(url).host : undefined,
    installation: server.installation,
    live: false,
    punctuates: true,
    ready: async () => !!url,
    start(lang, events) {
      session?.stop(true);
      session = run(server, lang, events, microphone);
    },
    stop(discard = false) {
      session?.stop(discard);
      if (discard) ended?.stop(true);
      ended = discard ? null : session ?? ended;
      session = null;
    },
  };
}

function run(server: SpeechServer, lang: string, events: EngineEvents, microphone: typeof listen) {
  const ctrl = new AbortController();
  // Over after an error or a discarding stop: nothing more is sent or inserted.
  let over = false;
  let stopped = false;
  let mic: Microphone | null = null;
  let cutter: PhraseCutter | null = null;
  let out = 0;
  let order = Promise.resolve();

  const fail = (code: DictationError) => {
    if (over) return;
    over = true;
    ctrl.abort();
    mic?.stop();
    events.busy(false);
    events.error(code);
  };
  // Every phrase goes out at once; the answers are inserted one after another, in order.
  const send = (pcm: Float32Array, rate: number) => {
    if (over) return;
    out++;
    events.busy(true);
    const heard = transcribe(server, lang, wav(resample(pcm, rate)), ctrl.signal);
    heard.catch(() => {});
    order = order.then(async () => {
      try {
        const text = await heard;
        if (!over && text) events.final(text);
      } catch (e) {
        fail(e instanceof SpeechServerError ? e.code : 'failed');
      } finally {
        if (--out === 0 && !over) events.busy(false);
      }
    });
  };

  microphone((samples) => cutter?.push(samples)).then((m) => {
    if (stopped || over) return m.stop();
    mic = m;
    cutter = new PhraseCutter(m.rate, (pcm) => send(pcm, m.rate));
  }, (e) => fail(micError(e)));

  return {
    stop(discard: boolean) {
      stopped = true;
      if (discard) {
        over = true;
        ctrl.abort();
      } else cutter?.flush();
      mic?.stop();
    },
  };
}
