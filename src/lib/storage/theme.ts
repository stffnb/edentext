export type ThemeMode = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'odf-editor-theme';

export function loadTheme(): ThemeMode {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark' || saved === 'auto') return saved;
  return 'auto';
}

export function saveTheme(mode: ThemeMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
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
