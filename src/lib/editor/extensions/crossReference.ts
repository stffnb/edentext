import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';
import { bookmarks, findBookmark, goToTarget, type BookmarkRef } from './bookmark';
import { pageOfElement, scheduleFieldRound, type FieldWrite, type PageGrid, type VMargins } from './pageBreaks';
import { blockText, headingNumbers, inCellOrItem, inlineText, type HeadingNumber } from './outline';
import { listNumberAt } from './listStyle';
import { liveText } from './trackChanges';
import { seqCategoryOf, sequenceFields, type SeqCategory } from './caption';
import { collectNoteRefs, findNoteSection, noteLabels, type NoteKind } from './notes';
import { styleSheet } from '../../styles/sheet.svelte';
import { t } from '../../i18n/i18n.svelte';
import { noteSettings } from '../../storage/notes.svelte';
import type { StyleSheet } from '../../styles/styleSheet';
import type { NoteSettings } from '../../storage/noteSettings';

// A cross-reference: an inline atom showing something about a target elsewhere in the
// document — its text, the page it sits on, its chapter or list number, or whether it
// stands above or below. The node view keeps it live the way the TOC keeps its page
// numbers. Round-trips to ODF text:bookmark-ref / -sequence-ref / -note-ref and to DOCX
// REF/PAGEREF/NOTEREF fields.

// ODF's own reference-format vocabulary (text:reference-format), which the ODF export
// writes verbatim; the DOCX export maps each to a REF switch. The three caption formats
// are only ever set on a `sequence` reference.
export type CrossRefFormat =
  | 'text' | 'page' | 'direction'
  | 'number' | 'number-no-superior' | 'number-all-superior'
  | 'category-and-value' | 'caption' | 'value';

const FORMATS: readonly CrossRefFormat[] = [
  'text', 'page', 'direction', 'number', 'number-no-superior', 'number-all-superior',
  'category-and-value', 'caption', 'value',
];

export const isCrossRefFormat = (v: unknown): v is CrossRefFormat =>
  FORMATS.includes(v as CrossRefFormat);

// Which element the reference is in its file. Every reference names a bookmark — that
// is the target the editor resolves and the one Word needs — but LibreOffice writes its
// own field for a caption and for a note, and a file carrying one keeps it.
export type CrossRefKind = 'bookmark' | 'sequence' | 'note';

export const isCrossRefKind = (v: unknown): v is CrossRefKind =>
  v === 'bookmark' || v === 'sequence' || v === 'note';

// Fired by the context menu; ToolbarExpanded owns the dialog (as it does for links).
export const OPEN_CROSS_REF_DIALOG_EVENT = 'odf-open-cross-ref-dialog';

