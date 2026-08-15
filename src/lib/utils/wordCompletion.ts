// LibreOffice's Tools ▸ AutoCorrect Options ▸ Word Completion: the words a document
// has used, offered back while typing. Framework-free — the extension and the storage
// singleton both build on these.

// A word is letters, digits and the marks that hold one together. Kept deliberately
// wide (\p{L}) so an accented or Greek word collects like an ASCII one.
const WORD_CHARS = /[\p{L}\p{N}_'’-]/u;

export const isWordChar = (ch: string): boolean => WORD_CHARS.test(ch);

/** The word ending at the end of `text` — what is being typed at the cursor. */
export function wordBefore(text: string): string {
  let i = text.length;
  while (i > 0 && WORD_CHARS.test(text[i - 1])) i--;
  return text.slice(i);
}

/**
 * `word` added to the front of the list, unchanged where it is already there. Newest
 * first, so the list drops the word used longest ago once it is full — LibreOffice's
 * own rule for its 1000 entries.
 */
export function collectWord(list: string[], word: string, minLength: number, max: number): string[] {
  if (word.length < minLength || !/^\p{L}/u.test(word)) return list;
  if (list[0] === word) return list;
  return [word, ...list.filter((w) => w !== word)].slice(0, max);
}

/**
 * What the typed prefix completes to, or null. Case-insensitive, the typed characters
 * stay as they were typed, and the shortest match wins — a longer word is the more
 * surprising guess. A word the prefix already spells completes to nothing.
 */
export function suggestCompletion(list: string[], prefix: string, minPrefix = 3): string | null {
  if (prefix.length < minPrefix) return null;
  const lower = prefix.toLowerCase();
  let best: string | null = null;
  for (const word of list) {
    if (word.length <= prefix.length || !word.toLowerCase().startsWith(lower)) continue;
    if (!best || word.length < best.length) best = word;
  }
  return best ? best.slice(prefix.length) : null;
}
