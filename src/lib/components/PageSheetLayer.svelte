<script lang="ts">
  // The sheets themselves, one box per page. A repeating gradient drew them while every
  // page was the same size; a section on its own paper makes the pages differ in height
  // and width, and only a box per page can say that.
  // An inserted blank page shows no page background, as LibreOffice prints it (probed).
  let { pageBoxes, blankPages = [] }: {
    pageBoxes: { top: number; left: number; height: number; width: number }[];
    blankPages?: number[];
  } = $props();
</script>

<div class="page-sheet-layer" aria-hidden="true">
  {#each pageBoxes as box, i}
    <div class="page-sheet" class:blank={blankPages.includes(i + 1)} style="top: {box.top}px; left: {box.left}px; height: {box.height}px; width: {box.width}px;"></div>
  {/each}
</div>

<style>
  /* Behind everything the page carries — the frames behind the text (-150 to -20, stackZ
     in image.ts) and the header/footer background layer at -1. */
  .page-sheet-layer {
    position: absolute;
    inset: 0;
    z-index: -200;
    pointer-events: none;
  }

  .page-sheet {
    position: absolute;
    background: var(--color-page-bg);
    border: 1px solid var(--color-page-border);
    /* The border rings the sheet without growing it, so the page box stays the paper. */
    box-sizing: border-box;
  }
  .page-sheet.blank {
    background: var(--color-page-plain);
  }
</style>
