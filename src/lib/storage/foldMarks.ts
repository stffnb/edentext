// Fold and punch marks in the left margin (DIN 5008 letter sheets). Off by default —
// neither word processor prints any — so a fresh document writes nothing. They ride the
// master page's header on export, like the watermark, as named <draw:line>/VML lines.

const KEY = 'edentext-fold-marks';

/** Distances from the top paper edge, in mm (DIN 5008: fold marks and punch mark). */
export const FOLD_MARK_MM = [87, 192];
export const PUNCH_MARK_MM = 148.5;

/** Tick geometry, in mm from the left paper edge; the punch mark is the longer one. */
export const MARK_START_MM = 5;
export const FOLD_MARK_LEN_MM = 4;
export const PUNCH_MARK_LEN_MM = 8;

/** The export names its lines EdenFoldMark1/2/Punch; the importers read them back. */
export const FOLD_MARK_NAME = 'EdenFoldMark';

export function loadFoldMarks(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveFoldMarks(on: boolean): void {
  if (!on) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, 'true');
}
