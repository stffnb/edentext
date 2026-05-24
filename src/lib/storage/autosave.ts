const STORAGE_KEY = 'odf-editor-doc';
const DEBOUNCE_MS = 1000;

let timeout: ReturnType<typeof setTimeout> | null = null;

export function saveDocument(json: object): void {
  if (timeout) clearTimeout(timeout);
  timeout = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
  }, DEBOUNCE_MS);
}

export function loadDocument(): object | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearDocument(): void {
  localStorage.removeItem(STORAGE_KEY);
}
