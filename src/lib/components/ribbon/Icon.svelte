<script lang="ts">
  import { STROKED, FILLED, pinnedStroke, type IconName } from './icons';

  let { name, size = 20 }: { name: IconName; size?: number } = $props();

  let stroked = $derived((STROKED as Record<string, readonly string[]>)[name] ?? []);
  let filled = $derived((FILLED as Record<string, readonly string[]>)[name] ?? []);
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width={pinnedStroke(size)}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#each stroked as d}<path {d} />{/each}
  {#each filled as d}<path {d} fill="currentColor" stroke="none" />{/each}
</svg>
