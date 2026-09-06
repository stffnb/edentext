import { FontFamily as FontFamilyBase } from '@tiptap/extension-text-style';

// Typing over a mixed selection makes the contenteditable insert a span carrying the
// computed style — a whole CSS stack, which is no font name the picker or either file
// can use. The first family is what renders, so that is the name the mark keeps.
export function firstFontFamily(value: string | null | undefined): string | null {
  const first = String(value ?? '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  return first && !first.startsWith('var(') ? first : null;
}

// The raw style attribute first, as upstream does: element.style canonicalizes a
// single-quoted multi-word name into double quotes.
const declared = (el: HTMLElement): string | null =>
  el.getAttribute('style')?.match(/(?:^|;)\s*font-family\s*:([^;]*)/i)?.[1] ?? el.style.fontFamily ?? null;

export const FontFamily = FontFamilyBase.extend({
  addGlobalAttributes() {
    return (this.parent?.() ?? []).map((group) => ({
      ...group,
      attributes: {
        ...group.attributes,
        fontFamily: {
          ...(group.attributes as Record<string, object>).fontFamily,
          parseHTML: (element: HTMLElement) => firstFontFamily(declared(element)),
        },
      },
    }));
  },
});
