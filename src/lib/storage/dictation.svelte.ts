// Dictation's settings: the switch, the consent to send audio to the browser's speech
// service, and the user's own speech server with the host its consent was given for.
// App-wide, one JSON key that exists only once a field differs from the default; in embed
// mode it lasts for the page only, like the AI's key.

import { embedded } from '../embed/mode';
import { hostDictation } from './hostConfig.svelte';
import type { SpeechServer } from '../dictation/speechServer';

export type DictationSettings = { enabled: boolean; consent: boolean; server: string; model: string; serverConsent: string };

const KEY = 'edentext-dictation';
const DEFAULTS: DictationSettings = { enabled: true, consent: false, server: '', model: '', serverConsent: '' };

const text = (v: unknown) => (typeof v === 'string' ? v : '');

function load(): DictationSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return raw && typeof raw === 'object'
      ? { enabled: raw.enabled !== false, consent: raw.consent === true, server: text(raw.server), model: text(raw.model), serverConsent: text(raw.serverConsent) }
      : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = $state(load());

export function dictationSettings(): DictationSettings { return current; }

/** Switched off by the installation or an embedding host, above the user's own switch. */
export function dictationHostOff(): boolean { return hostDictation().enabled === false; }

/** The speech server in use: the installation's while it locks it or the user has none of
 *  their own (a model typed over it still counts), else the user's; null for the browser's. */
export function dictationServer(): SpeechServer | null {
  const h = hostDictation();
  if (h.locked || (h.server && !current.server.trim())) {
    return h.server ? { address: h.server, model: (!h.locked && current.model.trim()) || h.model || '', installation: true } : null;
  }
  return current.server.trim() ? { address: current.server, model: current.model } : null;
}

export function setDictation(patch: Partial<DictationSettings>): void {
  current = { ...current, ...patch };
  if (embedded) return;
  const changed = Object.fromEntries(Object.entries(current).filter(([k, v]) => DEFAULTS[k as keyof DictationSettings] !== v));
  if (!Object.keys(changed).length) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(current));
}
