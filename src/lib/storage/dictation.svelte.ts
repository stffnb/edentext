// Dictation's settings: the switch, the service picked, the consent to send audio to the
// browser's speech service, and the user's own speech server with the host it was given for.
// App-wide, one JSON key that exists only once a field differs from the default; in embed
// mode it lasts for the page only, like the AI's key.

import { embedded } from '../embed/mode';
import { hostDictation } from './hostConfig.svelte';
import type { SpeechServer } from '../dictation/speechServer';

/** Opens Settings at the dictation rows, e.g. from the microphone button's menu. */
export const OPEN_DICTATION_SETTINGS_EVENT = 'edentext-dictation-settings';

/** Where speech is recognized: the installation's server, the user's own, or the browser. */
export type DictationService = 'installation' | 'own' | 'browser';
/** `service`: the user's pick, '' for the first one offered. */
export type DictationSettings = { enabled: boolean; service: DictationService | ''; consent: boolean; server: string; model: string; serverConsent: string };

const KEY = 'edentext-dictation';
const DEFAULTS: DictationSettings = { enabled: true, service: '', consent: false, server: '', model: '', serverConsent: '' };

const text = (v: unknown) => (typeof v === 'string' ? v : '');

function load(): DictationSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return raw && typeof raw === 'object'
      ? { enabled: raw.enabled !== false, service: ['installation', 'own', 'browser'].includes(raw.service) ? raw.service : '', consent: raw.consent === true, server: text(raw.server), model: text(raw.model), serverConsent: text(raw.serverConsent) }
      : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = $state(load());

export function dictationSettings(): DictationSettings { return current; }

/** Switched off by the installation or an embedding host, above the user's own switch. */
export function dictationHostOff(): boolean { return hostDictation().enabled === false; }

/** The installation's speech server, if it runs one. */
export function installationServer(): SpeechServer | null {
  const h = hostDictation();
  return h.server ? { address: h.server, model: h.model ?? '', installation: true } : null;
}

/** The user's own speech server, unless the installation locks dictation to its own. */
export function ownServer(): SpeechServer | null {
  return !hostDictation().locked && current.server.trim() ? { address: current.server, model: current.model } : null;
}

/** Whether the installation leaves the browser's speech recognition on offer. */
export const webSpeechAllowed = (): boolean => hostDictation().webSpeech !== false;

export function setDictation(patch: Partial<DictationSettings>): void {
  current = { ...current, ...patch };
  if (embedded) return;
  const changed = Object.fromEntries(Object.entries(current).filter(([k, v]) => DEFAULTS[k as keyof DictationSettings] !== v));
  if (!Object.keys(changed).length) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(current));
}
