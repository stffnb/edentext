// What a printed document says about its review markup, the way both word processors
// print it: a bar in the margin beside every changed or commented block, and the comment
// bodies as a list after the document. A comment's text is nowhere on the page, so a bar
// alone could only say that one exists — never what it says.

import { AUTHOR_COLORS } from '../editor/authorColors';
import { formatMoment } from '../storage/dateFormat.svelte';

/** Gap from the text edge to the bar, and the strip the left page margin gives up for it. */
export const BAR_GAP_CM = 0.2;
export const BAR_STRIP_CM = 0.32;

export type PrintedComment = {
  id: string; n: number; author: string; date: string; text: string; quote: string;
  /** The author's colour, as the editor draws it; the list's quote line takes it. */
  color?: string;
  /** The thread under it — a printout that dropped the answers would misreport it. */
  replies: { author: string; date: string; text: string }[];
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
      replies: parseReplies(el.getAttribute('data-comment-replies')),
      quote: el.textContent ?? '',
    };
    byId.set(id, entry);
    out.push(entry);
  }
  const colors = authorColors(root);
  for (const c of out) c.color = colors.get(c.author);
  return out;
}

function parseReplies(json: string | null): { author: string; date: string; text: string }[] {
  if (!json) return [];
  try {
    const list: unknown = JSON.parse(json);
    return Array.isArray(list) ? list as { author: string; date: string; text: string }[] : [];
  } catch { return []; }
}

// Author → colour as the editor's `authorColors` hands it out: revision and comment
// authors (with the answers') in order of first appearance.
function authorColors(root: ParentNode): Map<string, string> {
  const order = new Map<string, string>();
  const add = (a: string) => {
    if (!order.has(a)) order.set(a, AUTHOR_COLORS[order.size % AUTHOR_COLORS.length]);
  };
  for (const el of Array.from(root.querySelectorAll('[data-rev-author], [data-comment-author]'))) {
    const rev = el.getAttribute('data-rev-author');
    if (rev !== null) { add(rev); continue; }
    add(el.getAttribute('data-comment-author') ?? '');
    for (const r of parseReplies(el.getAttribute('data-comment-replies'))) add(String(r?.author ?? ''));
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
    const author = el.getAttribute('data-rev-author') ?? el.getAttribute('data-comment-author') ?? '';
    const color = colors.get(author) ?? AUTHOR_COLORS[0];
    // The tint the editor's decoration draws, which generated HTML does not carry.
    if (el.hasAttribute('data-comment')) {
      el.classList.add('pm-comment-tint');
      (el as HTMLElement).style.setProperty('--comment-author', color);
    }
    let block: HTMLElement | null = el as HTMLElement;
    while (block?.parentElement && block.parentElement !== root) block = block.parentElement;
    if (!block || block.parentElement !== root || block.hasAttribute('data-review-bar')) continue;
    block.setAttribute('data-review-bar', '');
    block.style.setProperty('--review-bar', color);
    marked = true;
  }
  return marked;
}

export const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));


/** The comment bodies, after the document: what the margin bar cannot carry. */
export function commentListHtml(list: PrintedComment[], labels: CommentLabels): string {
  const rows = list.map((c) => {
    // Page first, as LibreOffice prints its own end-of-document comments: with the
    // quote it is what makes an entry findable in a printout nobody can click.
    const meta = [c.page ? labels.onPage(c.page) : '', c.author, c.date ? formatMoment(c.date) : '']
      .filter(Boolean).map(esc).join(' · ');
    const replies = c.replies.map((r) => {
      const rm = [r.author, r.date ? formatMoment(r.date) : ''].filter(Boolean).map(esc).join(' · ');
      return `<span class="cl-reply"><span class="cl-meta">${rm}</span>`
        + `<span class="cl-text">${esc(r.text)}</span></span>`;
    }).join('');
    return `<li><span class="cl-meta">${meta}</span>`
      + (c.quote.trim()
        ? `<span class="cl-quote"${c.color ? ` style="border-color: ${c.color}"` : ''}>${esc(c.quote)}</span>` : '')
      + `<span class="cl-text">${esc(c.text)}</span>${replies}</li>`;
  }).join('');
  return `<section class="comment-list"><h2>${esc(labels.heading)}</h2><ol>${rows}</ol></section>`;
}

/** The rules both print paths draw the bar and the list with. */
export function reviewPrintCss(): string {
  return `
[data-review-bar] { position: relative; }
[data-review-bar]::before {
  content: ''; position: absolute; left: -${BAR_GAP_CM}cm; top: 0; bottom: 0;
  width: 2px; border-radius: 1px; background: var(--review-bar, ${AUTHOR_COLORS[0]});
}
.comment-list { break-before: page; font-family: var(--font-serif); color: #000; }
.comment-list h2 { font-family: var(--font-sans); font-size: 14pt; margin: 0 0 0.4cm; }
.comment-list ol { margin: 0; padding-left: 1.1cm; }
.comment-list li { margin: 0 0 0.35cm; break-inside: avoid; }
.cl-meta { display: block; font-size: 9pt; color: #555; }
.cl-quote { display: block; margin: 0.05cm 0; padding-left: 0.2cm; border-left: 2px solid ${AUTHOR_COLORS[0]}; color: #555; }
.cl-text { display: block; white-space: pre-wrap; }
.cl-reply { display: block; margin-top: 0.1cm; padding-left: 0.3cm; border-left: 1px solid #bbb; }
`;
}
