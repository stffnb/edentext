import { Extension, type CommandProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

// Left indent stored in cm so it round-trips 1:1 to ODF's fo:margin-left.
// On a paragraph/heading it maps to odf-kit's ParagraphOptions.indentLeft; on a
// bulletList/orderedList it shifts the whole list (the indent is added to the
// list style's level margins on export — see export/odt.ts applyListIndents).
// Renders as an inline margin-left. List *items* indent by nesting
// (sinkListItem/liftListItem); this list attr shifts the list as a block.

export const INDENT_STEP_CM = 1.25; // LibreOffice's default indent increment
export const INDENT_MAX_CM = 12;    // keep the indent inside the text column

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indentMore: () => ReturnType;
      indentLess: () => ReturnType;
      indentListMore: () => ReturnType;
      indentListLess: () => ReturnType;
      unsetIndent: () => ReturnType;
    };
  }
}

function clampIndent(cm: number): number {
  return Math.round(Math.max(0, Math.min(INDENT_MAX_CM, cm)) * 100) / 100;
}

function parseIndent(value: string | null): number | null {
  if (value == null || value === '') return null;
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const Indent = Extension.create({
  name: 'indent',

  addOptions() {
    return {
      types: ['paragraph', 'heading'] as string[],
      listTypes: ['bulletList', 'orderedList'] as string[],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: [...this.options.types, ...this.options.listTypes],
        attributes: {
          indent: {
            default: null,
            parseHTML: (element: HTMLElement) => parseIndent(element.getAttribute('data-indent')),
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.indent == null) return {};
              const cm = Number(attributes.indent);
              return {
                'data-indent': String(cm),
                style: `margin-left: ${cm}cm`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    const types = this.options.types as string[];
    const listTypes = this.options.listTypes as string[];

    // Step every paragraph/heading in the selection by delta cm, clamped to
    // [0, MAX]. Per-node (relative) change, so a mixed selection keeps each
    // block's offset; list-item paragraphs are skipped (lists indent by nesting).
    const step = (delta: number) => ({ state, tr, dispatch }: CommandProps) => {
      const { from, to } = state.selection;
      let changed = false;
      state.doc.nodesBetween(from, to, (node: PMNode, pos: number, parent: PMNode | null) => {
        if (!types.includes(node.type.name)) return;
        if (parent?.type.name === 'listItem') return;
        const current = typeof node.attrs.indent === 'number' ? node.attrs.indent : 0;
        const next = clampIndent(current + delta);
        const value = next > 0 ? next : null;
        if (value === (node.attrs.indent ?? null)) return;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: value });
        changed = true;
      });
      if (changed && dispatch) dispatch(tr);
      return changed;
    };

    // Step the innermost list ancestor's indent (shifts the whole list as a block).
    const stepList = (delta: number) => ({ state, tr, dispatch }: CommandProps) => {
      const { $from } = state.selection;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (!listTypes.includes(node.type.name)) continue;
        const current = typeof node.attrs.indent === 'number' ? node.attrs.indent : 0;
        const next = clampIndent(current + delta);
        const value = next > 0 ? next : null;
        if (value === (node.attrs.indent ?? null)) return false;
        if (dispatch) {
          tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, indent: value });
          dispatch(tr);
        }
        return true;
      }
      return false;
    };

    return {
      indentMore: () => step(INDENT_STEP_CM),
      indentLess: () => step(-INDENT_STEP_CM),
      indentListMore: () => stepList(INDENT_STEP_CM),
      indentListLess: () => stepList(-INDENT_STEP_CM),
      unsetIndent: () => ({ commands }) =>
        [...types, ...listTypes].map((type) => commands.resetAttributes(type, 'indent')).some((r) => r),
    };
  },
});
