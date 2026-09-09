import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { bookmarks, findBookmark, type BookmarkRef } from './bookmark';
import { pageOfElement, scheduleFieldRound, type FieldWrite, type PageGrid, type VMargins } from './pageBreaks';

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

// The reference's text now: the bookmark's own text, or the page it renders on. A
// bookmark that no longer exists leaves the cached text alone (Word shows its cached
// result too until the field is updated).
function resolveText(view: EditorView, node: PMNode, target: BookmarkRef | undefined, grid: () => PageGrid): string {
  const cached = String(node.attrs.text ?? '');
  if (!target) return cached;
  if (node.attrs.format !== 'page') return target.text;
  const at = view.domAtPos(target.from).node;
  const el = (at.nodeType === 1 ? at : at.parentElement) as HTMLElement | null;
  return el ? String(pageOfElement(view, el, grid())) : cached;
}

// Every reference of one editor resolves in one go, on each pagination settle
// (pm-pagecount) and on a change to any of them: one bookmark scan, and every page read
// in the field round's measuring phase, before any text of the round is written.
class CrossRefBatch {
  private views = new Set<CrossRefView>();
  private listening = false;

  constructor(private editor: Editor) {}

  add(view: CrossRefView): void {
    this.views.add(view);
    this.schedule();
  }

  remove(view: CrossRefView): void {
    this.views.delete(view);
  }

  schedule(): void {
    if (this.editor.isDestroyed) return;
    scheduleFieldRound(this.editor.view, this, (vm) => this.measure(vm));
  }

  private measure(vm: VMargins): FieldWrite | void {
    const { editor } = this;
    if (editor.isDestroyed) return;
    const view = editor.view;
    if (!this.listening) {
      this.listening = true;
      view.dom.addEventListener('pm-pagecount', () => this.schedule());
    }
    const targets = new Map<string, BookmarkRef>();
    for (const b of bookmarks(editor.state.doc)) if (!targets.has(b.name)) targets.set(b.name, b);
    const gridOf = () => vm.grid;
    const jobs: { ref: CrossRefView; node: PMNode; pos: number; text: string }[] = [];
    for (const ref of this.views) {
      const pos = ref.pos();
      const node = pos === null ? null : editor.state.doc.nodeAt(pos);
      if (pos === null || !node || node.type.name !== 'crossRef' || !ref.dom.isConnected) continue;
      jobs.push({ ref, node, pos, text: resolveText(view, node, targets.get(String(node.attrs.name ?? '')), gridOf) });
    }
    return (tr) => {
      for (const j of jobs) j.ref.paint(j.node, j.text);
      for (const j of jobs) {
        if (j.text !== j.node.attrs.text) tr.setNodeAttribute(j.pos, 'text', j.text);
      }
    };
  }
}

const batches = new WeakMap<Editor, CrossRefBatch>();

function batchFor(editor: Editor): CrossRefBatch {
  let batch = batches.get(editor);
  if (!batch) batches.set(editor, (batch = new CrossRefBatch(editor)));
  return batch;
}

// Node view: shows what the batch resolves; a modifier-click jumps to the bookmark.
class CrossRefView {
  dom: HTMLElement;
  private editor: Editor;
  private getPos: () => number;
  private batch: CrossRefBatch;

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

    this.batch = batchFor(editor);
    this.batch.add(this);
  }

  pos(): number | null {
    const pos = this.getPos();
    return typeof pos === 'number' ? pos : null;
  }

  private node(): PMNode | null {
    const pos = this.pos();
    const node = pos === null ? null : this.editor.state.doc.nodeAt(pos);
    return node?.type.name === 'crossRef' ? node : null;
  }

  // Mirror what renderHTML would emit, so the DOM reads the same with or without the view.
  paint(node: PMNode | null, text = String(node?.attrs?.text ?? '')): void {
    this.dom.dataset.crossRef = String(node?.attrs?.name ?? '');
    this.dom.dataset.format = node?.attrs?.format === 'page' ? 'page' : 'text';
    this.dom.dataset.text = text;
    this.dom.textContent = text;
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
    this.batch.schedule();
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
    this.batch.remove(this);
  }
}
