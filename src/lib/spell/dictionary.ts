import type { Hunspell, HunspellFactory } from 'hunspell-asm';
import { NO_LANGUAGE, hasDictionary, findLanguage, type DocumentLanguage } from '../storage/documentLanguage';
import { reportLoadFailure } from '../utils/loadFailure';
import { t } from '../i18n/i18n.svelte';

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
  // Vendored assets: public/dictionaries/<code>/<code>.{aff,dic.txt}. The word list is
  // .txt so the host gzips it (GitHub Pages leaves a .dic's text/x-c uncompressed);
  // BASE_URL keeps the path correct under a non-root deploy base.
  const base = `${import.meta.env.BASE_URL}dictionaries/${code}/${code}`;
  const [factory, aff, dic] = await Promise.all([
    loadFactory(),
    fetchBytes(`${base}.aff`),
    fetchBytes(`${base}.dic.txt`),
  ]);
  const affPath = factory.mountBuffer(aff, `${code}.aff`);
  const dicPath = factory.mountBuffer(dic, `${code}.dic`);
  return checkerOf(factory.create(affPath, dicPath));
}

// AutoCorrect types ’, but a word list without `ICONV ’ '` (it, de, es, pt) stores its
// elisions with ' only: such a word is checked again with ', and its suggestions keep ’.
export function checkerOf(hunspell: Pick<Hunspell, 'spell' | 'suggest' | 'addWord'>): Checker {
  const plain = (word: string) => word.replaceAll('’', "'");
  return {
    correct: (word) => hunspell.spell(word) || (word.includes('’') && hunspell.spell(plain(word))),
    suggest: (word) => {
      const typed = hunspell.suggest(word);
      if (!word.includes('’')) return typed;
      return [...new Set([...typed, ...hunspell.suggest(plain(word))].map((s) => s.replaceAll("'", '’')))];
    },
    add: (word) => hunspell.addWord(word),
  };
}

let reported = false;

// Lazily load (and cache) the Hunspell checker for a language. Resolves to null
// for NO_LANGUAGE, for a language we ship no dictionary for, or when the fetch fails.
export function loadChecker(code: DocumentLanguage): Promise<Checker | null> {
  if (code === NO_LANGUAGE || !hasDictionary(code)) return Promise.resolve(null);
  let pending = cache.get(code);
  if (!pending) {
    pending = build(code).catch((err) => {
      cache.delete(code); // allow a retry after a transient failure
      console.error(`[spell] failed to load dictionary "${code}":`, err);
      // Nobody asked for this load, and a document can hold several languages: one
      // report per session, naming the language whose words now go unchecked.
      if (!reported) {
        reported = true;
        reportLoadFailure(t().dialogs.couldNotLoadDictionary(findLanguage(code)?.label ?? code), err);
      }
      return null;
    });
    cache.set(code, pending);
  }
  return pending;
}
