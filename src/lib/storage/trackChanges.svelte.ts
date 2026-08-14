// Whether the editor records revisions, as a reactive singleton (same shape as
// autoCorrect.svelte.ts): the extension reads recordChanges() on every transaction, the
// Review tab flips it. Off by default, as in both word processors — and a document that
// records nothing writes no revision registry.

const KEY = 'edentext-record-changes';

let current = $state(localStorage.getItem(KEY) === 'true');

export function recordChanges(): boolean {
  return current;
}

export function setRecordChanges(on: boolean): void {
  current = on;
  if (on) localStorage.setItem(KEY, 'true');
  else localStorage.removeItem(KEY);
}
