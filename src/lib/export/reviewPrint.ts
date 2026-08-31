// What a printed document says about its review markup, the way both word processors
// print it: a bar in the margin beside every changed or commented block, and the comment
// bodies as a list after the document. A comment's text is nowhere on the page, so a bar
// alone could only say that one exists — never what it says.

import { REVISION_AUTHOR_COLORS } from '../editor/extensions/trackChanges';

/** Gap from the text edge to the bar, and the strip the left page margin gives up for it. */
export const BAR_GAP_CM = 0.2;
export const BAR_STRIP_CM = 0.32;

const COMMENT_COLOR = '#c88c00';

export type PrintedComment = {
  id: string; n: number; author: string; date: string; text: string; quote: string;
  /** The page the anchor sits on, where the caller knows it (the raster paths do). */
  page?: number;
};

/** The labels the list is printed with; this module has no i18n of its own. */
export type CommentLabels = { heading: string; onPage: (n: number) => string };

const OPEN_COMMENT = '[data-comment]:not([data-comment-resolved="true"])';
const MARKED = `${OPEN_COMMENT}, [data-insertion], [data-deletion]`;

/** Every unresolved comment in document order, numbered. A handled one prints nowhere. */
export function printedComments(root: ParentNode): PrintedComment[] {
  const out: PrintedComment[] = [];
  const byId = new Map<string, PrintedComment>();
  for (const el of Array.from(root.querySelectorAll(OPEN_COMMENT))) {
    const id = el.getAttribute('data-comment') ?? '';
    if (!id) continue;
    const seen = byId.get(id);
    // Runs of one comment split by a paragraph boundary: one entry, quoting them all.
    if (seen) { seen.quote += el.textContent ?? ''; continue; }
    const entry: PrintedComment = {
      id, n: out.length + 1,
      author: el.getAttribute('data-comment-author') ?? '',
      date: el.getAttribute('data-comment-date') ?? '',
      text: el.getAttribute('data-comment-text') ?? '',
      quote: el.textContent ?? '',
    };
    byId.set(id, entry);
    out.push(entry);
  }
  return out;
}

// The bar takes the revision author's colour, handed out as the editor's decoration
// does it: in order of first appearance.
function authorColors(root: ParentNode): Map<string, string> {
  const order = new Map<string, string>();
  for (const el of Array.from(root.querySelectorAll('[data-rev-author]'))) {
    const a = el.getAttribute('data-rev-author') ?? '';
    if (!order.has(a)) order.set(a, REVISION_AUTHOR_COLORS[order.size % REVISION_AUTHOR_COLORS.length]);
  }
  return order;
}

/**
 * Marks the blocks the margin bar hangs on, for the vector print path — the raster one
 * clones the editor's own layer instead. Per top-level block, not per line: CSS has no
 * line box to hang a bar on, and only a top-level block's left edge is the text column's.
 * Returns whether anything was marked, which is what pays for the margin strip.
 */
export function markReviewBlocks(root: HTMLElement): boolean {
  const colors = authorColors(root);
  let marked = false;
  for (const el of Array.from(root.querySelectorAll(MARKED))) {
    let block: HTMLElement | null = el as HTMLElement;
    while (block?.parentElement && block.parentElement !== root) block = block.parentElement;
    if (!block || block.parentElement !== root || block.hasAttribute('data-review-bar')) continue;
    const author = el.getAttribute('data-rev-author');
    block.setAttribute('data-review-bar', '');
    block.style.setProperty('--review-bar',
      author === null ? COMMENT_COLOR : colors.get(author) ?? REVISION_AUTHOR_COLORS[0]);
    marked = true;
  }
  return marked;
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));

// The stored ISO date, in the reader's locale — an imported file may carry any format.
function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** The comment bodies, after the document: what the margin bar cannot carry. */
export function commentListHtml(list: PrintedComment[], labels: CommentLabels): string {
  const rows = list.map((c) => {
    // Page first, as LibreOffice prints its own end-of-document comments: with the
    // quote it is what makes an entry findable in a printout nobody can click.
    const meta = [c.page ? labels.onPage(c.page) : '', c.author, c.date ? when(c.date) : '']
      .filter(Boolean).map(esc).join(' · ');
    return `<li><span class="cl-meta">${meta}</span>`
      + (c.quote.trim() ? `<span class="cl-quote">${esc(c.quote)}</span>` : '')
      + `<span class="cl-text">${esc(c.text)}</span></li>`;
  }).join('');
  return `<section class="comment-list"><h2>${esc(labels.heading)}</h2><ol>${rows}</ol></section>`;
}

/** The rules both print paths draw the bar and the list with. */
export function reviewPrintCss(): string {
  return `
[data-review-bar] { position: relative; }
[data-review-bar]::before {
  content: ''; position: absolute; left: -${BAR_GAP_CM}cm; top: 0; bottom: 0;
  width: 2px; border-radius: 1px; background: var(--review-bar, ${COMMENT_COLOR});
}
.comment-list { break-before: page; font-family: var(--font-serif); color: #000; }
.comment-list h2 { font-family: var(--font-sans); font-size: 14pt; margin: 0 0 0.4cm; }
.comment-list ol { margin: 0; padding-left: 1.1cm; }
.comment-list li { margin: 0 0 0.35cm; break-inside: avoid; }
.cl-meta { display: block; font-size: 9pt; color: #555; }
.cl-quote { display: block; margin: 0.05cm 0; padding-left: 0.2cm; border-left: 2px solid ${COMMENT_COLOR}; color: #555; }
.cl-text { display: block; white-space: pre-wrap; }
`;
}
