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
// margin-to-header model (see export/odt.ts applyHeaderFooterGeometry).
export const HF_DISTANCE_CM = 1.27;

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
