// What every speech recognizer offers the app (docs/architecture/dictation.md): one
// continuous session per start(), words as they come and as they settle. The editor side
// knows only this, so a local model or a provider's endpoint can stand in for Web Speech.

import { webSpeechEngines } from './webSpeech';
import { speechServerEngine, transcriptionUrl, type SpeechServer } from './speechServer';

/** Why a session ended on its own. */
export type DictationError = 'denied' | 'noMicrophone' | 'network' | 'language' | 'server' | 'failed';

export type EngineEvents = {
  /** The words heard so far that may still change; '' clears them. */
  interim(text: string): void;
  /** An engine without live text: a phrase is being recognized (true) or done (false). */
  busy(on: boolean): void;
  /** Words that will not change any more. */
  final(text: string): void;
  /** The session is over; stop() ends one without an error. */
  error(code: DictationError): void;
};

export interface DictationEngine {
  /** 'local' keeps the audio on this machine; 'cloud' sends it away and needs consent first. */
  readonly where: 'local' | 'cloud';
  /** The user's speech server on another machine, whose consent is asked for that host. */
  readonly host?: string;
  /** That server is the installation's own, which the consent says instead. */
  readonly installation?: boolean;
  /** Whether it reports words while they are spoken (`interim`) or only phrase by phrase (`busy`). */
  readonly live: boolean;
  /** Whether it writes the punctuation itself; then only the spoken breaks are commands. */
  readonly punctuates: boolean;
  /** Whether it can recognize `lang` now. */
  ready(lang: string): Promise<boolean>;
  /** Runs until stop() or an error, across the pauses after which a recognizer ends. */
  start(lang: string, events: EngineEvents): void;
  /** Ends the session; the words still being heard arrive as `final` unless discarded. */
  stop(discard?: boolean): void;
}

let web: DictationEngine[] | null = null;
let served: { key: string; engine: DictationEngine } | null = null;

/** Whether this browser can recognize speech itself (none in Firefox, Brave or the desktop app). */
export const browserRecognizes = (): boolean => (web ??= webSpeechEngines()).length > 0;

/**
 * The engines of the picked service in the order they are tried. A speech server is the
 * only one, so a session never drifts to another service. The browser's are its own local
 * recognition, then its cloud service, which the session uses only after consent.
 */
export function dictationEngines(server: SpeechServer | null = null): DictationEngine[] {
  if (server && transcriptionUrl(server.address)) {
    const key = `${server.address}\n${server.model}\n${!!server.installation}`;
    if (served?.key !== key) served = { key, engine: speechServerEngine(server) };
    return [served.engine];
  }
  web ??= webSpeechEngines();
  return [...web.filter((e) => e.where === 'local'), ...web.filter((e) => e.where === 'cloud')];
}
