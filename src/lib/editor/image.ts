import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { dropCursor } from '@tiptap/pm/dropcursor';

// Inline, as-character image (Word's "in line with text"). width/height are
// unscaled document px @96dpi (like tableRow.ts rowHeight); export converts them
// to cm and import back, so size round-trips exactly. Position is fully determined
// by the paragraph + text offset + the paragraph's alignment — no free coordinates.
// The node view adds corner resize handles (aspect-locked, zoom-aware).

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      setImage: (attrs: { src: string; alt?: string; width?: number | null; height?: number | null }) => ReturnType;
    };
  }
}

const MIN_SIZE_PX = 24;

function parsePx(value: string | null): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export const Image = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: '' },
      // px @96dpi; rendered as inline style (not width/height attrs) so the
      // value stays in one place for the node view to drive.
      width: {
        default: null,
        parseHTML: el => parsePx(el.getAttribute('width') ?? (el as HTMLElement).style.width),
        renderHTML: () => ({}),
      },
      height: {
        default: null,
        parseHTML: el => parsePx(el.getAttribute('height') ?? (el as HTMLElement).style.height),
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const w = node.attrs.width as number | null;
    const h = node.attrs.height as number | null;
    const style = [w ? `width:${w}px` : '', h ? `height:${h}px` : ''].filter(Boolean).join(';');
    return ['img', mergeAttributes(HTMLAttributes, style ? { style } : {})];
  },

  addCommands() {
    return {
      setImage:
        attrs =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => new ImageView(node as PMNode, editor, getPos as () => number);
  },

  // Dragging the image runs ProseMirror's native node move; the drop cursor paints
  // a caret at the would-be drop position so the user sees where it lands (like Word).
  addProseMirrorPlugins() {
    return [dropCursor({ color: '#3b82f6', width: 2 })];
  },
});

// Node view: <img> wrapped in an inline-block span with four corner handles shown
// while the node is selected. Mirrors the zoom trick from tableRowResize.ts
// (offset size is unscaled, getBoundingClientRect is scaled → ratio is the zoom).
class ImageView {
  dom: HTMLElement;
  private img: HTMLImageElement;
  private node: PMNode;
  private editor: Editor;
  private getPos: () => number;

  constructor(node: PMNode, editor: Editor, getPos: () => number) {
    this.node = node;
    this.editor = editor;
    this.getPos = getPos;

    this.dom = document.createElement('span');
    this.dom.className = 'image-node';

    this.img = document.createElement('img');
    this.img.src = (node.attrs.src as string) ?? '';
    this.img.alt = (node.attrs.alt as string) ?? '';
    this.applySize();
    this.dom.appendChild(this.img);

    for (const corner of ['nw', 'ne', 'sw', 'se'] as const) {
      const handle = document.createElement('span');
      handle.className = `image-resize-handle image-resize-${corner}`;
      handle.addEventListener('mousedown', e => this.startResize(e as MouseEvent, corner));
      this.dom.appendChild(handle);
    }
  }

  private applySize(): void {
    const w = this.node.attrs.width as number | null;
    const h = this.node.attrs.height as number | null;
    this.img.style.width = w ? `${w}px` : '';
    this.img.style.height = h ? `${h}px` : '';
  }

  private startResize(event: MouseEvent, corner: 'nw' | 'ne' | 'sw' | 'se'): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.editor.isEditable) return;

    const startX = event.clientX;
    const startW = this.img.offsetWidth;
    const startH = this.img.offsetHeight;
    if (!startW || !startH) return;
    const aspect = startW / startH;
    const zoom = this.img.getBoundingClientRect().width / startW || 1;
    // Left-side corners grow when dragged left; right-side corners when dragged right.
    const dirX = corner === 'ne' || corner === 'se' ? 1 : -1;
    // Never wider than the containing cell, or the page text column outside tables.
    // clientWidth/padding are unscaled layout px, matching our doc-px sizing.
    const box = (this.dom.closest('td,th') ?? this.dom.closest('.tiptap')) as HTMLElement | null;
    let maxW = startW;
    if (box) {
      const cs = getComputedStyle(box);
      maxW = box.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
    }
    maxW = Math.max(MIN_SIZE_PX, maxW || startW);
    const win = this.dom.ownerDocument.defaultView ?? window;

    let lastW = startW;
    let lastH = startH;
    let moved = false;

    const move = (e: MouseEvent): void => {
      if (!e.buttons) {
        finish();
        return;
      }
      const dx = ((e.clientX - startX) / zoom) * dirX;
      lastW = Math.max(MIN_SIZE_PX, Math.min(maxW, Math.round(startW + dx)));
      lastH = Math.max(MIN_SIZE_PX, Math.round(lastW / aspect));
      moved = true;
      this.img.style.width = `${lastW}px`;
      this.img.style.height = `${lastH}px`;
    };

    const finish = (): void => {
      win.removeEventListener('mousemove', move);
      win.removeEventListener('mouseup', finish);
      if (!moved) return;
      const pos = this.getPos();
      if (typeof pos !== 'number') return;
      this.editor.view.dispatch(
        this.editor.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, width: lastW, height: lastH }),
      );
    };

    win.addEventListener('mousemove', move);
    win.addEventListener('mouseup', finish);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    const src = (node.attrs.src as string) ?? '';
    if (this.img.getAttribute('src') !== src) this.img.src = src;
    this.img.alt = (node.attrs.alt as string) ?? '';
    this.applySize();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('image-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('image-selected');
  }

  // Atom node: no ProseMirror-managed content. Ignore the <img> load and our own
  // size/handle pokes so PM doesn't try to re-read the DOM.
  ignoreMutation(): boolean {
    return true;
  }

  // Keep ProseMirror out of resize-handle interactions so the drag isn't hijacked
  // into a node drag or selection change.
  stopEvent(event: Event): boolean {
    const t = event.target as HTMLElement | null;
    return event.type.startsWith('mouse') && !!t?.classList?.contains('image-resize-handle');
  }
}
