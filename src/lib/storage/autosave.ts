import { t } from '../i18n/i18n.svelte';

const STORAGE_KEY = 'odf-editor-doc';
const DEBOUNCE_MS = 1000;

let timeout: ReturnType<typeof setTimeout> | null = null;
// localStorage has a ~5 MB quota; embedded images (data-URIs) can exceed it. Warn
// the user once so a failed autosave isn't silent, and swallow the throw so the
// debounced timer doesn't surface an unhandled error.
let quotaWarned = false;

export function saveDocument(json: object): void {
  if (timeout) clearTimeout(timeout);
  timeout = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
    } catch (err) {
      console.error('[autosave] Could not save the document:', err);
      if (!quotaWarned) {
        quotaWarned = true;
        alert(t().dialogs.autosaveQuota);
      }
    }
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
