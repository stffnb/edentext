// Header/footer content: one single-paragraph TipTap doc per zone (hfExtensions
// schema), identical on every page. null = zone empty → not exported.

export type HfZone = 'header' | 'footer';
export type HfDoc = { type: 'doc'; content?: unknown[] } | null;

const KEYS: Record<HfZone, string> = {
  header: 'odf-editor-header',
  footer: 'odf-editor-footer',
};

// Word's default distance from the page edge to the header/footer text. The body
// margin stays the body margin (Word semantics); export/import convert to ODF's
// margin-to-header model (see export/odt.ts applyHfPostProcess).
export const HF_DISTANCE_CM = 1.25;

// Per-zone distance from the page edge to the header (from top) / footer (from
// bottom), in cm — user-configurable in the Layout panel.
export type HfDistances = { header: number; footer: number };

export const DEFAULT_HF_DISTANCES: HfDistances = { header: HF_DISTANCE_CM, footer: HF_DISTANCE_CM };

const DIST_KEY = 'odf-editor-hf-distances';
const DIST_MIN = 0;
const DIST_MAX = 10;

export function clampHfDistance(n: number): number {
  if (!Number.isFinite(n)) return HF_DISTANCE_CM;
  return Math.min(DIST_MAX, Math.max(DIST_MIN, Math.round(n * 100) / 100));
}

export function loadHfDistances(): HfDistances {
  const raw = localStorage.getItem(DIST_KEY);
  if (!raw) return { ...DEFAULT_HF_DISTANCES };
  try {
    const p = JSON.parse(raw);
    return {
      header: typeof p.header === 'number' ? clampHfDistance(p.header) : HF_DISTANCE_CM,
      footer: typeof p.footer === 'number' ? clampHfDistance(p.footer) : HF_DISTANCE_CM,
    };
  } catch {
    return { ...DEFAULT_HF_DISTANCES };
  }
}

export function saveHfDistances(d: HfDistances): void {
  localStorage.setItem(DIST_KEY, JSON.stringify(d));
}

export function loadHfDoc(zone: HfZone): HfDoc {
  const raw = localStorage.getItem(KEYS[zone]);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.type === 'doc' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveHfDoc(zone: HfZone, doc: HfDoc): void {
  if (hfIsEmpty(doc)) localStorage.removeItem(KEYS[zone]);
  else localStorage.setItem(KEYS[zone], JSON.stringify(doc));
}

// Empty = null or a single paragraph without inline content. Empty zones render
// nothing and are skipped on export.
export function hfIsEmpty(doc: HfDoc): boolean {
  if (!doc?.content?.length) return true;
  const para = doc.content[0] as { content?: unknown[] } | undefined;
  return !para?.content?.length;
}
