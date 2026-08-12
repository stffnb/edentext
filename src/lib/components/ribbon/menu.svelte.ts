// One open menu at a time, keyed by a string id. Opening any ribbon menu closes
// whichever was open, so no control has to know about its siblings.

let current = $state<string | null>(null);

export function openMenu(): string | null {
  return current;
}

export function isMenuOpen(id: string): boolean {
  return current === id;
}

export function toggleMenu(id: string): void {
  current = current === id ? null : id;
}

export function showMenu(id: string): void {
  current = id;
}

export function closeMenu(): void {
  current = null;
}

// A panel drops below the whole band, not just below its own button: opened
// inside the band it would cover the controls and group labels underneath.
function dropTop(anchor: DOMRect, panel: HTMLElement): number {
  const band = panel.closest('.ribbon-body')?.getBoundingClientRect();
  return Math.max(anchor.bottom, band?.bottom ?? 0) + 3;
}

// The ribbon band clips its own overflow, so a panel inside it has to leave the
// flow: this pins the menu under its wrapper in viewport coordinates and keeps it
// inside the window. Attach to the panel; its parent is the anchor.
export function anchored(node: HTMLElement, align: 'left' | 'right' = 'left') {
  function place() {
    const anchor = node.parentElement;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    node.style.position = 'fixed';
    node.style.top = `${dropTop(r, node)}px`;
    if (align === 'right') {
      node.style.left = 'auto';
      node.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    } else {
      node.style.right = 'auto';
      node.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - node.offsetWidth - 8))}px`;
    }
  }
  place();
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  return {
    destroy() {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    },
  };
}

// A reused picker positions its panel against its own trigger, so the band clips
// it to a sliver. Attach to the band: whatever panel opens inside gets the same
// pinning `anchored` gives the ribbon's own menus, with no prop threading.
export function pinPanels(node: HTMLElement) {
  let panel: HTMLElement | null = null;

  function place() {
    const anchor = panel?.isConnected ? panel.parentElement : null;
    if (!panel || !anchor) return void (panel = null);
    const r = anchor.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.right = 'auto';
    panel.style.top = `${dropTop(r, panel)}px`;
    panel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - panel.offsetWidth - 8))}px`;
  }

  // Only what a picker just mounted, so a permanently absolute element in the
  // band (the hidden file input) is never mistaken for a panel.
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const added of record.addedNodes) {
        if (!(added instanceof HTMLElement)) continue;
        if (getComputedStyle(added).position !== 'absolute') continue;
        panel = added;
        return place();
      }
    }
  });
  observer.observe(node, { childList: true, subtree: true });
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  return {
    destroy() {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    },
  };
}

// Closes the menu when a mousedown lands outside `node`. Attach to the element
// wrapping a trigger and its panel, and name the menu it owns: every wrapper sees
// every mousedown, so without the id each would close a sibling's open menu — and
// the panel would be gone before the click on one of its rows ever fired.
export function clickOutside(node: HTMLElement, id?: string) {
  function handler(e: MouseEvent) {
    if (id !== undefined && !isMenuOpen(id)) return;
    if (!node.contains(e.target as Node)) closeMenu();
  }
  window.addEventListener('mousedown', handler);
  return { destroy() { window.removeEventListener('mousedown', handler); } };
}
