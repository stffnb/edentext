import { Node, mergeAttributes } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';
import TextAlign from '@tiptap/extension-text-align';
import type { Editor } from '@tiptap/core';
import { DOMSerializer, Fragment } from '@tiptap/pm/model';
import { inNote } from './notes';
import type { DOMOutputSpec, Node as PMNode, Schema, Slice } from '@tiptap/pm/model';
import { NodeSelection, Selection, TextSelection, Plugin } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { placeFrameSoon, placeInColumn, placeTogether, freeDragX } from './pageBreaks';
import { HANDLES, MIN_SIZE_PX, clamp, parsePx, frameMargins, parseWrapGap, BOX_WRAP_GAP, type WrapGap, unstackFloat, pageContentHeightPx, sinkToOffset, applyRunThrough, runInZone, clearPagePlace, startFreeMove, droppedFrameAttrs, type WrapMode } from './image';
import { SHAPES, shapePath, linePaths, pathHeadPaths, arrowHeadPx, isShapeKind, isLineKind, outlineLayers, shadeColor, asShapePreset, asTextArea, type PathHeads, type ShapeKind, type DrawingMlPreset, type TextArea } from '../../utils/shapes';
import type { ResolvedGeometry } from '../../utils/enhancedGeometry';
import { cmToPx } from '../../storage/pageMargins';
import { normalizeColor } from '../../utils/color';

// cm attribute value → number, for the frame offsets (px ones use parsePx).
const parseCmAttr = (v: string | null): number | null => {
  const n = v == null ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// A text box / basic shape: a block-level frame with editable block content, a fill, a
// stroke, and the image's wrap model (inline = in-flow; left/right/topBottom float).
// Round-trips to ODF <draw:frame>/<draw:text-box>/<draw:custom-shape> and DOCX <wps:wsp>.

export type { ShapeKind };

// Vertical anchor of the text inside the frame (ODF draw:textarea-vertical-align,
// DOCX wps:bodyPr/@anchor t|ctr|b).
export type TextVAlign = 'top' | 'middle' | 'bottom';

// Fixed text inset inside the frame; exported as fo:padding / wps:bodyPr insets.
export const TEXTBOX_PADDING_CM = 0.15;
const paddingPx = (cm: unknown) => ((typeof cm === 'number' ? cm : TEXTBOX_PADDING_CM) * 96) / 2.54;

// Extra per-axis inset that fits the text area into an ellipse's inscribed
// rectangle (half-axis / √2), so text follows the oval instead of the bbox.
const ELLIPSE_INSET_RATIO = (1 - 1 / Math.SQRT2) / 2;

const DEFAULT_WIDTH_PX = 280;
const DEFAULT_HEIGHT_PX = 96;

// The width a box's text runs in (cm): what a table in it is measured against.
export function boxTextWidthCm(attrs: Record<string, unknown> | undefined): number {
  const w = typeof attrs?.width === 'number' && attrs.width > 0 ? attrs.width : DEFAULT_WIDTH_PX;
  return Math.max(0.5, (w * 2.54) / 96 - 2 * (typeof attrs?.paddingCm === 'number' ? attrs.paddingCm : TEXTBOX_PADDING_CM));
}
// A fresh line is flat: both word processors drop one across the text, not down it.
const DEFAULT_LINE_HEIGHT_PX = 0;
const SVG_NS = 'http://www.w3.org/2000/svg';
const PX_PER_PT = 96 / 72;

export interface TextBoxAttrs {
  width: number | null;
  height: number | null;
  rotation: number;
  wrap: WrapMode;
  wrapOffset: number | null;  // cm from the text column's left edge
  wrapOffsetY: number | null; // cm below the anchor paragraph
  wrapFromPage: boolean;      // …or below the top of the page the anchor lands on
  wrapFromBody: boolean;      // …or below the top of that page's body text
  inFront: boolean;           // over the text rather than behind it (run-through only)
  zIndex: number;             // place among the free frames (restackFrame in image.ts)
  wrapDist: number | WrapGap | null; // cm of gap to the text (see wrapGap)
  wrapAlign: string | null;   // 'center'/'right' = set against the middle/far end
  paddingCm: number;          // inset ring around the text (ODF fo:padding)
  paddingTopCm: number | null;  // its top and bottom where they differ from the sides
  paddingBottomCm: number | null;  // (Word's tIns/bIns)
  shapeKind: ShapeKind;
  shapePath: string | null;   // a freeform's own outline, in the 0…100 box
  shapeTextArea: TextArea | null; // where its text goes, same box
  shapePreset: DrawingMlPreset | null; // a DrawingML preset it stays, shapePath its snapshot
  arrowHeads: PathHeads | null; // the ends of that outline carrying an arrow head
  flipV: boolean;             // a line runs bottom-left → top-right instead
  flipH: boolean;             // a line starts at the right, so its head ends on the left
  textVertical: boolean;      // text runs top-to-bottom, right-to-left
  textVAlign: TextVAlign;     // where the text sits in a box taller than it is
  fixedHeight: boolean;       // exactly `height` tall, clipping what overflows
  fillColor: string | null;
  strokeColor: string | null;
  strokeWidthPt: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textBox: {
      insertTextBox: () => ReturnType;
      setTextBoxAttrs: (attrs: Partial<TextBoxAttrs>) => ReturnType;
      setTextBoxAlign: (align: string | null) => ReturnType;
    };
  }
}

// The text box enclosing the selection: a NodeSelection on one, or any ancestor of
// the cursor. Used by the commands and by the floating toolbar's visibility check.
export function findTextBox(state: EditorState): { pos: number; node: PMNode } | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === 'textBox') {
    return { pos: sel.from, node: sel.node };
  }
  const { $from } = sel;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'textBox') return { pos: $from.before(d), node: n };
  }
  return null;
}

// The depth of the text box a position sits in, or -1. The box is inline, so every
// ancestor from depth 1 has to be asked.
function boxDepthAt($p: { depth: number; node: (d: number) => PMNode }): number {
  for (let d = 1; d <= $p.depth; d++) if ($p.node(d).type.name === 'textBox') return d;
  return -1;
}

// Whether any text box in the fragment sits inside another. Both word processors refuse
// a box in a box, and neither format's writer has a place to put one.
function nestsBox(node: PMNode, inBox = false): boolean {
  let bad = false;
  node.forEach(child => {
    if (bad) return;
    const isBox = child.type.name === 'textBox';
    // A frame holding a table is a floating table, not a frame the file has to nest in:
    // a drawing in one of its cells is anchored in ordinary table text, and both
    // exporters write it as one.
    const floatingTable = isBox && child.childCount === 1 && child.firstChild?.type.name === 'table';
    if (isBox && inBox) bad = true;
    else if (nestsBox(child, !floatingTable && (inBox || isBox))) bad = true;
  });
  return bad;
}

function shapeRadius(kind: ShapeKind): string {
  return kind === 'ellipse' ? '50%' : kind === 'roundRect' ? '8px' : '0';
}

// A box that paints its own outline — a preset polygon, a freeform, or a line, which
// is only its stroke. The box behind any of them stays bare.
function isDrawnShape(a: TextBoxAttrs): boolean {
  return !!SHAPES[a.shapeKind]?.points || !!a.shapePath || isLineKind(a.shapeKind);
}

// The blocks a copied box carries, read back off the span the clipboard form is.
function clipboardContent(dom: HTMLElement, schema: Schema): Fragment {
  try {
    return Fragment.fromJSON(schema, JSON.parse(dom.getAttribute('data-tbx') || 'null'));
  } catch {
    return Fragment.empty;
  }
}

// A box holds blocks, and in an HTML string any block tag inside a `<p>` closes it — so
// a box copied to another window would arrive as loose paragraphs. It goes on the
// clipboard as an inline span instead, its blocks in an attribute as JSON, its text
// beside them for every reader that cannot take those back.
function boxClipboardSerializer(schema: Schema): DOMSerializer {
  const base = DOMSerializer.fromSchema(schema);
  const box = base.nodes.textBox;
  const nodes = {
    ...base.nodes,
    textBox: (node: PMNode) => {
      const [, attrs] = box(node) as [string, Record<string, string>, 0];
      return ['span', { ...attrs, 'data-tbx': JSON.stringify(node.content.toJSON()) },
        node.textBetween(0, node.content.size, ' ')] as DOMOutputSpec;
    },
  };
  return new DOMSerializer(nodes, base.marks);
}

