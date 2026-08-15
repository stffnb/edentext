import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { citationLabel, formatBibRow, isCitationStyle, type CitationStyle } from '../../utils/citationStyle';

// One citation: an inline atom carrying the whole source record, which is what ODF
// writes (every field is an attribute of text:bibliography-mark) and what lets the
// document travel without a database beside it. Word keeps the record in a custom-XML
// part instead and cites it by tag; `identifier` is that tag.

export type BibFields = Record<string, string>;
export type BibSource = { identifier: string; type: string; fields: BibFields };
export type BibEntry = BibSource & { pos: number; text: string };

// The ODF text:bibliography-type values — LibreOffice's own list, in its order.
export const BIB_TYPES = [
  'article', 'book', 'booklet', 'conference', 'inbook', 'incollection', 'inproceedings',
  'journal', 'manual', 'mastersthesis', 'misc', 'phdthesis', 'proceedings', 'techreport',
  'unpublished', 'www', 'email', 'custom1', 'custom2', 'custom3', 'custom4', 'custom5',
] as const;

// What the type picker offers. LibreOffice's list is the longer one above, and a file
// naming any of it still imports — this is only what the dialog is worth showing.
export const BIB_COMMON_TYPES = [
  'book', 'article', 'inbook', 'incollection', 'conference',
  'techreport', 'phdthesis', 'mastersthesis', 'www', 'misc',
] as const;

// The fields the dialog offers. A file's other ones (isbn, note, editor, …) ride the
// `fields` record untouched, so a round trip keeps them.
export const BIB_FIELDS = ['author', 'title', 'year', 'publisher', 'journal', 'pages', 'url'] as const;

// ODF field name → the <b:Source> child Word writes for it. Word has no slot for the
// rest, which therefore only survive the ODF leg.
export const DOCX_BIB_FIELD: Record<string, string> = {
  author: 'Author', title: 'Title', year: 'Year', publisher: 'Publisher', address: 'City',
  journal: 'JournalName', booktitle: 'BookTitle', pages: 'Pages', url: 'URL',
  edition: 'Edition', volume: 'Volume', number: 'Issue', note: 'Comments',
};

// ODF bibliography type → Word b:SourceType. Word's set is the smaller one, so several
// map onto one and the way back takes the commonest of them.
export const DOCX_SOURCE_TYPE: Record<string, string> = {
  book: 'Book', booklet: 'Book', manual: 'Book',
  article: 'JournalArticle', journal: 'JournalArticle',
  inbook: 'BookSection', incollection: 'BookSection',
  conference: 'ConferenceProceedings', inproceedings: 'ConferenceProceedings',
  proceedings: 'ConferenceProceedings',
  techreport: 'Report', mastersthesis: 'Report', phdthesis: 'Report',
  www: 'InternetSite', email: 'ElectronicSource',
};

const FROM_DOCX_TYPE: Record<string, string> = {
  Book: 'book', BookSection: 'inbook', JournalArticle: 'article',
  ArticleInAPeriodical: 'article', ConferenceProceedings: 'conference', Report: 'techreport',
  InternetSite: 'www', ElectronicSource: 'email',
};

export const bibTypeFromDocx = (t: string): string => FROM_DOCX_TYPE[t] ?? 'misc';

export function isBibType(v: unknown): boolean {
  return typeof v === 'string' && (BIB_TYPES as readonly string[]).includes(v);
}

/** What the citation shows where the file names nothing else: LibreOffice's `[key]`. */
export const citationText = (identifier: string): string => `[${identifier}]`;

// The document's citation style lives on its bibliography index (tableOfContents.ts),
// which is where both formats keep it too; a document with no bibliography cites by key.
export function documentCitationStyle(doc: PMNode): CitationStyle {
  let style: CitationStyle = 'key';
  doc.descendants((node) => {
    if (node.type.name !== 'tableOfContents' || node.attrs.index !== 'bibliography') return true;
    if (isCitationStyle(node.attrs.citationStyle)) style = node.attrs.citationStyle;
    return false;
  });
  return style;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bibliographyEntry: {
      insertBibliographyEntry: (source: BibSource) => ReturnType;
    };
  }
}

