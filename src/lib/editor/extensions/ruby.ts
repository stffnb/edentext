import { Node, mergeAttributes } from '@tiptap/core';

// A ruby annotation: the small reading printed over a run of text (LibreOffice's
// Format ▸ Asian Phonetic Guide, Word's Phonetic Guide). An inline **atom** carrying
// both halves, because that is what both formats write — one element holding a base
// and its reading, edited as a unit.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    ruby: {
      insertRuby: (attrs: { base: string; text: string }) => ReturnType;
    };
  }
}

export const Ruby = Node.create({
  name: 'ruby',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      base: {
        default: '',
        parseHTML: (el) => baseTextOf(el as HTMLElement),
        renderHTML: () => ({}),
      },
      text: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).querySelector('rt')?.textContent?.trim() ?? '',
        renderHTML: (attrs) => ({ 'data-ruby': String(attrs.text ?? '') }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'ruby' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'ruby',
      mergeAttributes(HTMLAttributes, { class: 'pm-ruby' }),
      String(node.attrs.base ?? ''),
      ['rt', {}, String(node.attrs.text ?? '')],
    ];
  },

  addCommands() {
    return {
      insertRuby: (attrs) => ({ commands }) => {
        const base = attrs.base.trim();
        if (!base) return false;
        return commands.insertContent({ type: this.name, attrs: { base, text: attrs.text.trim() } });
      },
    };
  },
});

// The base is everything the element holds outside its <rt> (and <rp>, the brackets a
// reader without ruby support falls back to).
function baseTextOf(el: HTMLElement): string {
  let out = '';
  for (const child of Array.from(el.childNodes)) {
    const tag = child.nodeType === 1 ? (child as HTMLElement).tagName.toLowerCase() : '';
    if (tag !== 'rt' && tag !== 'rp') out += child.textContent ?? '';
  }
  return out.trim();
}
