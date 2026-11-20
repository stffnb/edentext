import { describe, it, expect } from 'vitest';
import { DEFAULT_SHORTCUTS, matchesEvent, shortcutHint } from '../../src/lib/editor/shortcuts';
import { open, select } from '../trackChangesCases';
import { setLocale } from '../../src/lib/i18n/i18n.svelte';
import { LOCALES, isRtlLocale } from '../../src/lib/i18n/config';

// Two ids on one combo means one of them silently never fires — the table is the only
// place that can catch it, since the bindings are spread over extensions and App.svelte.
describe('shortcut table', () => {
  it('binds every combo exactly once', () => {
    const seen = new Map<string, string>();
    for (const [id, combo] of Object.entries(DEFAULT_SHORTCUTS)) {
      expect(seen.get(combo), `${id} collides with ${seen.get(combo)}`).toBeUndefined();
      seen.set(combo, id);
    }
  });

  it('renders hints in Word/LibreOffice notation', () => {
    expect(shortcutHint('heading1')).toBe('Ctrl+Alt+1');
    expect(shortcutHint('alignCenter')).toBe('Ctrl+E');
    expect(shortcutHint('softHyphen')).toBe('Ctrl+Shift+-');
  });

  // The interface runs the way its language is written, and a key combination keeps
  // its order inside it: bare where the UI reads left to right, isolated where it does not.
  it('keeps a hint left to right in every UI language', async () => {
    for (const l of LOCALES) {
      await setLocale(l, false);
      const rtl = isRtlLocale(l);
      expect(document.documentElement.dir, l).toBe(rtl ? 'rtl' : 'ltr');
      expect(shortcutHint('alignCenter').replace(/^\u2066(.*)\u2069$/, rtl ? '$1' : '$&'), l).toMatch(/^\S+\+E$/);
    }
    await setLocale('en', false);
  });
});

describe('Delete', () => {
  it.each([
    ['in a cell', '<table><tr><td><p style="text-align: center"></p></td></tr></table>', 3],
    ['in the document', '<p style="text-align: center"></p>', 1],
  ])('keeps an empty block alone %s', (_name, html, at) => {
    const editor = open(html);
    select(editor, at);
    editor.commands.keyboardShortcut('Delete');
    expect(JSON.stringify(editor.getJSON())).toContain('"textAlign":"center"');
    editor.destroy();
  });
});

function press(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

describe('matchesEvent', () => {
  it('requires every modifier to agree', () => {
    expect(matchesEvent(press({ key: 'o', ctrlKey: true }), DEFAULT_SHORTCUTS.open)).toBe(true);
    expect(matchesEvent(press({ key: 'o', metaKey: true }), DEFAULT_SHORTCUTS.open)).toBe(true);
    expect(matchesEvent(press({ key: 'o' }), DEFAULT_SHORTCUTS.open)).toBe(false);
    // Ctrl+Shift+S must stay free for strikethrough.
    expect(matchesEvent(press({ key: 'S', ctrlKey: true, shiftKey: true }), DEFAULT_SHORTCUTS.save)).toBe(false);
  });

  it('distinguishes F3 from Shift+F3', () => {
    expect(matchesEvent(press({ key: 'F3' }), DEFAULT_SHORTCUTS.findNext)).toBe(true);
    expect(matchesEvent(press({ key: 'F3', shiftKey: true }), DEFAULT_SHORTCUTS.findNext)).toBe(false);
    expect(matchesEvent(press({ key: 'F3', shiftKey: true }), DEFAULT_SHORTCUTS.findPrevious)).toBe(true);
  });

  it('matches digits by code, so keyboard layouts cannot break zoom reset', () => {
    expect(matchesEvent(press({ key: '0', code: 'Digit0', ctrlKey: true }), DEFAULT_SHORTCUTS.zoomReset)).toBe(true);
    expect(matchesEvent(press({ key: ')', code: 'Numpad0', ctrlKey: true }), DEFAULT_SHORTCUTS.zoomReset)).toBe(true);
  });

  it('accepts every spelling of the zoom keys', () => {
    for (const init of [{ key: '+' }, { key: '=' }, { key: 'Unidentified', code: 'NumpadAdd' }]) {
      expect(matchesEvent(press({ ...init, ctrlKey: true }), DEFAULT_SHORTCUTS.zoomIn)).toBe(true);
    }
    expect(matchesEvent(press({ key: '-', ctrlKey: true }), DEFAULT_SHORTCUTS.zoomOut)).toBe(true);
    expect(matchesEvent(press({ key: '+', ctrlKey: true }), DEFAULT_SHORTCUTS.zoomOut)).toBe(false);
  });
});
