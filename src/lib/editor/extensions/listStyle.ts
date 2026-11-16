import { Extension, getNodeType, type CommandProps, type RawCommands } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { ResolvedPos } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { childCycle, defaultOrderedTypeAt, formatOrdinal, orderedTypeDef, ROOT_ORDERED_CYCLE, type OrderedCycle, type OrderedListType } from '../../utils/orderedListTypes';
import { sinkListItem } from '@tiptap/pm/schema-list';
import { DOCX_LIST_LEVELS, effectiveListLevel } from '../../styles/listStyles';
import type { ListStyle as ListStyleDef } from '../../styles/listStyles';
import type { StyleSheet } from '../../styles/styleSheet';
import { SHEET_CHANGED, touchesList } from './listMarker';

const EMPTY_SHEET: StyleSheet = { paragraph: {}, character: {}, table: {}, list: {} };

// The walk resolving what every list renders: the node's own attrs over its named list
// style's level over the depth-cycle default. Ordered lists get `data-eff-list-style`
// (editor.css maps it to counters); what a style supplies beyond the attrs is decorated
// the same way the attrs would render, so editor.css needs no style-aware rules.
export function listStyleDecos(doc: ProseMirrorNode, sheet: StyleSheet): DecorationSet {
  const decos: Decoration[] = [];
  const { implicit } = listStarts(doc, sheet);
  const walk = (
    node: ProseMirrorNode, pos: number,
    cycle: OrderedCycle, multilevel: boolean, inList: boolean,
    style: ListStyleDef | null, depth: number,
  ) => {
    let nextCycle = ROOT_ORDERED_CYCLE;
    let nextMultilevel = false;
    let nextInList = false;
    let nextStyle: ListStyleDef | null = null;
    let nextDepth = 0;
    const name = node.type.name;
    if (name === 'orderedList' || name === 'bulletList') {
      const listCycle = inList ? cycle : ROOT_ORDERED_CYCLE;
      const listMultilevel = inList && multilevel;
      // Only the outermost list's style counts (as in ODF); nested lists inherit it.
      nextStyle = inList ? style : sheet.list[node.attrs.listStyleName as string] ?? null;
      nextDepth = depth + 1;
      const eff = effectiveListLevel(node.attrs, name === 'orderedList', nextStyle, nextDepth);
      const attrs: Record<string, string> = {};
      const css: string[] = [];
      // eff.kind decides what the depth renders — a style's number level numbers a <ul>
      // (and a bullet level bullets an <ol>), as the same file would render in LibreOffice.
      if (eff.kind === 'number') {
        const own = eff.listStyleType;
        const type = own === 'multilevel' || (listMultilevel && !own) ? 'multilevel' : own ?? defaultOrderedTypeAt(listCycle);
        attrs['data-eff-list-style'] = type;
        const counted = name === 'orderedList' ? implicit.get(pos) : undefined;
        if (counted != null) {
          attrs.start = String(counted);
        } else if (eff.startAt != null && eff.startAt !== 1 && (node.attrs.start ?? 1) === 1) {
          // A <ul> ignores the start attribute, so its offset rides the counter itself.
          if (name === 'orderedList') attrs.start = String(eff.startAt);
          else css.push(`counter-reset: list-item ${eff.startAt - 1}`);
        }
        nextMultilevel = type === 'multilevel';
      } else if (!node.attrs.bulletChar && eff.bulletChar) {
        // data-bullet too: editor.css keys the var()-reading marker rule on it.
        attrs['data-bullet'] = eff.bulletChar;
        css.push(`--bullet: "${eff.bulletChar}"`);
      }
      if (!node.attrs.markerAlign && eff.markerAlign) attrs['data-marker-align'] = eff.markerAlign;
      if (node.attrs.indent == null && eff.indent) css.push(`margin-left: calc(var(--sec-inset-left, 0px) + ${eff.indent}cm)`);
      if (css.length) attrs.style = css.join(';');
      if (Object.keys(attrs).length) decos.push(Decoration.node(pos, pos + node.nodeSize, attrs));
      nextCycle = childCycle(listCycle, eff.listStyleType as OrderedListType | null, eff.kind === 'number');
      nextInList = true;
    } else if (name === 'listItem') {
      nextCycle = cycle;
      nextMultilevel = multilevel;
      nextInList = inList;
      nextStyle = style;
      nextDepth = depth;
    }
    let p = pos + 1;
    node.forEach((child) => {
      walk(child, p, nextCycle, nextMultilevel, nextInList, nextStyle, nextDepth);
      p += child.nodeSize;
    });
  };
  walk(doc, -1, ROOT_ORDERED_CYCLE, false, false, null, 0);
  return DecorationSet.create(doc, decos);
}