export type CrossRefInsert = {
  /** An existing bookmark to point at; otherwise one is minted over from/to. */
  name?: string;
  from?: number;
  to?: number;
  format: CrossRefFormat;
  kind?: CrossRefKind;
  /** Separator between the levels of a full-context number (Word's \d). */
  sep?: string | null;
  /** Word's "include above/below": a second field right after the first. */
  withDirection?: boolean;
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    crossReference: {
      insertCrossRef: (opts: CrossRefInsert) => ReturnType;
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
        parseHTML: (el) => (isCrossRefFormat(el.getAttribute('data-format')) ? el.getAttribute('data-format') : 'text'),
        renderHTML: (attrs) => ({ 'data-format': isCrossRefFormat(attrs.format) ? attrs.format : 'text' }),
      },
      kind: {
        default: 'bookmark' as CrossRefKind,
        parseHTML: (el) => (isCrossRefKind(el.getAttribute('data-ref-kind')) ? el.getAttribute('data-ref-kind') : 'bookmark'),
        renderHTML: (attrs) => (attrs.kind && attrs.kind !== 'bookmark' ? { 'data-ref-kind': String(attrs.kind) } : {}),
      },
      // Word's \h switch, which makes a REF clickable there. Not offered on insert — a
      // reference is always a link, as Word's own default is — so only a file that
      // arrived without the switch carries `false`. ODF has no say and ignores it.
      link: {
        default: true,
        parseHTML: (el) => el.getAttribute('data-ref-link') !== 'false',
        renderHTML: (attrs) => (attrs.link === false ? { 'data-ref-link': 'false' } : {}),
      },
      sep: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-sep'),
        renderHTML: (attrs) => (attrs.sep ? { 'data-sep': String(attrs.sep) } : {}),
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
        (opts) =>
        ({ chain, state }) => {
          const range = typeof opts.from === 'number' && typeof opts.to === 'number' && opts.to > opts.from
            ? { from: opts.from, to: opts.to }
            : null;
          const existing = range ? adoptableBookmark(state.doc, range) : null;
          const name = opts.name || existing?.name || (range ? freshRefName(state.doc) : '');
          if (!name) return false;
          // Adopt the cursor's marks so the atom renders like the surrounding text.
          const marks = (state.storedMarks ?? state.selection.$to.marks())
            .filter((m) => m.type.name !== 'bookmark')
            .map((m) => ({ type: m.type.name, attrs: m.attrs }));
          const withMarks = <T extends object>(node: T) => (marks.length ? { ...node, marks } : node);
          const named = range ? null : findBookmark(state.doc, name);
          const shown = range ? rangeText(state.doc, range.from, range.to) : named?.text ?? name;
          // The second field's word, resolved here as well: a field round settles it, but
          // an empty one shows its bookmark's name until that round lands.
          const at = range ? range.from : named?.from;
          const direction = at == null ? ''
            : state.selection.from < at ? t().crossRef.below : t().crossRef.above;
          const attrs = {
            name,
            kind: opts.kind ?? 'bookmark',
            sep: opts.sep || null,
          };
          const content: object[] = [withMarks({
            type: this.name,
            attrs: { ...attrs, format: opts.format, text: opts.format === 'page' ? '1' : shown },
          })];
          if (opts.withDirection) {
            content.push(withMarks({ type: 'text', text: ' ' }));
            content.push(withMarks({ type: this.name, attrs: { ...attrs, format: 'direction', text: direction } }));
          }
          return chain()
            .command(({ tr }) => {
              if (range && !existing && !opts.name) {
                tr.addMark(range.from, range.to, state.schema.marks.bookmark.create({ name }));
              }
              return true;
            })
            .insertContent(content)
            .run();
        },
    };
  },

  addNodeView() {
    return ({ editor, getPos }) => new CrossRefView(editor, getPos as () => number);
  },
});

// The bookmark a reference may adopt for a range: one that covers it exactly and whose
// name means nothing else in the document. A name over a longer range or several pieces
// would show that whole range or its first piece, not the target that was picked.
export function adoptableBookmark(doc: PMNode, range: { from: number; to: number }): BookmarkRef | null {
  const all = bookmarks(doc);
  return all.find((b) => b.from === range.from && b.to === range.to
    && all.every((other) => other === b || other.name !== b.name)) ?? null;
}

// A name no bookmark in the document carries yet. Word mints `_Ref` + a number for
// every target a cross-reference dialog makes up, and hides them from its own list.
function freshRefName(doc: PMNode): string {
  const used = new Set(bookmarks(doc).map((b) => b.name));
  let n = 1;
  while (used.has(`_Ref${n}`)) n += 1;
  return `_Ref${n}`;
}

// The text a range shows, atoms spelled out — what the reference caches until the first
// field round resolves it against the bookmark.
function rangeText(doc: PMNode, from: number, to: number): string {
  let out = '';
  doc.nodesBetween(from, to, (node, pos) => {
    // An inline frame's own text sits in the blocks below it, so walk into one.
    if (!node.isInline || !node.isAtom) return true;
    if (node.isText) out += (node.text ?? '').slice(Math.max(0, from - pos), Math.max(0, to - pos));
    else if (pos >= from && pos + node.nodeSize <= to) out += inlineText(node);
    return false;
  });
  return out;
}

// --- What a reference can point at ------------------------------------------------

// The dialog's "reference type", in the order Word lists them.
export type RefTargetKind = 'heading' | 'numbered' | 'bookmark' | 'figure' | 'table' | 'footnote' | 'endnote';

