// The word-completion options as a reactive singleton (like autoCorrect.svelte.ts):
// the extension reads them on every keystroke and adds each word it collects, the
// dialog replaces them.

import { collectWord } from '../utils/wordCompletion';
import { loadWordCompletion, saveWordCompletion, type WordCompletionOptions } from './wordCompletion';

let current = $state<WordCompletionOptions>(loadWordCompletion());

export function wordCompletion(): WordCompletionOptions {
  return current;
}

export function setWordCompletion(next: WordCompletionOptions): void {
  current = next;
  saveWordCompletion(current);
}

/** One typed word remembered; a no-op where it is too short or already the newest. */
export function rememberWord(word: string): void {
  const words = collectWord(current.words, word, current.minLength, current.maxEntries);
  if (words !== current.words) setWordCompletion({ ...current, words });
}
