// Platform- and locale-aware keyboard-shortcut hints. Catalog messages store only
// the label; the shortcut suffix is composed at render. Mac always shows ⌘/⇧; other
// platforms use the locale's modifier names (Ctrl/Shift, Strg/Umschalt).

import { t } from './i18n.svelte';

const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

// 'Ctrl+Shift+S' → '⌘+⇧+S' on Mac, 'Strg+Umschalt+S' in German, etc.
export function withShortcut(combo: string): string {
  const mod = IS_MAC ? '⌘' : t().shortcut.ctrl;
  const shift = IS_MAC ? '⇧' : t().shortcut.shift;
  const alt = IS_MAC ? '⌥' : t().shortcut.alt;
  return combo.replace('Ctrl', mod).replace('Shift', shift).replace('Alt', alt);
}
