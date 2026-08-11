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

// Closes the shared menu when a mousedown lands outside `node`. Attach to the
// element that wraps a trigger and its panel.
export function clickOutside(node: HTMLElement) {
  function handler(e: MouseEvent) {
    if (!node.contains(e.target as Node)) closeMenu();
  }
  window.addEventListener('mousedown', handler);
  return { destroy() { window.removeEventListener('mousedown', handler); } };
}
