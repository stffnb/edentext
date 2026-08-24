<script lang="ts">
  import { PX_PER_CM } from '../storage/pageMargins';
  import { FOLD_MARK_MM, PUNCH_MARK_MM, MARK_START_MM, FOLD_MARK_LEN_MM, PUNCH_MARK_LEN_MM } from '../storage/foldMarks';

  // Fold + punch marks in the left margin of every page, positioned from the page's
  // own corner in unscaled document px (the zoom transform on .paper covers it).
  let { pageBoxes }: {
    pageBoxes: { top: number; left: number; height: number; width: number }[];
  } = $props();

  const mmToPx = (mm: number) => (mm / 10) * PX_PER_CM;
  // Fold marks sit on both edges (both hands find the crease); the punch mark only on
  // the left, where the pages are filed.
  const marks = [
    ...FOLD_MARK_MM.map((mm) => ({ mm, len: FOLD_MARK_LEN_MM, mirror: true })),
    { mm: PUNCH_MARK_MM, len: PUNCH_MARK_LEN_MM, mirror: false },
  ];
</script>

<div class="fold-mark-layer" aria-hidden="true">
  {#each pageBoxes as box}
    {#each marks as m}
      <span
        class="fold-mark"
        style="top: {box.top + mmToPx(m.mm)}px; left: {box.left + mmToPx(MARK_START_MM)}px; width: {mmToPx(m.len)}px;"
      ></span>
      {#if m.mirror}
        <span
          class="fold-mark"
          style="top: {box.top + mmToPx(m.mm)}px; left: {box.left + box.width - mmToPx(MARK_START_MM + m.len)}px; width: {mmToPx(m.len)}px;"
        ></span>
      {/if}
    {/each}
  {/each}
</div>

<style>
  /* A sibling of the other layers inside the scaled .paper; the marks are the sheet's
     own ink, so they keep the fixed page-text color through every theme. */
  .fold-mark-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .fold-mark {
    position: absolute;
    border-top: 1px solid var(--color-page-text);
  }
</style>