/**
 * The number a list item renders, one ordinal per level from the outermost list down —
 * the value a cross-reference to a numbered paragraph shows. On the page it comes from
 * CSS counters (`editor.css`), which no walk can read back, so the ancestor chain is
 * resolved here with the same rules `listStyleDecos` decorates with.
 *
 * null = not in a list, or a level that renders a bullet and so has no number.
 * `multilevel` says whether the marker itself shows the parent chain ("1.2.1").
 */
export function listNumberAt(
  doc: ProseMirrorNode, pos: number, sheet: StyleSheet,
): { parts: string[]; multilevel: boolean } | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  const chain: { list: ProseMirrorNode; index: number; pos: number }[] = [];
  let derived = false;
  for (let d = 1; d <= $pos.depth; d++) {
    const node = $pos.node(d);
    if (node.type.name !== 'orderedList' && node.type.name !== 'bulletList') continue;
    // Items without a label count nothing; one in the chain stands at the count before it.
    let index = isLabelless(node.child($pos.index(d))) ? -1 : 0;
    for (let i = 0; i < $pos.index(d); i++) if (!isLabelless(node.child(i))) index++;
    chain.push({ list: node, index, pos: $pos.before(d) });
    if (d > 1 && $pos.index(d - 1) === 0 && isLabelless($pos.node(d - 1))) derived = true;
  }
  if (!chain.length) return null;
  // A whole-document walk, so only where a level's start is derived at all.
  const implicit = derived ? listStarts(doc, sheet).implicit : new Map<number, number>();
  // Only the outermost list's style counts, as in ODF and in the decoration walk.
  const style = sheet.list[chain[0].list.attrs.listStyleName as string] ?? null;
  let cycle = ROOT_ORDERED_CYCLE;
  let multilevel = false;
  const parts: string[] = [];
  for (let depth = 1; depth <= chain.length; depth++) {
    const { list, index, pos: listPos } = chain[depth - 1];
    const ordered = list.type.name === 'orderedList';
    const eff = effectiveListLevel(list.attrs, ordered, style, depth);
    if (eff.kind !== 'number') {
      // A bullet level numbers nothing; a deeper number level still counts on its own.
      if (depth === chain.length) return null;
      cycle = childCycle(cycle, null, false);
      multilevel = false;
      continue;
    }
    const own = eff.listStyleType;
    const type: OrderedListType = own === 'multilevel' || (multilevel && !own) ? 'multilevel' : own ?? defaultOrderedTypeAt(cycle);
    const attrStart = Number(list.attrs.start) || 1;
    const start = implicit.get(listPos) ?? (attrStart !== 1 ? attrStart : eff.startAt ?? 1);
    parts.push(formatOrdinal(start + index, orderedTypeDef(type).numFormat));
    cycle = childCycle(cycle, own as OrderedListType | null, true);
    multilevel = type === 'multilevel';
  }
  return parts.length ? { parts, multilevel } : null;
}

const listStyleKey = new PluginKey<DecorationSet>('listStyleEff');

