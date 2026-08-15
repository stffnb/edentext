export type ThemeMode = 'light' | 'dark' | 'allBlack' | 'auto';

// Which chrome mounts above the document: the floating command island, or the
// Word-style ribbon. Both drive the same editor; only one is mounted at a time.
export type ChromeMode = 'classic' | 'ribbon';

const THEME_KEY = 'edentext-theme';
const TOOLBAR_KEY = 'edentext-toolbar-expanded';
const CHROME_KEY = 'edentext-chrome';
const RIBBON_COLLAPSED_KEY = 'edentext-ribbon-collapsed';
const FORMATTING_MARKS_KEY = 'edentext-formatting-marks';
const RULER_KEY = 'edentext-ruler';
const SPLIT_KEY = 'edentext-split';
const PAGE_COLUMNS_KEY = 'edentext-page-columns';

// Pages side by side. Each column is a live view of the whole document, so the
// count is capped — LibreOffice's own spinner goes further.
export const MAX_PAGE_COLUMNS = 4;

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

// The split is off unless it was switched on; the divider's position is not kept,
// as neither word processor restores one either.
export function loadSplitView(): boolean {
    return localStorage.getItem(SPLIT_KEY) === 'true';
}

export function saveSplitView(enabled: boolean): void {
    localStorage.setItem(SPLIT_KEY, String(enabled));
}

export function loadPageColumns(): number {
    const n = parseInt(localStorage.getItem(PAGE_COLUMNS_KEY) ?? '1', 10);
  return Number.isFinite(n) ? Math.min(MAX_PAGE_COLUMNS, Math.max(1, n)) : 1;
}

export function savePageColumns(columns: number): void {
    localStorage.setItem(PAGE_COLUMNS_KEY, String(columns));
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
