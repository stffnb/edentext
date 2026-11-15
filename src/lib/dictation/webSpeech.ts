// The browser's own recognizer (Web Speech API): Chrome and Edge send the audio to
// Google unless the language is installed locally (`processLocally`), Safari to Apple.

import type { DictationEngine, DictationError, EngineEvents } from './engine';

type Alternative = { transcript: string };
type Result = { isFinal: boolean; length: number; [i: number]: Alternative };
type Recognition = EventTarget & {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: { length: number; [i: number]: Result } }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionClass = {
  new (): Recognition;
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>;
};

const ERRORS: Record<string, DictationError> = {
  'not-allowed': 'denied',
  'service-not-allowed': 'denied',
  'audio-capture': 'noMicrophone',
  network: 'network',
  'language-not-supported': 'language',
};
// Silence and our own abort end a recognition without ending the session.
const BENIGN = new Set(['no-speech', 'aborted']);
// A recognizer that ends this often in a row without hearing anything is not coming back.
const QUICK_END_MS = 1000;
const QUICK_ENDS = 5;

function recognitionClass(): RecognitionClass | null {
  const w = globalThis as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Electron and Brave ship the API without access to Google's service: every start ends
// in 'network', and Electron 45 has no local recognition either (measured), so neither
// gets a button that cannot work.
function serviceMissing(): boolean {
  return typeof navigator !== 'undefined' && (/\bElectron\//.test(navigator.userAgent) || 'brave' in navigator);
}

/** The browser's recognizer twice: on this machine where it has the language, and its cloud service. */
export function webSpeechEngines(): DictationEngine[] {
  const SR = recognitionClass();
  if (!SR || serviceMissing()) return [];
  const available = SR.available;
  const local = recognizer(SR, 'local', async (lang) => {
    if (!available) return false;
    try {
      return (await available.call(SR, { langs: [lang], processLocally: true })) === 'available';
    } catch {
      return false;
    }
  });
  return [local, recognizer(SR, 'cloud', async () => true)];
}

function recognizer(SR: RecognitionClass, where: 'local' | 'cloud', ready: (lang: string) => Promise<boolean>): DictationEngine {
  let rec: Recognition | null = null;
  let stopped = true;

  return {
    where,
    live: true,
    ready,

    start(lang, events: EngineEvents) {
      rec?.abort();
      stopped = false;
      let startedAt = 0;
      let quickEnds = 0;
      const r = new SR();
      rec = r;
      r.lang = lang;
      r.continuous = true;
      r.interimResults = true;
      if (where === 'local') r.processLocally = true;
      const fail = (code: DictationError) => {
        if (stopped || rec !== r) return;
        stopped = true;
        r.abort();
        events.interim('');
        events.error(code);
      };
      r.onresult = (e) => {
        quickEnds = 0;
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const text = e.results[i][0]?.transcript ?? '';
          if (e.results[i].isFinal) {
            events.interim('');
            if (text.trim()) events.final(text);
          } else interim += text;
        }
        events.interim(interim);
      };
      r.onerror = (e) => { if (!BENIGN.has(e.error)) fail(ERRORS[e.error] ?? 'failed'); };
      const begin = () => {
        startedAt = Date.now();
        try { r.start(); } catch { fail('failed'); }
      };
      // A recognizer ends after a pause; the session goes on until the user stops it.
      r.onend = () => {
        if (stopped || rec !== r) return;
        events.interim('');
        quickEnds = Date.now() - startedAt < QUICK_END_MS ? quickEnds + 1 : 0;
        if (quickEnds >= QUICK_ENDS) fail('failed');
        else begin();
      };
      begin();
    },

    stop(discard = false) {
      stopped = true;
      // stop() lets the words already spoken arrive as a final result; abort() drops them.
      if (discard) rec?.abort();
      else rec?.stop();
    },
  };
}
