// The document's descriptive metadata — LibreOffice's File ▸ Properties, Word's
// File ▸ Info. Written to ODF meta.xml and DOCX docProps/core.xml, read back on import.

export type DocProperties = {
  title: string;
  subject: string;
  // ODF dc:creator / meta:initial-creator, Word's dc:creator ("Author").
  author: string;
  // Comma-separated in the UI; ODF stores one meta:keyword per keyword.
  keywords: string;
  // LibreOffice calls it Comments, Word Comments too (dc:description).
  description: string;
};

const KEY = 'edentext-doc-properties';

export const EMPTY_DOC_PROPERTIES: DocProperties = {
  title: '', subject: '', author: '', keywords: '', description: '',
};

export function loadDocProperties(): DocProperties {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY_DOC_PROPERTIES };
    const data = JSON.parse(raw) as Partial<DocProperties>;
    return { ...EMPTY_DOC_PROPERTIES, ...pickStrings(data) };
  } catch {
    return { ...EMPTY_DOC_PROPERTIES };
  }
}

export function saveDocProperties(props: DocProperties): void {
  if (isEmptyDocProperties(props)) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(props));
}

export function isEmptyDocProperties(props: DocProperties): boolean {
  return Object.values(props).every(v => !v.trim());
}

// Keeps a file's own values from landing as `undefined` or a number.
function pickStrings(data: Partial<DocProperties>): Partial<DocProperties> {
  const out: Partial<DocProperties> = {};
  for (const key of Object.keys(EMPTY_DOC_PROPERTIES) as (keyof DocProperties)[]) {
    if (typeof data[key] === 'string') out[key] = data[key];
  }
  return out;
}

// ODF keeps one meta:keyword per keyword, Word one comma-separated string.
export function keywordList(keywords: string): string[] {
  return keywords.split(',').map(k => k.trim()).filter(Boolean);
}
