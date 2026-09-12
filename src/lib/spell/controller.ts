import { loadChecker, type Checker } from './dictionary';
import { loadDocumentLanguage, type DocumentLanguage } from '../storage/documentLanguage';

const PERSONAL_KEY = 'edentext-user-dictionary';

function loadPersonal(): string[] {
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

  async setLanguage(code: DocumentLanguage): Promise<void> {
    if (code === this.code) return;
    this.code = code;
    const token = ++this.token;
    await this.load(code);
    if (token !== this.token) return; // a newer setLanguage superseded this one
    this.notify();
  }

  // Load a language's dictionary on demand — a run or paragraph in a language the
  // document itself is not in. Notifies when it lands, which re-runs the check.
  private loading = new Set<DocumentLanguage>();
  private async load(code: DocumentLanguage): Promise<void> {
    if (this.checkers.has(code) || this.loading.has(code)) return;
    this.loading.add(code);
    const checker = await loadChecker(code);
    this.loading.delete(code);
    if (checker) for (const w of this.personal) checker.add(w);
    this.checkers.set(code, checker);
  }

  private checkerFor(code: DocumentLanguage | undefined): Checker | null | undefined {
    const c = code || this.code;
    if (!this.checkers.has(c)) {
      void this.load(c).then(() => this.notify());
      return undefined; // not loaded yet — the caller skips the word
    }
    return this.checkers.get(c);
  }

  check(word: string, code?: DocumentLanguage): boolean {
    const checker = this.checkerFor(code);
    if (!checker) return true;
    if (this.ignored.has(word)) return true;
    return checker.correct(word);
  }

  suggest(word: string, code?: DocumentLanguage): string[] {
    return this.checkerFor(code)?.suggest(word) ?? [];
  }

  addWord(word: string): void {
    if (!word || this.personal.has(word)) return;
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

  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  private notify(): void {
    for (const cb of this.subs) cb();
  }
}

export const spellController = new SpellController();
