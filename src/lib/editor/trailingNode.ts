import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

// Keep an empty paragraph at the end of the document when the last block is a
// table. A table is an isolating block, so if it sits at the very end there is
// nowhere to click or type below it — the cursor gets trapped inside the table
// and the user can't continue the document. When the doc ends with a table we
// append a paragraph; once it's there the last child is a paragraph, so the
// check no-ops on the next round (no loop).
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
