// What a self-hoster presets for every user (docs/architecture/ai.md, dictation-local.md):
// edentext.config.json next to index.html, below an embedding host's options. Neither is
// stored. The file is public, so it holds addresses and models only; a key stays in a proxy.

export type HostAi = { enabled?: boolean; provider?: 'openai' | 'anthropic'; endpoint?: string; model?: string; contextTokens?: number; locked?: boolean };
export type HostDictation = { enabled?: boolean; server?: string; model?: string; locked?: boolean; webSpeech?: boolean };
type Sections = { ai: HostAi; dictation: HostDictation };

const isBool = (v: unknown) => typeof v === 'boolean';
const isText = (v: unknown) => typeof v === 'string';
const FIELDS: { [S in keyof Sections]: Record<keyof Sections[S], (v: unknown) => boolean> } = {
  ai: {
    enabled: isBool, locked: isBool, endpoint: isText, model: isText,
    provider: (v) => v === 'openai' || v === 'anthropic',
    contextTokens: (v) => Number.isInteger(v) && (v as number) >= 2048,
  },
  dictation: { enabled: isBool, locked: isBool, webSpeech: isBool, server: isText, model: isText },
};

// Strict: unknown keys and wrong types are dropped, the rest holds.
function section<S extends keyof Sections>(kind: S, raw: unknown): Sections[S] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const ok = FIELDS[kind] as Record<string, (v: unknown) => boolean>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (ok[k]?.(v)) out[k] = typeof v === 'string' ? v.trim() : v;
  return out as Sections[S];
}

let file = $state<{ ai: HostAi; dictation: HostDictation }>({ ai: {}, dictation: {} });
let embed = $state<{ ai: HostAi; dictation: HostDictation }>({ ai: {}, dictation: {} });

/** An embedding host's option: false switches the feature off, true leaves it as it is,
 *  an object takes the file's fields and overrides them. */
export function setEmbedHostConfig(kind: keyof Sections, value: unknown): void {
  const next = value === false ? { enabled: false } : value === true ? {} : section(kind, value);
  embed = { ...embed, [kind]: next };
}

/** Reads the installation's file once; a missing, slow or broken one presets nothing. */
export async function loadHostConfig(): Promise<void> {
  // The desktop app (app://) and file:// pages have no installation behind them.
  if (!/^https?:$/.test(location.protocol)) return;
  let next: typeof file = { ai: {}, dictation: {} };
  try {
    const res = await fetch(new URL('edentext.config.json', document.baseURI), { cache: 'no-cache', signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const raw: unknown = await res.json();
      const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      next = { ai: section('ai', obj.ai), dictation: section('dictation', obj.dictation) };
    }
  } catch { /* no preset */ }
  file = next;
}

export function hostAi(): HostAi { return { ...file.ai, ...embed.ai }; }
export function hostDictation(): HostDictation { return { ...file.dictation, ...embed.dictation }; }
