import { TableRow } from '@tiptap/extension-table';

// TableRow with a `rowHeight` attr (integer CSS px @96dpi), rendered as a <tr>
// min-height and exported as style:min-row-height (export/odt.ts). null auto-sizes
// to content. The drag interaction lives in tableRowResize.ts; this file owns the attr.
// LibreOffice adds the cells' top and bottom margins to that minimum (probed: 0.594cm
// with 0.049cm margins draws a 0.692cm row), whichever format the height came from.

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
          const m = /^(?:calc\()?([\d.]+)px\b/.exec(h.trim());
          return m ? Math.round(parseFloat(m[1])) : null;
        },
        renderHTML: (attributes) => {
          const h = attributes.rowHeight as number | null;
          return h ? { style: `height: calc(${h}px + var(--cell-pad-t, 0px) + var(--cell-pad-b, 0px))` } : {};
        },
      },
      // The row may not break across pages (Word's w:cantSplit, ODF's row
      // fo:keep-together): one taller than a page starts on a fresh one (pageBreaks.ts).
      cantSplit: {
        default: false,
        parseHTML: (element) => (element as HTMLElement).dataset?.cantSplit === 'true',
        renderHTML: (attributes) => (attributes.cantSplit ? { 'data-cant-split': 'true' } : {}),
      },
    };
  },
});
