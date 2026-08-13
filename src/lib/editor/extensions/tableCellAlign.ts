import { Extension } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';

// Where a cell's content sits in its box: a `verticalAlign` attr on table cells,
// rendered as the cell's CSS vertical-align. null = top, which is what both
// LibreOffice (style:vertical-align="top") and Word (no w:vAlign) default to.

export type CellVerticalAlign = 'middle' | 'bottom';

export const TableCellAlign = Extension.create({
  name: 'tableCellAlign',

  addGlobalAttributes() {
    return [
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          verticalAlign: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const v = element.style.verticalAlign;
              return v === 'middle' || v === 'bottom' ? v : null;
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const v = attributes.verticalAlign;
              return v === 'middle' || v === 'bottom' ? { style: `vertical-align: ${v}` } : {};
            },
          },
        },
      },
    ];
  },
});

// What the debug dump reports per cell. gapAbove/gapBelow measure against the cell's content
// box, so a block's own margin reads as a gap the alignment cannot take back.
export type CellBlockDebug = {
  tag: string;
  styleName: string | null;
  height: number;
  marginTop: number;
  marginBottom: number;
  paddingTop: number;
  paddingBottom: number;
  spaceBefore: string;
  lineHeight: string;
};

export type TableCellDebugEntry = {
  pos: number;
  row: number;
  col: number;
  textPreview: string;
  verticalAlign: CellVerticalAlign | null;
  inlineStyle: string | null;
  computedVerticalAlign: string;
  cellHeight: number;
  paddingTop: number;
  paddingBottom: number;
  gapAbove: number;
  gapBelow: number;
  rowHeightAttr: number | null;
  rowHeight: number;
  blocks: CellBlockDebug[];
};

const CELL_DEBUG_LIMIT = 120;
const px = (v: string) => Math.round(parseFloat(v) * 10) / 10 || 0;
const round1 = (v: number) => Math.round(v * 10) / 10;

export function getTableCellDebug(view: EditorView): TableCellDebugEntry[] {
  const out: TableCellDebugEntry[] = [];
  if (typeof getComputedStyle !== 'function') return out;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'tableCell' && node.type.name !== 'tableHeader') return;
    if (out.length >= CELL_DEBUG_LIMIT) return false;
    const td = view.nodeDOM(pos);
    if (!(td instanceof HTMLElement)) return false;
    const tr = td.parentElement;
    const cs = getComputedStyle(td);
    const cell = td.getBoundingClientRect();
    // The content box: what vertical-align distributes the free space in.
    const top = cell.top + px(cs.borderTopWidth) + px(cs.paddingTop);
    const bottom = cell.bottom - px(cs.borderBottomWidth) - px(cs.paddingBottom);
    const blocks: CellBlockDebug[] = [];
    let first: DOMRect | null = null;
    let last: DOMRect | null = null;
    for (const child of td.children) {
      if (!(child instanceof HTMLElement) || child.dataset.pageBreakSpacer != null) continue;
      const s = getComputedStyle(child);
      // Resize handles and the like are absolutely positioned; only in-flow blocks count.
      if (s.position === 'absolute') continue;
      const r = child.getBoundingClientRect();
      first ??= r;
      last = r;
      blocks.push({
        tag: child.tagName,
        styleName: child.dataset.style ?? null,
        height: round1(r.height),
        marginTop: px(s.marginTop),
        marginBottom: px(s.marginBottom),
        paddingTop: px(s.paddingTop),
        paddingBottom: px(s.paddingBottom),
        spaceBefore: s.getPropertyValue('--space-before').trim(),
        lineHeight: s.lineHeight,
      });
    }
    out.push({
      pos,
      row: tr?.parentElement ? [...tr.parentElement.children].indexOf(tr) : -1,
      col: tr ? [...tr.children].indexOf(td) : -1,
      textPreview: (node.textContent ?? '').slice(0, 40),
      verticalAlign: (node.attrs.verticalAlign as CellVerticalAlign | null) ?? null,
      inlineStyle: td.getAttribute('style'),
      computedVerticalAlign: cs.verticalAlign,
      cellHeight: round1(cell.height),
      paddingTop: px(cs.paddingTop),
      paddingBottom: px(cs.paddingBottom),
      gapAbove: first ? round1(first.top - top) : 0,
      gapBelow: last ? round1(bottom - last.bottom) : 0,
      rowHeightAttr: (tr && view.state.doc.resolve(pos).parent.attrs.rowHeight as number | null) ?? null,
      rowHeight: tr ? round1(tr.getBoundingClientRect().height) : 0,
      blocks,
    });
    return false; // cells hold blocks, not other cells
  });
  return out;
}
