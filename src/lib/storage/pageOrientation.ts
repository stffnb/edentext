export type Orientation = 'portrait' | 'landscape';

const KEY = 'odf-editor-page-orientation';

export function loadOrientation(): Orientation {
  return localStorage.getItem(KEY) === 'landscape' ? 'landscape' : 'portrait';
}

export function saveOrientation(o: Orientation): void {
  localStorage.setItem(KEY, o);
}
