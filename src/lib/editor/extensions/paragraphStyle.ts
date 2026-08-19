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

// Marks Ctrl+M keeps: they carry content, not formatting.
const KEPT_MARKS = new Set(['link', 'bookmark', 'comment']);

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
    const styleName = {
      default: null,
      parseHTML: (element: HTMLElement) => element.getAttribute('data-style') || null,
      renderHTML: (attributes: Record<string, unknown>) =>
        attributes.styleName ? { 'data-style': String(attributes.styleName) } : {},
    };
    return [
      { types: this.options.types.filter((t) => t !== 'heading'), attributes: { styleName } },
      // Enter at the end of a heading starts a body paragraph, as in both word
      // processors — carrying the name over would leave a paragraph that looks like a
      // heading and is none (no outline entry, no text:h on export).
      { types: ['heading'], attributes: { styleName: { ...styleName, keepOnSplit: false } } },
    ];
  },

  addCommands() {
    return {
      // A heading style also switches the node type (its outline level); any other
      // style turns a heading back into a paragraph.
      // The name rides along with the type switch: setNode copies the block's own attrs,
      // and a later updateAttributes looks for the *new* type in the pre-chain state,
      // where the block still has the old one — leaving the previous name in place.
      setParagraphStyle: (name: string) => ({ editor, chain }) => {
        const level = this.options.sheet().paragraph[name]?.outlineLevel;
        const heading = !!level && !!editor.schema.nodes.heading;
        return chain()
          .focus()
          .setNode(heading ? 'heading' : 'paragraph', heading ? { level, styleName: name } : { styleName: name })
          .run();
      },

      // Word/LibreOffice Ctrl+M: drop hard formatting, keep the style assignment.
      // A bare cursor clears the whole block (LibreOffice) — marks need a range —
      // and the caret is restored afterwards. Links survive: they carry the URL.
      clearDirectFormatting: () => ({ editor, state, chain }) => {
        const { from, to } = state.selection;
        const start = state.selection.$from.start();
        const end = state.selection.$to.end();
        const run = chain().focus().setTextSelection({ from: start, to: end });
        // Formatting only: a link, a bookmark and a comment are content, not formatting,
        // and neither word processor drops them here.
        for (const mark of Object.keys(editor.schema.marks)) {
          if (!KEPT_MARKS.has(mark)) run.unsetMark(mark);
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
