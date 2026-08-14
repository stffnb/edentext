import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { DEFAULT_SHORTCUTS } from '../shortcuts';
import { formatOrdinal } from '../../utils/orderedListTypes';
import { DEFAULT_NOTE_SETTINGS, type NoteKind, type NoteSettings } from '../../storage/noteSettings';

// Footnotes and endnotes. The anchor (`noteRef`) rides the text; the note text itself is
// a block in the single `noteSection` at the document end, kept in anchor order by the
// sync plugin below. Footnotes are lifted to the foot of their page by pageBreaks.ts,
// endnotes stay in flow — which is where LibreOffice puts them. See
// docs/architecture/notes.md.

export type { NoteKind };

const readKind = (v: unknown): NoteKind => (v === 'endnote' ? 'endnote' : 'footnote');

let idCounter = 0;
export function newNoteId(): string {
  idCounter += 1;
  return `n${Date.now().toString(36)}${idCounter.toString(36)}`;
}

// The label a note shows: its own custom mark where a file gave it one, else the
// running number in the class's own format, wrapped in the configured prefix/suffix.
export function noteLabel(index: number, kind: NoteKind, settings: NoteSettings, custom?: string | null): string {
  if (custom) return custom;
  const s = settings[kind];
  return `${s.prefix}${formatOrdinal(s.startAt + index, s.numFormat)}${s.suffix}`;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    notes: {
      insertNote: (kind: NoteKind) => ReturnType;
      goToNote: (id: string) => ReturnType;
    };
  }
}

export const NoteRef = Node.create({
  name: 'noteRef',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-note-ref') || '',
        renderHTML: (attrs) => ({ 'data-note-ref': String(attrs.id ?? '') }),
      },
      kind: {
        default: 'footnote' as NoteKind,
        parseHTML: (el) => readKind(el.getAttribute('data-note-kind')),
        renderHTML: (attrs) => ({ 'data-note-kind': readKind(attrs.kind) }),
      },
      // The resolved label, cached like a Word field's result so a static render and
      // the exports read the same number the node view shows.
      text: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-text') ?? el.textContent ?? '',
        renderHTML: (attrs) => ({ 'data-text': String(attrs.text ?? '') }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'sup[data-note-ref]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { class: 'note-ref' }), String(node.attrs.text ?? '')];
  },

  renderText({ node }) {
    return String(node.attrs.text ?? '');
  },
});

export const Note = Node.create({
  name: 'note',
  content: 'inline*',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-note-id') || '',
        renderHTML: (attrs) => ({ 'data-note-id': String(attrs.id ?? '') }),
      },
      kind: {
        default: 'footnote' as NoteKind,
        parseHTML: (el) => readKind(el.getAttribute('data-note-kind')),
        renderHTML: (attrs) => ({ 'data-note-kind': readKind(attrs.kind) }),
      },
      // A note whose file numbered it by hand (ODF text:note-citation/@text:label,
      // Word's w:customMarkFollows); null = the running number.
      label: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute('data-note-label'),
        renderHTML: (attrs) => (attrs.label ? { 'data-note-label': String(attrs.label) } : {}),
      },
      // The marker drawn in front of the text, by the widget decoration below.
      text: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-note-num') ?? '',
        renderHTML: (attrs) => ({ 'data-note-num': String(attrs.text ?? '') }),
      },
      // The file's own note paragraph style, rendered as data-style like any block's:
      // the document stylesheet then gives the note that file's size and indent, and
      // editor.css only supplies LibreOffice's for a note that names none.
      styleName: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute('data-style'),
        renderHTML: (attrs) => (attrs.styleName ? { 'data-style': String(attrs.styleName) } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-note-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'note' }), 0];
  },
});

export const NoteSection = Node.create({
  name: 'noteSection',
  group: 'notes',
  content: 'note+',
  isolating: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'div[data-notes]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-notes': 'true', class: 'note-section' }), 0];
  },
});

