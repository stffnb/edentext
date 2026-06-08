import { TableRow } from '@tiptap/extension-table';

// TableRow extended with a draggable row height.
//
// TipTap's stock TableRow has no height attribute. We add `rowHeight` (integer
// CSS px, unscaled document pixels at 96 dpi) and render it as `style="height: Npx"`
// on the <tr>. CSS treats a row's height as a *minimum* (the row grows if its
// content is taller), which is exactly the semantics we export — odf-kit gets a
// `style:min-row-height` (see export/odt.ts applyTableRowHeights). `null` means
// "no explicit height" → the row auto-sizes to its content (back-compat for
// documents saved before this feature).
//
// The actual drag interaction + live preview live in tableRowResize.ts; this file
// only owns the persisted attribute and its DOM/serialization mapping.

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
