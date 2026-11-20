import { NO_LANGUAGE, hasThesaurus, type DocumentLanguage } from '../storage/documentLanguage';
import { reportLoadFailure, fetchAsset, NotServed } from '../utils/loadFailure';
import { t } from '../i18n/i18n.svelte';

// Vendored assets: public/thesaurus/<code>/<code>.txt, one synonym group per
// line, ';'-separated (scripts/make-thesaurus.mjs, from LibreOffice's MyThes data).
const cache = new Map<string, Promise<string | null>>();

// Asks App.svelte for the dialog, as the other menu-opened dialogs do.
export const OPEN_THESAURUS_EVENT = 'odf-open-thesaurus';

// More than a dialog can show without becoming a word list of its own.
const MAX_GROUPS = 12;

function fetchThesaurus(code: string): Promise<string | null> {
  // en-GB shares the US thesaurus: the senses are the same, only the spelling differs.
  const file = code === 'en-GB' ? 'en' : code;
  const url = `${import.meta.env.BASE_URL}thesaurus/${file}/${file}.txt`;
  return fetchAsset(url)
    .then((res) => res.text())
    .catch((err) => {
      if (err instanceof NotServed) return null;
      cache.delete(code); // allow a retry after a transient failure
      console.error(`[thesaurus] failed to load "${code}":`, err);
      // The dialog would otherwise answer a lookup with "no synonyms found".
      reportLoadFailure(t().dialogs.couldNotLoadThesaurus, err);
      return null;
    });
}

// Loads on first use (a few MB) and stays for the session, like the dictionary.
export function loadThesaurus(code: DocumentLanguage): Promise<string | null> {
  if (!code || code === NO_LANGUAGE || !hasThesaurus(code)) return Promise.resolve(null);
  let pending = cache.get(code);
  if (!pending) cache.set(code, (pending = fetchThesaurus(code)));
  return pending;
}

const escapeRe = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The groups `term` appears in, itself removed, or null where it is in none.
function groupsOf(text: string, term: string): string[][] | null {
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
  return found.length ? found.sort((a, b) => a.at - b.at).slice(0, MAX_GROUPS).map((g) => g.others) : null;
}

// Arabic writes the article and the one-letter proclitics onto the word, while the
// thesaurus lists bare lemmas: conjunction (و ف), preposition (ب ك ل), article (ال; ل+ال is لل,
// so after ل a lone ل may be the article).
const AR_PROCLITICS = /^([وف]?)([بكل]?)(ال|(?<=ل)ل)?/;

// The proclitics put back on a synonym: no article on a phrase or a word that has one,
// and ل before an article swallows its alef (لل).
function attach(conj: string, prep: string, article: string, syn: string): string {
  const art = article && !syn.includes(' ') && !syn.startsWith('ال') ? 'ال' : '';
  const word = art + syn;
  return conj + (prep === 'ل' && word.startsWith('ال') ? 'ل' + word.slice(1) : prep + word);
}

// The groups `word` appears in, itself removed. Scanned, not indexed: a lookup is
// a menu click (~4ms over 3MB), where a word→group index would cost ~100MB.
// A group leads with its main form, so the earlier the word sits in one, the more
// that group is about it — which is the order LibreOffice lists the senses in.
export async function synonyms(code: DocumentLanguage, word: string): Promise<string[][]> {
  const text = await loadThesaurus(code);
  // Arabic vowel marks are optional in writing; the groups are stored without them.
  const term = word.trim().replace(/[\u064B-\u0652\u0670]/g, '');
  if (!text || !term) return [];
  const exact = groupsOf(text, term);
  if (exact || code !== 'ar') return exact ?? [];
  // An Arabic word with clitics: the least stripped stem the thesaurus knows, its
  // synonyms given the same clitics back, so a replacement keeps them.
  const [, conj, prep, article = ''] = AR_PROCLITICS.exec(term)!;
  const cuts = [[conj, '', ''], [conj, prep, ''], [conj, prep, article]];
  for (const [c, p, a] of cuts) {
    const stem = term.slice(c.length + p.length + a.length);
    if (!(c || p || a) || stem.length < 3) continue;
    const found = groupsOf(text, stem);
    if (found) return found.map((g) => g.map((syn) => attach(c, p, a, syn)));
  }
  return [];
}
