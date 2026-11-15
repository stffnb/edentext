// What every speech recognizer offers the app (docs/architecture/dictation.md): one
// continuous session per start(), words as they come and as they settle. The editor side
// knows only this, so a local model or a provider's endpoint can stand in for Web Speech.

import { webSpeechEngines } from './webSpeech';

/** Why a session ended on its own. */
export type DictationError = 'denied' | 'noMicrophone' | 'network' | 'language' | 'failed';

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
  /** Whether it reports words while they are spoken (`interim`) or only phrase by phrase (`busy`). */
  readonly live: boolean;
  /** Whether it can recognize `lang` now. */
  ready(lang: string): Promise<boolean>;
  /** Runs until stop() or an error, across the pauses after which a recognizer ends. */
  start(lang: string, events: EngineEvents): void;
  /** Ends the session; the words still being heard arrive as `final` unless discarded. */
  stop(discard?: boolean): void;
}

/**
 * The engines this browser has, in the order they are tried: the browser's own local
 * recognition, then a local model (none yet), and the browser's cloud service last,
 * which the session uses only after the user agreed to it.
 */
export function dictationEngines(): DictationEngine[] {
  const web = webSpeechEngines();
  return [...web.filter((e) => e.where === 'local'), ...web.filter((e) => e.where === 'cloud')];
}
