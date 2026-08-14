import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { findBookmark } from './bookmark';
import { readVerticalMargins, pageOfElement } from './pageBreaks';

// A cross-reference: an inline atom showing either the text of a bookmark or the page it
// sits on, kept live by the node view the way the TOC keeps its page numbers. Round-trips
// to ODF text:bookmark-ref and DOCX REF/PAGEREF fields.

export type CrossRefFormat = 'text' | 'page';

// Fired by the context menu; ToolbarExpanded owns the dialog (as it does for links).
export const OPEN_CROSS_REF_DIALOG_EVENT = 'odf-open-cross-ref-dialog';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    crossReference: {
      insertCrossRef: (opts: { name: string; format: CrossRefFormat }) => ReturnType;
    };
  }
}

export const CrossReference = Node.create({
  name: 'crossRef',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-cross-ref') || '',
        renderHTML: (attrs) => ({ 'data-cross-ref': String(attrs.name ?? '') }),
      },
      format: {
        default: 'text' as CrossRefFormat,
        parseHTML: (el) => (el.getAttribute('data-format') === 'page' ? 'page' : 'text'),
        renderHTML: (attrs) => ({ 'data-format': attrs.format === 'page' ? 'page' : 'text' }),
      },
      // The last resolved display text, persisted like a Word field's cached result: it
      // is what a reference to a deleted bookmark keeps showing.
      text: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-text') ?? el.textContent ?? '',
        renderHTML: (attrs) => ({ 'data-text': String(attrs.text ?? '') }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-cross-ref]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), String(node.attrs.text ?? '')];
  },

  renderText({ node }) {
    return String(node.attrs.text ?? '');
  },

  addCommands() {
    return {
      insertCrossRef:
        ({ name, format }) =>
        ({ commands, state }) => {
          if (!name) return false;
          const found = findBookmark(state.doc, name);
          // Adopt the cursor's marks so the atom renders like the surrounding text.
          const marks = (state.storedMarks ?? state.selection.$to.marks())
            .filter((m) => m.type.name !== 'bookmark')
            .map((m) => ({ type: m.type.name, attrs: m.attrs }));
          return commands.insertContent({
            type: this.name,
            attrs: { name, format, text: format === 'page' ? '1' : (found?.text ?? name) },
            ...(marks.length ? { marks } : {}),
          });
        },
    };
  },

  addNodeView() {
    return ({ editor, getPos }) => new CrossRefView(editor, getPos as () => number);
  },
});

// Node view: repaints from the live bookmark on each pagination settle (pm-pagecount on
// the .paper ancestor) and on doc change, writing the resolved text back to the attr —
// guarded against a loop by comparing with what the node already holds.
class CrossRefView {
  dom: HTMLElement;
  private editor: Editor;
  private getPos: () => number;
  private scheduled = false;
  private paper: HTMLElement | null = null;
  private onPageCount = () => this.schedule();

  constructor(editor: Editor, getPos: () => number) {
    this.editor = editor;
    this.getPos = getPos;

    this.dom = document.createElement('span');
    this.dom.className = 'cross-ref';
    this.dom.setAttribute('contenteditable', 'false');
    this.paint(this.node());
    this.dom.addEventListener('mousedown', (ev) => {
      if (!(ev.metaKey || ev.ctrlKey)) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.goTo();
    });

    requestAnimationFrame(() => {
      this.paper = this.dom.closest('.paper') as HTMLElement | null;
      this.paper?.addEventListener('pm-pagecount', this.onPageCount);
      this.render();
    });
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.render();
    });
  }

  private node(): PMNode | null {
    const pos = this.getPos();
    const node = typeof pos === 'number' ? this.editor.state.doc.nodeAt(pos) : null;
    return node?.type.name === 'crossRef' ? node : null;
  }

  // The reference's text now: the bookmark's own text, or the page it renders on. A
  // bookmark that no longer exists leaves the cached text alone (Word shows its cached
  // result too until the field is updated).
  private resolve(node: PMNode): string {
    const found = findBookmark(this.editor.state.doc, String(node.attrs.name ?? ''));
    if (!found) return String(node.attrs.text ?? '');
    if (node.attrs.format !== 'page') return found.text;
    const at = this.editor.view.domAtPos(found.from).node;
    const el = (at.nodeType === 1 ? at : at.parentElement) as HTMLElement | null;
    if (!el) return String(node.attrs.text ?? '');
    const { grid } = readVerticalMargins(this.editor.view.dom as HTMLElement);
    return String(pageOfElement(this.editor.view, el, grid));
  }

  // Mirror what renderHTML would emit, so the DOM reads the same with or without the view.
  private paint(node: PMNode | null, text = String(node?.attrs?.text ?? '')): void {
    this.dom.dataset.crossRef = String(node?.attrs?.name ?? '');
    this.dom.dataset.format = node?.attrs?.format === 'page' ? 'page' : 'text';
    this.dom.dataset.text = text;
    this.dom.textContent = text;
  }

  private render(): void {
    if (this.editor.isDestroyed || !this.dom.isConnected) return;
    const node = this.node();
    if (!node) return;
    const text = this.resolve(node);
    this.paint(node, text);
    if (text === node.attrs.text) return;
    const pos = this.getPos();
    if (typeof pos !== 'number') return;
    this.editor.view.dispatch(
      this.editor.state.tr.setNodeAttribute(pos, 'text', text).setMeta('addToHistory', false),
    );
  }

  // Scroll the bookmark into view and drop the cursor into it.
  private goTo(): void {
    const node = this.node();
    const found = node && findBookmark(this.editor.state.doc, String(node.attrs.name ?? ''));
    if (!found) return;
    const at = this.editor.view.domAtPos(found.from).node;
    const el = (at.nodeType === 1 ? at : at.parentElement) as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.editor.chain().focus().setTextSelection({ from: found.from, to: found.to }).run();
  }

  update(node: PMNode): boolean {
    if (node.type.name !== 'crossRef') return false;
    this.schedule();
    return true;
  }

  // Own only the modifier-click that navigates; a plain click still selects the atom so
  // it can be deleted.
  stopEvent(event: Event): boolean {
    const e = event as MouseEvent;
    return event.type.startsWith('mouse') && (e.metaKey || e.ctrlKey);
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.paper?.removeEventListener('pm-pagecount', this.onPageCount);
  }
}
