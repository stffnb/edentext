import { NO_LANGUAGE, type DocumentLanguage } from '../storage/documentLanguage';

// Vendored assets: public/thesaurus/<code>/<code>.txt, one synonym group per
// line, ';'-separated (scripts/make-thesaurus.mjs, from LibreOffice's MyThes data).
const cache = new Map<string, Promise<string | null>>();

// Asks App.svelte for the dialog, as the other menu-opened dialogs do.
export const OPEN_THESAURUS_EVENT = 'odf-open-thesaurus';

// More than a dialog can show without becoming a word list of its own.
const MAX_GROUPS = 12;

function fetchThesaurus(code: string): Promise<string | null> {
  const url = `${import.meta.env.BASE_URL}thesaurus/${code}/${code}.txt`;
  return fetch(url)
    .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`${res.status} for ${url}`))))
    .catch((err) => {
      cache.delete(code); // allow a retry after a transient failure
      console.error(`[thesaurus] failed to load "${code}":`, err);
      return null;
    });
}

// Loads on first use (a few MB) and stays for the session, like the dictionary.
export function loadThesaurus(code: DocumentLanguage): Promise<string | null> {
  if (!code || code === NO_LANGUAGE) return Promise.resolve(null);
  let pending = cache.get(code);
  if (!pending) cache.set(code, (pending = fetchThesaurus(code)));
  return pending;
}

const escapeRe = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The groups `word` appears in, itself removed. Scanned, not indexed: a lookup is
// a menu click (~4ms over 3MB), where a word→group index would cost ~100MB.
// A group leads with its main form, so the earlier the word sits in one, the more
// that group is about it — which is the order LibreOffice lists the senses in.
export async function synonyms(code: DocumentLanguage, word: string): Promise<string[][]> {
  const text = await loadThesaurus(code);
  const term = word.trim();
  if (!text || !term) return [];
  const lower = term.toLowerCase();
  const re = new RegExp(`(^|;)${escapeRe(term)}(;|$)`, 'gim');
  const seen = new Set<string>();
  const found: { at: number; others: string[] }[] = [];
  for (const m of text.matchAll(re)) {
    const start = text.lastIndexOf('\n', m.index) + 1;
    const end = text.indexOf('\n', m.index);
    const line = text.slice(start, end < 0 ? undefined : end);
    if (seen.has(line)) continue;
    seen.add(line);
    const members = line.split(';');
    const others = members.filter((w) => w.toLowerCase() !== lower);
    if (others.length) found.push({ at: members.findIndex((w) => w.toLowerCase() === lower), others });
  }
  return found.sort((a, b) => a.at - b.at).slice(0, MAX_GROUPS).map((g) => g.others);
}
