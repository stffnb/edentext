// LibreOffice's Word Completion tab, defaults and all: on, no appended space, words
// from eight letters up, 1000 of them. The collected list lives beside the settings —
// LibreOffice keeps it in its profile, so it outlives the document that filled it.

export type WordCompletionOptions = {
  enabled: boolean;
  appendSpace: boolean;
  minLength: number;
  maxEntries: number;
  words: string[];
};

const KEY = 'edentext-word-completion';

export const DEFAULT_WORD_COMPLETION: WordCompletionOptions = {
  enabled: true, appendSpace: false, minLength: 8, maxEntries: 1000, words: [],
};

export function loadWordCompletion(): WordCompletionOptions {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_WORD_COMPLETION };
    const data = JSON.parse(raw) as Partial<WordCompletionOptions>;
    return {
      enabled: typeof data.enabled === 'boolean' ? data.enabled : true,
      appendSpace: data.appendSpace === true,
      minLength: clamp(data.minLength, 5, 20, 8),
      maxEntries: clamp(data.maxEntries, 50, 5000, 1000),
      words: Array.isArray(data.words) ? data.words.filter((w) => typeof w === 'string') : [],
    };
  } catch {
    return { ...DEFAULT_WORD_COMPLETION };
  }
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;

export function saveWordCompletion(opts: WordCompletionOptions): void {
  localStorage.setItem(KEY, JSON.stringify(opts));
}
