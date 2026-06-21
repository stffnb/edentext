import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

// Keep an empty paragraph after a trailing table: a table is isolating, so at the very
// end the cursor gets trapped with nowhere to type below. Appending a paragraph fixes
// it and self-terminates (once the last child is a paragraph the check no-ops).
const trailingNodeKey = new PluginKey('trailingNode');

// Block types that can't sit at the document end without trapping the cursor.
const NEEDS_TRAILING_AFTER = new Set(['table']);

export const TrailingNode = Extension.create({
  name: 'trailingNode',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: trailingNodeKey,
        appendTransaction(_transactions, _oldState, newState) {
          const last = newState.doc.lastChild;
          if (!last || !NEEDS_TRAILING_AFTER.has(last.type.name)) return null;
          const paragraph = newState.schema.nodes.paragraph;
          if (!paragraph) return null;
          return newState.tr.insert(newState.doc.content.size, paragraph.create());
        },
      }),
    ];
  },
});
