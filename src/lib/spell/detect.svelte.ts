// Automatic language detection for checking only: a paragraph without a language of its
// own is checked in the one it is written in, and the document is never changed. App-wide,
// on by default (the key only stores "off"); the detector loads lazily.

import type { Node as PmNode } from '@tiptap/pm/model';
import { LANGUAGES, NO_LANGUAGE, findLanguage, hasDictionary, type DocumentLanguage } from '../storage/documentLanguage';
import { spellController } from './controller';

const KEY = 'edentext-auto-language';

let enabled = $state(readEnabled());

function readEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== 'false'; } catch { return true; }
}

// franc names ISO 639-3 codes; only languages we have a dictionary for are candidates.
const ISO3: Record<string, string> = { eng: 'en', deu: 'de', spa: 'es', fra: 'fr', ita: 'it', por: 'pt', ell: 'el', rus: 'ru', ukr: 'uk' };
const ONLY = Object.keys(ISO3).filter((k) => LANGUAGES.some((l) => l.odf.language === ISO3[k] && hasDictionary(l.code)));

// Shorter text is guessed too often wrong; longer text says nothing more and costs time.
const MIN_CHARS = 40;
const SAMPLE_CHARS = 600;
const SAMPLE_WORDS = 40;
const WORD_RE = /[\p{L}\p{M}]{2,}/gu;

type FrancAll = (text: string, opts: { only: string[]; minLength: number }) => [string, number][];
let francAll: FrancAll | null = null;
let loading = false;

// The grammar check reads detection too; it re-lints only when a verdict can have changed,
// not on every dictionary event the spell check listens to.
const subs = new Set<() => void>();
let waiting = false; // a verdict waited for a dictionary
function changed(): void {
  spellController.refresh();
  for (const cb of subs) cb();
}
spellController.subscribe(() => {
  if (!waiting) return;
  waiting = false;
  for (const cb of subs) cb();
});

export function subscribeDetection(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

function ensureLoaded(): void {
  if (francAll || loading || !enabled) return;
  loading = true;
  void import('franc-min').then((m) => {
    francAll = m.francAll as FrancAll;
    changed();
  }, (err) => console.error('[spell] language detector failed to load:', err))
    .finally(() => { loading = false; });
}
if (typeof window !== 'undefined') ensureLoaded();

export function autoLanguage(): boolean {
  return enabled;
}

export function setAutoLanguage(on: boolean): void {
  if (on === enabled) return;
  enabled = on;
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, 'false');
  } catch { /* the choice still holds for this session */ }
  ensureLoaded();
  changed();
}

// A node is immutable, so an unchanged paragraph keeps its verdict across checks; only an
// edited one is read again. Kept per document language, which is what it is compared with.
const cache = new WeakMap<PmNode, { doc: DocumentLanguage; code: DocumentLanguage | null }>();

/**
 * The language a textblock is written in when that is not the document's, else undefined.
 * franc proposes a candidate, the dictionaries decide: switch only where the candidate's
 * knows clearly more of the paragraph's words than the document language's does.
 */
export function detectLanguage(node: PmNode): DocumentLanguage | undefined {
  const doc = spellController.getLanguage();
  if (!enabled || !francAll || !doc || doc === NO_LANGUAGE || !node.isTextblock) return undefined;
  const hit = cache.get(node);
  if (hit && hit.doc === doc) return hit.code ?? undefined;
  const code = guess(node.textContent.slice(0, SAMPLE_CHARS), doc);
  if (code === undefined) { waiting = true; return undefined; } // asked again once it lands
  cache.set(node, { doc, code });
  return code ?? undefined;
}

function guess(text: string, doc: DocumentLanguage): DocumentLanguage | null | undefined {
  if (text.trim().length < MIN_CHARS) return null;
  const top = francAll!(text, { only: ONLY, minLength: MIN_CHARS })[0]?.[0];
  const base = top && ISO3[top];
  const docBase = findLanguage(doc)?.odf.language;
  if (!base || base === docBase) return null;
  const candidate = LANGUAGES.find((l) => l.odf.language === base && hasDictionary(l.code))?.code;
  if (!candidate) return null;
  const words = (text.match(WORD_RE) ?? []).slice(0, SAMPLE_WORDS);
  const ours = spellController.knownShare(words, doc);
  const theirs = spellController.knownShare(words, candidate);
  if (ours === undefined || theirs === undefined) return undefined;
  return theirs >= 0.75 && theirs - ours >= 0.25 ? candidate : null;
}
