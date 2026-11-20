// The command search: ranking, accent folding, the English fallback, and that every
// indexed id has a control to click in the ribbon and in the floating island.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import de from '../../src/lib/i18n/locales/de';
import { RIBBON_COMMANDS, searchCommands } from '../../src/lib/components/ribbon/commands';
import { RIBBON_ONLY, islandVia } from '../../src/lib/components/toolbar/island';

const ids = (q: string, recent: string[] = []) => searchCommands(q, RIBBON_COMMANDS, de, recent).map((c) => c.id);

describe('command search', () => {
  it('ranks a label prefix first', () => {
    expect(ids('ta')[0]).toBe('table');
  });

  it('folds umlauts and matches inside a compound', () => {
    expect(ids('rander')).toContain('margins');
  });

  it('matches the English label under another UI language', () => {
    expect(ids('table')[0]).toBe('table');
  });

  it('lists recent commands for an empty query and prefers them on a tie', () => {
    expect(ids('', ['footnote', 'table'])).toEqual(['footnote', 'table']);
    expect(ids('s', ['superscript'])[0]).toBe('superscript');
  });

  // A loop renders `<prefix>-<key>` from a template literal; the Review show-kind
  // snippet takes its id as an argument; a split names its chevron `caretCmd`.
  const carries = (files: string[]) => {
    const src = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    return (id: string) => src.includes(`cmd="${id}"`) || src.includes(`Cmd="${id}"`) || src.includes(`showKind('${id}'`)
      || (id.includes('-') && src.includes(`cmd={\`${id.split('-')[0]}-`));
  };

  it('indexes only ids a control carries', () => {
    const dir = 'src/lib/components/ribbon/';
    const tabs = readdirSync(dir + 'tabs').map((f) => `${dir}tabs/${f}`);
    // A panel both chromes share lives in toolbar/ and is imported by the tab.
    const shared = tabs.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/from '\.\.\/\.\.\/toolbar\/(\w+\.svelte)'/g)].map((m) => `src/lib/components/toolbar/${m[1]}`));
    const has = carries([dir + 'Ribbon.svelte', ...tabs, ...shared]);
    const missing = RIBBON_COMMANDS.filter((c) => !has(c.id) || (c.via && !has(c.via))).map((c) => c.id);
    expect(missing).toEqual([]);
    expect(new Set(RIBBON_COMMANDS.map((c) => c.id)).size).toBe(RIBBON_COMMANDS.length);
  });

  it('finds every command a control in the floating island', () => {
    const dir = 'src/lib/components/';
    const has = carries([
      'src/App.svelte',
      ...['Toolbar', 'ToolbarExpanded', 'AlignButton', 'TableToolbar', 'ImageToolbar', 'TextBoxToolbar', 'HeaderFooterLayer']
        .map((f) => `${dir}${f}.svelte`),
      ...readdirSync(dir + 'toolbar').filter((f) => f.endsWith('.svelte')).map((f) => `${dir}toolbar/${f}`),
    ]);
    const shown = RIBBON_COMMANDS.filter((c) => !RIBBON_ONLY.has(c.id));
    const missing = shown.filter((c) => !has(c.id) || (islandVia(c) && !has(islandVia(c)!))).map((c) => c.id);
    expect(missing).toEqual([]);
  });
});
