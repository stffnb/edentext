// What a self-hoster presets for every user (docs/self-hosting.md, architecture/ai.md):
// edentext.config.json next to index.html (shipped empty), below an embedding host's options.
// Neither is stored. The file is public: addresses and models only; a key stays in a proxy.
import { embedded as isEmbedded } from '../embed/mode';

export type HostAi = { enabled?: boolean; provider?: 'openai' | 'anthropic'; endpoint?: string; model?: string; contextTokens?: number; locked?: boolean };
export type HostDictation = { enabled?: boolean; server?: string; model?: string; locked?: boolean; webSpeech?: boolean };
/** A text, or one per language tag. */
export type HostText = string | Record<string, string>;
/** A template the installation offers: a file by address, or (embed only) its bytes. */
export type HostTemplate = { id: string; name: HostText; description?: HostText; preview?: string; url?: string; bytes?: ArrayBuffer; fileName: string };
export type HostTemplates = { enabled?: boolean; builtIn?: boolean; save?: boolean; items?: HostTemplate[] };
type Sections = { ai: HostAi; dictation: HostDictation; templates: HostTemplates };

export const MAX_HOST_TEMPLATES = 50;
const TEMPLATE_FILE = /\.(ott|odt|dotx|docx)$/i;

// A check returns the cleaned value, or undefined to drop the field.
type Check = (v: unknown, embed: boolean) => unknown;
const bool: Check = (v) => (typeof v === 'boolean' ? v : undefined);
const text: Check = (v) => (typeof v === 'string' ? v.trim() : undefined);
const filled = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

// An address against the page's, http(s) only; a preview may also be an inline picture.
function address(v: unknown, picture = false): string | undefined {
  const s = filled(v);
  if (!s) return undefined;
  if (picture && /^data:image\//i.test(s)) return s;
  try {
    const url = new URL(s, document.baseURI);
    return /^https?:$/.test(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

function hostText(v: unknown): HostText | undefined {
  if (typeof v === 'string') return filled(v);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [tag, s] of Object.entries(v)) {
    const clean = filled(s);
    if (clean && /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(tag)) out[tag] = clean;
  }
  return Object.keys(out).length ? out : undefined;
}

function lastSegment(href: string): string {
  try { return decodeURIComponent(new URL(href).pathname.split('/').pop() ?? ''); } catch { return ''; }
}

function ownBytes(v: unknown): ArrayBuffer | undefined {
  if (v instanceof ArrayBuffer) return v;
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice().buffer;
  return undefined;
}

// One entry; a broken one is dropped whole, without taking the others with it.
function template(raw: unknown, embed: boolean): HostTemplate | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const url = address(r.url);
  const bytes = embed && !url ? ownBytes(r.bytes) : undefined;
  const fileName = url ? lastSegment(url) : bytes ? filled(r.fileName) : undefined;
  if (!fileName || !TEMPLATE_FILE.test(fileName)) return undefined;
  const out: HostTemplate = { id: filled(r.id) ?? url ?? fileName, name: hostText(r.name) ?? fileName.replace(TEMPLATE_FILE, ''), fileName };
  const description = hostText(r.description);
  const preview = address(r.preview, true);
  if (description) out.description = description;
  if (preview) out.preview = preview;
  if (url) out.url = url;
  else out.bytes = bytes;
  return out;
}

const templates: Check = (v, embed) => {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  const out: HostTemplate[] = [];
  for (const raw of v) {
    const entry = template(raw, embed);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
    if (out.length === MAX_HOST_TEMPLATES) break;
  }
  return out;
};

const FIELDS: { [S in keyof Sections]: Record<keyof Sections[S], Check> } = {
  ai: {
    enabled: bool, locked: bool, endpoint: text, model: text,
    provider: (v) => (v === 'openai' || v === 'anthropic' ? v : undefined),
    contextTokens: (v) => (Number.isInteger(v) && (v as number) >= 2048 ? v : undefined),
  },
  dictation: { enabled: bool, locked: bool, webSpeech: bool, server: text, model: text },
  templates: { enabled: bool, builtIn: bool, save: bool, items: templates },
};

// Strict: unknown keys and wrong types are dropped, the rest holds.
function section<S extends keyof Sections>(kind: S, raw: unknown, embed = false): Sections[S] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const checks = FIELDS[kind] as Record<string, Check>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const clean = Object.hasOwn(checks, k) ? checks[k](v, embed) : undefined;
    if (clean !== undefined) out[k] = clean;
  }
  return out as Sections[S];
}

const none = (): Sections => ({ ai: {}, dictation: {}, templates: {} });
let file = $state<Sections>(none());
let embed = $state<Sections>(none());

/** An embedding host's option: false switches the feature off, true leaves it as it is,
 *  an object takes the file's fields and overrides them. */
export function setEmbedHostConfig(kind: keyof Sections, value: unknown): void {
  const next = value === false ? { enabled: false } : value === true ? {} : section(kind, value, true);
  embed = { ...embed, [kind]: next };
}

/** Reads the installation's file once; a missing, slow or broken one presets nothing. */
export async function loadHostConfig(): Promise<void> {
  // The desktop app (app://) and file:// pages have no installation behind them.
  if (!/^https?:$/.test(location.protocol)) return;
  let next = none();
  try {
    // index.html asks for the file before this module loads; a page without that script asks here.
    const early = (window as { __edentextConfig?: Promise<unknown> }).__edentextConfig;
    const raw: unknown = await (early ?? fetch(new URL('edentext.config.json', document.baseURI), { cache: 'no-cache', signal: AbortSignal.timeout(2000) })
      .then((res) => (res.ok ? res.json() : null)));
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      next = { ai: section('ai', obj.ai), dictation: section('dictation', obj.dictation), templates: section('templates', obj.templates) };
    }
  } catch { /* no preset */ }
  file = next;
}

export function hostAi(): HostAi { return { ...file.ai, ...embed.ai }; }
export function hostDictation(): HostDictation { return { ...file.dictation, ...embed.dictation }; }

export type TemplateOffer = { gallery: boolean; builtIn: boolean; items: HostTemplate[]; save: boolean };

/** What New from Template offers and whether Save as Template shows. Embedded, only the
 *  host's own option with entries or `builtIn: true` opens the gallery, and saving a
 *  template never shows: the host keeps the files. */
export function templateOffer(embedded = isEmbedded): TemplateOffer {
  const off = { gallery: false, builtIn: false, items: [], save: false };
  const merged = { ...file.templates, ...embed.templates };
  const own = embed.templates;
  if (merged.enabled === false || (embedded && !own.items?.length && own.builtIn !== true)) return off;
  const builtIn = embedded ? merged.builtIn === true : merged.builtIn !== false;
  const items = merged.items ?? [];
  return { gallery: builtIn || items.length > 0, builtIn, items, save: !embedded && merged.save !== false };
}

/** The UI language's text, else its base language's, English's, or the first one given. */
export function pickText(value: HostText | undefined, locale: string): string {
  if (value === undefined || typeof value === 'string') return value ?? '';
  const keys = Object.keys(value);
  const base = (tag: string) => tag.split('-')[0].toLowerCase();
  const key = keys.find((k) => k.toLowerCase() === locale.toLowerCase())
    ?? keys.find((k) => k.toLowerCase() === base(locale))
    ?? keys.find((k) => base(k) === base(locale))
    ?? keys.find((k) => base(k) === 'en')
    ?? keys[0];
  return value[key];
}
