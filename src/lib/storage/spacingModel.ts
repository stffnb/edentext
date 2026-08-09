// How the space between two blocks is measured. LibreOffice adds the upper block's
// space-below to the lower one's space-above ('add', its native ODF behaviour) but takes
// only the larger of the two for a Word document ('max') — probed, and per document.
export type SpacingModel = 'add' | 'max';

const KEY = 'odf-editor-spacing-model';

export function loadSpacingModel(): SpacingModel {
  return localStorage.getItem(KEY) === 'max' ? 'max' : 'add';
}

export function saveSpacingModel(m: SpacingModel): void {
  localStorage.setItem(KEY, m);
}
