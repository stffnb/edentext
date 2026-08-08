const KEY = 'odf-editor-tab-interval';

// The grid every tab past the last custom stop falls on (Word w:defaultTabStop, ODF
// style:tab-stop-distance). LibreOffice's default for a new document.
export const DEFAULT_TAB_INTERVAL_CM = 1.25;

// What a file that declares none falls back to. Both differ from the editor's default,
// so the exports always write the value out rather than leaving it implied.
export const ODF_IMPLIED_TAB_CM = 2;    // measured against LibreOffice
export const DOCX_IMPLIED_TAB_CM = 1.27; // ECMA-376's w:defaultTabStop default, 720twip

const MIN_CM = 0.05;
const MAX_CM = 10;

export function clampTabInterval(cm: unknown): number {
  if (typeof cm !== 'number' || !Number.isFinite(cm)) return DEFAULT_TAB_INTERVAL_CM;
  return Math.min(MAX_CM, Math.max(MIN_CM, Math.round(cm * 1000) / 1000));
}

export function loadTabInterval(): number {
  const raw = localStorage.getItem(KEY);
  return raw == null ? DEFAULT_TAB_INTERVAL_CM : clampTabInterval(parseFloat(raw));
}

export function saveTabInterval(cm: number): void {
  localStorage.setItem(KEY, String(cm));
}

// Sets --tab-interval on the document root, where it inherits down to .tiptap and
// becomes its `tab-size` (see editor.css).
export function applyTabIntervalVar(cm: number): void {
  document.documentElement.style.setProperty('--tab-interval', `${cm}cm`);
}
