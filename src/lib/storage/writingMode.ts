// The page's text direction: ODF style:writing-mode="rl-tb" / Word's w:bidi. A
// right-to-left page fills its columns from the right and sets the body's base
// direction, so bidi resolves a Hebrew or Arabic line the way the file means it.

const KEY = 'edentext-page-rtl';

export function loadPageRtl(): boolean {
  return localStorage.getItem(KEY) === 'true';
}

export function savePageRtl(rtl: boolean): void {
  localStorage.setItem(KEY, String(rtl));
}