const isListNode = (n: ProseMirrorNode) => n.type.name === 'bulletList' || n.type.name === 'orderedList';

/**
 * Cut the lists around the item at `itemDepth` behind the text the caret is in, up to the
 * outermost list, and return the position between the two outer parts (null where no
 * table may stand) — where a table goes, as neither format keeps one in a list item. The second part counts on: its
 * outer list by `continueNumbering`, a deeper level through the item without a label
 * it now opens with (listStarts).
 */
export function splitListAt(tr: Transaction, $from: ResolvedPos, itemDepth: number): number | null {
  let top = itemDepth - 1;
  while (top > 1 && $from.node(top - 1).type.name === 'listItem') top -= 2;
  // A columns section holds no table.
  const after = $from.index(top - 1) + 1;
  if (!$from.node(top - 1).canReplaceWith(after, after, tr.doc.type.schema.nodes.table)) return null;
  // The item's further paragraphs stay with it: a part opening with one would number it.
  const item = $from.node(itemDepth);
  let index = $from.index(itemDepth) + 1;
  while (index < item.childCount && item.child(index).isTextblock) index++;
  let pos = $from.start(itemDepth);
  for (let i = 0; i < index; i++) pos += item.child(i).nodeSize;
  // Nothing after the cut at a level: it moves out to the next.
  let depth = itemDepth;
  while (depth >= top && pos === $from.end(depth)) pos = $from.after(depth--);
  if (depth < top) return pos;
  const typesAfter = [];
  for (let d = top; d <= depth; d++) {
    const node = $from.node(d);
    const attrs: Record<string, unknown> = { ...node.attrs };
    if (node.type.name === 'orderedList') {
      delete attrs.start;
      attrs.continueNumbering = d === top;
    }
    typesAfter.push({ type: node.type, attrs });
  }
  tr.split(pos, depth - top + 1, typesAfter);
  return pos + depth - top + 1;
}

// The levels the lists below `node` reach down, 0 for none.
function levelsBelow(node: ProseMirrorNode): number {
  let max = 0;
  node.forEach((list) => { if (isListNode(list)) list.forEach((item) => { max = Math.max(max, 1 + levelsBelow(item)); }); });
  return max;
}

/** sinkListItem that leaves every item it moves, and their sub-lists, within DOCX_LIST_LEVELS. */
export const sinkListItemWithin: RawCommands['sinkListItem'] = (typeOrName) => ({ state, dispatch }) => {
  const type = getNodeType(typeOrName, state.schema);
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to, (n) => n.childCount > 0 && n.firstChild!.type === type);
  if (range) {
    let level = 0;
    for (let d = range.depth; d > 0 && (isListNode($from.node(d)) || $from.node(d).type.name === 'listItem'); d--) {
      if (isListNode($from.node(d))) level++;
    }
    for (let i = range.startIndex; i < range.endIndex; i++) {
      if (level + 1 + levelsBelow(range.parent.child(i)) > DOCX_LIST_LEVELS) return false;
    }
  }
  return sinkListItem(type)(state, dispatch);
};

/** An item of sub-lists only — ODF's item without a paragraph: no label, no count. */
export const isLabelless = (item: ProseMirrorNode) => !!item.firstChild && isListNode(item.firstChild);

/**
 * Where the ordered lists that count on start. A list continued by its attr takes the last
 * number of the ordered list before it in the same parent, plus one (LibreOffice's
 * continue-list, Word's shared numId), and its `start` is kept in step (`fixes`). The
 * first sub-list of an item without a label counts on from the same level of the item
 * before, as nothing numbered reset it (`implicit`, derived, never stored).
 */
