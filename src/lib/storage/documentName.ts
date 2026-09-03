// The user-visible document name (without the .odt extension). Drives the
// suggested filename on save; empty falls back to the heading-derived name.

const KEY = 'edentext-doc-name';

export function loadDocName(): string {
  return localStorage.getItem(KEY) ?? '';
}

export function saveDocName(name: string): void {
  localStorage.setItem(KEY, name);
}

// Drop a trailing .odt or .ott (case-insensitive) so the field shows just the name.
export function stripOdtExtension(name: string): string {
  return name.replace(/\.o[dt]t$/i, '');
}

// Strip filesystem-illegal characters; keep spaces so user-typed titles read
// naturally (unlike the heading slug, which hyphenates).
export function sanitizeNameForFile(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
}

export type DocumentFormat = 'odt' | 'docx';

// The format the open document round-trips in. Absent at the .odt default, so only a
// document that came in as .docx writes anything.
const FORMAT_KEY = 'edentext-doc-format';

export function loadDocFormat(): DocumentFormat {
  return localStorage.getItem(FORMAT_KEY) === 'docx' ? 'docx' : 'odt';
}

export function saveDocFormat(format: DocumentFormat): void {
  if (format === 'docx') localStorage.setItem(FORMAT_KEY, format);
  else localStorage.removeItem(FORMAT_KEY);
}
