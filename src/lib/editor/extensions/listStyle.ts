import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { childCycle, defaultOrderedTypeAt, ROOT_ORDERED_CYCLE, type OrderedCycle, type OrderedListType } from '../../utils/orderedListTypes';
import { effectiveListLevel } from '../../styles/listStyles';
import type { ListStyle as ListStyleDef } from '../../styles/listStyles';
import type { StyleSheet } from '../../styles/styleSheet';
import { FORCE_PAGE_RECALC } from './pageBreaks';

const EMPTY_SHEET: StyleSheet = { paragraph: {}, character: {}, table: {}, list: {} };

// The walk resolving what every list renders: the node's own attrs over its named list
// style's level over the depth-cycle default. Ordered lists get `data-eff-list-style`
// (editor.css maps it to counters); what a style supplies beyond the attrs is decorated
// the same way the attrs would render, so editor.css needs no style-aware rules.
export function listStyleDecos(doc: ProseMirrorNode, sheet: StyleSheet): DecorationSet {
  const decos: Decoration[] = [];
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
      if (name === 'orderedList') {
        const own = eff.listStyleType;
        const type = own === 'multilevel' || (listMultilevel && !own) ? 'multilevel' : own ?? defaultOrderedTypeAt(listCycle);
        attrs['data-eff-list-style'] = type;
        if (eff.startAt != null && eff.startAt !== 1 && (node.attrs.start ?? 1) === 1) attrs.start = String(eff.startAt);
        nextMultilevel = type === 'multilevel';
      } else if (!node.attrs.bulletChar && eff.bulletChar) {
        css.push(`--bullet: "${eff.bulletChar}"`);
      }
      if (!node.attrs.markerAlign && eff.markerAlign) attrs['data-marker-align'] = eff.markerAlign;
      if (node.attrs.indent == null && eff.indent) css.push(`margin-left: calc(var(--sec-inset-left, 0px) + ${eff.indent}cm)`);
      if (css.length) attrs.style = css.join(';');
      if (Object.keys(attrs).length) decos.push(Decoration.node(pos, pos + node.nodeSize, attrs));
      nextCycle = childCycle(listCycle, eff.listStyleType as OrderedListType | null, name === 'orderedList');
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

const listStyleKey = new PluginKey<DecorationSet>('listStyleEff');

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

  addProseMirrorPlugins() {
    const sheet = () => this.options.sheet();
    return [
      new Plugin({
        key: listStyleKey,
        state: {
          init: (_, state) => listStyleDecos(state.doc, sheet()),
          // An edited registry changes what a list style means; that arrives as
          // FORCE_PAGE_RECALC (Editor.svelte's stylesheet effect), as in listMarker.ts.
          apply: (tr, old) =>
            tr.docChanged || tr.getMeta(FORCE_PAGE_RECALC) ? listStyleDecos(tr.doc, sheet()) : old,
        },
        props: {
          decorations(state) {
            return listStyleKey.getState(state);
          },
        },
      }),
    ];
  },
});
