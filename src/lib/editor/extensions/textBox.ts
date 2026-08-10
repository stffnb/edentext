import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, Plugin } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { HANDLES, MIN_SIZE_PX, clamp, parsePx, frameMargins, pageContentHeightPx, type WrapMode } from './image';

// cm attribute value → number, for the frame offsets (px ones use parsePx).
const parseCmAttr = (v: string | null): number | null => {
  const n = v == null ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// A text box / basic shape: a block-level frame with editable block content, a fill, a
// stroke, and the image's wrap model (inline = in-flow; left/right/topBottom float).
// Round-trips to ODF <draw:frame>/<draw:text-box>/<draw:custom-shape> and DOCX <wps:wsp>.

export type ShapeKind = 'textbox' | 'roundRect' | 'ellipse';

// Fixed text inset inside the frame; exported as fo:padding / wps:bodyPr insets.
export const TEXTBOX_PADDING_CM = 0.15;
const paddingPx = (cm: unknown) => ((typeof cm === 'number' ? cm : TEXTBOX_PADDING_CM) * 96) / 2.54;

// Extra per-axis inset that fits the text area into an ellipse's inscribed
// rectangle (half-axis / √2), so text follows the oval instead of the bbox.
const ELLIPSE_INSET_RATIO = (1 - 1 / Math.SQRT2) / 2;

const DEFAULT_WIDTH_PX = 280;
const DEFAULT_HEIGHT_PX = 96;
const PX_PER_PT = 96 / 72;

export interface TextBoxAttrs {
  width: number | null;
  height: number | null;
  rotation: number;
  wrap: WrapMode;
  wrapOffset: number | null;  // cm from the text column's left edge
  wrapOffsetY: number | null; // cm below the anchor paragraph
  wrapAlign: string | null;   // 'center'/'right' = set against the middle/far end
  paddingCm: number;          // inset ring around the text (ODF fo:padding)
  shapeKind: ShapeKind;
  fillColor: string | null;
  strokeColor: string | null;
  strokeWidthPt: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textBox: {
      insertTextBox: () => ReturnType;
      setTextBoxAttrs: (attrs: Partial<TextBoxAttrs>) => ReturnType;
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

function shapeRadius(kind: ShapeKind): string {
  return kind === 'ellipse' ? '50%' : kind === 'roundRect' ? '8px' : '0';
}

export const TextBox = Node.create({
  name: 'textBox',
  // Own group (not `block`): only the doc admits it, so it can't nest in table
  // cells, list items, or other text boxes.
  group: 'textBox',
  content: '(paragraph | heading | bulletList | orderedList)+',
  isolating: true,
  defining: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      // px @96dpi like the image; height is a min-height (content never clips).
      width: {
        default: null,
        parseHTML: el => parsePx((el as HTMLElement).style.width),
        renderHTML: () => ({}),
      },
      height: {
        default: null,
        parseHTML: el => parsePx((el as HTMLElement).style.minHeight),
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
      shapeKind: {
        default: 'textbox',
        parseHTML: el => (el as HTMLElement).getAttribute('data-shape') ?? 'textbox',
        renderHTML: () => ({}),
      },
      fillColor: {
        default: '#FFFFFF',
        parseHTML: el => (el as HTMLElement).getAttribute('data-fill') || null,
        renderHTML: () => ({}),
      },
      strokeColor: {
        default: '#000000',
        parseHTML: el => (el as HTMLElement).getAttribute('data-stroke') || null,
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
    return [{ tag: 'div[data-textbox]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const a = node.attrs as TextBoxAttrs;
    const style = [
      a.width ? `width:${a.width}px` : '',
      a.height ? `min-height:${a.height}px` : '',
      a.fillColor ? `background:${a.fillColor}` : '',
      a.strokeColor ? `border:${a.strokeWidthPt * PX_PER_PT}px solid ${a.strokeColor}` : '',
      a.shapeKind !== 'textbox' ? `border-radius:${shapeRadius(a.shapeKind)}` : '',
      a.rotation ? `transform:rotate(${a.rotation}deg)` : '',
      `padding:${paddingPx(a.paddingCm).toFixed(2)}px`,
    ].filter(Boolean).join(';');
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-textbox': '',
      style,
      ...(a.rotation ? { 'data-rotation': String(a.rotation) } : {}),
      ...(a.wrap !== 'inline' ? { 'data-wrap': a.wrap } : {}),
      ...(a.shapeKind !== 'textbox' ? { 'data-shape': a.shapeKind } : {}),
      ...(a.fillColor ? { 'data-fill': a.fillColor } : {}),
      ...(a.strokeColor ? { 'data-stroke': a.strokeColor } : {}),
      ...(a.strokeWidthPt !== 1 ? { 'data-stroke-width': String(a.strokeWidthPt) } : {}),
      ...(a.paddingCm !== TEXTBOX_PADDING_CM ? { 'data-padding': String(a.paddingCm) } : {}),
    }), 0];
  },

  addCommands() {
    return {
      // Insert a fresh text box after the current top-level block, cursor inside.
      insertTextBox:
        () =>
        ({ state, dispatch }) => {
          const type = state.schema.nodes.textBox;
          const para = state.schema.nodes.paragraph?.createAndFill();
          if (!type || !para) return false;
          const { $from } = state.selection;
          const pos = $from.depth >= 1 ? $from.after(1) : state.selection.from;
          if (dispatch) {
            const box = type.create({ width: DEFAULT_WIDTH_PX, height: DEFAULT_HEIGHT_PX }, para);
            const tr = state.tr.insert(pos, box);
            tr.setSelection(TextSelection.create(tr.doc, pos + 2));
            dispatch(tr.scrollIntoView());
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
            dispatch(state.tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, ...attrs }));
          }
          return true;
        },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => new TextBoxView(node as PMNode, editor, getPos as () => number);
  },

  // Show the resize frame + handles (via .textbox-active) whenever the caret sits
  // inside a box, so a plain click into it reveals the editing frame like an image.
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const { from, to } = state.selection;
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'textBox') return false;
              if (from >= pos && to <= pos + node.nodeSize) {
                decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'textbox-active' }));
              }
              return false;
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

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
  private getPos: () => number;
  private observer: ResizeObserver | null = null;
  private resizing = false;
  // Last ellipse text-area inset applied; guards the ResizeObserver feedback loop.
  private lastInsetX = -1;
  private lastInsetY = -1;

  constructor(node: PMNode, editor: Editor, getPos: () => number) {
    this.node = node;
    this.editor = editor;
    this.getPos = getPos;

    this.dom = document.createElement('div');
    this.dom.className = 'textbox-node';

    this.rotor = document.createElement('div');
    this.rotor.className = 'textbox-rotor';

    // Padding lives on the rotor, so the inset ring around the text is frame
    // (click-to-select) area rather than content.
    this.rotor.style.padding = `${paddingPx(this.attrs().paddingCm).toFixed(2)}px`;
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
    this.observer = new ResizeObserver(() => {
      this.applyShapeInset();
      this.fitWrapper();
    });
    this.observer.observe(this.rotor);

    this.applyAll();
  }

  private attrs(): TextBoxAttrs {
    return this.node.attrs as TextBoxAttrs;
  }

  private applyAll(): void {
    const a = this.attrs();
    this.rotor.style.width = a.width ? `${a.width}px` : `${DEFAULT_WIDTH_PX}px`;
    this.rotor.style.minHeight = a.height ? `${a.height}px` : '';
    this.rotor.style.background = a.fillColor ?? 'transparent';
    this.rotor.style.border = a.strokeColor
      ? `${a.strokeWidthPt * PX_PER_PT}px solid ${a.strokeColor}`
      : 'none';
    this.rotor.style.borderRadius = shapeRadius(a.shapeKind);
    this.rotor.style.transform = `translate(-50%, -50%) rotate(${a.rotation}deg)`;
    this.applyWrap();
    this.applyShapeInset();
    this.fitWrapper();
  }

  // For an ellipse, pad the content into the inscribed rectangle so text stays inside
  // the oval. The vertical inset feeds back into the auto-grown height, so rewrite it
  // only past a threshold — the ResizeObserver then settles (ratio < 0.5 converges).
  private applyShapeInset(): void {
    if (this.attrs().shapeKind !== 'ellipse') {
      if (this.contentDOM.style.padding) this.contentDOM.style.padding = '';
      this.lastInsetX = this.lastInsetY = -1;
      return;
    }
    const w = this.rotor.offsetWidth;
    const h = this.rotor.offsetHeight;
    if (!w || !h) return;
    const insetX = w * ELLIPSE_INSET_RATIO;
    const insetY = h * ELLIPSE_INSET_RATIO;
    if (Math.abs(insetX - this.lastInsetX) < 0.5 && Math.abs(insetY - this.lastInsetY) < 0.5) return;
    this.lastInsetX = insetX;
    this.lastInsetY = insetY;
    this.contentDOM.style.padding = `${insetY.toFixed(2)}px ${insetX.toFixed(2)}px`;
  }

  // Size the wrapper to the rotor's rotated bounding box so surrounding text
  // reserves the right space (same math as ImageView.applyLayout).
  private fitWrapper(): void {
    const w = this.rotor.offsetWidth;
    const h = this.rotor.offsetHeight;
    if (!w || !h) return;
    const rad = (this.attrs().rotation * Math.PI) / 180;
    const bw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
    const bh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
    this.dom.style.width = `${bw}px`;
    this.dom.style.height = `${bh}px`;
  }

  // Float per wrap mode, exactly like ImageView.applyWrap. 'inline' and 'topBottom'
  // both render in-flow for a block-level box (they differ only in export anchoring).
  private applyWrap(): void {
    const d = this.dom;
    const a = this.attrs();
    d.style.float = '';
    d.style.clear = '';
    d.style.margin = frameMargins('topBottom', a.wrap === 'topBottom' ? a.wrapOffset : null, 0);
    if (a.wrap === 'left' || a.wrap === 'right') {
      d.style.float = a.wrap;
      d.style.margin = frameMargins(a.wrap, a.wrapOffset, parseFloat(d.style.width) || 0);
    } else if (a.wrap === 'topBottom') {
      d.style.clear = 'both';
    }
    // The anchor paragraph's spacing, which a lifted box stands in for: space above as
    // padding so it adds to the block above (editor.css), space below as the margin the
    // frame distance already is.
    const before = this.node.attrs.spaceBefore as number | null;
    const after = this.node.attrs.spaceAfter as number | null;
    // On the rotor too: --space-before is a registered non-inheriting property, and the
    // rotor centres itself in the padding box, so it needs the value to correct for it.
    for (const el of [d, this.rotor]) {
      if (before != null) el.style.setProperty('--space-before', `${before}pt`);
      else el.style.removeProperty('--space-before');
    }
    if (after != null) d.style.marginBottom = `${after}pt`;
    // Set against the middle or the far end of the column, unless the file placed the
    // box by coordinate.
    if ((a.wrapAlign === 'center' || a.wrapAlign === 'right')
        && a.wrapOffset == null && a.wrap !== 'left' && a.wrap !== 'right') {
      d.style.marginLeft = 'auto';
      if (a.wrapAlign === 'center') d.style.marginRight = 'auto';
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
  // select the box; anywhere further inside is text area. Rotation-aware (the point
  // is un-rotated into the rotor's own axes) and zoom-aware.
  private isFrameHit(e: MouseEvent): boolean {
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

  private onFrameMouseDown(e: MouseEvent): void {
    if (this.isOwnUi(e.target)) return;
    const pos = this.getPos();
    if (typeof pos !== 'number') return;
    const view = this.editor.view;
    const already = view.state.selection instanceof NodeSelection && view.state.selection.from === pos;
    if (this.isFrameHit(e)) {
      // First ring click: block the native caret so the NodeSelection sticks (then
      // refocus, since preventDefault also drops focus). Once selected the box is
      // draggable, so a later ring drag still moves it natively.
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
      if (!already) { e.preventDefault(); view.focus(); }
    } else if (already) {
      // Body click on an object-selected (draggable) box: the browser won't place a
      // caret, so do it ourselves at the click point to enter text editing.
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
    this.editor.view.dispatch(this.editor.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...attrs }));
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
    const maxH = pageContentHeightPx();
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
      this.rotor.style.minHeight = `${lastH}px`;
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

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    // Never touch contentDOM children — ProseMirror owns them.
    if (!this.resizing) this.applyAll();
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
    return this.isFrameHit(event as MouseEvent);
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
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
