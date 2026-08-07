<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { activeTableLook, activeTableStyle, styleRegions } from '../editor/extensions/tableStyle';
  import { DEFAULT_TABLE_LOOK } from '../styles/tableStyles';
  import { styleSheet } from '../styles/sheet.svelte';
  import { previewCellCss, previewTextCss, styleLook, type TableRegion } from '../styles/tableStyles';
  import { t } from '../i18n/i18n.svelte';

  let { editor, tick }: { editor: Editor | null; tick: number } = $props();

  let open = $state(false);
  const sheet = $derived(styleSheet());
  const styles = $derived(Object.values(sheet.table ?? {}));
  const current = $derived(tick >= 0 && editor ? activeTableStyle(editor.state) : null);
  // Word's Table Style Options: the tiles preview the table's own options, and an option
  // the current style doesn't paint is shown disabled.
  const look = $derived(tick >= 0 && editor ? activeTableLook(editor.state) : null);
  const painted = $derived(new Set(styleRegions(current ? sheet.table?.[current] : undefined)));
  // Word's order in the ribbon, reading down each column.
  const OPTIONS: TableRegion[] = ['headerRow', 'lastRow', 'firstColumn', 'lastColumn', 'bandedRow', 'bandedColumn'];

  function toggle(region: TableRegion, on: boolean) {
    editor?.chain().focus().setTableLook(region, on).run();
  }

  // A tile shows the style on a small grid, painted by the same resolver that paints the
  // real table — so a preview can never disagree with what applying it does.
  const ROWS = 4;
  const COLS = 3;

  function styleLabel(name: string): string {
    return (t().table.styleNames as Record<string, string>)[name] ?? name;
  }

  function apply(name: string | null) {
    open = false;
    editor?.chain().focus().setTableStyle(name).run();
  }

  function clickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) open = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }
</script>

<div class="style-picker" use:clickOutside>
  <button
    class="tsp-trigger"
    class:active={open}
    title={t().table.tableStyle}
    aria-label={t().table.tableStyle}
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="15" height="15" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <rect x="1.5" y="1.5" width="15" height="4.5" fill="currentColor" opacity="0.55"/>
      <rect x="1.5" y="10.5" width="15" height="3" fill="currentColor" opacity="0.25"/>
    </svg>
    <svg class="tsp-chevron" width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
      <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  {#if open}
    <div class="tsp-dropdown">
      <div class="tsp-title">{t().table.tableStyle}</div>
      <div class="tsp-body">
      <div class="tsp-grid">
        <button
          class="tsp-tile"
          class:active={current === null}
          title={t().table.noTableStyle}
          aria-pressed={current === null}
          onclick={() => apply(null)}
        >
          <span class="tsp-none" aria-hidden="true">
            <svg width="34" height="26" viewBox="0 0 34 26" fill="none">
              <rect x="1" y="1" width="32" height="24" stroke="currentColor" stroke-width="1" opacity="0.35"/>
              <path d="M6 20L28 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
          </span>
          <span class="tsp-name">{t().table.noTableStyle}</span>
        </button>

        {#each styles as style (style.name)}
          {@const tileLook = styleLook(style, look ?? DEFAULT_TABLE_LOOK)}
          <button
            class="tsp-tile"
            class:active={current === style.name}
            title={styleLabel(style.name)}
            aria-pressed={current === style.name}
            onclick={() => apply(style.name)}
          >
            <table class="tsp-preview" aria-hidden="true">
              <tbody>
                {#each Array(ROWS) as _, r}
                  <tr>
                    {#each Array(COLS) as _, c}
                      <td style={previewCellCss(style, r, c, ROWS, COLS, tileLook)}>
                        <i class="tsp-text" style={previewTextCss(style, r, c, ROWS, COLS, tileLook)}></i>
                      </td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
            <span class="tsp-name">{styleLabel(style.name)}</span>
          </button>
        {/each}
      </div>

      <div class="tsp-options">
        <div class="tsp-title">{t().table.styleOptions}</div>
        <!-- Without a style nothing is in effect yet, so the boxes read clear. -->
        {#each OPTIONS as region}
          <label class="tsp-option" class:muted={!painted.has(region)}>
            <input
              type="checkbox"
              checked={!!current && !!look?.[region]}
              disabled={!current}
              onchange={(e) => toggle(region, e.currentTarget.checked)}
            />
            {t().styles.regions[region]}
          </label>
        {/each}
      </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .style-picker {
    position: relative;
  }

  .tsp-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 1px;
    height: 1.7rem;
    min-width: unset;
    padding: 0 3px;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }

  .tsp-trigger:hover,
  .tsp-trigger.active {
    background: var(--color-btn-hover);
  }

  .tsp-chevron {
    flex-shrink: 0;
  }

  .tsp-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    z-index: 200;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  }

  .tsp-title {
    padding: 0.1rem 0.2rem 0.2rem;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text);
    font-family: var(--font-sans);
    user-select: none;
  }

  /* Tiles and options side by side. */
  .tsp-body {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .tsp-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 3px;
    /* The gallery grew past the toolbar's height; keep the panel scrollable. */
    max-height: 21rem;
    overflow-y: auto;
  }

  .tsp-options {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-left: 8px;
    border-left: 1px solid var(--color-border);
  }

  .tsp-option {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.15rem 0.1rem;
    font-family: var(--font-sans);
    font-size: 0.7rem;
    color: var(--color-text);
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
  }

  .tsp-option input {
    margin: 0;
    cursor: pointer;
  }

  /* The current style doesn't paint this area, so the toggle has no visible effect. */
  .tsp-option.muted {
    color: var(--color-text-muted);
  }

  .tsp-option:has(input:disabled) {
    opacity: 0.5;
    cursor: default;
  }

  .tsp-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    width: 5.4rem;
    min-width: unset;
    padding: 4px 3px 3px;
    border: 1px solid var(--color-border);
    border-radius: calc(var(--radius) - 2px);
    background: var(--color-bg);
    color: var(--color-text);
    cursor: pointer;
    transition: background 0.1s;
  }

  .tsp-tile:hover {
    background: var(--color-btn-hover);
  }

  .tsp-tile.active {
    outline: 2px solid var(--color-primary);
    outline-offset: -1px;
  }

  .tsp-preview {
    width: 38px;
    table-layout: fixed;
    border-collapse: collapse;
    background: var(--color-page-bg);
    color: var(--color-page-text);
  }

  .tsp-preview td {
    height: 8px;
    padding: 0 1px;
  }

  /* The schematic text line; its weight is what makes a bold-only region visible. */
  .tsp-text {
    display: block;
    width: 100%;
  }

  .tsp-none {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 28px;
    color: var(--color-text);
  }

  .tsp-name {
    font-family: var(--font-sans);
    font-size: 0.6rem;
    line-height: 1.1;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    user-select: none;
  }
</style>
