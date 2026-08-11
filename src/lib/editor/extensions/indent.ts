import { Extension, type CommandProps } from '@tiptap/core';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { DEFAULT_SHORTCUTS } from '../shortcuts';

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

// The innermost list wrapping the head, with its 0-based nesting depth (bullet +
// ordered ancestors counted), or null when the head is not in a list.
function innermostList($from: ResolvedPos): { node: PMNode; depth: number; depth0: number } | null {
  let depth0 = -1;
  let found: { node: PMNode; depth: number; depth0: number } | null = null;
  for (let d = 1; d <= $from.depth; d++) {
    const name = $from.node(d).type.name;
    if (name === 'bulletList' || name === 'orderedList') found = { node: $from.node(d), depth: d, depth0: ++depth0 };
  }
  return found;
}

// The type-defining attr an explicit same-kind list at `depth0` already uses in this
// tree (DFS-first), so a freshly nested list can reuse it — the per-level memory.
function rememberedListStyle(root: PMNode, kind: string, depth0: number): Record<string, unknown> | null {
  let found: Record<string, unknown> | null = null;
  const walk = (list: PMNode, d: number) => {
    if (found) return;
    if (d === depth0 && list.type.name === kind) {
      const attr = kind === 'orderedList' ? list.attrs.listStyleType : list.attrs.bulletChar;
      if (attr) { found = kind === 'orderedList' ? { listStyleType: attr } : { bulletChar: attr }; return; }
    }
    list.forEach((item) => {
      if (item.type.name !== 'listItem') return;
      item.forEach((child) => {
        if (!found && (child.type.name === 'bulletList' || child.type.name === 'orderedList')) walk(child, d + 1);
      });
    });
  };
  walk(root, 0);
  return found;
}

// After a Tab-sink deepens the list, stamp the new (attr-less) nested list with the
// per-level style a sibling already uses, so the chosen numbering/bullet is remembered.
function stampRememberedStyle(tr: Transaction, beforeDepth0: number): void {
  const $from = tr.selection.$from;
  const inner = innermostList($from);
  if (!inner || inner.depth0 <= beforeDepth0) return;
  const kind = inner.node.type.name;
  const has = kind === 'orderedList' ? inner.node.attrs.listStyleType : inner.node.attrs.bulletChar;
  if (has) return;
  let rootDepth = inner.depth;
  for (let d = inner.depth - 1; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'bulletList' || name === 'orderedList') rootDepth = d;
  }
  const remembered = rememberedListStyle($from.node(rootDepth), kind, inner.depth0);
  if (remembered) tr.setNodeMarkup($from.before(inner.depth), undefined, { ...inner.node.attrs, ...remembered });
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indentMore: () => ReturnType;
      indentLess: () => ReturnType;
      setIndent: (cm: number) => ReturnType;
      setIndentRight: (cm: number) => ReturnType;
      setIndentFirst: (cm: number) => ReturnType;
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

// A first-line indent is signed (negative = a hanging indent).
function clampFirst(cm: number): number {
  return Math.round(Math.max(-INDENT_MAX_CM, Math.min(INDENT_MAX_CM, cm)) * 100) / 100;
}

// Signed: a first-line indent may be negative (a hanging indent), and on a list the
// value is the offset from the level's 1.27cm base, so a file whose list sits closer
// to the margin than that imports a negative one.
function parseIndent(value: string | null): number | null {
  if (value == null || value === '') return null;
  const n = parseFloat(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
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
                // Plus the section inset, which .tiptap's own padding can't draw (editor.css).
                style: `margin-left: calc(var(--sec-inset-left, 0px) + ${cm}cm)`,
              };
            },
          },
          // Right indent in cm (fo:margin-right / w:ind w:right), the mirror of `indent`.
          indentRight: {
            default: null,
            parseHTML: (element: HTMLElement) => parseIndent(element.getAttribute('data-indent-right')),
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.indentRight == null) return {};
              const cm = Number(attributes.indentRight);
              return {
                'data-indent-right': String(cm),
                style: `margin-right: calc(var(--sec-inset-right, 0px) + ${cm}cm)`,
              };
            },
          },
          // First-line indent in cm; negative is a hanging indent. Independent of
          // `indent`, which is the whole block's left margin.
          indentFirst: {
            default: null,
            parseHTML: (element: HTMLElement) => parseIndent(element.getAttribute('data-indent-first')),
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.indentFirst == null) return {};
              const cm = Number(attributes.indentFirst);
              return {
                'data-indent-first': String(cm),
                style: `text-indent: ${cm}cm`,
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

    // Rewrite one indent attr on every paragraph/heading in the selection; 0 clears it.
    // `next` gets the block's own value, so a relative step keeps each block's offset in
    // a mixed selection. List-item paragraphs are skipped (lists indent by nesting).
    const write = (attr: 'indent' | 'indentRight' | 'indentFirst', next: (current: number) => number) =>
      ({ state, tr, dispatch }: CommandProps) => {
        const { from, to } = state.selection;
        let changed = false;
        state.doc.nodesBetween(from, to, (node: PMNode, pos: number, parent: PMNode | null) => {
          if (!types.includes(node.type.name)) return;
          if (parent?.type.name === 'listItem') return;
          const current = typeof node.attrs[attr] === 'number' ? node.attrs[attr] : 0;
          const value = next(current) || null;
          if (value === (node.attrs[attr] ?? null)) return;
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attr]: value });
          changed = true;
        });
        if (changed && dispatch) dispatch(tr);
        return changed;
      };

    const step = (delta: number) => write('indent', (current) => clampIndent(current + delta));

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
      // Absolute, as the ruler drags them; the buttons above step relatively.
      setIndent: (cm: number) => write('indent', () => clampIndent(cm)),
      setIndentRight: (cm: number) => write('indentRight', () => clampIndent(cm)),
      setIndentFirst: (cm: number) => write('indentFirst', () => clampFirst(cm)),
      indentListMore: () => stepList(INDENT_STEP_CM),
      indentListLess: () => stepList(-INDENT_STEP_CM),
      indentListForward: () => ({ state, chain, commands }) => {
        const ctx = listContext(state);
        if (!ctx.inList) return false;
        if (ctx.wholeList) return commands.indentListMore();
        const beforeDepth0 = innermostList(state.selection.$from)?.depth0 ?? -1;
        return chain()
          .sinkListItem('listItem')
          .command(({ tr }) => { stampRememberedStyle(tr, beforeDepth0); return true; })
          .run();
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
      [DEFAULT_SHORTCUTS.indentMore]: () => {
        if (inCell()) return false;
        if (listContext(this.editor.state).inList) {
          this.editor.commands.indentListForward();
          return true;
        }
        this.editor.commands.insertContent('\t');
        return true;
      },
      [DEFAULT_SHORTCUTS.indentLess]: () => {
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
