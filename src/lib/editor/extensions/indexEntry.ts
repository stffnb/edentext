import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

// One entry of the alphabetical index: an inline atom marking the place a term is
// discussed. It carries the term itself, so the marked text and the word the index
// lists can differ — which is the point of marking rather than searching.
//
// LibreOffice writes a point <text:alphabetical-index-mark text:string-value="…">,
// Word an XE field. Both are places, not ranges, so this is an atom and not a mark.

export type IndexEntry = { pos: number; term: string; key1: string };

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indexEntry: {
      /** Mark the cursor's position as an entry for `term` (under `key1` if given). */
      insertIndexEntry: (term: string, key1?: string) => ReturnType;
    };
  }
}

export const IndexEntry = Node.create({
  name: 'indexEntry',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      term: {
        default: '',
        parseHTML: el => (el as HTMLElement).getAttribute('data-index-term') ?? '',
        renderHTML: attrs => ({ 'data-index-term': String(attrs.term ?? '') }),
      },
      // The heading this entry files under, where it differs from the term itself
      // (LibreOffice's "1st key", Word's `XE "key:term"`).
      key1: {
        default: '',
        parseHTML: el => (el as HTMLElement).getAttribute('data-index-key') ?? '',
        renderHTML: attrs => (attrs.key1 ? { 'data-index-key': String(attrs.key1) } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-index-term]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    // Title, not text: the marker is a field, and its term belongs in the tooltip.
    return ['span', mergeAttributes(HTMLAttributes, {
      class: 'pm-index-entry',
      title: String(node.attrs.term ?? ''),
    })];
  },

  addCommands() {
    return {
      insertIndexEntry: (term, key1 = '') => ({ commands }) => {
        const text = term.trim();
        if (!text) return false;
        return commands.insertContent({ type: this.name, attrs: { term: text, key1: key1.trim() } });
      },
    };
  },
});

/** Every index entry in document order. */
export function indexEntries(doc: PMNode): IndexEntry[] {
  const out: IndexEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'indexEntry') return true;
    const term = String(node.attrs.term ?? '').trim();
    if (term) out.push({ pos, term, key1: String(node.attrs.key1 ?? '').trim() });
    return false;
  });
  return out;
}

/**
 * The index rows: one per term, its pages merged and de-duplicated, sorted the way
 * both word processors sort an alphabetical index — case-insensitively, by locale.
 * A term filed under a key sorts and prints under that key.
 */
export function indexRows(entries: { term: string; key1: string; page: number }[]): { text: string; pages: number[] }[] {
  const byTerm = new Map<string, { text: string; pages: Set<number> }>();
  for (const e of entries) {
    const text = e.key1 ? `${e.key1}: ${e.term}` : e.term;
    const row = byTerm.get(text) ?? { text, pages: new Set<number>() };
    row.pages.add(e.page);
    byTerm.set(text, row);
  }
  return [...byTerm.values()]
    .sort((a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base' }))
    .map((r) => ({ text: r.text, pages: [...r.pages].sort((a, b) => a - b) }));
}
