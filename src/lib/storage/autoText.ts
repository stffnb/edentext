// LibreOffice's Tools ▸ AutoText / Word's Insert ▸ Quick Parts: named blocks of text
// kept beside the documents, not in one. Both products store them in a template of
// their own (`.bau`, a `.dotx`); here they live in localStorage, so they outlive the
// document that made them.

export type AutoTextEntry = {
  name: string;
  /** Typed in the text, then F3 — LibreOffice's shortcut, case-insensitive. */
  shortcut: string;
  /** The entry's content as HTML, parsed back through the schema on insert. */
  html: string;
};

const KEY = 'edentext-autotext';

export function loadAutoText(): AutoTextEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? (JSON.parse(raw) as AutoTextEntry[]) : [];
    return Array.isArray(data)
      ? data.filter((e) => e && typeof e.name === 'string' && typeof e.html === 'string')
          .map((e) => ({ name: e.name, shortcut: String(e.shortcut ?? ''), html: e.html }))
      : [];
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