// `chapter` is the running count of top-level level-1 headings above the anchor, which
// is what a per-chapter restart counts within.
export type NoteRefInfo = { id: string; kind: NoteKind; pos: number; chapter: number };

// Every anchor in the body, in document order. The note section is skipped: a note's
// own text may hold an anchor, and that one numbers nothing.
export function collectNoteRefs(doc: PMNode): NoteRefInfo[] {
  const out: NoteRefInfo[] = [];
  let chapter = 0;
  doc.forEach((child, offset) => {
    if (child.type.name === 'noteSection') return;
    if (child.type.name === 'heading' && child.attrs.level === 1) chapter += 1;
    child.descendants((node, pos) => {
      if (node.type.name === 'noteRef') {
        out.push({ id: String(node.attrs.id ?? ''), kind: readKind(node.attrs.kind), pos: offset + 1 + pos, chapter });
      }
    });
    if (child.type.name === 'noteRef') {
      out.push({ id: String(child.attrs.id ?? ''), kind: readKind(child.attrs.kind), pos: offset, chapter });
    }
  });
  return out;
}

export function findNoteSection(doc: PMNode): { node: PMNode; pos: number } | null {
  const last = doc.lastChild;
  if (!last || last.type.name !== 'noteSection') return null;
  return { node: last, pos: doc.content.size - last.nodeSize };
}

// Anchors that ended up inside a note — a paste, since inserting one there is refused.
// They reference nothing and carry no number, so the sync pass drops them.
function strayRefsInNotes(doc: PMNode): number[] {
  const section = findNoteSection(doc);
  if (!section) return [];
  const out: number[] = [];
  section.node.descendants((node, pos) => {
    if (node.type.name === 'noteRef') out.push(section.pos + 1 + pos);
  });
  return out;
}

export function inNote(state: EditorState): boolean {
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'note') return true;
  return false;
}

// Position of the first text place inside the note with this id.
function noteEntryPos(doc: PMNode, id: string): number | null {
  const section = findNoteSection(doc);
  if (!section) return null;
  let found: number | null = null;
  section.node.forEach((child, offset) => {
    if (found === null && String(child.attrs.id ?? '') === id) found = section.pos + offset + 2;
  });
  return found;
}

// The page each footnote anchor landed on, published by pageBreaks.ts after every
// pagination pass — the only place that knows it. Returns whether it moved, which is
// what makes the plugin renumber.
let anchorPages: ReadonlyMap<string, number> = new Map();

export function setNoteAnchorPages(next: ReadonlyMap<string, number>): boolean {
  const same = next.size === anchorPages.size
    && Array.from(next).every(([id, page]) => anchorPages.get(id) === page);
  anchorPages = next;
  return !same;
}

// The label each anchor shows, keyed by note id: footnotes and endnotes count
// separately, each from its own start value. A restart counts within the anchor's page
// or chapter instead — per page is a footnote-only option, as it is in LibreOffice,
// since the endnote list has no page of its own to count on.
export function noteLabels(
  refs: NoteRefInfo[], settings: NoteSettings, pages: ReadonlyMap<string, number> = anchorPages,
): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const ref of refs) {
    const restart = settings[ref.kind].restart;
    const bucket = restart === 'chapter' ? `${ref.kind}:c${ref.chapter}`
      : restart === 'page' && ref.kind === 'footnote' ? `${ref.kind}:p${pages.get(ref.id) ?? 0}`
      : ref.kind;
    const index = seen.get(bucket) ?? 0;
    out.set(ref.id, noteLabel(index, ref.kind, settings));
    seen.set(bucket, index + 1);
  }
  return out;
}

const notesKey = new PluginKey('notes');

// Meta asking for a renumber without a document change: the numbering follows the
// settings, and changing those in the dialog edits nothing the sync pass would see.
export const RESYNC_NOTES = 'resyncNotes';

export interface NotesOptions {
  settings: () => NoteSettings;
}

