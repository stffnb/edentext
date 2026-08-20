import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

// Keep an empty paragraph after a trailing table: a table is isolating, so at the very
// end the cursor gets trapped with nowhere to type below. Appending a paragraph fixes
// it and self-terminates (once the last child is a paragraph the check no-ops).
const trailingNodeKey = new PluginKey('trailingNode');

// Block types that can't sit at the document end without trapping the cursor.
const NEEDS_TRAILING_AFTER = new Set(['table', 'textBox', 'columns']);

export const TrailingNode = Extension.create({
  name: 'trailingNode',

  // The trap mirrored at the start: nothing can sit before a leading table, so Enter
  // at the table's very first position inserts a paragraph above it and moves the
  // caret there — the only way to get text before such a table.
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parentOffset !== 0) return false;
        let depth = 0;
        for (let d = $from.depth; d > 0 && !depth; d--) {
          if ($from.node(d).type.name === 'table') depth = d;
        }
        if (!depth) return false;
        // First row, first cell, first block — anything else is a normal Enter.
        for (let d = depth; d < $from.depth; d++) if ($from.index(d) !== 0) return false;
        const tablePos = $from.before(depth);
        if (editor.state.doc.resolve(tablePos).index() !== 0) return false;
        return editor
          .chain()
          .insertContentAt(tablePos, { type: 'paragraph' })
          .setTextSelection(tablePos + 1)
          .run();
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: trailingNodeKey,
        appendTransaction(_transactions, _oldState, newState) {
          // The note section is not body text and sits past it, so the block that needs
          // a paragraph under it is the last one before the section.
          const doc = newState.doc;
          const notes = doc.lastChild?.type.name === 'noteSection' ? doc.lastChild : null;
          const end = doc.content.size - (notes?.nodeSize ?? 0);
          const last = notes ? doc.childBefore(end).node : doc.lastChild;
          if (!last || !NEEDS_TRAILING_AFTER.has(last.type.name)) return null;
          const paragraph = newState.schema.nodes.paragraph;
          if (!paragraph) return null;
          return newState.tr.insert(end, paragraph.create());
        },
      }),
    ];
  },
});
