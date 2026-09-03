// cm. `mirrored` = ODF style:page-usage="mirrored" / Word's mirror margins: left and
// right are the inner/outer pair, and an even (left-hand) page swaps them.
export type PageMargins = {
  top: number; bottom: number; left: number; right: number; mirrored?: boolean;
};

export type MarginAxis = 'top' | 'bottom' | 'left' | 'right';

// The flag is absent, never false, when off: margins are compared whole, so a stored
// `mirrored: false` would read as a different page setup than an unmirrored one.
export function withMirrored(m: PageMargins, on: boolean): PageMargins {
  const { mirrored: _was, ...rest } = m;
  return on ? { ...rest, mirrored: true } : rest;
}

// Mirrored, the left/right pair is the inner/outer one — the label the field carries.
export function marginAxisLabel(axis: MarginAxis, m: PageMargins): MarginAxis | 'inner' | 'outer' {
  if (!m.mirrored || (axis !== 'left' && axis !== 'right')) return axis;
  return axis === 'left' ? 'inner' : 'outer';
}

const KEY = 'edentext-page-margins';

// LibreOffice Writer's default page margins (Word uses 2.54cm all round). Only a new
// document gets these — an imported one always adopts its own page geometry.
export const DEFAULT_MARGINS: PageMargins = { top: 2, bottom: 2, left: 2, right: 2 };

// An imported margin is laid out as the file declares it — a back cover really does push
// its five lines to the page foot with a 21cm top. The only cap is that the page keeps a
// strip of text, or the flow would measure a column of no height at all.
export const MIN_CONTENT_CM = 1;

export function fitMargins(m: PageMargins, pageWidthCm: number, pageHeightCm: number): PageMargins {
  const pair = (a: number, b: number, page: number): [number, number] => {
    const room = Math.max(0, page - MIN_CONTENT_CM);
    const first = Math.min(Math.max(0, a), room);
    return [first, Math.min(Math.max(0, b), room - first)];
  };
  const [top, bottom] = pair(m.top, m.bottom, pageHeightCm);
  const [left, right] = pair(m.left, m.right, pageWidthCm);
  return { ...m, top, bottom, left, right };
}

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
}
