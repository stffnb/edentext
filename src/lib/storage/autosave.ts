import { t } from '../i18n/i18n.svelte';

const STORAGE_KEY = 'edentext-doc';
// Set while a stored document is being handed to the editor, cleared once the editor
// has actually come up (markDocumentLoaded). Finding it still set at load time means
// the last attempt hung or threw — reloading would only freeze again.
const BOOT_KEY = 'edentext-doc-loading';
// Where such a document is parked instead of being loaded, so nothing is lost and
// it can still be pulled out of localStorage.
const BROKEN_KEY = 'edentext-doc-broken';
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
  if (localStorage.getItem(BOOT_KEY)) {
    localStorage.removeItem(BOOT_KEY);
    if (raw) {
      localStorage.setItem(BROKEN_KEY, raw);
      localStorage.removeItem(STORAGE_KEY);
      // After paint, so the message doesn't land on a blank app.
      requestAnimationFrame(() => alert(t().dialogs.documentNotLoaded));
    }
    return null;
  }
  if (!raw) return null;
  let doc: object;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  localStorage.setItem(BOOT_KEY, '1');
  return doc;
}

// Called once the editor is up and has laid out the document. Until then the boot
// flag stands, so a document that freezes the editor is skipped on the next load.
export function markDocumentLoaded(): void {
  localStorage.removeItem(BOOT_KEY);
}

export function clearDocument(): void {
  localStorage.removeItem(STORAGE_KEY);
}