export function listStarts(doc: ProseMirrorNode, sheet: StyleSheet): { fixes: { pos: number; start: number }[]; implicit: Map<number, number> } {
  const fixes: { pos: number; start: number }[] = [];
  const implicit = new Map<number, number>();
  // A list's last number, then those of its open deeper levels after its last item.
  const visitList = (list: ProseMirrorNode, pos: number, from: number[] | null, how: 'attr' | 'implicit' | null, depth: number): number[] => {
    const ordered = list.type.name === 'orderedList';
    let start = Number(list.attrs.start) || 1;
    let carry: number[] = [];
    if (from) {
      if (ordered && how === 'attr' && start !== (from[0] ?? 0) + 1) fixes.push({ pos, start: (from[0] ?? 0) + 1 });
      if (ordered) start = (from[0] ?? 0) + 1;
      if (ordered && how === 'implicit') implicit.set(pos, start);
      carry = from.slice(1);
    } else if (ordered && start === 1 && depth === 1) {
      start = effectiveListLevel(list.attrs, true, sheet.list[list.attrs.listStyleName as string] ?? null, 1).startAt ?? 1;
    }
    let count = 0;
    let itemPos = pos + 1;
    list.forEach((item) => {
      const labelled = !isLabelless(item);
      if (labelled) { count++; carry = []; }
      let childPos = itemPos + 1;
      item.forEach((child, _o, index) => {
        if (isListNode(child)) carry = visitList(child, childPos, !labelled && index === 0 ? carry : null, 'implicit', depth + 1);
        childPos += child.nodeSize;
      });
      itemPos += item.nodeSize;
    });
    return [ordered ? start + count - 1 : 0, ...carry];
  };
  const visit = (parent: ProseMirrorNode, base: number) => {
    let prev: number[] = [];
    parent.forEach((child, offset) => {
      const pos = base + offset;
      if (isListNode(child)) {
        const continued = child.type.name === 'orderedList' && !!child.attrs.continueNumbering;
        const tails = visitList(child, pos, continued ? prev : null, continued ? 'attr' : null, 1);
        if (child.type.name === 'orderedList') prev = tails;
      } else if (child.isBlock && !child.isTextblock) {
        visit(child, pos + 1);
      }
    });
  };
  visit(doc, 0);
  return { fixes, implicit };
}

/**
 * The outermost list at the caret when ordered, for Continue/Restart Numbering: whether it
 * counts on, and whether an ordered list before it in the same parent could be counted on.
 */
export function outerOrderedListAt(state: EditorState): { pos: number; node: ProseMirrorNode; canContinue: boolean } | null {
  const { $from } = state.selection;
  for (let d = 1; d <= $from.depth; d++) {
    const node = $from.node(d);
    if (!isListNode(node)) continue;
    if (node.type.name !== 'orderedList') return null;
    const parent = $from.node(d - 1);
    let canContinue = false;
    for (let i = 0; i < $from.index(d - 1); i++) if (parent.child(i).type.name === 'orderedList') canContinue = true;
    return { pos: $from.before(d), node, canContinue };
  }
  return null;
}

// The named style governing the cursor's list (the outermost list's), for the
// dropdowns' active state; null = none or not in a list.
// A block made a list joins the list after it, and a join keeps the first list's attrs:
// the list that was there stays what it was. Attr steps, as that is no change of the block's.
export function keepingListBelow(props: CommandProps, toggle: () => boolean): boolean {
  const { $to } = props.state.selection;
  const below = $to.depth ? props.state.doc.resolve($to.after()).nodeAfter : null;
  if (!toggle()) return false;
  if (!below?.type.spec.group?.includes('list') || !props.dispatch) return true;
  const $now = props.tr.selection.$to;
  for (let d = $now.depth; d > 0; d--) {
    const list = $now.node(d);
    if (list.type !== below.type || !list.lastChild!.eq(below.lastChild!)) continue;
    for (const [key, value] of Object.entries(below.attrs)) if (list.attrs[key] !== value) props.tr.setNodeAttribute($now.before(d), key, value);
    break;
  }
  return true;
}

