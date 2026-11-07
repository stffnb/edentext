// The AI assistant's settings: the kill switch and the provider the user brought.
// App-wide, one JSON key, removed while everything is at its default (on and empty), so a
// switch-off is stored; switching off keeps the provider so switching back on needs no retyping.

import { SvelteMap } from 'svelte/reactivity';
import { embedded } from '../embed/mode';

export type AiProvider = 'openai' | 'anthropic';
/** 'chat' answers in the pane only; 'edit' changes the document through the tools. */
export type AiMode = 'chat' | 'edit';
/** `contextTokens`: the model's context window, which sizes the document sent along. */
/** A saved prompt the chat runs as `/name`. */
export type CustomCommand = { name: string; prompt: string };
/** `commands`: the user's own slash commands. */
export type AiSettings = { enabled: boolean; provider: AiProvider; endpoint: string; apiKey: string; model: string; contextTokens: number; mode: AiMode; side: 'left' | 'right'; commands: CustomCommand[] };
export type AiConfig = Omit<AiSettings, 'enabled'>;

const KEY = 'edentext-ai';

/** Opens the chat pane; detail `{ prefill, send }` fills its field, e.g. `/draft `, or sends it. */
export const OPEN_AI_CHAT_EVENT = 'edentext-ai-chat';
/** A comment or reply named the assistant; detail `{ id }` is the thread to answer. */
export const AI_COMMENT_EVENT = 'edentext-ai-comment';

/** The comment threads the assistant is answering ('') or failed to (the error), for their cards. */
export const aiAnswering = new SvelteMap<string, string>();

export const DEFAULT_CONTEXT_TOKENS = 32_000;
const DEFAULTS: AiSettings = { enabled: true, provider: 'openai', endpoint: '', apiKey: '', model: '', contextTokens: DEFAULT_CONTEXT_TOKENS, mode: 'edit', side: 'right', commands: [] };

/** The characters of document a request may carry: half the context, at about four a token. */
export function docBudget(cfg: Pick<AiConfig, 'contextTokens'>): number {
  return Math.max(4000, Math.round((cfg.contextTokens || DEFAULT_CONTEXT_TOKENS) * 2));
}

const validCommands = (v: unknown): CustomCommand[] =>
  Array.isArray(v) ? v.filter((c) => c && typeof c.name === 'string' && typeof c.prompt === 'string') : [];

function load(): AiSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return raw && typeof raw === 'object' ? { ...DEFAULTS, ...raw, enabled: raw.enabled !== false, mode: raw.mode === 'chat' ? 'chat' : 'edit', side: raw.side === 'left' ? 'left' : 'right', commands: validCommands(raw.commands) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = $state(load());
// An embedding host's switch-off (`ai: false`), above the user's own; never stored.
let hostOff = $state(false);

export function setAiHostOff(off: boolean): void { hostOff = off; }
export function aiHostOff(): boolean { return hostOff; }

/** The kill switch: false hides every AI surface and keeps every request from going out. */
export function aiEnabled(): boolean { return current.enabled && !hostOff; }

export function aiSettings(): AiSettings { return current; }

/** What a request needs, or null while the assistant is off or not set up. */
export function aiConfig(): AiConfig | null {
  const { enabled, ...cfg } = current;
  return enabled && !hostOff && cfg.endpoint.trim() && cfg.model.trim() ? cfg : null;
}

export function setAi(patch: Partial<AiSettings>): void {
  current = { ...current, ...patch };
  // Typed inside another application's page, a provider and its key last for that page only.
  if (embedded) return;
  const isDefault = (Object.keys(DEFAULTS) as (keyof AiSettings)[]).every((k) => JSON.stringify(current[k]) === JSON.stringify(DEFAULTS[k]));
  if (isDefault) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(current));
}

// Presets fill in the address; the model stays the user's choice.
export const AI_PRESETS: { id: string; label: string; provider: AiProvider; endpoint: string }[] = [
  { id: 'openai', label: 'OpenAI', provider: 'openai', endpoint: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic', provider: 'anthropic', endpoint: 'https://api.anthropic.com/v1' },
  { id: 'mistral', label: 'Mistral', provider: 'openai', endpoint: 'https://api.mistral.ai/v1' },
  { id: 'openrouter', label: 'OpenRouter', provider: 'openai', endpoint: 'https://openrouter.ai/api/v1' },
  { id: 'gemini', label: 'Google Gemini', provider: 'openai', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'ollama', label: 'Ollama', provider: 'openai', endpoint: 'http://localhost:11434/v1' },
  { id: 'lmstudio', label: 'LM Studio', provider: 'openai', endpoint: 'http://localhost:1234/v1' },
];

export function presetOf(s: AiSettings): string {
  return AI_PRESETS.find((p) => p.provider === s.provider && p.endpoint === s.endpoint)?.id ?? 'custom';
}
