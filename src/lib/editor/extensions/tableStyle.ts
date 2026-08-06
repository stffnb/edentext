import { Extension } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { TableMap, isInTable, selectedRect } from '@tiptap/pm/tables';
import {
  DEFAULT_TABLE_LOOK, TABLE_REGIONS, parseTableLook, regionText, resolveTableCell, styleLook,
  tableLookAttr,
  type TableLook, type TableRegion, type TableStyle as TableStyleDef,
} from '../../styles/tableStyles';
import type { TextProps } from '../../styles/styleSheet';

// Word/LibreOffice table styles: the link lives on the table (`tableStyle`), fill and
// borders are materialized into cell attrs (so export/PDF/clipboard need nothing), and
// each cell records its regions in `region` — the hook the generated CSS keys text on.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableStyle: {
      setTableStyle: (name: string | null) => ReturnType;
      setTableLook: (region: TableRegion, on: boolean) => ReturnType;
      reapplyTableStyle: () => ReturnType;
      refreshTableStyles: () => ReturnType;
    };
  }
}

export type TableStyleOptions = { styles: () => Record<string, TableStyleDef> };

// The style attrs a table style owns; clearing it resets exactly these.
const CLEARED = {
  backgroundColor: null, region: null,
  borderTop: null, borderRight: null, borderBottom: null, borderLeft: null,
};

// Write a table's cell attrs from `style` (null clears them). Only changed cells are
// touched, so re-running is a no-op — the condition the re-band plugin relies on.
function paintTable(tr: Transaction, tablePos: number, style: TableStyleDef | null): boolean {
  const table = tr.doc.nodeAt(tablePos);
  if (!table) return false;
  const look = parseTableLook(table.attrs.tableLook);
  const map = TableMap.get(table);
  const start = tablePos + 1;
  let changed = false;
  for (const pos of new Set(map.map)) {
    const cell = tr.doc.nodeAt(start + pos);
    if (!cell) continue;
    let next: Record<string, unknown> = CLEARED;
    if (style) {
      const box = map.findCell(pos);
      const paint = resolveTableCell(style, {
        row: box.top, col: box.left,
        rowSpan: box.bottom - box.top, colSpan: box.right - box.left,
        rows: map.height, cols: map.width,
      }, look);
      next = {
        backgroundColor: paint.fill,
        region: paint.regions.length ? paint.regions.join(' ') : null,
        ...paint.borders,
      };
    }
    if (Object.keys(next).every(key => cell.attrs[key] === next[key])) continue;
    tr.setNodeMarkup(start + pos, undefined, { ...cell.attrs, ...next });
    changed = true;
  }
  return changed;
}

// Every table carrying a style name, with its position. Tables sit at block level, so the
// walk stops at textblocks.
function styledTables(doc: PMNode): { pos: number; node: PMNode }[] {
  const out: { pos: number; node: PMNode }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'table') {
      if (node.attrs.tableStyle) out.push({ pos, node });
      return false;
    }
    return node.isBlock && !node.isTextblock;
  });
  return out;
}

const shapeOf = (node: PMNode) =>
  `${node.attrs.tableStyle}|${node.attrs.tableLook}:${node.childCount}x${TableMap.get(node).width}`;

export function activeTableStyle(state: EditorState): string | null {
  if (!isInTable(state)) return null;
  return (selectedRect(state).table.attrs.tableStyle as string | null) ?? null;
}

// The cursor's table's options, for the checkbox states (and the gallery previews).
export function activeTableLook(state: EditorState): TableLook {
  if (!isInTable(state)) return { ...DEFAULT_TABLE_LOOK };
  return parseTableLook(selectedRect(state).table.attrs.tableLook);
}

// Which options the style actually paints — the rest are shown disabled, as in Word.
export function styleRegions(style: TableStyleDef | undefined): TableRegion[] {
  return style ? TABLE_REGIONS.filter(r => !!style.regions[r]) : [];
}

// The text formatting the cursor's cell inherits from its table style — what the CSS
// paints. Drives the Bold button's heading-like behaviour in a styled header row.
export function cellRegionText(state: EditorState, styles: Record<string, TableStyleDef>): TextProps {
  const { $from } = state.selection;
  let regions: unknown = null;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    const role = node.type.spec.tableRole;
    if (role === 'cell' || role === 'header_cell') regions = node.attrs.region;
    else if (role === 'table') return regionText(styles[node.attrs.tableStyle as string], regions);
  }
  return {};
}

