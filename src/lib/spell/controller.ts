import { loadChecker, type Checker } from './dictionary';
import { isComplexTag, loadDocumentLanguage, type DocumentLanguage } from '../storage/documentLanguage';
import { COMPLEX_SCRIPT_RE } from '../utils/script';
import { volatile } from '../storage/docScope';

const PERSONAL_KEY = 'edentext-user-dictionary';

// Off while nothing is to be stored: the words would be the document's own.
export const personalDictionary = !volatile;

function loadPersonal(): string[] {
  if (!personalDictionary) return [];
  try {
    const raw = localStorage.getItem(PERSONAL_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((w): w is string => typeof w === 'string') : [];
  } catch {
    return [];
  }
}

// Singleton bridging the static TipTap extension to the live spell state. The
// extension subscribes and re-decorates whenever the active checker, personal
// dictionary, or ignore set changes.
class SpellController {
  private code: DocumentLanguage = '';
  // The document's language of the other script kind: the western one beside Arabic.
  private alt: DocumentLanguage | null = null;
  // One checker per language the document actually uses; loadChecker caches the fetch.
  private readonly checkers = new Map<DocumentLanguage, Checker | null>();
  private token = 0;
  private readonly personal = new Set<string>(loadPersonal());
  private readonly ignored = new Set<string>(); // session-only "Ignore all"
  private readonly subs = new Set<() => void>();

  constructor() {
    if (typeof localStorage !== 'undefined') {
      void this.setLanguage(loadDocumentLanguage());
    }
  }

  getLanguage(): DocumentLanguage {
    return this.code;
  }

  isEnabled(): boolean {
    return this.checkers.get(this.code) != null;
  }

  async setLanguage(code: DocumentLanguage, alt: DocumentLanguage | null = null): Promise<void> {
    if (code === this.code && alt === this.alt) return;
    this.code = code;
    this.alt = alt;
    const token = ++this.token;
    await this.load(code);
    if (token !== this.token) return; // a newer setLanguage superseded this one
    this.notify();
  }

  // Load a language's dictionary on demand — a run or paragraph in a language the
  // document itself is not in. Every caller waits on the one load in flight.
  private loading = new Map<DocumentLanguage, Promise<void>>();
  private load(code: DocumentLanguage): Promise<void> {
    if (this.checkers.has(code)) return Promise.resolve();
    let pending = this.loading.get(code);
    if (!pending) {
      pending = loadChecker(code).then((checker) => {
        this.loading.delete(code);
        if (checker) for (const w of this.personal) checker.add(w);
        this.checkers.set(code, checker);
      });
      this.loading.set(code, pending);
    }
    return pending;
  }

  private checkerFor(code: DocumentLanguage | undefined): Checker | null | undefined {
    const c = code || this.code;
    if (!this.checkers.has(c)) {
      // Notifies when it lands, which re-runs the check.
      if (!this.loading.has(c)) void this.load(c).then(() => this.notify());
      return undefined; // not loaded yet — the caller skips the word
    }
    return this.checkers.get(c);
  }

  // A word is checked in a language of its own script: Latin text in an Arabic paragraph
  // takes the document's western language, and goes unchecked where there is none.
  private checkerOfScript(word: string, code: DocumentLanguage | undefined): Checker | null | undefined {
    const complex = COMPLEX_SCRIPT_RE.test(word);
    const own = [code || this.code, this.code, this.alt].find((c) => c && isComplexTag(c) === complex);
    return own ? this.checkerFor(own) : null;
  }

  check(word: string, code?: DocumentLanguage): boolean {
    const checker = this.checkerOfScript(word, code);
    if (!checker) return true;
    if (this.ignored.has(word)) return true;
    return checker.correct(word);
  }

  // The share of `words` a language's dictionary knows; undefined while it loads.
  knownShare(words: string[], code: DocumentLanguage): number | undefined {
    const checker = this.checkerFor(code);
    if (checker === undefined) return undefined;
    if (!checker || !words.length) return 0;
    return words.filter((w) => checker.correct(w)).length / words.length;
  }

  suggest(word: string, code?: DocumentLanguage): string[] {
    return this.checkerOfScript(word, code)?.suggest(word) ?? [];
  }

  addWord(word: string): void {
    if (!personalDictionary || !word || this.personal.has(word)) return;
    this.personal.add(word);
    localStorage.setItem(PERSONAL_KEY, JSON.stringify([...this.personal]));
    for (const c of this.checkers.values()) c?.add(word);
    this.notify();
  }

  ignoreWord(word: string): void {
    if (!word || this.ignored.has(word)) return;
    this.ignored.add(word);
    this.notify();
  }

  // Something that decides which dictionary a text takes has changed: check again.
  refresh(): void {
    this.notify();
  }

  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  private notify(): void {
    for (const cb of this.subs) cb();
  }
}

export const spellController = new SpellController();