export const BibliographyEntry = Node.create({
  name: 'bibliographyEntry',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      identifier: {
        default: '',
        parseHTML: el => (el as HTMLElement).getAttribute('data-bib-id') ?? '',
        renderHTML: attrs => ({ 'data-bib-id': String(attrs.identifier ?? '') }),
      },
      type: {
        default: 'book',
        parseHTML: el => (el as HTMLElement).getAttribute('data-bib-type') || 'book',
        renderHTML: attrs => ({ 'data-bib-type': String(attrs.type ?? 'book') }),
      },
      // Every remaining ODF field, by its own name. One attr, so a file's fields we have
      // no UI for still round-trip.
      fields: {
        default: {} as BibFields,
        parseHTML: (el) => {
          try { return JSON.parse((el as HTMLElement).getAttribute('data-bib-fields') ?? '{}'); }
          catch { return {}; }
        },
        renderHTML: attrs => ({ 'data-bib-fields': JSON.stringify(attrs.fields ?? {}) }),
      },
      // What the citation shows. A file's own text wins over `[key]`: LibreOffice writes
      // the number there when the index numbers its entries.
      text: {
        default: '',
        parseHTML: el => (el as HTMLElement).getAttribute('data-bib-text') ?? '',
        renderHTML: attrs => (attrs.text ? { 'data-bib-text': String(attrs.text) } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-bib-id]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'pm-citation' }), shownText(node.attrs)];
  },

  // The shown text is derived from the document's style and the source's rank, so an
  // edit that adds or moves a citation restyles them all. Off the undo stack, like the
  // caption numbers: undoing an edit must not step back through the recount.
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('bibliographyLabels'),
        appendTransaction: (transactions, _old, newState) =>
          transactions.some((t) => t.docChanged) ? relabelTr(newState) : null,
      }),
    ];
  },

  onCreate() {
    const tr = relabelTr(this.editor.state);
    if (tr) this.editor.view.dispatch(tr);
  },

  addCommands() {
    return {
      insertBibliographyEntry: (source) => ({ commands }) => {
        const identifier = source.identifier.trim();
        if (!identifier) return false;
        return commands.insertContent({
          type: this.name,
          attrs: { identifier, type: source.type, fields: source.fields },
        });
      },
    };
  },
});

const shownText = (attrs: Record<string, unknown>): string =>
  String(attrs.text || citationText(String(attrs.identifier ?? '')));

// Every citation's label brought up to date, or null when they all already agree.
function relabelTr(state: EditorState): Transaction | null {
  const style = documentCitationStyle(state.doc);
  const entries = bibliographyEntries(state.doc);
  const rank = sourceRanks(entries);
  const tr = state.tr;
  let changed = false;
  for (const e of entries) {
    const label = citationLabel(e, style, rank.get(e.identifier) ?? 0);
    if (label === e.text) continue;
    tr.setNodeAttribute(e.pos, 'text', label);
    changed = true;
  }
  return changed ? tr.setMeta('addToHistory', false) : null;
}

/** Each cited source's number: 1 upwards, in the order the document first cites it. */
export function sourceRanks(entries: BibSource[]): Map<string, number> {
  const rank = new Map<string, number>();
  for (const e of entries) if (!rank.has(e.identifier)) rank.set(e.identifier, rank.size + 1);
  return rank;
}

/** Every citation in document order, duplicates included. */
export function bibliographyEntries(doc: PMNode): BibEntry[] {
  const out: BibEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'bibliographyEntry') return true;
    const identifier = String(node.attrs.identifier ?? '').trim();
    const fields = (node.attrs.fields ?? {}) as BibFields;
    if (identifier) {
      out.push({ pos, identifier, type: String(node.attrs.type ?? 'book'), fields, text: shownText(node.attrs) });
    }
    return false;
  });
  return out;
}

/**
 * One row per cited source, in document order — LibreOffice's own default, which sorts
 * a bibliography by document position rather than alphabetically. The row reads
 * "key: author, title, year", the shape LibreOffice's entry templates produce.
 */
export function bibliographyRows(entries: BibSource[], style: CitationStyle = 'key'): { identifier: string; text: string }[] {
  const rank = sourceRanks(entries);
  const seen = new Set<string>();
  const out: { identifier: string; text: string }[] = [];
  for (const e of entries) {
    if (seen.has(e.identifier)) continue;
    seen.add(e.identifier);
    out.push({ identifier: e.identifier, text: formatBibRow(e, style, rank.get(e.identifier) ?? 0) });
  }
  return out;
}

export function bibRowText(source: BibSource, style: CitationStyle = 'key'): string {
  return formatBibRow(source, style, 1);
}
