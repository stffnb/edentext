// The AutoCorrect options as a reactive singleton (same shape as notes.svelte.ts):
// the extension reads autoCorrect() on every keystroke, the dialog replaces it.

import { loadAutoCorrect, saveAutoCorrect, type AutoCorrectOptions } from './autoCorrect';

let current = $state<AutoCorrectOptions>(loadAutoCorrect());

export function autoCorrect(): AutoCorrectOptions {
  return current;
}

export function setAutoCorrect(next: AutoCorrectOptions): void {
  current = next;
  saveAutoCorrect(current);
}
