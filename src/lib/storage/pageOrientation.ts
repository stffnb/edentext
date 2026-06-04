export type Orientation = 'portrait' | 'landscape';

const KEY = 'odf-editor-page-orientation';

// A4 page box in px @96dpi. Portrait is the editor's historical fixed layout;
// landscape swaps the two dimensions (matches odf-kit's automatic A4 swap).
export const PAGE_W_PORTRAIT = 794;  // 210mm
export const PAGE_H_PORTRAIT = 1123; // 297mm

export function loadOrientation(): Orientation {
  return localStorage.getItem(KEY) === 'landscape' ? 'landscape' : 'portrait';
}

export function saveOrientation(o: Orientation): void {
  localStorage.setItem(KEY, o);
}

// Sets --user-page-{width,height} (in px) on the document root, where they
// inherit down to .paper / .tiptap (see editor.css) and are read per layout
// pass by pageBreaks.ts. Landscape swaps the portrait dimensions.
export function applyOrientationVars(o: Orientation): void {
  const landscape = o === 'landscape';
  const w = landscape ? PAGE_H_PORTRAIT : PAGE_W_PORTRAIT;
  const h = landscape ? PAGE_W_PORTRAIT : PAGE_H_PORTRAIT;
  const root = document.documentElement.style;
  root.setProperty('--user-page-width', `${w}px`);
  root.setProperty('--user-page-height', `${h}px`);
}
