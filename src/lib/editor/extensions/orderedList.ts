import OrderedListBase from '@tiptap/extension-ordered-list';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model';
import { childCycle, defaultOrderedTypeAt, orderedTypeAttrAt, ROOT_ORDERED_CYCLE, type OrderedCycle, type OrderedListType } from '../../utils/orderedListTypes';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    customOrderedList: {
      /** Set the numbering style of the ordered list at the cursor (multilevel targets the outermost list). */
      setOrderedListType: (key: OrderedListType) => ReturnType;
    };
  }
}

// Cycle position of the list node at resolved depth `d` — walks its list ancestors
// (bullet + ordered) from the outermost in, advancing one slot per level and
// re-anchoring at each explicit ordered style (see childCycle).
function baseCycleAt($from: ResolvedPos, d: number): OrderedCycle {
  const depths: number[] = [];
  for (let i = 1; i <= d; i++) {
    const name = $from.node(i).type.name;
    if (name === 'bulletList' || name === 'orderedList') depths.push(i);
  }
  let cycle = ROOT_ORDERED_CYCLE;
  for (let k = 1; k < depths.length; k++) {
    const parent = $from.node(depths[k - 1]);
    cycle = childCycle(cycle, parent.attrs.listStyleType, parent.type.name === 'orderedList');
  }
  return cycle;
}

// Innermost/outermost ordered-list ancestor depths at the cursor (null = not in one).
function orderedContext(state: EditorState): { innermost: number; outermost: number } | null {
  const { $from } = state.selection;
  let innermost = -1;
  let outermost = -1;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== 'orderedList') continue;
    if (innermost === -1) innermost = d;
    outermost = d;
  }
  return innermost === -1 ? null : { innermost, outermost };
}

// The numbering the cursor's list level renders: explicit attr, else 'multilevel'
// when a governing ancestor chain is set to it, else the depth default. Drives the
// toolbar's active state. null = not in an ordered list.
export function effectiveOrderedTypeAt(state: EditorState): OrderedListType | null {
  const ctx = orderedContext(state);
  if (!ctx) return null;
  const { $from } = state.selection;
  const own = $from.node(ctx.innermost).attrs.listStyleType as OrderedListType | null;
  if (own) return own;
  for (let d = ctx.innermost - 1; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name !== 'orderedList') continue;
    const t = node.attrs.listStyleType as string | null;
    if (t === 'multilevel') return 'multilevel';
    if (t) break; // a nearer explicit style cuts the chain
  }
  return defaultOrderedTypeAt(baseCycleAt($from, ctx.innermost));
}

// OrderedList with a `listStyleType` attr (an ORDERED_LIST_TYPES key; null = the
// per-depth default cycle 1. → a. → i.), rendered as `data-list-style` on the <ol>:
// editor.css maps it to the on-screen marker, export/odt.ts to style:num-format.
export const OrderedList = OrderedListBase.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      listStyleType: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-list-style') || null,
        renderHTML: (attributes) => {
          const v = attributes.listStyleType;
          // An explicit decimal must be emitted: it overrides the depth cycle.
          return v ? { 'data-list-style': v } : {};
        },
      },
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      // setNodeMarkup on exactly the target list (updateAttributes would rewrite
      // ancestor lists too). 'multilevel' is list-wide: it goes on the outermost
      // ordered list and clears explicit styles below so the whole chain renders.
      setOrderedListType:
        (key) =>
        ({ state, tr, dispatch }) => {
          const ctx = orderedContext(state);
          if (!ctx) return false;
          const { $from } = state.selection;
          const target = key === 'multilevel' ? ctx.outermost : ctx.innermost;
          const node = $from.node(target);
          const pos = $from.before(target);
          // Inside a multilevel chain an explicit style must stay explicit even if
          // it matches the depth default — null would re-join the chain.
          const inChain = target !== ctx.outermost && $from.node(ctx.outermost).attrs.listStyleType === 'multilevel';
          const value = key === 'multilevel' ? 'multilevel'
            : inChain ? key
            : orderedTypeAttrAt(key, baseCycleAt($from, target));
          if (dispatch) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, listStyleType: value });
            if (key === 'multilevel') {
              node.descendants((child, offset) => {
                if (child.type.name === 'orderedList' && child.attrs.listStyleType) {
                  tr.setNodeMarkup(tr.mapping.map(pos + 1 + offset), undefined, { ...child.attrs, listStyleType: null });
                }
              });
            }
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: orderedListStyleKey,
        state: {
          init: (_, state) => orderedListStyleDecos(state.doc),
          apply: (tr, old) => (tr.docChanged ? orderedListStyleDecos(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return orderedListStyleKey.getState(state);
          },
        },
      }),
    ];
  },
});

const orderedListStyleKey = new PluginKey<DecorationSet>('orderedListEffStyle');

// An attr-less <ol>'s marker depends on its list-ancestor chain. This walk resolves
// each list's effective numbering (re-anchoring at explicit styles, propagating
// multilevel) and tags the <ol> with `data-eff-list-style`, which editor.css maps.
export function orderedListStyleDecos(doc: ProseMirrorNode): DecorationSet {
  const decos: Decoration[] = [];
  const walk = (node: ProseMirrorNode, pos: number, cycle: OrderedCycle, multilevel: boolean, inList: boolean) => {
    let nextCycle = ROOT_ORDERED_CYCLE;
    let nextMultilevel = false;
    let nextInList = false;
    const name = node.type.name;
    if (name === 'orderedList' || name === 'bulletList') {
      const listCycle = inList ? cycle : ROOT_ORDERED_CYCLE;
      const listMultilevel = inList && multilevel;
      if (name === 'orderedList') {
        const own = node.attrs.listStyleType as string | null;
        const eff = own === 'multilevel' || (listMultilevel && !own) ? 'multilevel' : own ?? defaultOrderedTypeAt(listCycle);
        decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-eff-list-style': eff }));
        nextMultilevel = eff === 'multilevel';
      }
      nextCycle = childCycle(listCycle, node.attrs.listStyleType as string | null, name === 'orderedList');
      nextInList = true;
    } else if (name === 'listItem') {
      nextCycle = cycle;
      nextMultilevel = multilevel;
      nextInList = inList;
    }
    let p = pos + 1;
    node.forEach((child) => {
      walk(child, p, nextCycle, nextMultilevel, nextInList);
      p += child.nodeSize;
    });
  };
  walk(doc, -1, ROOT_ORDERED_CYCLE, false, false);
  return DecorationSet.create(doc, decos);
}
