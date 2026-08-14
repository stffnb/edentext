import { withShortcut } from '../i18n/shortcut';

// Every shortcut this app binds itself, in ProseMirror keymap syntax ('Mod' = Ctrl/Cmd).
// Ids are stable so a later remapping UI only overrides this map. TipTap's own defaults
// (Mod-b/i/u, Mod-Shift-s/h, Mod-z, Mod-Shift-7/8, …) are not ours to bind and not listed.

export const DEFAULT_SHORTCUTS = {
  // Character formatting — LibreOffice's sub/superscript keys; Word's Ctrl+= pair
  // would collide with zoom. Mod-Shift-b deliberately shadows TipTap's Mod-B bold alias.
  superscript: 'Mod-Shift-p',
  subscript: 'Mod-Shift-b',
  fontGrow: 'Mod-Shift-.',
  fontShrink: 'Mod-Shift-,',
  clearFormatting: 'Mod-m',
  clearFormattingAlt: 'Mod-Space',

  // Paragraph
  alignLeft: 'Mod-l',
  alignCenter: 'Mod-e',
  alignRight: 'Mod-r',
  alignJustify: 'Mod-j',
  lineHeight1: 'Mod-1',
  lineHeight2: 'Mod-2',
  lineHeight15: 'Mod-5',
  heading1: 'Mod-Alt-1',
  heading2: 'Mod-Alt-2',
  heading3: 'Mod-Alt-3',
  heading4: 'Mod-Alt-4',
  heading5: 'Mod-Alt-5',
  heading6: 'Mod-Alt-6',
  styleStandard: 'Mod-Shift-n',
  indentMore: 'Tab',
  indentLess: 'Shift-Tab',

  // Insert
  link: 'Mod-k',
  pageBreak: 'Mod-Enter',
  nbsp: 'Mod-Shift-Space',
  softHyphen: 'Mod-Shift--',
  dateField: 'Alt-Shift-d',
  timeField: 'Alt-Shift-t',
  // Word's own note keys. Letters, not digits: the AltGr collision only affects
  // Mod-Alt-<digit> (see editor/CLAUDE.md).
  footnote: 'Mod-Alt-f',
  endnote: 'Mod-Alt-d',

  // Application (window keydown in App.svelte)
  open: 'Mod-o',
  save: 'Mod-s',
  print: 'Mod-p',
  find: 'Mod-f',
  replace: 'Mod-h',
  findNext: 'F3',
  findPrevious: 'Shift-F3',
  formattingMarks: 'Mod-F10',
  // LibreOffice's Navigator key; Word has none for its Navigation pane.
  navigator: 'F5',
  zoomIn: 'Mod-+',
  zoomOut: 'Mod--',
  zoomReset: 'Mod-0',
} as const;

export type ShortcutId = keyof typeof DEFAULT_SHORTCUTS;

type Parsed = { mod: boolean; shift: boolean; alt: boolean; key: string };

// Split like ProseMirror does: a trailing '-' is the key, not a separator.
function parse(combo: string): Parsed {
  const parts = combo.split(/-(?!$)/);
  const key = parts.pop() ?? '';
  return {
    mod: parts.includes('Mod'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    key,
  };
}

// Layouts put these on different keys; accept every spelling of the same intent.
const KEY_ALIASES: Record<string, string[]> = {
  '+': ['+', '=', 'NumpadAdd'],
  '-': ['-', 'NumpadSubtract'],
};

// For the window-level handler in App.svelte, which has no ProseMirror keymap.
// Digits and function keys match by code so keyboard layouts can't break them.
export function matchesEvent(e: KeyboardEvent, combo: string): boolean {
  const { mod, shift, alt, key } = parse(combo);
  if (mod !== (e.ctrlKey || e.metaKey) || shift !== e.shiftKey || alt !== e.altKey) return false;
  const aliases = KEY_ALIASES[key];
  if (aliases) return aliases.includes(e.key) || aliases.includes(e.code);
  if (/^\d$/.test(key)) return e.code === `Digit${key}` || e.code === `Numpad${key}`;
  if (/^F\d+$/.test(key) || key === 'Enter' || key === 'Tab') return e.key === key;
  if (key === 'Space') return e.code === 'Space';
  return e.key.toLowerCase() === key.toLowerCase();
}

// Tooltip hint: 'Mod-Alt-1' → 'Strg+Alt+1' (or '⌘+⌥+1' on Mac).
export function shortcutHint(id: ShortcutId): string {
  const parts = DEFAULT_SHORTCUTS[id].split(/-(?!$)/);
  const key = parts.pop() ?? '';
  const combo = [
    ...parts.map((p) => (p === 'Mod' ? 'Ctrl' : p)),
    key.length === 1 ? key.toUpperCase() : key,
  ].join('+');
  return withShortcut(combo);
}
