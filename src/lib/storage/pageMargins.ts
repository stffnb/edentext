// cm. `mirrored` = ODF style:page-usage="mirrored" / Word's mirror margins: left and
// right are the inner/outer pair, and an even (left-hand) page swaps them.
export type PageMargins = {
  top: number; bottom: number; left: number; right: number; mirrored?: boolean;
};

const KEY = 'edentext-page-margins';

// LibreOffice Writer's default page margins (Word uses 2.54cm all round). Only a new
// document gets these — an imported one always adopts its own page geometry.
export const DEFAULT_MARGINS: PageMargins = { top: 2, bottom: 2, left: 2, right: 2 };

export const PX_PER_CM = 96 / 2.54; // 37.795 — A4 @96dpi
export const cmToPx = (cm: number) => cm * PX_PER_CM;

const MIN_CM = 0;
const MAX_CM = 10;

function clampCm(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_CM, Math.max(MIN_CM, n));
}

export function loadPageMargins(): PageMargins {
  const raw = localStorage.getItem(KEY);
  if (!raw) return { ...DEFAULT_MARGINS };
  try {
    const parsed = JSON.parse(raw);
    return {
      top:    typeof parsed.top    === 'number' ? clampCm(parsed.top)    : DEFAULT_MARGINS.top,
      bottom: typeof parsed.bottom === 'number' ? clampCm(parsed.bottom) : DEFAULT_MARGINS.bottom,
      left:   typeof parsed.left   === 'number' ? clampCm(parsed.left)   : DEFAULT_MARGINS.left,
      right:  typeof parsed.right  === 'number' ? clampCm(parsed.right)  : DEFAULT_MARGINS.right,
      ...(parsed.mirrored === true ? { mirrored: true } : {}),
    };
  } catch {
    return { ...DEFAULT_MARGINS };
  }
}

export function savePageMargins(m: PageMargins): void {
  localStorage.setItem(KEY, JSON.stringify(m));
}

// Sets --user-margin-{top,bottom,left,right} (in px) on the document root, where
// they inherit down to .tiptap (see editor.css). Drives both the visual padding
// and the pagination math in pageBreaks.ts.
export function applyMarginVars(m: PageMargins): void {
  const root = document.documentElement.style;
  root.setProperty('--user-margin-top',    `${cmToPx(m.top)}px`);
  root.setProperty('--user-margin-bottom', `${cmToPx(m.bottom)}px`);
  root.setProperty('--user-margin-left',   `${cmToPx(m.left)}px`);
  root.setProperty('--user-margin-right',  `${cmToPx(m.right)}px`);
  // How far an even page's text block moves right; .tiptap's padding draws the odd
  // page's pair, so pageBreaks.ts insets the even one by the difference.
  root.setProperty('--user-margin-mirror', `${m.mirrored ? cmToPx(m.right - m.left) : 0}px`);
}
