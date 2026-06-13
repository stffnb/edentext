import { Node } from '@tiptap/core';

// Inline atom fields for header/footer content: current page number and total
// page count. The DOM text is a placeholder — HeaderFooterLayer.svelte patches
// every [data-page-field] span with the real per-page value after rendering.
// Round-trips to ODF <text:page-number>/<text:page-count> (export/import odt.ts).

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
