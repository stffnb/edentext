import type { HunspellFactory } from 'hunspell-asm';
import { NO_LANGUAGE, type DocumentLanguage } from '../storage/documentLanguage';

// Thin engine-agnostic view over a loaded dictionary, so the controller and
// extension never touch hunspell-asm directly.
export interface Checker {
  correct(word: string): boolean;
  suggest(word: string): string[];
  add(word: string): void;
}

// One in-flight/resolved load per code, so switching back to a language is
// instant and concurrent callers share a single fetch.
const cache = new Map<string, Promise<Checker | null>>();

// The wasm module is language-independent; load it once and share it. The
// dynamic import keeps hunspell-asm (~780kB, base64-inlined wasm) out of the
// initial bundle — Vite splits it into a chunk fetched on first spell-check.
let modulePromise: Promise<HunspellFactory> | null = null;
function loadFactory(): Promise<HunspellFactory> {
  if (!modulePromise) modulePromise = import('hunspell-asm').then((m) => m.loadModule());
  return modulePromise;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function build(code: string): Promise<Checker> {
  // Vendored assets: public/dictionaries/<code>/<code>.{aff,dic}. BASE_URL keeps
  // this correct under a non-root deploy base.
  const base = `${import.meta.env.BASE_URL}dictionaries/${code}/${code}`;
  const [factory, aff, dic] = await Promise.all([
    loadFactory(),
    fetchBytes(`${base}.aff`),
    fetchBytes(`${base}.dic`),
  ]);
  const affPath = factory.mountBuffer(aff, `${code}.aff`);
  const dicPath = factory.mountBuffer(dic, `${code}.dic`);
  const hunspell = factory.create(affPath, dicPath);
  return {
    correct: (word) => hunspell.spell(word),
    suggest: (word) => hunspell.suggest(word),
    add: (word) => hunspell.addWord(word),
  };
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
