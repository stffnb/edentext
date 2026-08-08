import BulletListBase from '@tiptap/extension-bullet-list';
import { bulletCharAttr } from '../../utils/bulletListTypes';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    customBulletList: {
      /** Set the marker char of the innermost bullet list at the cursor (null = default cycle). */
      setBulletChar: (char: string | null) => ReturnType;
    };
  }
}

// BulletList with a `bulletChar` attr (a literal marker char, null = the default
// per-depth cycle), rendered as `data-bullet` + a CSS string marker on the <ul>:
// export/odt.ts maps it to text:bullet-char, export/docx.ts to w:lvlText.
export const BulletList = BulletListBase.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      bulletChar: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-bullet') || null,
        renderHTML: (attributes) => {
          const ch = attributes.bulletChar;
          // The marker is the item block's ::before, whose attr() would read that block,
          // not the list — so the char travels as an inherited custom property instead.
          return ch ? { 'data-bullet': ch, style: `--bullet: "${ch}"` } : {};
        },
      },
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      // setNodeMarkup on exactly the innermost list: updateAttributes would also
      // rewrite every ancestor bulletList (it visits all nodes across the range).
      setBulletChar:
        (char) =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection;
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.type.name !== this.name) continue;
            // Suppress the char when it matches the default cycle at this depth.
            const value = bulletCharAttr(char, countListDepth($from, d));
            if (dispatch) {
              tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, bulletChar: value });
            }
            return true;
          }
          return false;
        },
    };
  },
});

// 0-based bullet/ordered-list nesting depth of the list node at resolved depth `d`.
function countListDepth($from: { node: (d: number) => { type: { name: string } } }, d: number): number {
  let depth0 = 0;
  for (let i = d - 1; i > 0; i--) {
    const name = $from.node(i).type.name;
    if (name === 'bulletList' || name === 'orderedList') depth0++;
  }
  return depth0;
}