export const TextBox = Node.create({
  name: 'textBox',
  // An inline node carrying block content, like the frame both formats write: it rides
  // a paragraph's content, so `inline` really is in the line and a box reaches a cell
  // or a list item through their paragraphs. A box inside a box is barred by a plugin.
  group: 'inline',
  inline: true,
  // Blocks and tables, as both formats' text boxes hold them. A frame holding nothing but
  // one table is how both word processors keep a floating table (Word's w:tblpPr).
  content: '(paragraph | heading | bulletList | orderedList | table)+',
  isolating: true,
  defining: true,
  draggable: true,
  selectable: true,

  // A box is only placed on purpose. ProseMirror's wrap and fit search skips a type with
  // required attributes; without this it reached a heading through a box (heading → list).
  onBeforeCreate() {
    this.editor.schema.nodes.textBox.hasRequiredAttrs = () => true;
  },

  addAttributes() {
    return {
      // px @96dpi like the image; height is a min-height (content grows the box) unless
      // `fixedHeight` says the box is that tall and clips the rest, as a word processor's is.
      width: {
        default: null,
        parseHTML: el => parsePx((el as HTMLElement).style.width),
        renderHTML: () => ({}),
      },
      height: {
        default: null,
        parseHTML: el => parsePx((el as HTMLElement).style.minHeight || (el as HTMLElement).style.height),
        renderHTML: () => ({}),
      },
      rotation: {
        default: 0,
        parseHTML: el => parsePx((el as HTMLElement).getAttribute('data-rotation')) ?? 0,
        renderHTML: () => ({}),
      },
      wrap: {
        default: 'inline',
        parseHTML: el => (el as HTMLElement).getAttribute('data-wrap') ?? 'inline',
        renderHTML: () => ({}),
      },
      // Where the frame sits relative to its anchor, in cm — as on an image.
      wrapOffset: {
        default: null,
        parseHTML: el => parseCmAttr((el as HTMLElement).getAttribute('data-wrap-offset')),
        renderHTML: () => ({}),
      },
      wrapOffsetY: {
        default: null,
        parseHTML: el => parseCmAttr((el as HTMLElement).getAttribute('data-wrap-offset-y')),
        renderHTML: () => ({}),
      },
      // In front of the text rather than behind it (Word's behindDoc="0", ODF
      // style:run-through="foreground") — as on an image.
      inFront: {
        default: false,
        parseHTML: el => (el as HTMLElement).hasAttribute('data-in-front'),
        renderHTML: () => ({}),
      },
      // Its place among the free frames — as on an image.
      zIndex: {
        default: 0,
        parseHTML: el => parsePx((el as HTMLElement).getAttribute('data-z-index')) ?? 0,
        renderHTML: () => ({}),
      },
      // Whether wrapOffsetY counts from the top of the frame's page — as on an image.
      wrapFromPage: {
        default: false,
        parseHTML: el => (el as HTMLElement).hasAttribute('data-wrap-from-page'),
        renderHTML: () => ({}),
      },
      // Whether it counts from the top of the page's body text instead — as on an image.
      wrapFromBody: {
        default: false,
        parseHTML: el => (el as HTMLElement).hasAttribute('data-wrap-from-body'),
        renderHTML: () => ({}),
      },
      // The gap to the text beside it, in cm — as on an image.
      wrapDist: {
        default: null,
        parseHTML: el => parseWrapGap((el as HTMLElement).getAttribute('data-wrap-dist')),
        renderHTML: () => ({}),
      },
      // 'center' = set against the middle of the column (ODF style:horizontal-pos): a
      // figure frame keeps it after the importer lifts it out of its anchor paragraph.
      wrapAlign: {
        default: null,
        parseHTML: el => (el as HTMLElement).getAttribute('data-wrap-align') || null,
        renderHTML: () => ({}),
      },
      // The file's own fo:padding (cm). A figure frame declares 0, and the default
      // ring would make every such box a little taller and its text a little inset.
      paddingCm: {
        default: TEXTBOX_PADDING_CM,
        parseHTML: el => parseCmAttr((el as HTMLElement).getAttribute('data-padding')) ?? TEXTBOX_PADDING_CM,
        renderHTML: () => ({}),
      },
      paddingTopCm: {
        default: null,
        parseHTML: el => parseCmAttr((el as HTMLElement).getAttribute('data-padding-top')),
        renderHTML: () => ({}),
      },
      paddingBottomCm: {
        default: null,
        parseHTML: el => parseCmAttr((el as HTMLElement).getAttribute('data-padding-bottom')),
        renderHTML: () => ({}),
      },
      shapeKind: {
        default: 'textbox',
        parseHTML: el => {
          const k = (el as HTMLElement).getAttribute('data-shape');
          return isShapeKind(k) ? k : 'textbox';
        },
        renderHTML: () => ({}),
      },
      // A drawing this editor cannot author (a polygon, a curve, a connector's elbow):
      // the file's own outline, in the same 0…100 box a preset's points live in.
      shapePath: {
        default: null,
        parseHTML: el => (el as HTMLElement).getAttribute('data-shape-path') || null,
        renderHTML: () => ({}),
      },
      // The text area of that outline: left, top, right, bottom in the same box.
      shapeTextArea: {
        default: null,
        parseHTML: el => asTextArea(((el as HTMLElement).getAttribute('data-shape-text-area') ?? '').split(' ').map(Number)),
        renderHTML: () => ({}),
      },
      // A DrawingML preset the outline came from, redrawn for whatever size the box takes.
      shapePreset: {
        default: null,
        parseHTML: el => {
          try { return asShapePreset(JSON.parse((el as HTMLElement).getAttribute('data-shape-preset') ?? 'null')); }
          catch { return null; }
        },
        renderHTML: () => ({}),
      },
      // Arrow heads on an open outline (a connector's ends): which of them carry one.
      arrowHeads: {
        default: null,
        parseHTML: el => {
          const v = (el as HTMLElement).getAttribute('data-arrow-heads');
          return v === 'start' || v === 'end' || v === 'both' ? v : null;
        },
        renderHTML: () => ({}),
      },
      // Which diagonal of the frame a line runs along — the one flag Word's `flipV`
      // and ODF's own endpoints both come down to.
      flipV: {
        default: false,
        parseHTML: el => (el as HTMLElement).getAttribute('data-flip-v') === 'true',
        renderHTML: () => ({}),
      },
      // Which end of that diagonal a line starts at — Word's `flipH`, ODF's endpoint order.
      flipH: {
        default: false,
        parseHTML: el => (el as HTMLElement).getAttribute('data-flip-h') === 'true',
        renderHTML: () => ({}),
      },
      // The text runs top-to-bottom, right-to-left instead of across (Word's
      // `w:bodyPr vert`, ODF's tb-rl writing mode on the frame's style).
      textVertical: {
        default: false,
        parseHTML: el => (el as HTMLElement).getAttribute('data-text-vertical') === 'true',
        renderHTML: () => ({}),
      },
      // Where the text sits in a box taller than the text: both formats anchor it
      // top, middle or bottom.
      fixedHeight: {
        default: false,
        parseHTML: el => (el as HTMLElement).hasAttribute('data-fixed-height'),
        renderHTML: () => ({}),
      },
      textVAlign: {
        default: 'top' as TextVAlign,
        parseHTML: el => {
          const v = (el as HTMLElement).getAttribute('data-text-valign');
          return v === 'middle' || v === 'bottom' ? v : 'top';
        },
        renderHTML: () => ({}),
      },
      fillColor: {
        default: '#FFFFFF',
        parseHTML: el => normalizeColor((el as HTMLElement).getAttribute('data-fill')) ?? null,
        renderHTML: () => ({}),
      },
      strokeColor: {
        default: '#000000',
        parseHTML: el => normalizeColor((el as HTMLElement).getAttribute('data-stroke')) ?? null,
        renderHTML: () => ({}),
      },
      strokeWidthPt: {
        default: 1,
        parseHTML: el => {
          const n = parseFloat((el as HTMLElement).getAttribute('data-stroke-width') ?? '');
          return Number.isFinite(n) ? n : 1;
        },
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'div[data-textbox]' },
      // The clipboard's inline form, whose blocks ride an attribute (see
      // boxClipboardSerializer); its own text is what the attribute already holds.
      { tag: 'span[data-tbx]', getContent: (dom, schema) => clipboardContent(dom as HTMLElement, schema) },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const a = node.attrs as TextBoxAttrs;
    const fill = normalizeColor(a.fillColor);
    const stroke = normalizeColor(a.strokeColor);
    const style = [
      a.width ? `width:${a.width}px` : '',
      a.height ? (a.fixedHeight ? `height:${a.height}px;overflow:hidden` : `min-height:${a.height}px`) : '',
      // A polygon paints itself and a line is only its stroke, so the box behind
      // either of them stays bare.
      fill && !isDrawnShape(a) ? `background:${fill}` : '',
      stroke && !isDrawnShape(a)
        ? `border:${a.strokeWidthPt * PX_PER_PT}px solid ${stroke}` : '',
      a.shapeKind !== 'textbox' ? `border-radius:${shapeRadius(a.shapeKind)}` : '',
      a.rotation ? `transform:rotate(${a.rotation}deg)` : '',
      `padding:${ringCss(a)}`,
      a.textVAlign !== 'top'
        ? `display:flex;flex-direction:column;justify-content:${a.textVAlign === 'middle' ? 'safe center' : 'safe flex-end'}` : '',
    ].filter(Boolean).join(';');
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-textbox': '',
      style,
      ...(a.rotation ? { 'data-rotation': String(a.rotation) } : {}),
      ...(a.wrap !== 'inline' ? { 'data-wrap': a.wrap } : {}),
      ...(a.inFront ? { 'data-in-front': '' } : {}),
      ...(a.zIndex ? { 'data-z-index': String(a.zIndex) } : {}),
      ...(a.wrapFromPage ? { 'data-wrap-from-page': '' } : {}),
      ...(a.wrapFromBody ? { 'data-wrap-from-body': '' } : {}),
      ...(a.shapeKind !== 'textbox' ? { 'data-shape': a.shapeKind } : {}),
      ...(a.shapePath ? { 'data-shape-path': a.shapePath } : {}),
      ...(a.shapeTextArea ? { 'data-shape-text-area': a.shapeTextArea.join(' ') } : {}),
      ...(a.shapePreset ? { 'data-shape-preset': JSON.stringify(a.shapePreset) } : {}),
      ...(a.arrowHeads ? { 'data-arrow-heads': a.arrowHeads } : {}),
      ...(a.flipV ? { 'data-flip-v': 'true' } : {}),
      ...(a.flipH ? { 'data-flip-h': 'true' } : {}),
      ...(a.textVertical ? { 'data-text-vertical': 'true' } : {}),
      ...(a.textVAlign !== 'top' ? { 'data-text-valign': a.textVAlign } : {}),
      ...(a.fixedHeight ? { 'data-fixed-height': '' } : {}),
      ...(fill ? { 'data-fill': fill } : {}),
      ...(stroke ? { 'data-stroke': stroke } : {}),
      ...(a.strokeWidthPt !== 1 ? { 'data-stroke-width': String(a.strokeWidthPt) } : {}),
      ...(a.paddingCm !== TEXTBOX_PADDING_CM ? { 'data-padding': String(a.paddingCm) } : {}),
      ...(a.paddingTopCm != null ? { 'data-padding-top': String(a.paddingTopCm) } : {}),
      ...(a.paddingBottomCm != null ? { 'data-padding-bottom': String(a.paddingBottomCm) } : {}),
    }), 0];
  },

  addCommands() {
    return {
      // Insert a fresh text box at the cursor, cursor inside. A box is a character, so
      // it goes where the caret is — except inside a box, where it would nest: there it
      // follows the block that holds that box, in a paragraph of its own.
      insertTextBox:
        () =>
        ({ state, dispatch }) => {
          const type = state.schema.nodes.textBox;
          const paraType = state.schema.nodes.paragraph;
          const para = paraType?.createAndFill();
          // Not in a note: both products refuse a frame there, and the ODT note body
          // holds inline content only.
          if (!type || !paraType || !para || inNote(state)) return false;
          const { $from } = state.selection;
          const nested = boxDepthAt($from) >= 0 && $from.depth >= 1;
          const at = nested ? $from.after(1) : state.selection.from;
          if (dispatch) {
            const box = type.create({ width: DEFAULT_WIDTH_PX, height: DEFAULT_HEIGHT_PX }, para);
            const tr = state.tr.insert(at, nested ? paraType.create(null, box) : box);
            // The box's own first text position: one more where a paragraph wraps it.
            tr.setSelection(TextSelection.create(tr.doc, at + (nested ? 3 : 2)));
            dispatch(tr.scrollIntoView());
          }
          return true;
        },

      // The alignment of the paragraph an in-line box sits in — which is what places it,
      // and what both formats write. Its own command because the caret is usually inside
      // the box, where the generic one would align the box's own paragraph instead.
      setTextBoxAlign:
        (align: string | null) =>
        ({ state, dispatch }) => {
          const found = findTextBox(state);
          if (!found) return false;
          const $box = state.doc.resolve(found.pos);
          if (!$box.parent.type.spec.attrs?.textAlign) return false;
          if (dispatch) {
            dispatch(state.tr.setNodeMarkup($box.before(), undefined, { ...$box.parent.attrs, textAlign: align }));
          }
          return true;
        },

      // Update attrs of the selected box or the box enclosing the cursor.
      setTextBoxAttrs:
        (attrs: Partial<TextBoxAttrs>) =>
        ({ state, dispatch }) => {
          const found = findTextBox(state);
          if (!found) return false;
          if (dispatch) {
            const was = found.node.attrs as TextBoxAttrs;
            // A box turned into a line leaves the text, in front of it: as LibreOffice
            // draws a new line, and so that both its ends can be dragged anywhere.
            const freed = attrs.shapeKind && isLineKind(attrs.shapeKind) && !isLineKind(was.shapeKind)
              && was.wrap === 'inline' && !attrs.wrap
              ? { wrap: 'through' as const, ...droppedFrameAttrs('through', true, was.wrap) } : {};
            // A box that starts to wrap without a gap of its own takes a new frame's.
            const gap = attrs.wrap && attrs.wrap !== 'inline' && attrs.wrap !== 'through' && was.wrapDist == null && attrs.wrapDist === undefined
              ? { wrapDist: BOX_WRAP_GAP } : {};
            const tr = state.tr.setNodeMarkup(found.pos, undefined, { ...was, ...freed, ...gap, ...attrs });
            // As in commit(): a selected frame stays selected, its toolbar with it. A line
            // holds no text, so the caret it had moves out onto the frame.
            if (state.selection instanceof NodeSelection || isLineKind(attrs.shapeKind ?? was.shapeKind)) tr.setSelection(NodeSelection.create(tr.doc, found.pos));
            dispatch(tr);
          }
          return true;
        },
    };
  },

  // The frame holds editable blocks, so at its own first or last text position there is
  // no neighbouring one for the browser to walk to and the caret sits stuck. Step out to
  // the position the box occupies in its paragraph, which is where a character would be.
  addKeyboardShortcuts() {
    const escape = (dir: -1 | 1) => () => {
      const sel = this.editor.state.selection;
      if (!(sel instanceof TextSelection) || !sel.empty) return false;
      const $c = sel.$from;
      const d = boxDepthAt($c);
      if (d < 0) return false;
      const box = $c.node(d);
      const edge = dir < 0 ? Selection.atStart(box).from : Selection.atEnd(box).to;
      if (sel.from !== $c.start(d) + edge) return false;
      return this.editor.commands.setTextSelection(dir < 0 ? $c.before(d) : $c.after(d));
    };
    return { ArrowLeft: escape(-1), ArrowRight: escape(1) };
  },

  addNodeView() {
    return ({ node, editor, getPos, view }) => new TextBoxView(node as PMNode, editor, getPos as () => number, view);
  },

  // Show the resize frame + handles (via .textbox-active) whenever the caret sits
  // inside a box, so a plain click into it reveals the editing frame like an image.
  addProseMirrorPlugins() {
    const clipboardSerializer = boxClipboardSerializer(this.editor.schema);
    return [
      new Plugin({
        // A selection may not end inside a box it did not start in: deleting one
        // dissolves the frame and spills its text into the body. Grown to the box's
        // own bounds, the same delete takes the whole box, which is what both word
        // processors do.
        appendTransaction: (_trs, _old, state) => {
          const sel = state.selection;
          if (!(sel instanceof TextSelection) || sel.empty) return null;
          const { $from, $to } = sel;
          const df = boxDepthAt($from);
          const dt = boxDepthAt($to);
          if (df === dt && (df < 0 || $from.start(df) === $to.start(df))) return null;
          const from = df < 0 ? sel.from : $from.before(df);
          const to = dt < 0 ? sel.to : $to.after(dt);
          return state.tr.setSelection(TextSelection.create(state.doc, from, to));
        },
        // A box in a box has nowhere to go in either format, so it never enters the
        // document. Only a step that carries one is worth the walk.
        filterTransaction: tr => {
          if (!tr.docChanged) return true;
          const carriesBox = tr.steps.some(step => {
            const slice = (step as unknown as { slice?: Slice }).slice;
            if (!slice) return false;
            let found = false;
            slice.content.descendants(n => {
              if (n.type.name === 'textBox') found = true;
              return !found;
            });
            return found;
          });
          return !carriesBox || !nestsBox(tr.doc);
        },
        props: {
          clipboardSerializer,
          decorations(state) {
            const known = decoSets.get(state);
            if (known) return known;
            const { from, to } = state.selection;
            const selected = state.selection instanceof NodeSelection ? from : -1;
            const decos = boxRanges(state.doc).map(([pos, end]) => {
              const attrs: Record<string, string> = {};
              // Selected, or the caret inside: a caret just before the box is beside it,
              // which is where every zone's editor starts out.
              if (selected === pos || (from > pos && to < end)) attrs.class = 'textbox-active';
              // A frame nobody is editing is an atom to the browser. Left editable it
              // swallows the caret meant for the box's own place in the line — there is
              // no text position beside a box that starts its paragraph — and what is
              // typed there lands inside the frame.
              if (!(from > pos && to < end)) attrs.contenteditable = 'false';
              return Decoration.node(pos, end, attrs);
            });
            const set = DecorationSet.create(state.doc, decos);
            decoSets.set(state, set);
            return set;
          },
        },
      }),
    ];
  },
});

