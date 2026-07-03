<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { activeBorderPresets, type BorderPreset } from '../editor/extensions/tableCellBorders';

  let { editor, tick }: { editor: Editor | null; tick: number } = $props();

  let open = $state(false);
  // Pen settings (Word-style): presets apply with the currently chosen width/color.
  let widthPt = $state(0.5);
  let color = $state('#000000');

  const WIDTHS = [0.5, 1, 1.5, 2.25, 3];
  // Greyscale + standard hues (the first two ColorPicker palette rows).
  const COLORS = [
    ['#000000', '#1A1A1A', '#333333', '#4D4D4D', '#666666', '#808080', '#999999', '#B3B3B3', '#CCCCCC', '#FFFFFF'],
    ['#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0'],
  ];

  // Preset icons: 6 segments (outer edges + the two inner grid lines); "on" segments
  // draw solid, the rest as faint guides.
  type Seg = 'top' | 'right' | 'bottom' | 'left' | 'h' | 'v';
  const SEG_PATH: Record<Seg, string> = {
    top: 'M2 2H16', right: 'M16 2V16', bottom: 'M2 16H16', left: 'M2 2V16',
    h: 'M2 9H16', v: 'M9 2V16',
  };
  const ALL_SEGS: Seg[] = ['top', 'right', 'bottom', 'left', 'h', 'v'];
  const PRESETS: { id: BorderPreset | 'none'; title: string; on: Seg[] }[] = [
    { id: 'all', title: 'All borders', on: ['top', 'right', 'bottom', 'left', 'h', 'v'] },
    { id: 'outer', title: 'Outside borders', on: ['top', 'right', 'bottom', 'left'] },
    { id: 'inner', title: 'Inside borders', on: ['h', 'v'] },
    { id: 'innerH', title: 'Inside horizontal border', on: ['h'] },
    { id: 'innerV', title: 'Inside vertical border', on: ['v'] },
    { id: 'top', title: 'Top border', on: ['top'] },
    { id: 'bottom', title: 'Bottom border', on: ['bottom'] },
    { id: 'left', title: 'Left border', on: ['left'] },
    { id: 'right', title: 'Right border', on: ['right'] },
    { id: 'none', title: 'No border', on: [] },
  ];

  // Word-like button states, re-read per transaction (tick) and pen change: a preset
  // is active when its boundaries all render the pen border; 'none' when borderless.
  const active = $derived(
    tick >= 0 && editor ? activeBorderPresets(editor.state, { widthPt, color }) : null,
  );

  // Clicking an inactive preset applies the pen; clicking an active one toggles those
  // borders off (Word behavior). The panel stays open so the states visibly update.
  function apply(id: BorderPreset | 'none') {
    if (!editor) return;
    if (id === 'none') editor.chain().focus().setTableBorders('all', null).run();
    else if (active?.[id]) editor.chain().focus().setTableBorders(id, null).run();
    else editor.chain().focus().setTableBorders(id, { widthPt, color }).run();
  }

  function clickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) open = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }
</script>

<div class="border-picker" use:clickOutside>
  <button
    class="bp-trigger"
    class:active={open}
    title="Borders"
    aria-label="Borders"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="13" height="13" stroke="currentColor" stroke-width="1.3"/>
      <path d="M9 2.5V15.5M2.5 9H15.5" stroke="currentColor" stroke-width="1.1" stroke-dasharray="1.6 1.6"/>
    </svg>
    <svg class="bp-chevron" width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
      <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  {#if open}
    <div class="bp-dropdown">
      <div class="bp-title">Borders</div>
      <div class="bp-presets">
        {#each PRESETS as preset}
          <button
            class="bp-preset"
            class:active={!!active?.[preset.id]}
            title={preset.title}
            aria-label={preset.title}
            aria-pressed={!!active?.[preset.id]}
            onclick={() => apply(preset.id)}
          >
            {#if preset.id === 'none'}
              <!-- Prohibition sign over a faint grid: unmistakably "remove borders". -->
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                {#each ALL_SEGS as seg}
                  <path d={SEG_PATH[seg]} stroke="currentColor" stroke-width="1" opacity="0.22" stroke-dasharray="1.4 1.4"/>
                {/each}
                <circle cx="9" cy="9" r="4.6" fill="var(--color-surface)" stroke="currentColor" stroke-width="1.3"/>
                <path d="M5.9 12.1L12.1 5.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
            {:else}
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                {#each ALL_SEGS as seg}
                  {#if !preset.on.includes(seg)}
                    <path d={SEG_PATH[seg]} stroke="currentColor" stroke-width="1" opacity="0.22" stroke-dasharray="1.4 1.4"/>
                  {/if}
                {/each}
                {#each preset.on as seg}
                  <path d={SEG_PATH[seg]} stroke="currentColor" stroke-width="1.7"/>
                {/each}
              </svg>
            {/if}
          </button>
        {/each}
      </div>

      <div class="bp-title">Line width</div>
      <div class="bp-widths">
        {#each WIDTHS as w}
          <button
            class="bp-width"
            class:active={widthPt === w}
            title="{w}pt"
            aria-label="{w}pt"
            aria-pressed={widthPt === w}
            onclick={() => (widthPt = w)}
          >
            <span class="bp-width-line" style="height: {Math.max(1, Math.round((w * 96) / 72))}px"></span>
          </button>
        {/each}
      </div>

      <div class="bp-title">Line color</div>
      <div class="bp-colors">
        {#each COLORS as row}
          <div class="bp-color-row">
            {#each row as c}
              <button
                class="bp-color"
                class:active={color === c}
                style="background: {c}"
                title={c}
                aria-label={c}
                onclick={() => (color = c)}
              ></button>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .border-picker {
    position: relative;
  }

  .bp-trigger {
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

  .bp-trigger:hover,
  .bp-trigger.active {
    background: var(--color-btn-hover);
  }

  .bp-chevron {
    flex-shrink: 0;
  }

  .bp-dropdown {
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

  .bp-title {
    padding: 0.1rem 0.2rem 0.2rem;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text);
    font-family: var(--font-sans);
    user-select: none;
  }

  .bp-presets {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 2px;
  }

  .bp-preset {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    min-width: unset;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    transition: background 0.1s;
  }

  .bp-preset:hover {
    background: var(--color-btn-hover);
  }

  .bp-preset.active {
    outline: 2px solid var(--color-primary);
    outline-offset: -1px;
  }

  .bp-widths {
    display: flex;
    gap: 2px;
  }

  .bp-width {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    height: 1.4rem;
    min-width: unset;
    padding: 0 4px;
    border: 1px solid var(--color-border);
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    transition: background 0.1s;
  }

  .bp-width:hover {
    background: var(--color-btn-hover);
  }

  .bp-width.active {
    outline: 2px solid var(--color-primary);
    outline-offset: -1px;
  }

  .bp-width-line {
    display: block;
    width: 100%;
    background: currentColor;
  }

  .bp-colors {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .bp-color-row {
    display: flex;
    gap: 2px;
  }

  .bp-color {
    width: 18px;
    height: 18px;
    min-width: unset;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: 2px;
    cursor: pointer;
    transition: transform 0.05s;
  }

  .bp-color:hover {
    transform: scale(1.15);
  }

  .bp-color.active {
    outline: 2px solid var(--color-primary);
    outline-offset: 1px;
  }
</style>
