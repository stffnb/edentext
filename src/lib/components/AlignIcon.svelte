<script lang="ts">
  // The four alignment glyphs, shared by the toolbar's align picker and the style
  // manager so both show the same control.
  export type AlignValue = 'left' | 'center' | 'right' | 'justify';

  let { value }: { value: AlignValue } = $props();

  // Per line: x1 and x2 of the three rules that make up the glyph.
  const LINES: Record<AlignValue, [number, number][]> = {
    left: [[2, 14], [2, 10], [2, 12]],
    center: [[2, 14], [4, 12], [3, 13]],
    right: [[2, 14], [6, 14], [4, 14]],
    justify: [[2, 14], [2, 14], [2, 14]],
  };
</script>

<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
  {#each LINES[value] as [x1, x2], i}
    <line x1={x1} y1={3 + i * 4} x2={x2} y2={3 + i * 4} stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  {/each}
</svg>
