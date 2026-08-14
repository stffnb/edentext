<script lang="ts">
  // The sheets themselves, one box per page. A repeating gradient drew them while every
  // page was the same size; a section on its own paper makes the pages differ in height
  // and width, and only a box per page can say that.
  let { pageBoxes }: {
    pageBoxes: { top: number; height: number; width: number }[];
  } = $props();
</script>

<div class="page-sheet-layer" aria-hidden="true">
  {#each pageBoxes as box}
    <div class="page-sheet" style="top: {box.top}px; height: {box.height}px; width: {box.width}px;"></div>
  {/each}
</div>

<style>
  /* Behind everything the page carries — the header/footer background layer sits at
     -1, so the sheet has to be under that. */
  .page-sheet-layer {
    position: absolute;
    inset: 0;
    z-index: -2;
    pointer-events: none;
  }

  .page-sheet {
    position: absolute;
    left: 0;
    background: var(--color-page-bg);
    border: 1px solid var(--color-page-border);
    /* The border rings the sheet without growing it, so the page box stays the paper. */
    box-sizing: border-box;
  }
</style>
