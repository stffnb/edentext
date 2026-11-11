<script lang="ts">
  import type { Snippet } from 'svelte';
  import { reading } from '../collab/reading.svelte';

  // Greys every control inside while the tab reads along: a disabled fieldset disables
  // its descendants, and `display: contents` keeps it out of the layout.
  let { children }: { children: Snippet } = $props();
</script>

<fieldset class="read-gate" disabled={reading()}>{@render children()}</fieldset>

<style>
  .read-gate { display: contents; }
</style>
