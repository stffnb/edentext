// The user-visible document name (without the .odt extension). Drives the
// suggested filename on save; empty falls back to the heading-derived name.

const KEY = 'odf-editor-doc-name';

export function loadDocName(): string {
  return localStorage.getItem(KEY) ?? '';
}

export function saveDocName(name: string): void {
  localStorage.setItem(KEY, name);
}

// Drop a trailing .odt (case-insensitive) so the field shows just the name.
export function stripOdtExtension(name: string): string {
  return name.replace(/\.odt$/i, '');
}

// Strip filesystem-illegal characters; keep spaces so user-typed titles read
// naturally (unlike the heading slug, which hyphenates).
export function sanitizeNameForFile(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
}
