import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// The hint an empty document shows (editor.css `p.is-editor-empty::before`). TipTap's
// Placeholder hit-tests the viewport twice per keystroke and dispatches the result —
// 30 ms in a long document — for a decoration that never leaves the one empty block.
export const Placeholder = Extension.create<{ placeholder: string | (() => string) }>({
  name: 'placeholder',

  addOptions() {
    return { placeholder: '' };
  },

  addProseMirrorPlugins() {
    const { editor, options } = this;
    return [
      new Plugin({
        props: {
          decorations(state) {
            const { doc } = state;
            if (!editor.isEditable) return null;
            let empty = true;
            doc.forEach((n) => { if (!n.isTextblock || n.childCount !== 0) empty = false; });
            const $anchor = doc.resolve(state.selection.anchor);
            if (!empty || $anchor.depth === 0) return null;
            const text = typeof options.placeholder === 'function' ? options.placeholder() : options.placeholder;
            return DecorationSet.create(doc, [Decoration.node($anchor.before(1), $anchor.after(1), {
              class: 'is-empty is-editor-empty',
              'data-placeholder': text,
            })]);
          },
        },
      }),
    ];
  },
});