export const REF_TARGET_KINDS: readonly RefTargetKind[] =
  ['heading', 'numbered', 'bookmark', 'figure', 'table', 'footnote', 'endnote'];

export type RefTarget = {
  /** Which element the file writes for it. */
  kind: CrossRefKind;
  /** The whole target: a block's content, a bookmark's range, a note's anchor. */
  from: number;
  to: number;
  /** The row the dialog lists. */
  label: string;
  /** The bookmark it already is; anything else gets one minted on insert. */
  name?: string;
  /** A caption's number field — the point the caption formats cut along. */
  seq?: { from: number; to: number };
};

// The number a heading or a numbered paragraph shows, in the three shapes a reference
// can ask for. null = the block carries no number at all.
export function numberAt(
  doc: PMNode, pos: number, format: CrossRefFormat, sep: string | null,
  sheet: StyleSheet, headings: Map<number, HeadingNumber>,
): string | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  let block = -1;
  for (let d = $pos.depth; d >= 0; d--) {
    if ($pos.node(d).isTextblock) { block = $pos.before(d); break; }
  }
  if (block < 0) return null;
  const join = (parts: string[]) => parts.join(sep || '.');
  const heading = headings.get(block);
  if (heading) {
    if (!heading.parts.length) return null;
    return format === 'number-no-superior' ? heading.parts[heading.parts.length - 1]
      : format === 'number-all-superior' ? join(heading.parts)
      : heading.label.trim();
  }
  const list = listNumberAt(doc, block, sheet);
  if (!list) return null;
  return format === 'number-no-superior' ? list.parts[list.parts.length - 1]
    : format === 'number-all-superior' ? join(list.parts)
    : list.multilevel ? list.parts.join('.') : list.parts[list.parts.length - 1];
}

// Every target of one type, in document order — the dialog's pick list. Word hides the
// `_Ref…` bookmarks it mints itself, and so does the bookmark list here.
export function refTargets(
  doc: PMNode, kind: RefTargetKind, sheet: StyleSheet, notes: NoteSettings,
): RefTarget[] {
  const out: RefTarget[] = [];
  if (kind === 'bookmark') {
    const seen = new Set<string>();
    for (const b of bookmarks(doc)) {
      // Word lists no bookmark whose name starts with an underscore: its own `_Ref`/`_Toc`
      // anchors and the navigation marks a converter leaves behind are hidden ones. One
      // row per name, since a bookmark over several blocks comes back once per block.
      if (b.name.startsWith('_') || seen.has(b.name)) continue;
      seen.add(b.name);
      out.push({ kind: 'bookmark', from: b.from, to: b.to, label: b.name, name: b.name });
    }
    return out;
  }
  if (kind === 'heading') {
    const numbers = headingNumbers(doc, sheet.outline);
    doc.descendants((node, pos) => {
      if (node.type.name !== 'heading') return true;
      if (inCellOrItem(doc, pos)) return false;
      const text = blockText(node);
      if (text) out.push({
        kind: 'bookmark', from: pos + 1, to: pos + node.nodeSize - 1,
        label: (numbers.get(pos)?.label ?? '') + text,
      });
      return false;
    });
    return out;
  }
  if (kind === 'numbered') {
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      const number = listNumberAt(doc, pos, sheet);
      const text = blockText(node);
      if (number && text) {
        const shown = number.multilevel ? number.parts.join('.') : number.parts[number.parts.length - 1];
        out.push({ kind: 'bookmark', from: pos + 1, to: pos + node.nodeSize - 1, label: `${shown}. ${text}` });
      }
      // On into the block: an inline frame carries its own, and a list in a text box is
      // as numbered as one in the body.
      return true;
    });
    return out;
  }
  if (kind === 'figure' || kind === 'table') {
    const category: SeqCategory = kind === 'table' ? 'table' : 'figure';
    for (const field of sequenceFields(doc)) {
      if (seqCategoryOf(field.node.attrs.category as string) !== category) continue;
      const $at = doc.resolve(field.pos);
      const block = $at.parent;
      if (!block.isTextblock) continue;
      const start = $at.before($at.depth) + 1;
      out.push({
        kind: 'sequence', from: start, to: start + block.content.size,
        label: blockText(block), seq: { from: field.pos, to: field.pos + field.node.nodeSize },
      });
    }
    return out;
  }
  const all = collectNoteRefs(doc);
  const labels = noteLabels(all, notes);
  const refs = all.filter((r) => r.kind === (kind as NoteKind));
  const bodies = noteBodies(doc);
  for (const ref of refs) {
    const body = bodies.get(ref.id) ?? '';
    out.push({
      kind: 'note', from: ref.pos, to: ref.pos + 1, name: ref.id,
      label: [labels.get(ref.id) ?? '', body].filter(Boolean).join(' '),
    });
  }
  return out;
}

