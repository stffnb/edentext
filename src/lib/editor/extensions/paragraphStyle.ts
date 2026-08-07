import { Extension } from '@tiptap/core';
import { headingStyleName, type StyleSheet } from '../../styles/styleSheet';
import { DEFAULT_SHORTCUTS } from '../shortcuts';

// The named paragraph style a block uses (LibreOffice's style:style / Word's w:pStyle).
// Rendered as data-style so the generated document stylesheet (styleCss) can target it;
// direct formatting (attrs/marks) still overrides it, as in Word/LibreOffice.

// Block attrs reset by clearDirectFormatting and kept by setParagraphStyle. Most are
// style-governed; the first-line and right indents never are, so they are always
// direct formatting.
const DIRECT_ATTRS = [
  'textAlign', 'lineHeight', 'spaceBefore', 'spaceAfter', 'fontSize',
  'indent', 'indentRight', 'indentFirst',
  'backgroundColor', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
];

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphStyle: {
      setParagraphStyle: (name: string) => ReturnType;
      clearDirectFormatting: () => ReturnType;
    };
  }
}

export const ParagraphStyle = Extension.create<{ types: string[]; sheet: () => StyleSheet }>({
  name: 'paragraphStyle',

  addOptions() {
    return { types: ['paragraph', 'heading'], sheet: () => ({ paragraph: {}, character: {}, table: {} }) };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          styleName: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute('data-style') || null,
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.styleName ? { 'data-style': String(attributes.styleName) } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      // A heading style also switches the node type (its outline level); any other
      // style turns a heading back into a paragraph.
      setParagraphStyle: (name: string) => ({ editor, chain }) => {
        const style = this.options.sheet().paragraph[name];
        const level = style?.outlineLevel;
        const run = chain().focus();
        if (level && editor.schema.nodes.heading) run.setNode('heading', { level });
        else if (!level) run.setNode('paragraph');
        return run.updateAttributes(level ? 'heading' : 'paragraph', { styleName: name }).run();
      },

      // Word/LibreOffice Ctrl+M: drop hard formatting, keep the style assignment.
      // A bare cursor clears the whole block (LibreOffice) — marks need a range —
      // and the caret is restored afterwards. Links survive: they carry the URL.
      clearDirectFormatting: () => ({ editor, state, chain }) => {
        const { from, to } = state.selection;
        const start = state.selection.$from.start();
        const end = state.selection.$to.end();
        const run = chain().focus().setTextSelection({ from: start, to: end });
        for (const mark of Object.keys(editor.schema.marks)) {
          if (mark !== 'link') run.unsetMark(mark);
        }
        for (const type of this.options.types) run.resetAttributes(type, DIRECT_ATTRS);
        if (start !== end) run.setTextSelection({ from, to });
        return run.run();
      },
    };
  },

  addKeyboardShortcuts() {
    return { [DEFAULT_SHORTCUTS.clearFormatting]: () => this.editor.commands.clearDirectFormatting() };
  },
});

// The style a block renders with: its own, else the heading level's, else Standard.
export function blockStyleName(node: { type: { name: string }; attrs?: Record<string, unknown> } | null): string {
  const own = node?.attrs?.styleName;
  if (typeof own === 'string' && own) return own;
  if (node?.type.name === 'heading') return headingStyleName(Number(node.attrs?.level) || 1);
  return 'Standard';
}
