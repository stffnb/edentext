import type { Node as PMNode } from '@tiptap/pm/model';
import { CELL_PAD_VARS, parseCellPadding } from './tableCellPadding';
import type { ViewMutationRecord } from '@tiptap/pm/view';

// Custom table node view: <colgroup> uses percentage widths and the table stays at
// width:100%, so it's always full text width (matching the export) and responsive
// to margin/orientation. `colwidth` cell attrs are proportional weights (null=equal).

// Expand the first row's cells into a per-column weight array, honouring colspan.
// A cell with colspan k contributes k entries (its colwidth slice, or nulls).
export function columnWeightsFromRow(row: PMNode | null | undefined): (number | null)[] {
  const weights: (number | null)[] = [];
  if (!row) return weights;
  for (let i = 0; i < row.childCount; i++) {
    const cell = row.child(i);
    const colspan = (cell.attrs.colspan as number) ?? 1;
    const colwidth = cell.attrs.colwidth as number[] | null;
    for (let j = 0; j < colspan; j++) {
      const w = colwidth && colwidth[j] ? colwidth[j] : null;
      weights.push(w);
    }
  }
  return weights;
}

// Convert column weights into percentages that sum to 100. All-null → equal
// columns; otherwise null entries take the average present weight so they render
// as "normal" columns until the user resizes them (after which all are explicit).
export function columnPercents(weights: (number | null)[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const present = weights.filter((w): w is number => w != null && w > 0);
  if (present.length === 0) return weights.map(() => 100 / n);
  const avg = present.reduce((a, b) => a + b, 0) / present.length;
  const filled = weights.map((w) => (w != null && w > 0 ? w : avg));
  const total = filled.reduce((a, b) => a + b, 0);
  return filled.map((w) => (w / total) * 100);
}

// The table's own margins (cm) go on the wrapper; the table stays 100% of it, so a
// dragged outer edge (tableColumnResize.ts) narrows the table without touching layout.
function applyMargins(node: PMNode, wrapper: HTMLElement): void {
  const ml = (node.attrs.marginLeft as number) || 0;
  const mr = (node.attrs.marginRight as number) || 0;
  const mt = (node.attrs.marginTop as number) || 0;
  const mb = (node.attrs.marginBottom as number) || 0;
  wrapper.style.marginLeft = ml ? `${ml}cm` : '';
  wrapper.style.marginRight = mr ? `${mr}cm` : '';
  wrapper.style.marginBottom = mb ? `${mb}cm` : '';
  // Space above rides --space-before so editor.css can add it to the block above
  // instead of collapsing against it (storage/spacingModel.ts).
  if (mt) wrapper.style.setProperty('--space-before', `${mt}cm`);
  else wrapper.style.removeProperty('--space-before');
}

// The node view never calls the node's renderHTML, so the table-style hook the generated
// CSS keys on has to be set here too (the static path emits it in tableStyle.ts).
function applyTableStyleAttr(node: PMNode, table: HTMLElement): void {
  const name = node.attrs.tableStyle as string | null;
  if (name) table.dataset.tableStyle = name;
  else delete table.dataset.tableStyle;
  const look = node.attrs.tableLook as string | null;
  if (look != null) table.dataset.tableLook = look;
  else delete table.dataset.tableLook;
}

// Also bypassed by the node view: the cell margins editor.css reads off the table.
function applyCellPadding(node: PMNode, table: HTMLElement): void {
  const p = parseCellPadding(node.attrs.cellPadding);
  CELL_PAD_VARS.forEach((v, i) => {
    if (p) table.style.setProperty(v, `${p[i]}cm`);
    else table.style.removeProperty(v);
  });
}

function buildColgroup(node: PMNode, colgroup: HTMLElement): void {
  while (colgroup.firstChild) colgroup.removeChild(colgroup.firstChild);
  const percents = columnPercents(columnWeightsFromRow(node.firstChild));
  for (const p of percents) {
    const col = document.createElement('col');
    col.style.width = `${p}%`;
    colgroup.appendChild(col);
  }
}

export class TableView {
  node: PMNode;
  cellMinWidth: number;
  dom: HTMLElement;
  table: HTMLTableElement;
  colgroup: HTMLElement;
  contentDOM: HTMLElement;

  constructor(node: PMNode, cellMinWidth: number) {
    this.node = node;
    this.cellMinWidth = cellMinWidth;
    this.dom = document.createElement('div');
    this.dom.className = 'tableWrapper';
    applyMargins(node, this.dom);
    this.table = this.dom.appendChild(document.createElement('table'));
    // Percentage columns are authoritative only under fixed layout; the actual
    // table-layout/border-collapse come from editor.css. width:100% keeps the
    // table the full text width regardless of the stored weights.
    this.table.style.width = '100%';
    applyTableStyleAttr(node, this.table);
    applyCellPadding(node, this.table);
    this.colgroup = this.table.appendChild(document.createElement('colgroup'));
    buildColgroup(node, this.colgroup);
    this.contentDOM = this.table.appendChild(document.createElement('tbody'));
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    applyMargins(node, this.dom);
    applyTableStyleAttr(node, this.table);
    applyCellPadding(node, this.table);
    buildColgroup(node, this.colgroup);
    return true;
  }

  // Ignore DOM mutations the view makes to its own chrome (colgroup/table chrome),
  // including the live <col> width pokes from the resize plugin — only the tbody
  // content is ProseMirror-managed.
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    const target = mutation.target as Node;
    const isInsideWrapper = this.dom.contains(target);
    const isInsideContent = this.contentDOM.contains(target);
    if (isInsideWrapper && !isInsideContent) {
      return (
        mutation.type === 'attributes' ||
        mutation.type === 'childList' ||
        mutation.type === 'characterData'
      );
    }
    return false;
  }
}