// Every note anchor as a target, shaped like a bookmark so the resolver keeps one code
// path: a note is addressed by its own id, since its anchor carries no marks.
export function noteTargets(doc: PMNode, notes: NoteSettings = noteSettings()): Map<string, BookmarkRef> {
  const refs = collectNoteRefs(doc);
  const labels = noteLabels(refs, notes);
  const out = new Map<string, BookmarkRef>();
  for (const ref of refs) {
    out.set(ref.id, { name: ref.id, from: ref.pos, to: ref.pos + 1, text: labels.get(ref.id) ?? '' });
  }
  return out;
}

// Whether anything in the document can be referenced at all — what enables the button
// and the context-menu entry. Structural only: collecting the targets of all seven types
// would walk the document seven times on every transaction.
export function hasRefTargets(doc: PMNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    const name = node.type.name;
    found = name === 'heading' || name === 'sequenceField' || name === 'noteRef' || name === 'orderedList'
      || (node.isInline && node.marks.some((m) => m.type.name === 'bookmark'));
    return !found;
  });
  return found;
}

// The text of every note, keyed by id — what the dialog shows beside its number.
function noteBodies(doc: PMNode): Map<string, string> {
  const out = new Map<string, string>();
  const section = findNoteSection(doc);
  section?.node.forEach((child) => out.set(String(child.attrs.id ?? ''), liveText(child).trim()));
  return out;
}

// The range a reference of this format marks. A caption is the one target the formats
// cut into pieces — "Figure 2", the text after it, or the number alone — which is how
// Word makes a plain REF field show each of them.
export function refRange(doc: PMNode, target: RefTarget, format: CrossRefFormat): { from: number; to: number } {
  const whole = { from: target.from, to: target.to };
  return target.seq ? sliceCaption(doc, whole, target.seq, format) : whole;
}

const CAPTION_FORMATS: readonly CrossRefFormat[] = ['category-and-value', 'caption', 'value'];

function sliceCaption(
  doc: PMNode, whole: { from: number; to: number }, seq: { from: number; to: number }, format: CrossRefFormat,
): { from: number; to: number } {
  if (format === 'value') return { ...seq };
  if (format === 'category-and-value') return { from: whole.from, to: seq.to };
  if (format === 'caption') {
    // Both products drop the separator the caption puts between number and text.
    const skip = /^[\s:.–—-]+/.exec(doc.textBetween(seq.to, whole.to, '', ''));
    const from = Math.min(seq.to + (skip?.[0].length ?? 0), whole.to);
    return from < whole.to ? { from, to: whole.to } : whole;
  }
  return whole;
}

// A caption format reads its caption's own paragraph, not the bookmark's range: a file
// from LibreOffice addresses the number alone, and "Figure 2" has to come out of it all
// the same.
function captionPart(doc: PMNode, pos: number, format: CrossRefFormat): string | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  let block: PMNode | null = null;
  let start = -1;
  for (let d = $pos.depth; d >= 0; d--) {
    if ($pos.node(d).isTextblock) { block = $pos.node(d); start = $pos.before(d) + 1; break; }
  }
  if (!block) return null;
  let seq: { from: number; to: number } | null = null;
  let at = start;
  block.forEach((child) => {
    if (!seq && child.type.name === 'sequenceField') seq = { from: at, to: at + child.nodeSize };
    at += child.nodeSize;
  });
  if (!seq) return null;
  const range = sliceCaption(doc, { from: start, to: start + block.content.size }, seq, format);
  return rangeText(doc, range.from, range.to).trim();
}