// Every view of a state asks for the same set, and a selection change keeps the doc:
// the walk runs once per doc and the set once per state, not once per pane.
const decoSets = new WeakMap<EditorState, DecorationSet>();
const boxesOf = new WeakMap<PMNode, [number, number][]>();
function boxRanges(doc: PMNode): [number, number][] {
  let out = boxesOf.get(doc);
  if (out) return out;
  out = [];
  // A box rides a paragraph's inline content, so the walk has to enter blocks.
  doc.descendants((node, pos) => {
    if (node.type.name !== 'textBox') return node.isBlock;
    out!.push([pos, pos + node.nodeSize]);
    return false;
  });
  boxesOf.set(doc, out);
  return out;
}

type Size = { w: number; h: number };

// A view still being built has no size, and the observer reports it once mounted; WebKit
// lays out the whole document even to answer 0 for a detached element.
const rotorSize = (el: HTMLElement): Size => el.isConnected ? { w: el.offsetWidth, h: el.offsetHeight } : { w: 0, h: 0 };

// One observer for every frame in the document: a per-view one is delivered in a
// callback of its own, so the browser lays the document out again between any two
// frames — 1.4 s on a document holding 450 of them.
const fitted = new WeakMap<Element, TextBoxView>();
let fitObserver: ResizeObserver | null = null;
// The preset table, loaded the first time a box needs it (`resolvePreset`).
let presetTable: typeof import('../../utils/shapePresets') | null = null;
let presetsLoading: Promise<void> | null = null;
const EMU_PER_PX = 9525;

