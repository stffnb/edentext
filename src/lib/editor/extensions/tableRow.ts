import { TableRow } from '@tiptap/extension-table';
import { mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { parseCellPadding } from './tableCellPadding';
import { DEFAULT_BORDER_WIDTH_PT, parseBorderAttr } from './tableCellBorders';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

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

// A minimum row also adds its top border, an exact one none (probed: 0.5pt adds 0.18mm, 3pt
// 1.06mm a row) — LibreOffice's MinRowHeightInclBorder, which every Word import sets.
function rowBorderStyle(row: PMNode): string | null {
  if (!row.attrs.rowHeight || row.attrs.fixedHeight) return null;
  let pt = 0;
  row.forEach((cell) => {
    const b = parseBorderAttr(cell.attrs.borderTop as string | null);
    pt = Math.max(pt, b === 'none' ? 0 : b ? b.widthPt : DEFAULT_BORDER_WIDTH_PT);
  });
  return pt ? `--row-border-t:${pt}pt` : null;
}

// An exact row clips what does not fit, from the top (probed: content taller than the row
// keeps the row's height and its first line where a top-aligned cell has it). A CSS cell
// grows instead, so each overflowing cell's excess is measured and taken off its ::after.
const exactKey = new PluginKey<DecorationSet>('exactRowClip');

function measureExact(view: EditorView): DecorationSet {
  const decos: Decoration[] = [];
  // The zoom, from the editor's own box: a cell's whole-pixel offsetHeight skews it.
  const scale = view.dom.offsetWidth / (view.dom.getBoundingClientRect().width || 1) || 1;
  for (const tr of view.dom.querySelectorAll<HTMLElement>('tr[data-fixed-height]')) {
    const h = parseFloat(/([\d.]+)px/.exec(tr.style.height)?.[1] ?? '');
    if (!Number.isFinite(h)) continue;
    for (const td of Array.from(tr.children) as HTMLElement[]) {
      const first = td.firstElementChild as HTMLElement | null;
      const last = td.lastElementChild as HTMLElement | null;
      if (!first || !last) continue;
      const cs = getComputedStyle(td);
      const top = first.getBoundingClientRect().top - (parseFloat(getComputedStyle(first).marginTop) || 0) / scale;
      const bottom = last.getBoundingClientRect().bottom + (parseFloat(getComputedStyle(last).marginBottom) || 0) / scale;
      const avail = h + (parseFloat(cs.paddingBottom) || 0) - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
      // The row's height holds the cell's borders too (probed: 0.5pt lines, 255tw rows
      // 4.5mm apart), and the ::after's own pull (less the excess it already takes) counts.
      const pull = (parseFloat(getComputedStyle(td, '::after').marginTop) || 0) + (parseFloat(td.style.getPropertyValue('--exact-over')) || 0);
      const over = Math.round(((bottom - top) * scale - avail + td.offsetHeight - td.clientHeight + pull) * 10) / 10;
      if (over <= 0.5) continue;
      const $pos = view.state.doc.resolve(view.posAtDOM(td, 0));
      for (let d = $pos.depth; d > 0; d--) {
        if ($pos.node(d).type.spec.tableRole?.toString().includes('cell')) {
          decos.push(Decoration.node($pos.before(d), $pos.after(d), { style: `--exact-over: ${over}px` }));
          break;
        }
      }
    }
  }
  return DecorationSet.create(view.state.doc, decos);
}

const sameDecos = (a: DecorationSet, b: DecorationSet) => {
  const key = (s: DecorationSet) => s.find().map((d) => `${d.from}:${(d as unknown as { type: { attrs: { style: string } } }).type.attrs.style}`).join('|');
  return key(a) === key(b);
};

export const ResizableTableRow = TableRow.extend({
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin<DecorationSet>({
        key: exactKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old) => tr.getMeta(exactKey) ?? old.map(tr.mapping, tr.doc),
        },
        props: { decorations: (state) => exactKey.getState(state) },
        view: (view) => {
          let frame = 0;
          // A row that grows without a doc change (its columns settle, a cell rewraps) is
          // measured again; one at its own height reports nothing.
          const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : null;
          const watched = new WeakSet<Element>();
          const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
              const rows = view.dom.querySelectorAll('tr[data-fixed-height]');
              rows.forEach((tr) => { if (!watched.has(tr)) { watched.add(tr); resized?.observe(tr); } });
              if (!rows.length && exactKey.getState(view.state) === DecorationSet.empty) return;
              const next = measureExact(view);
              const cur = exactKey.getState(view.state) ?? DecorationSet.empty;
              // Measured with the current excess applied: the children keep their place.
              if (!sameDecos(cur, next)) view.dispatch(view.state.tr.setMeta(exactKey, next).setMeta('addToHistory', false));
            });
          };
          schedule();
          void document.fonts?.ready.then(schedule);
          return { update: (_v, prev) => { if (!prev.doc.eq(view.state.doc)) schedule(); }, destroy: () => { cancelAnimationFrame(frame); resized?.disconnect(); } };
        },
      }),
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const style = [rowPadStyle(node), rowBorderStyle(node)].filter(Boolean).join(';');
    return ['tr', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, style ? { style } : {}), 0];
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
          const pad = attributes.fixedHeight ? '' : ` + ${top} + var(--row-border-t, 0px)`;
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
