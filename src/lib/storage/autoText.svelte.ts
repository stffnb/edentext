// The AutoText library as a reactive singleton (like autoCorrect.svelte.ts): the
// extension reads it on F3, the dialog adds to and removes from it.

import { loadAutoText, saveAutoText, type AutoTextEntry } from './autoText';

let current = $state<AutoTextEntry[]>(loadAutoText());

export function autoTextEntries(): AutoTextEntry[] {
  return current;
}

export function setAutoTextEntries(next: AutoTextEntry[]): void {
  current = next;
  saveAutoText(current);
}

/** Added, or replaced where an entry of that name is already there. */
export function putAutoText(entry: AutoTextEntry): void {
  setAutoTextEntries([...current.filter((e) => e.name !== entry.name), entry]);
}

export function removeAutoText(name: string): void {
  setAutoTextEntries(current.filter((e) => e.name !== name));
}
