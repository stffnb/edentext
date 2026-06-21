import { Extension, type CommandProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

// Left indent in cm: maps to fo:margin-left on paragraphs/headings; on lists it shifts
// the whole list block (list items nest instead via sinkListItem/liftListItem).

export const INDENT_STEP_CM = 1.25; // LibreOffice's default indent increment
export const INDENT_MAX_CM = 12;    // keep the indent inside the text column

export type ListIndentContext = { inList: boolean; wholeList: boolean; listIndent: number; nested: boolean };

// Shared by the Tab keymap and toolbar indent buttons so both apply identical rules.
export function listContext(state: EditorState): ListIndentContext {
  const { empty } = state.selection;
  const head = state.selection.$from;
  const tail = state.selection.$to;
  let liDepth = -1;
  for (let d = head.depth; d > 0; d--) {
    if (head.node(d).type.name === 'listItem') { liDepth = d; break; }
  }
  if (liDepth < 0) return { inList: false, wholeList: false, listIndent: 0, nested: false };
  const listDepth = liDepth - 1;
  const list = head.node(listDepth);
  const listIndent = typeof list.attrs.indent === 'number' ? list.attrs.indent : 0;
  const fromFirst = head.index(listDepth) === 0;
  // Guard: a selection ending outside the list has no index at listDepth.
  const toLast = tail.depth >= listDepth && tail.node(listDepth) === list
    && tail.index(listDepth) === list.childCount - 1;
  const wholeList = fromFirst && (empty || toLast);
  const nested = listDepth > 0 && head.node(listDepth - 1).type.name === 'listItem';
  return { inList: true, wholeList, listIndent, nested };
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indentMore: () => ReturnType;
      indentLess: () => ReturnType;
      indentListMore: () => ReturnType;
      indentListLess: () => ReturnType;
      indentListForward: () => ReturnType;
      indentListBackward: () => ReturnType;
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

  // >100 so Tab/Shift-Tab beat ListItem's built-in sink/lift — TipTap priority-sorts
  // after reversing extension order, so equal priority would let ListItem win.
  priority: 1000,

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
      indentListForward: () => ({ state, commands }) => {
        const ctx = listContext(state);
        if (!ctx.inList) return false;
        return ctx.wholeList ? commands.indentListMore() : commands.sinkListItem('listItem');
      },
      indentListBackward: () => ({ state, commands }) => {
        const ctx = listContext(state);
        if (!ctx.inList) return false;
        if (ctx.listIndent > 0) return commands.indentListLess();
        if (ctx.nested) return commands.liftListItem('listItem');
        return false;
      },
      unsetIndent: () => ({ commands }) =>
        [...types, ...listTypes].map((type) => commands.resetAttributes(type, 'indent')).some((r) => r),
    };
  },

  // In a list: Tab/Shift-Tab call indentListForward/Backward.
  // Outside a list: Tab inserts \t, Shift-Tab steps paragraph indent.
  // In a table cell: returns false so Table's own Tab navigates between cells.
  addKeyboardShortcuts() {
    const inCell = () => this.editor.isActive('tableCell') || this.editor.isActive('tableHeader');
    return {
      Tab: () => {
        if (inCell()) return false;
        if (listContext(this.editor.state).inList) {
          this.editor.commands.indentListForward();
          return true;
        }
        this.editor.commands.insertContent('\t');
        return true;
      },
      'Shift-Tab': () => {
        if (inCell()) return false;
        if (listContext(this.editor.state).inList) {
          this.editor.commands.indentListBackward();
          return true;
        }
        this.editor.commands.indentLess();
        return true;
      },
    };
  },
});