function observeFit(rotor: HTMLElement, view: TextBoxView): void {
  fitted.set(rotor, view);
  // A round's reads before its writes: the size is offsetWidth's, which snaps to the
  // pixel grid the frame sits on and so is the rotor's own, not the observation's.
  fitObserver ??= new ResizeObserver((entries) => {
    const jobs = entries.map((e) => [fitted.get(e.target), rotorSize(e.target as HTMLElement)] as const);
    placeTogether(() => { for (const [view, size] of jobs) view?.refit(size); });
  });
  fitObserver.observe(rotor);
}

function unobserveFit(rotor: HTMLElement): void {
  fitObserver?.unobserve(rotor);
  fitted.delete(rotor);
}

// Node view: like ImageView, an axis-aligned wrapper reserves the rotated bounding box and
// a centered rotor carries fill/stroke/rotation plus the handles — but the rotor holds an
// editable contentDOM and auto-grows, so a ResizeObserver re-fits the wrapper.
class TextBoxView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private rotor: HTMLElement;
  private badge: HTMLElement;
  private node: PMNode;
  private editor: Editor;
  // The view this box renders in: a split or grid pane is its own, measured on its own.
  private view: EditorView;
  private getPos: () => number;
  private resizing = false;
  // Live offsets while a free drag runs (cm), added to the node's own by offX/offY.
  private dragBy: { x: number; y: number } | null = null;
  private dragX = 0;
  // The polygon outline, for a shape CSS cannot draw; null for the three it can.
  private outline: SVGSVGElement | null = null;
  // A preset's outline and text area for the size last drawn (`resolvePreset`).
  private live: { key: string; geo: ResolvedGeometry } | null = null;
  // The line and its arrow heads, for the kinds that are two endpoints, not a box.
  private lineSvg: SVGSVGElement | null = null;
  private lineEnds: HTMLElement[] = [];
  // A line's geometry while one of its ends is dragged, over the node's own attrs.
  private preview: Partial<TextBoxAttrs> | null = null;
  // Last text-area inset applied; guards the ResizeObserver feedback loop.
  private lastInset = '';

  constructor(node: PMNode, editor: Editor, getPos: () => number, view: EditorView) {
    this.node = node;
    this.editor = editor;
    this.getPos = getPos;
    this.view = view;

    this.dom = document.createElement('div');
    this.dom.className = 'textbox-node';

    this.rotor = document.createElement('div');
    this.rotor.className = 'textbox-rotor';

    // Padding lives on the rotor, so the inset ring around the text is frame
    // (click-to-select) area rather than content.
    this.rotor.style.padding = ringCss(this.attrs());
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'textbox-content';
    this.rotor.appendChild(this.contentDOM);

    for (const cfg of HANDLES) {
      const h = document.createElement('span');
      h.className = `image-resize-handle image-resize-${cfg.k}`;
      h.addEventListener('mousedown', e => this.startResize(e as MouseEvent, cfg));
      this.rotor.appendChild(h);
    }
    const rot = document.createElement('span');
    rot.className = 'image-rotate-handle';
    rot.addEventListener('mousedown', e => this.startRotate(e as MouseEvent));
    this.rotor.appendChild(rot);
    // A line is grabbed by its two ends instead (CSS shows one set or the other).
    this.lineEnds = (['start', 'end'] as const).map(end => {
      const h = document.createElement('span');
      h.className = 'image-resize-handle textbox-line-end';
      h.addEventListener('mousedown', e => this.startEndpoint(e as MouseEvent, end));
      return this.rotor.appendChild(h);
    });

    this.dom.appendChild(this.rotor);

    this.badge = document.createElement('span');
    this.badge.className = 'image-size-badge';
    this.dom.appendChild(this.badge);

    // A mousedown on the frame ring (border, not the text area) object-selects the box
    // so it can be dragged/moved; clicks further inside place the caret and edit.
    this.dom.addEventListener('mousedown', e => this.onFrameMouseDown(e));

    // The rotor is out of flow and grows with its content; refit the wrapper to the
    // rotated bounding box whenever the rendered size changes (typing, resizing), and
    // re-fit an ellipse's text area to its now-current height.
    observeFit(this.rotor, this);

    this.applyAll();
  }

  private attrs(): TextBoxAttrs {
    return (this.preview ? { ...this.node.attrs, ...this.preview } : this.node.attrs) as TextBoxAttrs;
  }

  // The frame's offsets, carrying a running free drag (see ImageView).
  private offX(): unknown { return this.dragBy ? this.dragX + this.dragBy.x : this.attrs().wrapOffset; }
  private offY(): unknown { const v = this.attrs().wrapOffsetY; return this.dragBy ? (typeof v === 'number' ? v : 0) + this.dragBy.y : v; }

  // Past its zone, as on an image (ImageView.pastZone).
  private pastZone(): boolean {
    const a = this.attrs();
    return (a.wrapFromBody || a.wrapFromPage) && this.inZone();
  }
  // Any box of a zone's own that is not in its line is out of the zone's text flow.
  // The mount, not editor.view: that is not there yet while a saved document builds.
  private inZone(): boolean {
    const el = this.editor.options.element as Element | { mount: HTMLElement } | null;
    const mount = el && 'mount' in el ? el.mount : el;
    return this.attrs().wrap !== 'inline' && !!mount?.closest?.('.hf-zone');
  }

  // A fixed box is exactly that tall and clips its overflow; any other grows with its text.
  private applyHeight(h: number | null): void {
    const fixed = this.attrs().fixedHeight && h != null;
    this.rotor.style.minHeight = !fixed && h ? `${h}px` : '';
    this.rotor.style.height = fixed ? `${h}px` : '';
    // The content clips, not the rotor: the resize handles sit on the rotor's edge.
    // Its edge is the inset's, where LibreOffice cuts the text too (probed).
    this.contentDOM.style.maxHeight = fixed ? '100%' : '';
    this.contentDOM.style.overflow = fixed ? 'clip' : '';
  }

  private applyAll(): void {
    const a = this.attrs();
    // A polygon shape paints its own fill and stroke, so the box behind it stays bare;
    // a line has no box at all, only the two endpoints it is drawn between.
    const poly = !!SHAPES[a.shapeKind]?.points || !!a.shapePath;
    const line = isLineKind(a.shapeKind);
    // A vertical line is a frame of no width, as a horizontal one is of no height.
    this.rotor.style.width = `${line ? a.width ?? DEFAULT_WIDTH_PX : a.width || DEFAULT_WIDTH_PX}px`;
    this.applyHeight(a.height);
    this.dom.classList.toggle('textbox-is-line', line);
    // The outline covers the padding box, so the frame's own ring moves to the text
    // where a polygon draws it — applyShapeInset adds it back in.
    this.rotor.style.padding = poly || line ? '0' : ringCss(a);
    const fill = normalizeColor(a.fillColor);
    const strokeColor = normalizeColor(a.strokeColor);
    this.rotor.style.background = !poly && !line && fill ? fill : 'transparent';
    this.rotor.style.border = !poly && !line && strokeColor
      ? `${a.strokeWidthPt * PX_PER_PT}px solid ${strokeColor}`
      : 'none';
    this.rotor.style.borderRadius = shapeRadius(a.shapeKind);
    this.rotor.style.transform = `translate(-50%, -50%) rotate(${a.rotation}deg)`;
    // A line holds no text: the paragraph the schema requires stays in the document
    // (and in both exports' anchor), it just takes no room.
    this.contentDOM.style.display = line ? 'none' : '';
    // Vertical text: the browser flows it, so the box needs nothing but the mode.
    this.contentDOM.style.writingMode = a.textVertical ? 'vertical-rl' : '';
    // Vertical anchor: the handles are absolute, so the rotor can flex its one child.
    this.rotor.style.display = a.textVAlign === 'top' ? '' : 'flex';
    this.rotor.style.flexDirection = 'column';
    // `safe`: text taller than a fixed box overflows from its top, as LibreOffice sets it.
    this.rotor.style.justifyContent = a.textVAlign === 'middle' ? 'safe center' : a.textVAlign === 'bottom' ? 'safe flex-end' : '';
    this.resolvePreset();
    this.applyOutline();
    this.applyLine();
    this.applyWrap();
    this.applyShapeInset();
    this.fitWrapper();
    // As on an image: a sunk frame measures what stands above it once it is in the document.
    if (a.wrap === 'topBottom') requestAnimationFrame(() => sinkToOffset(this.dom, this.attrs().wrapOffsetY));
  }

  // A line is drawn in real pixels, not the 0…100 box a polygon is stretched into: an
  // arrow head has to keep its shape however flat the frame is drawn.
  private applyLine(): void {
    const a = this.attrs();
    const w = a.width ?? DEFAULT_WIDTH_PX;
    const h = a.height ?? DEFAULT_LINE_HEIGHT_PX;
    const stroke = a.strokeWidthPt * PX_PER_PT;
    const headLen = arrowHeadPx(a.strokeWidthPt);
    // An outline's heads ride the same real-pixel layer, over the stretched outline.
    const paths = linePaths(a.shapeKind, w, h, a.flipV, headLen, a.flipH)
      ?? (a.shapePath && a.arrowHeads && a.strokeColor
        ? { line: '', heads: pathHeadPaths(this.live?.geo.path || a.shapePath, w, h, a.arrowHeads, headLen) } : null);
    if (!paths) {
      this.lineSvg?.remove();
      this.lineSvg = null;
      return;
    }
    if (!this.lineSvg) {
      this.lineSvg = document.createElementNS(SVG_NS, 'svg');
      this.lineSvg.setAttribute('class', 'textbox-line');
      this.rotor.insertBefore(this.lineSvg, this.rotor.firstChild);
    }
    const color = normalizeColor(a.strokeColor) ?? '#000000';
    // A frame of no height (the divider line both word processors write) would give the
    // SVG a zero-high viewport, and that turns rendering off entirely — the stroke needs
    // one of its own, which it then overflows by half as it does in any flat frame.
    const vh = Math.max(h, stroke);
    const vw = Math.max(w, stroke);
    this.lineSvg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
    this.lineSvg.setAttribute('width', `${vw}`);
    this.lineSvg.setAttribute('height', `${vh}`);
    this.lineSvg.style.height = `${vh}px`;
    if (isLineKind(a.shapeKind)) {
      const [x1, y1] = [a.flipH ? w : 0, a.flipV ? h : 0];
      [[x1, y1], [w - x1, h - y1]].forEach(([x, y], i) => {
        this.lineEnds[i].style.left = `${x - 5}px`;
        this.lineEnds[i].style.top = `${y - 5}px`;
      });
    }
    this.lineSvg.replaceChildren();
    if (paths.line && isLineKind(a.shapeKind)) {
      // Wide enough to grab a hairline, and the one thing a line is hit on.
      const hit = document.createElementNS(SVG_NS, 'path');
      hit.setAttribute('d', paths.line);
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', String(Math.max(stroke, 10)));
      this.lineSvg.appendChild(hit);
    }
    if (paths.line) {
      const line = document.createElementNS(SVG_NS, 'path');
      line.setAttribute('d', paths.line);
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', String(stroke));
      this.lineSvg.appendChild(line);
    }
    for (const d of paths.heads) {
      const head = document.createElementNS(SVG_NS, 'path');
      head.setAttribute('d', d);
      head.setAttribute('fill', color);
      this.lineSvg.appendChild(head);
    }
  }

  // The outline of a shape CSS can't draw, behind the text. preserveAspectRatio="none"
  // stretches the 0…100 box to the frame, and non-scaling-stroke keeps the line even
  // width under that distortion.
  private applyOutline(): void {
    const a = this.attrs();
    const d = this.live?.geo.path || shapePath(a.shapeKind, a.shapePath);
    this.dom.classList.toggle('textbox-outlined', !!d);
    if (!d) {
      this.outline?.remove();
      this.outline = null;
      return;
    }
    if (!this.outline) {
      this.outline = document.createElementNS(SVG_NS, 'svg');
      this.outline.setAttribute('class', 'textbox-outline');
      this.outline.setAttribute('viewBox', '0 0 100 100');
      this.outline.setAttribute('preserveAspectRatio', 'none');
      this.rotor.insertBefore(this.outline, this.rotor.firstChild);
    }
    // Faces filled only, shaded or stroked only (`outlineLayers`) each take a path: the
    // fills in drawing order, then the lines over them.
    const { fills, stroke: lines } = outlineLayers(d);
    const fill = normalizeColor(a.fillColor);
    const stroke = normalizeColor(a.strokeColor) ?? 'none';
    // An outline none of whose parts closes is stroked only, whatever fill its style
    // declares — which is how both products draw a polyline.
    const layers = fills.map((f) => ({ d: f.d, fill: fill && f.d.includes('Z') ? shadeColor(fill, f.shade) : 'none', stroke: 'none' }));
    if (layers.length === 1 && fills[0].d === lines) layers[0].stroke = stroke;
    else layers.push({ d: lines, fill: 'none', stroke });
    const paths = Array.from(this.outline.children) as SVGPathElement[];
    layers.forEach((l, i) => {
      const p = paths[i] ?? this.outline!.appendChild(document.createElementNS(SVG_NS, 'path'));
      p.setAttribute('vector-effect', 'non-scaling-stroke');
      p.setAttribute('d', l.d);
      p.setAttribute('fill', l.fill);
      p.setAttribute('stroke', l.stroke);
      p.setAttribute('stroke-width', String(a.strokeWidthPt * PX_PER_PT));
    });
    paths.slice(layers.length).forEach((p) => p.remove());
  }

  // A preset is redrawn from its formulas at the size the box renders at, so a corner
  // or a depth keeps its measure however the box is stretched. The table loads once;
  // until then the snapshot in `shapePath` draws.
  private resolvePreset(size?: Size): void {
    const preset = this.attrs().shapePreset;
    if (!preset) { this.live = null; return; }
    if (!presetTable) {
      presetsLoading ??= import('../../utils/shapePresets').then((m) => { presetTable = m; });
      presetsLoading.then(() => { if (this.attrs().shapePreset) this.applyAll(); }, () => {});
      return;
    }
    const a = this.attrs();
    const { w, h } = size ?? { w: a.width ?? DEFAULT_WIDTH_PX, h: a.height ?? DEFAULT_HEIGHT_PX };
    if (!w || !h) return;
    const key = `${JSON.stringify(preset)} ${Math.round(w)} ${Math.round(h)}`;
    if (this.live?.key === key) return;
    const geo = presetTable.presetGeometry(preset, w * EMU_PER_PX, h * EMU_PER_PX);
    this.live = geo.path ? { key, geo } : null;
    this.applyOutline();
    this.applyLine();
  }

  // Pad the content into the shape's own text area — the ellipse's inscribed rectangle,
  // a polygon's `textArea` — so text stays inside the outline. The vertical inset feeds
  // back into the auto-grown height, so rewrite it only past a threshold; the
  // ResizeObserver then settles (every ratio below 0.5 converges).
  private applyShapeInset(size?: Size): void {
    const kind = this.attrs().shapeKind;
    const area = SHAPES[kind]?.textArea ?? (this.live ? this.live.geo.textArea : this.attrs().shapeTextArea);
    if (kind !== 'ellipse' && !area) {
      if (this.contentDOM.style.padding) this.contentDOM.style.padding = '';
      this.lastInset = '';
      return;
    }
    const { w, h } = size ?? rotorSize(this.rotor);
    if (!w || !h) return;
    const [l, t, r, b] = area
      ? [area[0] / 100, area[1] / 100, 1 - area[2] / 100, 1 - area[3] / 100]
      : [ELLIPSE_INSET_RATIO, ELLIPSE_INSET_RATIO, ELLIPSE_INSET_RATIO, ELLIPSE_INSET_RATIO];
    // Whole px: the inset feeds back into the height, and rounding is what settles it.
    // A polygon carries the frame's own ring here, its rotor having none.
    const ring = area ? paddingPx(this.attrs().paddingCm) : 0;
    const px = (v: number, base: number) => `${Math.round(v * base + ring)}px`;
    const inset = `${px(t, h)} ${px(r, w)} ${px(b, h)} ${px(l, w)}`;
    if (inset === this.lastInset) return;
    this.lastInset = inset;
    this.contentDOM.style.padding = inset;
  }

  // The wrapper's width before the ResizeObserver has measured the mounted rotor:
  // the attr size through the same rotation math (a construction-time margin computed
  // with 0 shoved a right float its whole width off the column).
  private wrapperWidth(): number {
    const set = parseFloat(this.dom.style.width);
    if (set) return set;
    const a = this.attrs();
    const rad = (a.rotation * Math.PI) / 180;
    const w = a.width || DEFAULT_WIDTH_PX;
    return Math.abs(w * Math.cos(rad)) + Math.abs((a.height || 0) * Math.sin(rad));
  }

  // Size the wrapper to the rotor's rotated bounding box so surrounding text
  // reserves the right space (same math as ImageView.applyLayout).
  private fitWrapper(size?: Size): void {
    const { w, h } = size ?? rotorSize(this.rotor);
    // A straight line may be flat either way; only the detached frame has neither.
    if (isLineKind(this.attrs().shapeKind) ? !w && !h : !w || !h) return;
    // Out of the flow nothing is reserved and the offsets place the unrotated box, as
    // both formats do, so it turns about a centre that stays put.
    const rad = this.attrs().wrap === 'through' || this.inZone() ? 0 : (this.attrs().rotation * Math.PI) / 180;
    const bw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
    const bh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
    // A band-wrapped frame spans the column instead (applyWrap), which is what keeps
    // text off its sides; only its height is the frame's.
    const band = this.attrs().wrap === 'topBottom';
    this.dom.style.width = band ? '100%' : `${bw}px`;
    this.dom.style.height = `${bh}px`;
    if (band) this.placeInBand(this.attrs());
  }

  // Float per wrap mode, exactly like ImageView.applyWrap: an inline node leaves the
  // line by floating, never by becoming a block box.
  private applyWrap(): void {
    const d = this.dom;
    const a = this.attrs();
    // Mirrors renderHTML's data-wrap, so one selector reaches a floating frame in the
    // live view and in generated static HTML alike (as on an image).
    if (a.wrap === 'inline') delete d.dataset.wrap; else d.dataset.wrap = a.wrap;
    d.style.float = '';
    d.style.clear = '';
    d.style.position = '';
    d.style.zIndex = '';
    d.style.display = '';
    d.style.verticalAlign = '';
    d.style.margin = '';
    this.rotor.style.left = '';
    clearPagePlace(d);
    if (a.wrap !== 'through' && this.pastZone()) {
      applyRunThrough(d, this.offX(), this.offY(), true, a.wrapFromPage, a.wrapFromBody, a.zIndex);
    } else if (a.wrap !== 'through' && this.inZone()) {
      runInZone(this.view, d, this.offX(), this.offY(), a.wrapDist, a.zIndex);
    } else if (a.wrap === 'left' || a.wrap === 'right') {
      d.style.float = a.wrap;
      d.style.margin = frameMargins(a.wrap, a.wrapOffset, this.wrapperWidth(), null, a.wrapDist);
      unstackFloat(d, a.wrap, a.wrapOffset, a.wrapDist);
    } else if (a.wrap === 'through') {
      // Behind the text, which is what a shape with no run-through of its own exports as
      // — and under a picture behind the text too (-1), which is the order LibreOffice
      // paints a cover page in; a box the file puts in front of the text sits above both.
      applyRunThrough(d, this.offX(), this.offY(), a.inFront === true, a.wrapFromPage === true, a.wrapFromBody === true, a.zIndex);
      // Deferred: the frame has to be laid out before its own page can be read. Its
      // column only needs it in the document, so one already there lands at once.
      if (!a.wrapFromPage && !a.wrapFromBody && d.isConnected) placeInColumn(this.view, d);
      else placeFrameSoon(this.view, d);
    } else if (a.wrap === 'topBottom') {
      // A full-width float, as on an image: text may only flow above and below it, and
      // a block box on an inline node view splits the paragraph's inline content into
      // anonymous ones, which loses the following page-break spacer.
      d.style.float = 'left';
      d.style.clear = 'both';
      d.style.width = '100%';
      d.style.margin = frameMargins('topBottom', null, 0, a.wrapOffsetY, a.wrapDist);
      sinkToOffset(d, a.wrapOffsetY);
      this.placeInBand(a);
    } else {
      // In the line: a box is a character. inline-block keeps ProseMirror's inline view
      // intact where a block box would not.
      d.style.display = 'inline-block';
      d.style.verticalAlign = 'bottom';
    }
  }

  // Where the frame sits across a band it spans: the wrapper is the whole column, so
  // this moves the rotor, which CSS centres in it — which is already `center`.
  private placeInBand(a: TextBoxAttrs): void {
    const half = (parseFloat(this.rotor.style.width) || 0) / 2;
    if (typeof a.wrapOffset === 'number') {
      this.rotor.style.left = `${Math.round(cmToPx(a.wrapOffset)) + half}px`;
    } else if (a.wrapAlign === 'right') {
      this.rotor.style.left = `calc(100% - ${half}px)`;
    } else if (a.wrapAlign !== 'center') {
      this.rotor.style.left = `${half}px`;
    }
  }

  // The resize/rotate handles and the badge — always ours, never ProseMirror's.
  private isOwnUi(t: EventTarget | null): boolean {
    return (
      t instanceof HTMLElement &&
      (t.classList.contains('image-resize-handle') ||
        t.classList.contains('image-rotate-handle') ||
        t === this.badge)
    );
  }

  // Frame hit test: the border plus a few px of the inner padding ring
  // select the box; anywhere further inside is text area. An outline is hit where CSS
  // lets it be: on the shape but off its text. Rotation-aware (the point
  // is un-rotated into the rotor's own axes) and zoom-aware.
  private isFrameHit(e: MouseEvent): boolean {
    if (this.outline) return this.outline.contains(e.target as globalThis.Node);
    if (isLineKind(this.attrs().shapeKind)) return !!this.lineSvg?.contains(e.target as globalThis.Node);
    const r = this.rotor.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const zoom = this.dom.getBoundingClientRect().width / this.dom.offsetWidth || 1;
    const rad = (-this.attrs().rotation * Math.PI) / 180;
    const dx = (e.clientX - cx) / zoom;
    const dy = (e.clientY - cy) / zoom;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    const hw = this.rotor.offsetWidth / 2;
    const hh = this.rotor.offsetHeight / 2;
    const RING = 6;
    const inside = Math.abs(lx) <= hw + 2 && Math.abs(ly) <= hh + 2;
    const nearEdge = Math.abs(lx) >= hw - RING || Math.abs(ly) >= hh - RING;
    return inside && nearEdge;
  }

  // Whether the caret sits in this box's text — the one state in which the frame is
  // editable, and so the one in which the browser places a caret in it by itself.
  private editing(state: EditorState): boolean {
    const pos = this.getPos();
    return typeof pos === 'number' && state.selection.from > pos && state.selection.to < pos + this.node.nodeSize;
  }

  private onFrameMouseDown(e: MouseEvent): void {
    if (this.isOwnUi(e.target)) return;
    const pos = this.getPos();
    if (typeof pos !== 'number') return;
    const view = this.view;
    const already = view.state.selection instanceof NodeSelection && view.state.selection.from === pos;
    if (this.isFrameHit(e)) {
      // First ring click: block the native caret so the NodeSelection sticks (then
      // refocus, since preventDefault also drops focus). Once selected the box is
      // draggable, so a later ring drag still moves it natively.
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
      if (!already) { e.preventDefault(); view.focus(); }
      // Out of the flow there is no text position to re-anchor to, so the ring drag
      // moves the box by its own offsets instead of PM's native node move.
      if (this.attrs().wrap === 'through' || this.inZone()) {
        this.dragX = freeDragX(view, this.dom, this.attrs().wrapOffset);
        startFreeMove(e, this.dom, { ...this.node.attrs, wrapOffset: this.dragX }, by => { this.dragBy = by; this.applyWrap(); },
          offsets => { if (offsets) this.commit(offsets); });
      }
    } else if (!this.editing(view.state) || !e.isTrusted) {
      // Body click on a box nobody is editing: the frame is not editable yet, so the
      // browser places no caret in it. Do it ourselves at the click point — also for a
      // click handed on to a box behind the text, which the browser never saw.
      e.preventDefault();
      const from = pos + 1, to = pos + this.node.nodeSize - 1;
      const hit = view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos;
      const target = hit != null && hit >= from && hit <= to ? hit : from;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target)));
      view.focus();
    }
  }

  private showBadge(w: number, h: number): void {
    const cm = (px: number) => ((px * 2.54) / 96).toFixed(2);
    this.badge.textContent = `Width ${cm(w)} cm × Height ${cm(h)} cm`;
    this.badge.style.display = 'block';
  }

  private commit(attrs: Partial<TextBoxAttrs>): void {
    const pos = this.getPos();
    if (typeof pos !== 'number') return;
    const { state } = this.editor;
    const tr = state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...attrs });
    // Replacing the node's markup maps a selection of it to a caret; the frame stays selected.
    if (state.selection instanceof NodeSelection && state.selection.from === pos) tr.setSelection(NodeSelection.create(tr.doc, pos));
    this.editor.view.dispatch(tr);
  }

  // Largest width the box may take: the page text column.
  private boxMaxWidth(): number {
    const box = this.dom.closest('.tiptap') as HTMLElement | null;
    if (!box) return 10000;
    const cs = getComputedStyle(box);
    const w = box.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
    return Math.max(MIN_SIZE_PX, w || 10000);
  }

  // Drag math mirrors ImageView.startResize (zoom-aware, deltas un-rotated onto the
  // box's own axes); the committed height is a min-height, so content never clips.
  private startResize(event: MouseEvent, cfg: typeof HANDLES[number]): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.editor.isEditable) return;

    const startW = this.rotor.offsetWidth;
    const startH = this.rotor.offsetHeight;
    if (!startW || !startH) return;
    const aspect = startW / startH;
    const deg = this.attrs().rotation;
    const th = (deg * Math.PI) / 180;
    const cosT = Math.cos(th);
    const sinT = Math.sin(th);
    const zoom = this.dom.getBoundingClientRect().width / this.dom.offsetWidth || 1;
    const maxW = this.boxMaxWidth();
    const maxH = pageContentHeightPx(this.dom);
    const sx = event.clientX;
    const sy = event.clientY;
    const win = this.dom.ownerDocument.defaultView ?? window;
    let lastW = startW;
    let lastH = startH;
    let moved = false;
    this.resizing = true;

    const move = (e: MouseEvent): void => {
      if (!e.buttons) { finish(); return; }
      const dx = (e.clientX - sx) / zoom;
      const dy = (e.clientY - sy) / zoom;
      const lx = dx * cosT + dy * sinT;
      const ly = -dx * sinT + dy * cosT;
      if (cfg.aspect) {
        let w = clamp(startW + cfg.x * lx, MIN_SIZE_PX, maxW);
        let h = w / aspect;
        if (h > maxH) { h = maxH; w = h * aspect; }
        lastW = Math.round(w);
        lastH = Math.round(h);
      } else {
        if (cfg.x) lastW = Math.round(clamp(startW + cfg.x * lx, MIN_SIZE_PX, maxW));
        if (cfg.y) lastH = Math.round(clamp(startH + cfg.y * ly, MIN_SIZE_PX, maxH));
      }
      moved = true;
      this.rotor.style.width = `${lastW}px`;
      this.applyHeight(lastH);
      this.applyShapeInset();
      this.fitWrapper();
      this.showBadge(lastW, lastH);
    };
    const finish = (): void => {
      win.removeEventListener('mousemove', move);
      win.removeEventListener('mouseup', finish);
      this.badge.style.display = 'none';
      this.resizing = false;
      if (moved) this.commit({ width: lastW, height: lastH });
    };
    win.addEventListener('mousemove', move);
    win.addEventListener('mouseup', finish);
  }

  private startRotate(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.editor.isEditable) return;

    const rect = this.dom.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const win = this.dom.ownerDocument.defaultView ?? window;
    let lastDeg = this.attrs().rotation;
    let moved = false;

    const move = (e: MouseEvent): void => {
      if (!e.buttons) { finish(); return; }
      let ang = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
      if (e.shiftKey) ang = Math.round(ang / 15) * 15;
      lastDeg = ((Math.round(ang) % 360) + 360) % 360;
      moved = true;
      this.rotor.style.transform = `translate(-50%, -50%) rotate(${lastDeg}deg)`;
      this.fitWrapper();
    };
    const finish = (): void => {
      win.removeEventListener('mousemove', move);
      win.removeEventListener('mouseup', finish);
      if (moved) this.commit({ rotation: lastDeg });
    };
    win.addEventListener('mousemove', move);
    win.addEventListener('mouseup', finish);
  }

  // Drag one end of a line while the other stays put, as both word processors do. The
  // frame is the two ends' bounding box and the flips say which corner starts; a rotated
  // line's ends are rotated into it. Out of the flow the box's corner moves with them.
  private startEndpoint(event: MouseEvent, end: 'start' | 'end'): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.editor.isEditable) return;
    const a = this.attrs();
    const w = a.width ?? DEFAULT_WIDTH_PX;
    const h = a.height ?? DEFAULT_LINE_HEIGHT_PX;
    const th = (a.rotation * Math.PI) / 180;
    const turn = ([x, y]: number[]) => [
      w / 2 + (x - w / 2) * Math.cos(th) - (y - h / 2) * Math.sin(th),
      h / 2 + (x - w / 2) * Math.sin(th) + (y - h / 2) * Math.cos(th),
    ];
    const p0 = [a.flipH ? w : 0, a.flipV ? h : 0];
    const ends = [turn(p0), turn([w - p0[0], h - p0[1]])];
    const [moving, fixed] = end === 'start' ? [ends[0], ends[1]] : [ends[1], ends[0]];
    const free = a.wrap === 'through' || this.inZone();
    const view = this.view;
    if (free) this.dragX = freeDragX(view, this.dom, a.wrapOffset);
    const zoom = this.dom.getBoundingClientRect().width / this.dom.offsetWidth || 1;
    const cm = (px: number) => Math.round((px * 2.54 * 1000) / 96) / 1000;
    const sx = event.clientX;
    const sy = event.clientY;
    const win = this.dom.ownerDocument.defaultView ?? window;
    let geo: Partial<TextBoxAttrs> | null = null;
    let by = { x: 0, y: 0 };
    this.resizing = true;

    const move = (e: MouseEvent): void => {
      if (!e.buttons) { finish(); return; }
      let dx = moving[0] + (e.clientX - sx) / zoom - fixed[0];
      let dy = moving[1] + (e.clientY - sy) / zoom - fixed[1];
      if (e.shiftKey) {
        const len = Math.hypot(dx, dy);
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        dx = len * Math.cos(ang);
        dy = len * Math.sin(ang);
      }
      const p = [fixed[0] + dx, fixed[1] + dy];
      const [s, t] = end === 'start' ? [p, fixed] : [fixed, p];
      const nw = Math.round(Math.abs(t[0] - s[0]));
      const nh = Math.round(Math.abs(t[1] - s[1]));
      if (!nw && !nh) return;
      geo = { width: nw, height: nh, flipH: s[0] > t[0], flipV: s[1] > t[1], rotation: 0 };
      by = { x: cm(Math.min(s[0], t[0])), y: cm(Math.min(s[1], t[1])) };
      this.preview = geo;
      if (free) this.dragBy = by;
      this.applyAll();
      this.showBadge(nw, nh);
    };
    const finish = (): void => {
      win.removeEventListener('mousemove', move);
      win.removeEventListener('mouseup', finish);
      this.badge.style.display = 'none';
      this.resizing = false;
      this.preview = null;
      this.dragBy = null;
      if (!geo) return;
      const y = a.wrapOffsetY;
      this.commit(free
        ? { ...geo, wrapOffset: this.dragX + by.x, wrapOffsetY: (typeof y === 'number' ? y : 0) + by.y }
        : geo);
    };
    win.addEventListener('mousemove', move);
    win.addEventListener('mouseup', finish);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    // Everything applyAll writes comes from the attrs; text typed inside the box carries
    // the same attrs object, and the observer refits what that grows.
    const drawn = node.attrs === this.node.attrs;
    this.node = node;
    // Never touch contentDOM children — ProseMirror owns them.
    if (!this.resizing && !drawn) this.applyAll();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('textbox-selected');
    // Draggable only while node-selected, so selecting text inside the box never
    // starts a native drag.
    this.dom.draggable = true;
  }

  deselectNode(): void {
    this.dom.classList.remove('textbox-selected');
    this.dom.draggable = false;
  }

  ignoreMutation(m: MutationRecord | { type: 'selection'; target: globalThis.Node }): boolean {
    // The ellipse inset padding we write to contentDOM is our own styling, not a content
    // edit — without this PM rebuilds the node view mid-resize and the wrapper collapses.
    if (m.type === 'attributes' && m.target === this.contentDOM) return true;
    return !this.contentDOM.contains(m.target);
  }

  // Mouse events on the frame ring/handles are ours (selection, resize, rotate);
  // clicks further inside pass through so ProseMirror places the caret and edits.
  stopEvent(event: Event): boolean {
    if (!event.type.startsWith('mouse')) return false;
    if (this.isOwnUi(event.target)) return true;
    // Every mouse event on a frame nobody is editing is ours: onFrameMouseDown has
    // placed the selection already, and ProseMirror would put it somewhere else.
    return this.isFrameHit(event as MouseEvent) || !this.editing(this.editor.state);
  }

  // What the shared observer reports, so nothing here reads the rotor back: one
  // frame's write between two reads is a forced layout per frame in the document.
  refit(size: Size): void {
    this.resolvePreset(size);
    this.applyShapeInset(size);
    this.fitWrapper(size);
    // A right float's margin is computed from the wrapper width just set.
    this.applyWrap();
  }

  destroy(): void {
    unobserveFit(this.rotor);
  }
}

