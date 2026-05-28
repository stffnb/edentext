export type ThemeMode = 'light' | 'dark' | 'auto';

const THEME_KEY = 'odf-editor-theme';
const TOOLBAR_KEY = 'odf-editor-toolbar-expanded';
const FORMATTING_MARKS_KEY = 'odf-editor-formatting-marks';

export function loadTheme(): ThemeMode {
    const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark' || saved === 'auto') return saved;
  return 'auto';
}

export function saveTheme(mode: ThemeMode): void {
    localStorage.setItem(THEME_KEY, mode);
}

export function loadToolbarExpanded(): boolean {
    return localStorage.getItem(TOOLBAR_KEY) === 'true';
}

export function saveToolbarExpanded(expanded: boolean): void {
    localStorage.setItem(TOOLBAR_KEY, String(expanded));
}

export function loadFormattingMarks(): boolean {
    return localStorage.getItem(FORMATTING_MARKS_KEY) === 'true';
}

export function saveFormattingMarks(enabled: boolean): void {
    localStorage.setItem(FORMATTING_MARKS_KEY, String(enabled));
}

function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute('data-theme', resolveMode(mode));
}
