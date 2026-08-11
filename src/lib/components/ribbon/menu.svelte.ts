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

// The ribbon band clips its own overflow, so a panel inside it has to leave the
// flow: this pins the menu under its wrapper in viewport coordinates and keeps it
// inside the window. Attach to the panel; its parent is the anchor.
export function anchored(node: HTMLElement, align: 'left' | 'right' = 'left') {
  function place() {
    const anchor = node.parentElement;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    node.style.position = 'fixed';
    node.style.top = `${r.bottom + 3}px`;
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
