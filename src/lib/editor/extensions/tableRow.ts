import { TableRow } from '@tiptap/extension-table';

// TableRow with a `rowHeight` attr (integer CSS px @96dpi), rendered as a <tr>
// min-height and exported as style:min-row-height (export/odt.ts). null auto-sizes
// to content. The drag interaction lives in tableRowResize.ts; this file owns the attr.

export const ResizableTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      rowHeight: {
        default: null as number | null,
        // Round-trip a pasted/imported <tr style="height: …px">. Non-px units are
        // ignored (null) — the editor only ever writes px.
        parseHTML: (element) => {
          const h = (element as HTMLElement).style?.height;
          if (!h) return null;
          const m = /^([\d.]+)px$/.exec(h.trim());
          return m ? Math.round(parseFloat(m[1])) : null;
        },
        renderHTML: (attributes) => {
          const h = attributes.rowHeight as number | null;
          return h ? { style: `height: ${h}px` } : {};
        },
      },
    };
  },
});
