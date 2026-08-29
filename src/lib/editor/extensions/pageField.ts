import { Node } from '@tiptap/core';

// Inline atom fields for header/footer: current page number and total page count. The
// DOM text is a placeholder — HeaderFooterLayer.svelte patches each [data-page-field]
// span per page. Round-trips to ODF <text:page-number>/<text:page-count>.

function pageFieldNode(name: string, kind: 'number' | 'count') {
  return Node.create({
    name,
    group: 'inline',
    inline: true,
    atom: true,

    parseHTML() {
      return [{ tag: `span[data-page-field="${kind}"]` }];
    },

    renderHTML() {
      return ['span', { 'data-page-field': kind }, '1'];
    },
  });
}

export const PageNumber = pageFieldNode('pageNumber', 'number');
export const PageCount = pageFieldNode('pageCount', 'count');

// The chapter heading in force on the page — the running head every manual has (in a
// header the chapter at the page's top, in a footer the last begun on it, as
// LibreOffice resolves its <text:chapter>); `text` is the file's cached name.
export const ChapterField = Node.create({
  name: 'chapterField',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      level: {
        default: 1,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-level')) || 1,
      },
      text: {
        default: '',
        parseHTML: (el: HTMLElement) => el.textContent ?? '',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-page-field="chapter"]' }];
  },

  renderHTML({ node }) {
    return ['span', { 'data-page-field': 'chapter', 'data-level': String(node.attrs.level) }, node.attrs.text || ' '];
  },
});
