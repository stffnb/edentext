// Dictation's settings: the switch, the consent to send audio to the browser's speech
// service, and the user's own speech server with the host its consent was given for.
// App-wide, one JSON key that exists only once a field differs from the default; in embed
// mode it lasts for the page only, like the AI's key.

import { embedded } from '../embed/mode';

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

export function setDictation(patch: Partial<DictationSettings>): void {
  current = { ...current, ...patch };
  if (embedded) return;
  const changed = Object.fromEntries(Object.entries(current).filter(([k, v]) => DEFAULTS[k as keyof DictationSettings] !== v));
  if (!Object.keys(changed).length) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(current));
}
