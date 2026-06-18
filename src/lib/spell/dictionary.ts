import nspell, { type NSpell } from 'nspell';
import { NO_LANGUAGE, type DocumentLanguage } from '../storage/documentLanguage';

export type Checker = NSpell;

// One in-flight/resolved load per code, so switching back to a language is
// instant and concurrent callers share a single fetch.
const cache = new Map<string, Promise<Checker | null>>();

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

async function build(code: string): Promise<Checker> {
  // Vendored assets: public/dictionaries/<code>/<code>.{aff,dic}. BASE_URL keeps
  // this correct under a non-root deploy base.
  const base = `${import.meta.env.BASE_URL}dictionaries/${code}/${code}`;
  const [aff, dic] = await Promise.all([fetchText(`${base}.aff`), fetchText(`${base}.dic`)]);
  return nspell(aff, dic);
}

// Lazily load (and cache) the Hunspell checker for a language. Resolves to null
// for NO_LANGUAGE or when the dictionary can't be fetched.
export function loadChecker(code: DocumentLanguage): Promise<Checker | null> {
  if (code === NO_LANGUAGE) return Promise.resolve(null);
  let pending = cache.get(code);
  if (!pending) {
    pending = build(code).catch((err) => {
      cache.delete(code); // allow a retry after a transient failure
      console.error(`[spell] failed to load dictionary "${code}":`, err);
      return null;
    });
    cache.set(code, pending);
  }
  return pending;
}
