import { loadChecker, type Checker } from './dictionary';
import { loadDocumentLanguage, type DocumentLanguage } from '../storage/documentLanguage';

const PERSONAL_KEY = 'odf-editor-user-dictionary';

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
  private checker: Checker | null = null;
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
    return this.checker !== null;
  }

  async setLanguage(code: DocumentLanguage): Promise<void> {
    if (code === this.code) return;
    this.code = code;
    const token = ++this.token;
    const checker = await loadChecker(code);
    if (token !== this.token) return; // a newer setLanguage superseded this one
    if (checker) for (const w of this.personal) checker.add(w);
    this.checker = checker;
    this.notify();
  }

  check(word: string): boolean {
    if (!this.checker) return true;
    if (this.ignored.has(word)) return true;
    return this.checker.correct(word);
  }

  suggest(word: string): string[] {
    return this.checker ? this.checker.suggest(word) : [];
  }

  addWord(word: string): void {
    if (!word || this.personal.has(word)) return;
    this.personal.add(word);
    localStorage.setItem(PERSONAL_KEY, JSON.stringify([...this.personal]));
    this.checker?.add(word);
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
