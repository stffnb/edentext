import { Mark, mergeAttributes } from '@tiptap/core';

// A named character style on a run (LibreOffice style:family="text" / Word w:rStyle):
// paragraphStyle.ts one level down. Rendered as data-char-style for the generated
// document stylesheet; direct marks are inline styles and still win.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    characterStyle: {
      setCharacterStyle: (name: string) => ReturnType;
      unsetCharacterStyle: () => ReturnType;
    };
  }
}

export const CharacterStyle = Mark.create({
  name: 'charStyle',

  // Above TextStyle's 101, so this span wraps the direct formatting's instead of sitting
  // inside it: the style is a stylesheet rule, and a rule beats an ancestor's inline style.
  priority: 102,

  addAttributes() {
    return {
      name: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-char-style') || null,
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.name ? { 'data-char-style': String(attributes.name) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-char-style]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setCharacterStyle: (name: string) => ({ commands }) => commands.setMark(this.name, { name }),
      unsetCharacterStyle: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
});

// The character style covering the selection, or null when there is none / it is mixed.
export function activeCharacterStyle(state: {
  selection: { from: number; to: number; empty: boolean; $head: { marks(): readonly { type: { name: string }; attrs: Record<string, unknown> }[] } };
  storedMarks?: readonly { type: { name: string }; attrs: Record<string, unknown> }[] | null;
  doc: { nodesBetween(from: number, to: number, f: (node: { isText: boolean; marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[] }) => void): void };
}): string | null {
  const nameOf = (marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[]) =>
    (marks.find(m => m.type.name === 'charStyle')?.attrs.name as string | undefined) ?? null;
  if (state.selection.empty) return nameOf(state.storedMarks ?? state.selection.$head.marks());
  let found: string | null | undefined;
  let mixed = false;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
    if (mixed || !node.isText) return;
    const name = nameOf(node.marks);
    if (found === undefined) found = name;
    else if (found !== name) mixed = true;
  });
  return mixed ? null : found ?? null;
}
