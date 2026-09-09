import { flushSync } from 'svelte';

// The header/footer layer draws only the pages around the one being read. A capture or a
// printout takes the live DOM, so both open the window to the whole document first.
export const allPagesDrawn = $state({ on: false });

if (typeof window !== 'undefined') {
  window.addEventListener('beforeprint', () => {
    allPagesDrawn.on = true;
    flushSync();
  });
  window.addEventListener('afterprint', () => {
    allPagesDrawn.on = false;
  });
}
