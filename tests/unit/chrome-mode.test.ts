// The chrome default is the ribbon; a stored choice wins, and the floating
// island's legacy stored name 'classic' still selects it.
import { describe, it, expect, beforeEach } from 'vitest';
import { loadChromeMode, saveChromeMode } from '../../src/lib/storage/theme';

describe('chrome mode', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to the ribbon', () => {
    expect(loadChromeMode()).toBe('ribbon');
  });

  it('keeps a stored choice, the legacy name included', () => {
    saveChromeMode('modern');
    expect(loadChromeMode()).toBe('modern');
    localStorage.setItem('edentext-chrome', 'classic');
    expect(loadChromeMode()).toBe('modern');
  });
});
