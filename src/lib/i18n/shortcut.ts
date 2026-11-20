// Platform- and locale-aware keyboard-shortcut hints. Catalog messages store only
// the label; the shortcut suffix is composed at render. Mac always shows ⌘/⇧; other
// platforms use the locale's modifier names (Ctrl/Shift, Strg/Umschalt).

import { locale, t } from './i18n.svelte';
import { isRtlLocale } from './config';

const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

// 'Ctrl+Shift+S' → '⌘+⇧+S' on Mac, 'Strg+Umschalt+S' in German, etc.
export function withShortcut(combo: string): string {
  const mod = IS_MAC ? '⌘' : t().shortcut.ctrl;
  const shift = IS_MAC ? '⇧' : t().shortcut.shift;
  const alt = IS_MAC ? '⌥' : t().shortcut.alt;
  return ltrIsland(combo.replace('Ctrl', mod).replace('Shift', shift).replace('Alt', alt));
}

// Text that reads left to right whatever surrounds it (a key combination, a file name, a
// value with its unit), for places markup cannot reach: a title, a catalog sentence. Under
// a right-to-left UI it is wrapped in Unicode isolates; elsewhere it is returned as it is.
export function ltrIsland(text: string): string {
  return isRtlLocale(locale()) && text ? `\u2066${text}\u2069` : text;
}

// A name (or other user text) inside a catalog sentence, as `<bdi>` isolates it in markup:
// under a right-to-left UI it takes its own direction, so a Latin name's punctuation stays put.
export function nameIsland(text: string): string {
  return isRtlLocale(locale()) && text ? `\u2068${text}\u2069` : text;
}
