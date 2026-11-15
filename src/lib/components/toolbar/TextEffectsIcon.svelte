<script lang="ts">
  // The text-effects button's glyph: a light letter with a coloured outline and a soft halo,
  // so it reads as a styled letter rather than a bold one. Colours come from --fx-icon-*.
  let { size = 16 }: { size?: number } = $props();

  const LETTER = 'M2.2 14 6.6 2h2.8l4.4 12h-2.6l-1-2.9H5.8l-1 2.9ZM6.56 9.2h2.88L8 5.3Z';
</script>

<svg class="fx-icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
  <path d={LETTER} fill="none" stroke="var(--fx-icon-glow)" stroke-width="2.6" stroke-linejoin="round" />
  <path d={LETTER} fill="var(--fx-icon-fill)" fill-rule="evenodd" stroke="var(--fx-icon-line)" stroke-width="1.1" stroke-linejoin="round" />
</svg>

<style>
  /* On the island's filled active button the edge turns white and the colour moves inside. */
  :global(.ib.active) .fx-icon path:first-child { stroke: none; }
  :global(.ib.active) .fx-icon path:last-child { fill: var(--fx-icon-line); stroke: currentColor; }

  /* System colours replace the palette in forced-colours mode, so the letter keeps its edge. */
  @media (forced-colors: active) {
    .fx-icon path { stroke: CanvasText; }
    .fx-icon path:first-child { stroke: none; }
    .fx-icon path:last-child { fill: Canvas; }
  }
</style>
