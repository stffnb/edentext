// Dictation's settings: the switch and the consent to send audio to the browser's speech
// service. App-wide, one JSON key that exists only once either differs from the default
// (on, not consented); in embed mode the consent lasts for the page only, like the AI's key.

import { embedded } from '../embed/mode';

export type DictationSettings = { enabled: boolean; consent: boolean };

const KEY = 'edentext-dictation';
const DEFAULTS: DictationSettings = { enabled: true, consent: false };

function load(): DictationSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return raw && typeof raw === 'object' ? { enabled: raw.enabled !== false, consent: raw.consent === true } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = $state(load());

export function dictationSettings(): DictationSettings { return current; }

export function setDictation(patch: Partial<DictationSettings>): void {
  current = { ...current, ...patch };
  if (embedded) return;
  if (current.enabled === DEFAULTS.enabled && current.consent === DEFAULTS.consent) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(current));
}
