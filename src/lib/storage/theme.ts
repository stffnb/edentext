export type ThemeMode = 'light' | 'dark' | 'allBlack' | 'auto';

// Which chrome mounts above the document: the floating command island, or the
// Word-style ribbon. Both drive the same editor; only one is mounted at a time.
export type ChromeMode = 'classic' | 'ribbon';

const THEME_KEY = 'odf-editor-theme';
const TOOLBAR_KEY = 'odf-editor-toolbar-expanded';
const CHROME_KEY = 'odf-editor-chrome';
const RIBBON_COLLAPSED_KEY = 'odf-editor-ribbon-collapsed';
const FORMATTING_MARKS_KEY = 'odf-editor-formatting-marks';
const RULER_KEY = 'odf-editor-ruler';

export function loadTheme(): ThemeMode {
    const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark' || saved === 'allBlack' || saved === 'auto') return saved;
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

export function loadChromeMode(): ChromeMode {
    return localStorage.getItem(CHROME_KEY) === 'ribbon' ? 'ribbon' : 'classic';
}

export function saveChromeMode(mode: ChromeMode): void {
    localStorage.setItem(CHROME_KEY, mode);
}

export function loadRibbonCollapsed(): boolean {
    return localStorage.getItem(RIBBON_COLLAPSED_KEY) === 'true';
}

export function saveRibbonCollapsed(collapsed: boolean): void {
    localStorage.setItem(RIBBON_COLLAPSED_KEY, String(collapsed));
}

export function loadFormattingMarks(): boolean {
    return localStorage.getItem(FORMATTING_MARKS_KEY) === 'true';
}

export function saveFormattingMarks(enabled: boolean): void {
    localStorage.setItem(FORMATTING_MARKS_KEY, String(enabled));
}

// The ruler is on unless it was switched off.
export function loadRuler(): boolean {
    return localStorage.getItem(RULER_KEY) !== 'false';
}

export function saveRuler(enabled: boolean): void {
    localStorage.setItem(RULER_KEY, String(enabled));
}

function resolveMode(mode: ThemeMode): 'light' | 'dark' | 'allBlack' {
  if (mode === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute('data-theme', resolveMode(mode));
}
