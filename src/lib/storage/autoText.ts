// LibreOffice's Tools ▸ AutoText / Word's Insert ▸ Quick Parts: named blocks of text
// kept beside the documents, not in one. Both products store them in a template of
// their own (`.bau`, a `.dotx`); here they live in localStorage, so they outlive the
// document that made them.

import type { JSONContent } from '@tiptap/core';

export type AutoTextEntry = {
  name: string;
  /** Typed in the text, then F3 — LibreOffice's shortcut, case-insensitive. */
  shortcut: string;
  /** The entry's nodes, or the HTML an entry stored before they were kept as JSON. */
  content: JSONContent[] | string;
};

const KEY = 'edentext-autotext';

/** The entry's content, taking an older entry's `html` as the string it already is. */
function contentOf(e: AutoTextEntry & { html?: unknown }): AutoTextEntry['content'] | null {
  if (Array.isArray(e.content) || typeof e.content === 'string') return e.content;
  return typeof e.html === 'string' ? e.html : null;
}

export function loadAutoText(): AutoTextEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? (JSON.parse(raw) as AutoTextEntry[]) : [];
    if (!Array.isArray(data)) return [];
    return data.flatMap((e) => {
      const content = e && typeof e.name === 'string' ? contentOf(e) : null;
      return content === null ? [] : [{ name: e.name, shortcut: String(e.shortcut ?? ''), content }];
    });
  } catch {
    return [];
  }
}

export function saveAutoText(list: AutoTextEntry[]): void {
  if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
  else localStorage.removeItem(KEY);
}

/** The entry a typed shortcut names, matched as LibreOffice matches it: ignoring case. */
export function entryForShortcut(list: AutoTextEntry[], word: string): AutoTextEntry | null {
  const key = word.trim().toLowerCase();
  return key ? list.find((e) => e.shortcut.toLowerCase() === key) ?? null : null;
}