export function listStyleNameAt(state: EditorState): string | null {
  const { $from } = state.selection;
  for (let d = 1; d <= $from.depth; d++) {
    const node = $from.node(d);
    if (node.type.name === 'bulletList' || node.type.name === 'orderedList') {
      return (node.attrs.listStyleName as string | null) ?? null;
    }
  }
  return null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    listStyle: {
      /** Assign a named list style to the outermost list at the cursor (null = none). */
      setListStyle: (name: string | null) => ReturnType;
    };
  }
}

// The named list style, the fourth style family: `listStyleName` on the outermost list
// (LibreOffice's Listenformatvorlagen / Word's numbering styles).
export const ListStyle = Extension.create<{ sheet: () => StyleSheet }>({
  name: 'listStyle',

  addOptions() {
    return { sheet: () => EMPTY_SHEET };
  },

  addGlobalAttributes() {
    return [
      {
        types: ['bulletList', 'orderedList'],
        attributes: {
          listStyleName: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-list-style-name') || null,
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.listStyleName ? { 'data-list-style-name': attrs.listStyleName as string } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      // The style goes on the outermost list (nested ones inherit); the subtree's own
      // marker attrs are cleared so the style shows — assigning one replaces the
      // list's direct numbering, as in LibreOffice — and each list node is retyped to
      // its level's kind, so the document matches what an import of it would build.
      setListStyle:
        (name) =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection;
          let outer = -1;
          for (let d = 1; d <= $from.depth; d++) {
            const n = $from.node(d).type.name;
            if (n === 'bulletList' || n === 'orderedList') { outer = d; break; }
          }
          if (outer === -1) return false;
          if (dispatch) {
            const style = name ? this.options.sheet().list[name] ?? null : null;
            const typeFor = (node: ProseMirrorNode, depth: number) => {
              const kind = style?.levels[depth - 1]?.kind;
              return kind ? state.schema.nodes[kind === 'number' ? 'orderedList' : 'bulletList'] : node.type;
            };
            const clear = (attrs: Record<string, unknown>) =>
              ({ ...attrs, bulletChar: null, listStyleType: null, markerAlign: null, indent: null, hanging: null, markerSuffix: null });
            const pos = $from.before(outer);
            const node = $from.node(outer);
            tr.setNodeMarkup(pos, typeFor(node, 1), { ...clear(node.attrs), listStyleName: name });
            const walk = (parent: ProseMirrorNode, base: number, depth: number) => {
              parent.forEach((child, offset) => {
                const isList = child.type.name === 'bulletList' || child.type.name === 'orderedList';
                if (isList) {
                  tr.setNodeMarkup(tr.mapping.map(base + offset), typeFor(child, depth + 1), { ...clear(child.attrs), listStyleName: null });
                }
                walk(child, base + offset + 1, isList ? depth + 1 : depth);
              });
            };
            walk(node, pos + 1, 1);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const sheet = () => this.options.sheet();
    return [
      new Plugin({
        key: listStyleKey,
        state: {
          init: (_, state) => listStyleDecos(state.doc, sheet()),
          apply: (tr, old) =>
            tr.getMeta(SHEET_CHANGED) || (tr.docChanged && touchesList(tr)) ? listStyleDecos(tr.doc, sheet())
            : tr.docChanged ? old.map(tr.mapping, tr.doc) : old,
        },
        props: {
          decorations(state) {
            return listStyleKey.getState(state);
          },
        },
      }),
      // A continued list follows the one before it, so an item added or removed there
      // renumbers it; the fix rides the edit's own history event.
      new Plugin({
        key: new PluginKey('listContinue'),
        appendTransaction(trs, _old, state) {
          if (!trs.some((tr) => tr.docChanged && touchesList(tr))) return null;
          const { fixes } = listStarts(state.doc, sheet());
          if (!fixes.length) return null;
          const tr = state.tr;
          for (const { pos, start } of fixes) tr.setNodeAttribute(pos, 'start', start);
          return tr;
        },
      }),
    ];
  },
});
