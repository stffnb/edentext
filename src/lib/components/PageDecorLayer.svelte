<script lang="ts">
  import { pageDimsCm, type PageFormat } from '../storage/pageFormat';
  import { cmToPx, PX_PER_CM, type PageMargins } from '../storage/pageMargins';
  import type { Orientation } from '../storage/pageOrientation';
  import type { PageDecor } from '../storage/pageDecor';

  // The page's border and watermark, one box per page — the background itself is a
  // custom property on .paper, which already paints the sheet. Geometry is unscaled
  // document px: the layer sits inside .paper, so the zoom transform covers it.
  let { decor, numPages, pageMargins, pageFormat, orientation }: {
    decor: PageDecor;
    numPages: number;
    pageMargins: PageMargins;
    pageFormat: PageFormat;
    orientation: Orientation;
  } = $props();

  const PAGE_GAP = 20;
  // The watermark's aspect ratio, measured off LibreOffice's own shape.
  const WATERMARK_RATIO = 4.487;

  let dims = $derived(pageDimsCm(pageFormat, orientation));
  let pageHeightPx = $derived(dims.h * PX_PER_CM);
  let cycle = $derived(pageHeightPx + PAGE_GAP);
  let pages = $derived(Array.from({ length: Math.max(1, numPages) }, (_, i) => i + 1));

  // The border rings the text area, grown by its own padding — where ODF's fo:padding
  // and Word's w:space put it.
  let inset = $derived.by(() => {
    const pad = cmToPx(decor.border?.paddingCm ?? 0);
    const swap = (page: number) => pageMargins.mirrored === true && page % 2 === 0;
    return (page: number) => ({
      top: cmToPx(pageMargins.top) - pad,
      bottom: cmToPx(pageMargins.bottom) - pad,
      left: cmToPx(swap(page) ? pageMargins.right : pageMargins.left) - pad,
      right: cmToPx(swap(page) ? pageMargins.left : pageMargins.right) - pad,
    });
  });

  let markWidth = $derived((dims.w - pageMargins.left - pageMargins.right) * PX_PER_CM);
</script>

<div class="page-decor-layer" aria-hidden="true">
  {#each pages as p}
    {#if decor.border}
      {@const box = inset(p)}
      <div
        class="page-border"
        style="top: {(p - 1) * cycle + box.top}px; left: {box.left}px;
               width: {dims.w * PX_PER_CM - box.left - box.right}px;
               height: {pageHeightPx - box.top - box.bottom}px;
               border: {decor.border.widthPt}pt solid {decor.border.color};"
      ></div>
    {/if}
    {#if decor.watermark}
      <div class="watermark" style="top: {(p - 1) * cycle}px; height: {pageHeightPx}px;">
        <!-- A fontwork shape stretches its text to the box rather than setting it at a
             size, which is what textLength does here — the box is the text width, as
             LibreOffice sizes its own watermark. -->
        <svg
          width={markWidth}
          height={markWidth / WATERMARK_RATIO}
          viewBox="0 0 {markWidth} {markWidth / WATERMARK_RATIO}"
          style="transform: rotate({-decor.watermark.angle}deg); opacity: {1 - decor.watermark.transparency / 100};"
          aria-hidden="true"
        >
          <text
            x="0"
            y={markWidth / WATERMARK_RATIO / 2}
            dominant-baseline="central"
            textLength={markWidth}
            lengthAdjust="spacingAndGlyphs"
            font-family="{decor.watermark.font}, sans-serif"
            font-size={markWidth / WATERMARK_RATIO}
            font-weight="700"
            fill={decor.watermark.color}
          >{decor.watermark.text}</text>
        </svg>
      </div>
    {/if}
  {/each}
</div>

<style>
  /* Below the body text, like .hf-bg-layer: both word processors draw the watermark
     behind what is written over it. */
  .page-decor-layer {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
  }

  .page-border,
  .watermark {
    position: absolute;
  }

  .watermark {
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .watermark svg {
    overflow: visible;
  }
</style>