export const Notes = Extension.create<NotesOptions>({
  name: 'notes',

  addOptions() {
    return { settings: () => DEFAULT_NOTE_SETTINGS };
  },

  addCommands() {
    return {
      // Insert the anchor and its (empty) note in one step and drop the cursor into the
      // note, so the user types where they are looking. The sync plugin only repairs.
      insertNote:
        (kind) =>
        ({ state, dispatch }) => {
          const schema = state.schema;
          const refType = schema.nodes.noteRef;
          const noteType = schema.nodes.note;
          const sectionType = schema.nodes.noteSection;
          if (!refType || !noteType || !sectionType) return false;
          // No note inside a note: LibreOffice and Word both refuse it, and the anchor
          // would reference a note that can never be numbered.
          if (inNote(state)) return false;
          if (!dispatch) return true;

          const id = newNoteId();
          const tr = state.tr.replaceSelectionWith(refType.create({ id, kind, text: '' }), false);

          // Where the new note belongs: after every note whose anchor precedes this one.
          const section = findNoteSection(tr.doc);
          const before = collectNoteRefs(tr.doc).findIndex((r) => r.id === id);
          const note = noteType.create({ id, kind, text: '' });
          if (!section) {
            tr.insert(tr.doc.content.size, sectionType.create(null, note));
          } else {
            let offset = section.pos + 1;
            section.node.forEach((child, childOffset, index) => {
              if (index < before) offset = section.pos + 1 + childOffset + child.nodeSize;
            });
            tr.insert(offset, note);
          }
          const entry = noteEntryPos(tr.doc, id);
          if (entry !== null) tr.setSelection(TextSelection.near(tr.doc.resolve(entry)));
          dispatch(tr.scrollIntoView());
          return true;
        },

      goToNote:
        (id) =>
        ({ state, dispatch }) => {
          const entry = noteEntryPos(state.doc, id);
          if (entry === null || !dispatch) return entry !== null;
          dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(entry))).scrollIntoView());
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      [DEFAULT_SHORTCUTS.footnote]: () => this.editor.commands.insertNote('footnote'),
      [DEFAULT_SHORTCUTS.endnote]: () => this.editor.commands.insertNote('endnote'),
    };
  },

  addProseMirrorPlugins() {
    const getSettings = () => this.options.settings();
    return [
      new Plugin({
        key: notesKey,

        props: {
          // The note's own marker, as a widget rather than generated content: real text
          // reaches the PDF, the clipboard and every measurement, which is why the index
          // draws its leader dots the same way. Not document content — nothing to edit,
          // delete or serialize.
          decorations(state) {
            const section = findNoteSection(state.doc);
            if (!section) return null;
            const decos: Decoration[] = [];
            section.node.forEach((child, offset) => {
              const label = String(child.attrs.text ?? '');
              if (!label) return;
              decos.push(Decoration.widget(section.pos + offset + 2, () => {
                const el = document.createElement('span');
                el.className = 'note-marker';
                el.setAttribute('contenteditable', 'false');
                el.textContent = label;
                return el;
              }, { side: -1, key: `nm:${child.attrs.id}:${label}` }));
            });
            return DecorationSet.create(state.doc, decos);
          },

          // Clicking an anchor jumps to its note, the way the TOC's rows jump to their
          // heading. A note's own marker jumps nowhere — it is where you already are.
          handleClickOn(view, _pos, node) {
            if (node.type.name !== 'noteRef') return false;
            const entry = noteEntryPos(view.state.doc, String(node.attrs.id ?? ''));
            if (entry === null) return false;
            view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(entry))).scrollIntoView());
            view.focus();
            return true;
          },
        },

        // Two rounds by design: structure first, numbering on the pass after it. Doing
        // both at once would need positions from a document this transaction is still
        // rewriting.
        appendTransaction(trs, _oldState, newState) {
          if (!trs.some((tr) => tr.docChanged || tr.getMeta(RESYNC_NOTES))) return null;
          return syncStructure(newState) ?? syncNumbers(newState, getSettings());
        },
      }),
    ];
  },
});

