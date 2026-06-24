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
