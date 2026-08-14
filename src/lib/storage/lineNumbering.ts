// LibreOffice's Tools ▸ Line Numbering / Word's Layout ▸ Line Numbers. Off by default in
// both, so a fresh document writes nothing and neither importer stamps it on a file that
// declares none. ODF keeps it as one <text:linenumbering-configuration> in office:styles,
// Word as <w:lnNumType> in every w:sectPr (probed).

const KEY = 'edentext-line-numbering';

export type LineNumbering = {
  on: boolean;
  /** Only every nth line shows its number — LibreOffice's "Interval". */
  interval: number;
  /** Gap from the number to the text, in cm. */
  distanceCm: number;
  /** Where the count starts over. */
  restart: 'continuous' | 'page';
  /** Whether an empty line counts, as it does in both word processors by default. */
  countEmpty: boolean;
};

export const DEFAULT_LINE_NUMBERING: LineNumbering = {
  on: false, interval: 5, distanceCm: 0.5, restart: 'continuous', countEmpty: true,
};

export function normalizeLineNumbering(raw: unknown): LineNumbering {
  const v = raw as Partial<LineNumbering> | null | undefined;
  if (!v || typeof v !== 'object') return DEFAULT_LINE_NUMBERING;
  const clamp = (n: unknown, lo: number, hi: number, fallback: number) => {
    const x = Number(n);
    return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x * 100) / 100)) : fallback;
  };
  return {
    on: v.on === true,
    interval: Math.round(clamp(v.interval, 1, 100, DEFAULT_LINE_NUMBERING.interval)),
    distanceCm: clamp(v.distanceCm, 0, 5, DEFAULT_LINE_NUMBERING.distanceCm),
    restart: v.restart === 'page' ? 'page' : 'continuous',
    countEmpty: v.countEmpty !== false,
  };
}

export function loadLineNumbering(): LineNumbering {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizeLineNumbering(JSON.parse(raw)) : DEFAULT_LINE_NUMBERING;
  } catch {
    return DEFAULT_LINE_NUMBERING;
  }
}

export function saveLineNumbering(ln: LineNumbering): void {
  if (!ln.on) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(ln));
}