// `name` undefined re-applies the table's current style (after a structural change).
function applyStyle(styles: () => Record<string, TableStyleDef>, name?: string | null) {
  return ({ state, tr, dispatch }: CommandProps): boolean => {
    if (!isInTable(state)) return false;
    const { table, tableStart } = selectedRect(state);
    const wanted = name === undefined ? (table.attrs.tableStyle as string | null) : name;
    const style = wanted ? styles()[wanted] ?? null : null;
    if (wanted && !style) return false; // unknown style: leave the table alone
    if (!dispatch) return true;
    const tablePos = tableStart - 1;
    // Assigning a style adopts the options it is about (a column-banded style switches
    // the bands to columns); a re-apply after a structural change leaves them alone.
    const attrs: Record<string, unknown> = { ...table.attrs };
    if (table.attrs.tableStyle !== wanted) attrs.tableStyle = wanted;
    if (name !== undefined && style?.look) {
      attrs.tableLook = tableLookAttr(styleLook(style, parseTableLook(table.attrs.tableLook)));
    }
    if (attrs.tableStyle !== table.attrs.tableStyle || attrs.tableLook !== table.attrs.tableLook) {
      tr.setNodeMarkup(tablePos, undefined, attrs);
    }
    paintTable(tr, tablePos, style);
    dispatch(tr);
    return true;
  };
}

export const TableStyle = Extension.create<TableStyleOptions>({
  name: 'tableStyle',

  addOptions() {
    return { styles: () => ({}) };
  },

  addGlobalAttributes() {
    return [
      {
        types: ['table'],
        attributes: {
          tableStyle: {
            default: null as string | null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-table-style'),
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.tableStyle ? { 'data-table-style': String(attrs.tableStyle) } : {},
          },
          // Word's Table Style Options; null = the default look (parseTableLook).
          tableLook: {
            default: null as string | null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-table-look'),
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.tableLook == null ? {} : { 'data-table-look': String(attrs.tableLook) },
          },
        },
      },
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          region: {
            default: null as string | null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-region'),
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.region ? { 'data-region': String(attrs.region) } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    const styles = () => this.options.styles();
    return {
      setTableStyle: (name: string | null) => applyStyle(styles, name),
      // Toggle one Table Style Option and repaint the table under the new look.
      setTableLook: (region: TableRegion, on: boolean) => ({ state, tr, dispatch }: CommandProps) => {
        if (!isInTable(state)) return false;
        if (!dispatch) return true;
        const { table, tableStart } = selectedRect(state);
        const tablePos = tableStart - 1;
        const look = { ...parseTableLook(table.attrs.tableLook), [region]: on };
        tr.setNodeMarkup(tablePos, undefined, { ...table.attrs, tableLook: tableLookAttr(look) });
        paintTable(tr, tablePos, styles()[table.attrs.tableStyle as string] ?? null);
        dispatch(tr);
        return true;
      },
      reapplyTableStyle: () => applyStyle(styles),
      // Repaint every styled table — the registry changed (edit, rename, reset, import).
      refreshTableStyles: () => ({ tr, dispatch }: CommandProps) => {
        let changed = false;
        for (const { pos, node } of styledTables(tr.doc)) {
          const style = styles()[node.attrs.tableStyle as string];
          if (style) changed = paintTable(tr, pos, style) || changed;
        }
        if (changed && dispatch) dispatch(tr);
        return changed;
      },
    };
  },

  addProseMirrorPlugins() {
    const styles = () => this.options.styles();
    return [
      new Plugin({
        key: new PluginKey('tableStyleReband'),
        // Re-band a styled table when it gains or loses rows/columns. Deliberately not on
        // every transaction: repainting each change would undo a manually shaded cell.
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some(tr => tr.docChanged)) return null;
          const next = styledTables(newState.doc);
          if (!next.length) return null;
          const prev = styledTables(oldState.doc);
          const aligned = prev.length === next.length;
          const stale = next.filter((t, i) => !aligned || shapeOf(prev[i].node) !== shapeOf(t.node));
          if (!stale.length) return null;

          const tr = newState.tr;
          let changed = false;
          for (const { pos, node } of stale) {
            const style = styles()[node.attrs.tableStyle as string];
            // setNodeMarkup keeps node sizes, so the collected positions stay valid.
            if (style) changed = paintTable(tr, pos, style) || changed;
          }
          return changed ? tr : null;
        },
      }),
    ];
  },
});