export type TextBoxDebugEntry = {
  pos: number;
  attrs: TextBoxAttrs;
  textPreview: string;
  // What the node view actually rendered — to compare against the attrs when a
  // fill/stroke round-trips wrong (e.g. a stray blue background on import).
  rendered: { background: string; border: string } | null;
};

// Every textBox node's attrs plus its live rendered fill/stroke, for the dev Debug
// dump. Reads the .textbox-rotor's computed style via the view's DOM lookup.
// The inset ring as CSS: its top and bottom where the file gives them apart.
function ringCss(a: TextBoxAttrs): string {
  const px = (cm: number | null) => `${paddingPx(cm ?? a.paddingCm).toFixed(2)}px`;
  return `${px(a.paddingTopCm)} ${px(null)} ${px(a.paddingBottomCm)}`;
}

// The document with every growing box as tall as it renders. A .docx box keeps its extent
// in Word and LibreOffice alike (a:spAutoFit makes LibreOffice draw the text detached,
// probed), so the file has to carry the height the text has grown it to.
export function withRenderedBoxHeights(view: EditorView): ReturnType<PMNode['toJSON']> {
  const tr = view.state.tr;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'textBox') return true;
    const rotor = (view.nodeDOM(pos) as HTMLElement | null)?.querySelector?.<HTMLElement>('.textbox-rotor');
    const h = rotor?.offsetHeight ?? 0;
    if (!node.attrs.fixedHeight && h > (node.attrs.height ?? 0) + 0.5) tr.setNodeAttribute(pos, 'height', h);
    return false;
  });
  return tr.doc.toJSON();
}

