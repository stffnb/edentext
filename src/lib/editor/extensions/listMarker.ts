import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

// A list marker renders bold when the item's first text portion is bold — the rule
// LibreOffice numbering uses (Word takes the paragraph mark instead). The bold mark
// lives inside the paragraph and never reaches ::marker, so it rides as a class.
export function listMarkerDecos(doc: ProseMirrorNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'listItem' || !firstPortionBold(node)) return;
    decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'marker-bold' }));
  });
  return DecorationSet.create(doc, decos);
}

function firstPortionBold(item: ProseMirrorNode): boolean {
  const first = item.firstChild?.firstChild;
  if (!first?.isText) return false;
  return first.marks.some((m) => m.type.name === 'bold')
    && !first.marks.some((m) => m.type.name === 'textStyle' && m.attrs.fontWeight === 'normal');
}

const listMarkerKey = new PluginKey<DecorationSet>('listMarkerWeight');

export const ListMarker = Extension.create({
  name: 'listMarker',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: listMarkerKey,
        state: {
          init: (_, state) => listMarkerDecos(state.doc),
          apply: (tr, old) => (tr.docChanged ? listMarkerDecos(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return listMarkerKey.getState(state);
          },
        },
      }),
    ];
  },
});
