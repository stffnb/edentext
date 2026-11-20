import { docKey, docStore } from './docScope';
import { isRtlTag, loadDocumentLanguage, tagForLanguage, type DocumentLanguage } from './documentLanguage';

// The page's text direction: ODF style:writing-mode="rl-tb" / Word's w:bidi. A
// right-to-left page fills its columns from the right and sets the body's base
// direction, so bidi resolves a Hebrew or Arabic line the way the file means it.

const KEY = docKey('edentext-page-rtl');

// A new document's page runs the way its language is written, as LibreOffice starts one.
export function defaultPageRtl(language: DocumentLanguage): boolean {
  return isRtlTag(tagForLanguage(language) ?? '');
}

export function loadPageRtl(): boolean {
  const stored = docStore.getItem(KEY);
  return stored === null ? defaultPageRtl(loadDocumentLanguage()) : stored === 'true';
}

export function savePageRtl(rtl: boolean): void {
  docStore.setItem(KEY, String(rtl));
}