// Keep exactly one note per anchor, in anchor order. Returns null when the document
// already satisfies that, so the pass converges after one repair.
function syncStructure(state: EditorState): Transaction | null {
  const noteType = state.schema.nodes.note;
  const sectionType = state.schema.nodes.noteSection;
  if (!noteType || !sectionType) return null;

  // Strays first and on their own: they shift every position after them, and the rest
  // of this pass reads positions out of the document it was handed.
  const strays = strayRefsInNotes(state.doc);
  if (strays.length) {
    const tr = state.tr;
    for (let i = strays.length - 1; i >= 0; i--) tr.delete(strays[i], strays[i] + 1);
    return tr.setMeta('addToHistory', false);
  }

  const refs = collectNoteRefs(state.doc);
  const section = findNoteSection(state.doc);
  const existing = new Map<string, PMNode>();
  section?.node.forEach((child) => existing.set(String(child.attrs.id ?? ''), child));

  const wanted: PMNode[] = [];
  const reIds: { pos: number; id: string }[] = [];
  const used = new Set<string>();
  for (const ref of refs) {
    // The same id twice means an anchor was copied: the copy earns its own note, a
    // clone of the one it was duplicated from.
    if (used.has(ref.id) || !ref.id) {
      const source = existing.get(ref.id);
      const id = newNoteId();
      reIds.push({ pos: ref.pos, id });
      wanted.push(noteType.create({ ...(source?.attrs ?? {}), id, kind: ref.kind }, source?.content));
      used.add(id);
      continue;
    }
    const own = existing.get(ref.id);
    wanted.push(own ?? noteType.create({ id: ref.id, kind: ref.kind }));
    used.add(ref.id);
  }

  const currentIds = section ? section.node.children.map((c) => String(c.attrs.id ?? '')) : [];
  const wantedIds = wanted.map((c) => String(c.attrs.id ?? ''));
  const sameOrder = currentIds.length === wantedIds.length && currentIds.every((v, i) => v === wantedIds[i]);
  if (sameOrder && !reIds.length) return null;

  const tr = state.tr;
  for (const fix of reIds) tr.setNodeAttribute(fix.pos, 'id', fix.id);
  if (!sameOrder) {
    if (!wanted.length && section) tr.delete(section.pos, section.pos + section.node.nodeSize);
    else if (!section) tr.insert(tr.doc.content.size, sectionType.create(null, wanted));
    else tr.replaceWith(section.pos + 1, section.pos + section.node.nodeSize - 1, wanted);
  }
  return tr.setMeta('addToHistory', false);
}

// Write the running label onto every anchor and its note. Cached attrs, so nothing is
// dispatched once they agree.
function syncNumbers(state: EditorState, settings: NoteSettings): Transaction | null {
  const refs = collectNoteRefs(state.doc);
  const labels = noteLabels(refs, settings);
  const section = findNoteSection(state.doc);
  // A note the file numbered by hand keeps its own mark, and the anchor shows the same
  // one — the two are one mark drawn twice, not two.
  section?.node.forEach((child) => {
    if (child.attrs.label) labels.set(String(child.attrs.id ?? ''), String(child.attrs.label));
  });
  const tr = state.tr;
  let changed = false;

  for (const ref of refs) {
    const label = labels.get(ref.id) ?? '';
    if (state.doc.nodeAt(ref.pos)?.attrs.text === label) continue;
    tr.setNodeAttribute(ref.pos, 'text', label);
    changed = true;
  }
  section?.node.forEach((child, offset) => {
    const own = labels.get(String(child.attrs.id ?? '')) ?? '';
    if (child.attrs.text === own) return;
    tr.setNodeAttribute(section.pos + 1 + offset, 'text', own);
    changed = true;
  });

  return changed ? tr.setMeta('addToHistory', false) : null;
}
