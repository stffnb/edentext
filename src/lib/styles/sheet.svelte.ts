// The document's style sheet as a reactive singleton (same shape as i18n.svelte.ts):
// components read styleSheet() in a template or $derived and re-render when it is
// replaced. Persisted to localStorage like the other document side-cars.

import { builtinStyleSheet, type Style, type StyleSheet } from './styleSheet';

const STORAGE_KEY = 'odf-editor-styles';

function load(): StyleSheet {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return builtinStyleSheet();
  try {
    const parsed = JSON.parse(raw) as StyleSheet;
    if (!parsed?.paragraph || typeof parsed.paragraph !== 'object') return builtinStyleSheet();
    // Built-ins are re-seeded so a new release's additions show up; stored entries win.
    return { paragraph: { ...builtinStyleSheet().paragraph, ...parsed.paragraph } };
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

// Replace one style (add or edit) — every block using it re-renders via styleCss.
export function putStyle(style: Style): void {
  setStyleSheet({ paragraph: { ...current.paragraph, [style.name]: style } });
}
