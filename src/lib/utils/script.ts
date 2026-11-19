// Text both word processors set from the asian font and language slot. CJK punctuation and
// the fullwidth forms are script Common, so the property escapes miss them; LibreOffice
// sets both from the asian properties.
export const ASIAN_SCRIPT_RE =
  /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}\p{sc=Bopomofo}　-〿＀-￯]/u;

// Text both word processors set from the complex-script slot: Hebrew and Arabic with their
// presentation forms, the Indic scripts, Thai and Khmer.
export const COMPLEX_SCRIPT_RE = /[\u0590-\u08FF\u0900-\u0DFF\u0E00-\u0E7F\u1780-\u17FF\uFB1D-\uFDFF\uFE70-\uFEFC]/;

// More East Asian characters than Latin letters: the text of a Chinese, Japanese or
// Korean document. ponytail: a count over the whole text, blind to styles and hidden
// text; vote per paragraph if a mixed document misreads.
export function mostlyAsian(text: string): boolean {
  const asian = text.match(new RegExp(ASIAN_SCRIPT_RE.source, 'gu'))?.length ?? 0;
  return asian > (text.match(/\p{sc=Latin}/gu)?.length ?? 0);
}

// The slot most of a text's letters belong to, which names a file's main language
// among the three defaults every file carries.
export function dominantScript(text: string): 'asian' | 'complex' | null {
  if (mostlyAsian(text)) return 'asian';
  const complex = text.match(new RegExp(COMPLEX_SCRIPT_RE.source, 'g'))?.length ?? 0;
  return complex > (text.match(/\p{sc=Latin}/gu)?.length ?? 0) ? 'complex' : null;
}
