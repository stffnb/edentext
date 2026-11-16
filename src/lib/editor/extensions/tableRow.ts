import { TableRow } from '@tiptap/extension-table';
import { mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { parseCellPadding } from './tableCellPadding';

// TableRow with a `rowHeight` attr (CSS px @96dpi, two decimals), rendered as a <tr>
// min-height and exported as style:min-row-height (export/odt.ts). null auto-sizes
// to content. The drag interaction lives in tableRowResize.ts; this file owns the attr.
// LibreOffice adds the cells' top and bottom margins to that minimum (probed: 0.594cm
// with 0.049cm margins draws a 0.692cm row), whichever format the height came from.
// A `fixedHeight` row (w:hRule="exact", ODF style:row-height) adds the bottom margin only.

// LibreOffice gives every cell of a row the row's largest top and bottom margin (probed
// in both formats: one cell's 0.35cm top margin lowers its neighbours' text as well).
function rowPadStyle(row: PMNode): string | null {
  const own: number[][] = [];
  let inherits = false;
  row.forEach((cell) => {
    const p = parseCellPadding(cell.attrs.cellPadding);
    if (p) own.push(p);
    else inherits = true;
  });
  if (!own.length) return null;
  const side = (i: number, v: string) =>
    `--row-pad-${v}:max(${[...own.map((p) => `${p[i]}cm`), ...(inherits ? [`var(--cell-pad-${v}, 0px)`] : [])].join(',')})`;
  return `${side(0, 't')};${side(2, 'b')}`;
}

export const ResizableTableRow = TableRow.extend({
  renderHTML({ node, HTMLAttributes }) {
    const pad = rowPadStyle(node);
    return ['tr', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, pad ? { style: pad } : {}), 0];
  },

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
          return m ? Math.round(parseFloat(m[1]) * 100) / 100 : null;
        },
        renderHTML: (attributes) => {
          const h = attributes.rowHeight as number | null;
          if (!h) return {};
          const top = 'var(--row-pad-t, var(--cell-pad-t, 0px))';
          const pad = attributes.fixedHeight ? '' : ` + ${top}`;
          // --row-text is the content box's height: the line length of a turned cell's text.
          const text = attributes.fixedHeight ? `calc(${h}px - ${top})` : `${h}px`;
          return { style: `height: calc(${h}px${pad} + var(--row-pad-b, var(--cell-pad-b, 0px))); --row-text: ${text}` };
        },
      },
      // The height is exact, not a minimum; only meaningful with a rowHeight.
      fixedHeight: {
        default: false,
        parseHTML: (element) => (element as HTMLElement).dataset?.fixedHeight === 'true',
        renderHTML: (attributes) => (attributes.fixedHeight ? { 'data-fixed-height': 'true' } : {}),
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
