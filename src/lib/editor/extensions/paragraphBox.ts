import { Extension, InputRule } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { cssBorder, parseBorderAttr, type BorderSpec } from './tableCellBorders';

// Paragraph/heading background ("colored field") + borders ("rule line"), as in
// Word/LibreOffice letterheads. Border attrs share table cells' canonical
// `'<W>pt solid #RRGGBB'`, but here null/absent = no border (no 'none' sentinel).

export type ParaBorderPreset = 'all' | 'top' | 'bottom' | 'left' | 'right';
export const PARA_BORDER_PRESETS: ParaBorderPreset[] = ['all', 'top', 'bottom', 'left', 'right'];

const BORDER_SIDES = ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'] as const;
type Side = (typeof BORDER_SIDES)[number];

const SIDE_META: Record<Side, { data: string; css: string }> = {
  borderTop: { data: 'data-pborder-top', css: 'border-top' },
  borderRight: { data: 'data-pborder-right', css: 'border-right' },
  borderBottom: { data: 'data-pborder-bottom', css: 'border-bottom' },
  borderLeft: { data: 'data-pborder-left', css: 'border-left' },
};

const PRESET_SIDES: Record<ParaBorderPreset, Side[]> = {
  all: ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'],
  top: ['borderTop'],
  bottom: ['borderBottom'],
  left: ['borderLeft'],
  right: ['borderRight'],
};

// Canonical attr value for a paragraph border; null spec = remove the border. Unlike the
// table version, the 0.5pt-black default is NOT collapsed (a chosen paragraph rule renders).
export function paraBorderValue(spec: BorderSpec): string | null {
  if (!spec) return null;
  const w = Math.round(spec.widthPt * 100) / 100;
  return `${w}pt solid ${spec.color.toUpperCase()}`;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphBox: {
      setParagraphBackground: (color: string | null) => ReturnType;
      setParagraphBorders: (preset: ParaBorderPreset, spec: BorderSpec) => ReturnType;
    };
  }
}

// The paragraph/heading textblocks the selection covers (the caret's own block when empty).
function selectedBlocks(state: EditorState): { pos: number; node: PMNode }[] {
  const out: { pos: number; node: PMNode }[] = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'paragraph' || node.type.name === 'heading') out.push({ pos, node });
  });
  if (out.length === 0) {
    const { $from } = state.selection;
    const parent = $from.parent;
    if (parent.type.name === 'paragraph' || parent.type.name === 'heading') {
      out.push({ pos: $from.before(), node: parent });
    }
  }
  return out;
}

export const ParagraphBox = Extension.create({
  name: 'paragraphBox',

  addOptions() {
    return { types: ['paragraph', 'heading'] as string[] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          backgroundColor: {
            default: null,
            // Decorative box shouldn't cascade onto the next paragraph on Enter.
            keepOnSplit: false,
            parseHTML: (element: HTMLElement) => element.getAttribute('data-bg') || null,
            renderHTML: (attributes: Record<string, unknown>) => {
              const c = attributes.backgroundColor as string | null;
              if (!c) return {};
              return { 'data-bg': c, style: `background-color: ${c}` };
            },
          },
          ...Object.fromEntries(
            BORDER_SIDES.map((side) => [
              side,
              {
                default: null,
                keepOnSplit: false,
                parseHTML: (element: HTMLElement) => element.getAttribute(SIDE_META[side].data),
                renderHTML: (attributes: Record<string, unknown>) => {
                  const v = attributes[side] as string | null;
                  if (!v) return {};
                  const css = cssBorder(v);
                  if (!css || css === 'none') return {};
                  return { [SIDE_META[side].data]: v, style: `${SIDE_META[side].css}: ${css}` };
                },
              },
            ]),
          ),
        },
      },
    ];
  },

  addCommands() {
    return {
      setParagraphBackground:
        (color: string | null) =>
        ({ state, tr, dispatch }: CommandProps): boolean => {
          const blocks = selectedBlocks(state);
          if (!blocks.length) return false;
          if (dispatch) {
            for (const { pos, node } of blocks) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, backgroundColor: color });
            }
            dispatch(tr);
          }
          return true;
        },
      setParagraphBorders:
        (preset: ParaBorderPreset, spec: BorderSpec) =>
        ({ state, tr, dispatch }: CommandProps): boolean => {
          const blocks = selectedBlocks(state);
          if (!blocks.length) return false;
          const value = paraBorderValue(spec);
          const patch: Partial<Record<Side, string | null>> = {};
          for (const side of PRESET_SIDES[preset]) patch[side] = value;
          if (dispatch) {
            for (const { pos, node } of blocks) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch });
            }
            dispatch(tr);
          }
          return true;
        },
    };
  },

  // Word/LibreOffice "border lines" AutoCorrect: a paragraph whose only text is 3+ of
  // -, _ or = becomes an empty bottom-rule line (thin / thick / thick — no double style).
  addInputRules() {
    const types = this.options.types;
    const WIDTH_PT: Record<string, number> = { '-': 0.5, _: 1.5, '=': 1.5 };
    return [
      new InputRule({
        find: /^(-{3,}|_{3,}|={3,})$/,
        handler: ({ state, range, match }) => {
          const value = `${WIDTH_PT[match[1][0]] ?? 0.5}pt solid #000000`;
          const $start = state.doc.resolve(range.from);
          const node = $start.parent;
          if (!types.includes(node.type.name)) return null;
          const paraPos = $start.before();
          state.tr.delete(range.from, range.to);
          state.tr.setNodeMarkup(paraPos, undefined, { ...node.attrs, borderBottom: value });
        },
      }),
    ];
  },
});

// Active states for the paragraph border picker: a preset is active when every
// covered block renders exactly the pen border on every side the preset targets. `none`
// is active when every covered block is borderless. null when no block is selected.
export function activeParagraphBorderPresets(
  state: EditorState,
  pen: Exclude<BorderSpec, null>,
): Record<ParaBorderPreset | 'none', boolean> | null {
  const blocks = selectedBlocks(state);
  if (!blocks.length) return null;

  const matchesPen = (attrVal: unknown) => {
    const b = parseBorderAttr(attrVal as string | null);
    return b !== null && b !== 'none' && Math.abs(b.widthPt - pen.widthPt) < 0.01 && b.color === pen.color.toUpperCase();
  };
  const sideEmpty = (attrVal: unknown) => {
    const b = parseBorderAttr(attrVal as string | null);
    return b === null || b === 'none';
  };

  const out = {} as Record<ParaBorderPreset | 'none', boolean>;
  for (const preset of PARA_BORDER_PRESETS) {
    out[preset] = blocks.every(({ node }) => PRESET_SIDES[preset].every((s) => matchesPen(node.attrs[s])));
  }
  out.none = blocks.every(({ node }) => BORDER_SIDES.every((s) => sideEmpty(node.attrs[s])));
  return out;
}
