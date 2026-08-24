import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';

// Inline atom for a template placeholder (LibreOffice's Insert ▸ Field ▸ Placeholder):
// gray ‹label› text; a click selects the whole field and typing replaces it.
// Round-trips to ODF <text:placeholder> and a tagged DOCX <w:sdt> content control.

export interface PlaceholderFieldAttrs {
  /** The label shown inside ‹ ›, without the brackets. */
  text: string;
}

export function placeholderFieldText(attrs: PlaceholderFieldAttrs): string {
  return `‹${attrs.text}›`;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    placeholderField: {
      insertPlaceholderField: (text: string) => ReturnType;
    };
  }
}

// Tab/Shift-Tab from a selected placeholder jump to the next/previous one, wrapping.
function selectAdjacentPlaceholder(editor: Editor, dir: 1 | -1): boolean {
  const { state } = editor;
  const sel = state.selection;
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'placeholderField') return false;
  const positions: number[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'placeholderField') positions.push(pos);
  });
  const i = positions.indexOf(sel.from);
  if (i < 0 || positions.length < 2) return true; // consume: Tab must not replace the field
  const next = positions[(i + dir + positions.length) % positions.length];
  editor.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, next)).scrollIntoView());
  return true;
}

export const PlaceholderField = Node.create({
  name: 'placeholderField',
  group: 'inline',
  inline: true,
  atom: true,

  // Above Indent (1000) so Tab reaches this keymap first while a field is selected.
  priority: 1100,

  addAttributes() {
    return {
      text: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-placeholder-field') || '',
        renderHTML: (attrs) => ({ 'data-placeholder-field': attrs.text }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-placeholder-field]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), placeholderFieldText(node.attrs as PlaceholderFieldAttrs)];
  },

  renderText({ node }) {
    return placeholderFieldText(node.attrs as PlaceholderFieldAttrs);
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => selectAdjacentPlaceholder(this.editor, 1),
      'Shift-Tab': () => selectAdjacentPlaceholder(this.editor, -1),
    };
  },

  addCommands() {
    return {
      insertPlaceholderField: (text) => ({ commands, state }) => {
        // Adopt the cursor's marks so the field renders like the surrounding text.
        const marks = (state.storedMarks ?? state.selection.$to.marks())
          .map((m) => ({ type: m.type.name, attrs: m.attrs }));
        return commands.insertContent({
          type: this.name,
          attrs: { text },
          ...(marks.length ? { marks } : {}),
        });
      },
    };
  },
});
