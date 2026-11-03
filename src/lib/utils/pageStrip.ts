// A copy of a `.paper` holding only some of its parts, for the PDF strips and the
// navigator's page thumbnails: the chain above them is copied shallowly, so a page's
// copy costs one page however long the document is.

const flowOf = (paper: HTMLElement) => paper.querySelector('.tiptap') as HTMLElement;

/**
 * Copies `paper` with, of each holder's children, only those in `keep`; `other` decides
 * whether the paper's remaining children come along whole. The flow above `first` folds
 * into a stand-in that `alignStrip` sizes so `first` lands at `firstTop` (paper px).
 */
export function stripOf(
  paper: HTMLElement, holders: Set<Node | null>, keep: Set<Node>,
  first: Element | null, firstTop: number, other = true,
): HTMLElement {
  const flow = flowOf(paper);
  const copies = new Map<Node, Node>();
  const copyOf = (node: Node): Node => {
    if (!(node instanceof Element) || !(node.contains(flow) || holders.has(node))) {
      const c = node.cloneNode(true);
      copies.set(node, c);
      return c;
    }
    const c = node.cloneNode(false);
    for (const child of Array.from(node.childNodes)) {
      const el = child instanceof Element ? child : null;
      const wanted = holders.has(node)
        ? !el || keep.has(el)
        : other || !el || el.contains(flow) || holders.has(el);
      if (wanted) c.appendChild(copyOf(child));
    }
    return c;
  };
  const copy = copyOf(paper) as HTMLElement;
  const at = first && (copies.get(first) as HTMLElement | undefined);
  if (!at) return copy;
  const standIn = document.createElement('div');
  standIn.style.cssText = 'display:block !important; margin:0 !important; padding:0 !important; border:0 !important; height:0 !important;';
  standIn.dataset.stripTop = String(firstTop);
  at.before(standIn);
  return copy;
}

/** Sizes the stand-in of an attached copy, at whatever scale it is drawn. */
export function alignStrip(copy: HTMLElement): void {
  const standIn = copy.querySelector<HTMLElement>('[data-strip-top]');
  const block = standIn?.nextElementSibling;
  if (!standIn || !block) return;
  const box = copy.getBoundingClientRect();
  const scale = copy.offsetWidth ? box.width / copy.offsetWidth : 1;
  const now = (block.getBoundingClientRect().top - box.top) / (scale || 1);
  standIn.style.setProperty('height', `${Math.max(0, Number(standIn.dataset.stripTop) - now)}px`, 'important');
}

/**
 * The flow's top-level blocks reaching into [top, bottom) of the live paper, found by
 * bisection (they stand in document order), with the first one's paper top.
 */
export function flowRange(paper: HTMLElement, top: number, bottom: number): { blocks: HTMLElement[]; firstTop: number } {
  const flow = flowOf(paper);
  const kids = flow.children;
  const base = flow.offsetTop;
  const topOf = (el: HTMLElement) => base + el.offsetTop;
  let lo = 0, hi = kids.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const el = kids[mid] as HTMLElement;
    if (topOf(el) + el.offsetHeight <= top) lo = mid + 1; else hi = mid;
  }
  const blocks: HTMLElement[] = [];
  for (let i = lo; i < kids.length; i++) {
    const el = kids[i] as HTMLElement;
    if (topOf(el) >= bottom) break;
    blocks.push(el);
  }
  return { blocks, firstTop: blocks.length ? topOf(blocks[0]) : 0 };
}

/** The first block that starts on the page, else the one running into it from above. */
export function pageStartBlock(paper: HTMLElement, top: number, bottom: number): HTMLElement | null {
  const { blocks } = flowRange(paper, top, bottom);
  const base = flowOf(paper).offsetTop;
  const real = blocks.filter((el) => !el.hasAttribute('data-page-break-spacer'));
  return real.find((el) => base + el.offsetTop >= top) ?? real[0] ?? null;
}

/** One sheet as the editor lays it out, in unscaled document px. */
export type PageBox = { top: number; left: number; height: number; width: number; section: number };
