// The document's style sheet as a reactive singleton (same shape as i18n.svelte.ts):
// components read styleSheet() in a template or $derived and re-render when it is
// replaced. Persisted to localStorage like the other document side-cars.

import { builtinStyleSheet, DEFAULT_STYLE, mergeStoredSheet, STYLE_SHEET_VERSION, type Style, type StyleSheet } from './styleSheet';

const STORAGE_KEY = 'odf-editor-styles';

function load(): StyleSheet {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return builtinStyleSheet();
  try {
    return mergeStoredSheet(JSON.parse(raw));
  } catch {
    return builtinStyleSheet();
  }
}

let current = $state<StyleSheet>(load());

export function styleSheet(): StyleSheet {
  return current;
}

export function setStyleSheet(next: StyleSheet): void {
  current = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: STYLE_SHEET_VERSION, ...next }));
}

// Replace one style (add or edit) — every block using it re-renders via styleCss.
export function putStyle(style: Style): void {
  setStyleSheet({ paragraph: { ...current.paragraph, [style.name]: style } });
}

// Rename a style and re-point everything that referenced it (children, next-styles).
// Blocks keep their own `styleName`; the caller retags them.
export function renameStyle(from: string, to: string): void {
  const style = current.paragraph[from];
  if (!style || from === to || current.paragraph[to]) return;
  const paragraph: Record<string, Style> = {};
  for (const [name, s] of Object.entries(current.paragraph)) {
    if (name === from) continue;
    paragraph[name] = { ...s, parent: s.parent === from ? to : s.parent, next: s.next === from ? to : s.next };
  }
  paragraph[to] = { ...style, name: to, builtin: undefined };
  setStyleSheet({ paragraph });
}

// Delete a style; its children re-parent to its own parent, as in LibreOffice.
export function deleteStyle(name: string): void {
  const style = current.paragraph[name];
  if (!style || style.builtin) return;
  const paragraph: Record<string, Style> = {};
  for (const [key, s] of Object.entries(current.paragraph)) {
    if (key === name) continue;
    paragraph[key] = {
      ...s,
      parent: s.parent === name ? style.parent : s.parent,
      next: s.next === name ? style.next ?? DEFAULT_STYLE : s.next,
    };
  }
  setStyleSheet({ paragraph });
}

// Restore a built-in to its factory definition.
export function resetStyle(name: string): void {
  const factory = builtinStyleSheet().paragraph[name];
  if (factory) putStyle(factory);
}
