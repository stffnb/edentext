// Whether a printout carries the review markup — the margin bar beside a changed or
// commented block, and the comment list after the document (`export/reviewPrint.ts`).
// A reactive singleton like trackChanges.svelte.ts: the Review tab flips it, the three
// export paths read it. On by default; both word processors offer the same switch.

const KEY = 'edentext-print-markup';

let current = $state(localStorage.getItem(KEY) !== 'false');

export function printMarkup(): boolean {
  return current;
}

export function setPrintMarkup(on: boolean): void {
  current = on;
  if (on) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, 'false');
}