export function getTextBoxDebug(view: EditorView): TextBoxDebugEntry[] {
  const out: TextBoxDebugEntry[] = [];
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'textBox') return;
    let rendered: TextBoxDebugEntry['rendered'] = null;
    const dom = view.nodeDOM(pos);
    const rotor = dom instanceof HTMLElement ? dom.querySelector('.textbox-rotor') : null;
    if (rotor && typeof getComputedStyle === 'function') {
      const cs = getComputedStyle(rotor);
      rendered = { background: cs.backgroundColor, border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}` };
    }
    out.push({
      pos,
      attrs: node.attrs as TextBoxAttrs,
      textPreview: (node.textContent ?? '').slice(0, 80),
      rendered,
    });
  });
  return out;
}

// A selected text box is one node whose range covers its own paragraphs, so the command
// would align the box's contents along with the block holding it — moving the frame and
// re-setting its text in one keystroke. With the frame selected only the block it sits
// in is meant; the caret inside the box still aligns that text.
export const TextAlignInFrames = TextAlign.extend({
  addCommands() {
    const base = this.parent?.() ?? {};
    const onBox = (align: string | null) => (props: CommandProps) =>
      props.state.selection instanceof NodeSelection
      && props.state.selection.node.type.name === 'textBox'
      && props.chain().setTextBoxAlign(align).run();
    return {
      ...base,
      setTextAlign: (align: string) => (props: CommandProps) =>
        onBox(align)(props) || base.setTextAlign!(align)(props),
      unsetTextAlign: () => (props: CommandProps) =>
        onBox(null)(props) || base.unsetTextAlign!()(props),
    };
  },
});