// Which formats a reference type offers, in the order Word's "Insert reference to"
// lists them. A caption has its own three; everything else shares the general set.
export function refFormats(kind: RefTargetKind): CrossRefFormat[] {
  if (kind === 'figure' || kind === 'table') return ['text', 'category-and-value', 'caption', 'page'];
  if (kind === 'footnote' || kind === 'endnote') return ['text', 'page'];
  if (kind === 'numbered') return ['number', 'number-no-superior', 'number-all-superior', 'text', 'page'];
  return ['text', 'page', 'number', 'number-no-superior', 'number-all-superior'];
}

// --- Keeping every reference live -------------------------------------------------

type RefContext = {
  doc: PMNode;
  grid: () => PageGrid;
  sheet: StyleSheet;
  headings: Map<number, HeadingNumber>;
};

// The reference's text now. A bookmark that no longer exists leaves the cached text
// alone (Word shows its cached result too until the field is updated).
function resolveText(view: EditorView, node: PMNode, pos: number, target: BookmarkRef | undefined, ctx: RefContext): string {
  const cached = String(node.attrs.text ?? '');
  if (!target) return cached;
  const format: CrossRefFormat = isCrossRefFormat(node.attrs.format) ? node.attrs.format : 'text';
  if (format === 'page') {
    const at = view.domAtPos(target.from).node;
    const el = (at.nodeType === 1 ? at : at.parentElement) as HTMLElement | null;
    return el ? String(pageOfElement(view, el, ctx.grid())) : cached;
  }
  if (format === 'direction') return pos < target.from ? t().crossRef.below : t().crossRef.above;
  if (format.startsWith('number')) {
    return numberAt(ctx.doc, target.from, format, node.attrs.sep as string | null, ctx.sheet, ctx.headings) ?? cached;
  }
  if (CAPTION_FORMATS.includes(format)) return captionPart(ctx.doc, target.from, format) ?? target.text;
  return target.text;
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
    const doc = editor.state.doc;
    const targets = new Map<string, BookmarkRef>();
    for (const b of bookmarks(doc)) if (!targets.has(b.name)) targets.set(b.name, b);
    const notes = noteTargets(doc);
    const sheet = styleSheet();
    const ctx: RefContext = { doc, grid: () => vm.grid, sheet, headings: headingNumbers(doc, sheet.outline) };
    const jobs: { ref: CrossRefView; node: PMNode; pos: number; text: string }[] = [];
    for (const ref of this.views) {
      const pos = ref.pos();
      const node = pos === null ? null : doc.nodeAt(pos);
      if (pos === null || !node || node.type.name !== 'crossRef' || !ref.dom.isConnected) continue;
      const key = String(node.attrs.name ?? '');
      const target = (node.attrs.kind === 'note' ? notes : targets).get(key);
      jobs.push({ ref, node, pos, text: resolveText(view, node, pos, target, ctx) });
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
    const name = String(node?.attrs?.name ?? '');
    this.dom.dataset.crossRef = name;
    this.dom.dataset.format = isCrossRefFormat(node?.attrs?.format) ? node!.attrs.format : 'text';
    this.dom.dataset.text = text;
    // A file whose reference never carried a target leaves nothing to show; both word
    // processors put a marker in that gap rather than an invisible field.
    this.dom.textContent = text || name;
    this.dom.classList.toggle('cross-ref-broken', !text);
  }

  // Scroll the target into view and drop the cursor into it.
  private goTo(): void {
    const node = this.node();
    if (!node) return;
    const name = String(node.attrs.name ?? '');
    const view = this.editor.view;
    const note = node.attrs.kind === 'note' ? noteTargets(view.state.doc).get(name) : undefined;
    if (note) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, note.from, note.to)).scrollIntoView());
    else goToTarget(view, name);
    view.focus();
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
