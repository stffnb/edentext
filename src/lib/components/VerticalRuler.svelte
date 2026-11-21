<script lang="ts">
  import { MIN_CONTENT_CM, PX_PER_CM } from '../storage/pageMargins';
  import { formatDecimal } from '../i18n/number';
  import { t } from '../i18n/i18n.svelte';
  import { scaleMarks, snapCm, SNAP_CM } from './rulerScale';

  type Band = { top: number; height: number } | null;
  // Vertical ruler: the measured page's height beside it, top and bottom margin shaded and
  // draggable, a header or footer band as a section of its own. cm count from the top of the
  // text area, or of the open zone. Lives in .paper-scaler, so it scrolls with the page.
  let { zoom, page, end = false, editable = true, onMargin }: {
    zoom: number;
    // Unscaled px: the page's box in .paper; margins in cm; bands from the page top.
    page: { top: number; left: number; width: number; height: number; margins: { top: number; bottom: number };
      header: Band; footer: Band; editing: 'header' | 'footer' | null };
    end?: boolean; // the interface's end side: on the right in a right-to-left interface
    editable?: boolean;
    onMargin: (edge: 'top' | 'bottom', cm: number) => void;
  } = $props();

  const MAX_MARGIN_CM = 10; // the page setup fields' own limit
  const LABEL_CLEAR_PX = 9; // a number this close to the bottom handle would sit under it
  let strip = $state<HTMLDivElement>();

  const scale = $derived(zoom / 100);
  const pageCm = $derived(page.height / PX_PER_CM);
  const header = $derived(page.header);
  const footer = $derived(page.footer);

  type Edge = 'top' | 'bottom';
  let drag = $state<{ edge: Edge; cm: number; from: number; grab: number } | null>(null);
  // A margin as the ruler shows it: the dragged one follows the pointer.
  const marginOf = (edge: Edge) => (drag?.edge === edge ? drag.cm : page.margins[edge]);

  // The white column: the open zone, else the body between margins and the zones' reach.
  const span = $derived.by(() => {
    const zone = page.editing === 'header' ? header : page.editing === 'footer' ? footer : null;
    if (zone) return { from: zone.top / PX_PER_CM, to: (zone.top + zone.height) / PX_PER_CM };
    const from = Math.max(marginOf('top'), header ? (header.top + header.height) / PX_PER_CM : 0);
    const to = pageCm - Math.max(marginOf('bottom'), footer ? (page.height - footer.top) / PX_PER_CM : 0);
    return { from, to: Math.max(from, to) };
  });
  const originCm = $derived(span.from);
  const textCm = $derived(span.to - span.from);
  // cm from the page top → px down the strip.
  const y = (cm: number) => cm * PX_PER_CM * scale;
  const { ticks, subTicks, labelEvery } = $derived(scaleMarks(originCm, pageCm, scale));
  const onPage = (cm: number) => cm >= -originCm && cm <= pageCm - originCm;

  // Each margin keeps the other plus a strip of text clear, as the page setup does.
  const maxOf = (edge: Edge) =>
    Math.max(0, Math.min(MAX_MARGIN_CM, pageCm - page.margins[edge === 'top' ? 'bottom' : 'top'] - MIN_CONTENT_CM));
  // Rounded to the hundredth, so a stored margin never carries the snap's float noise.
  const clamp = (edge: Edge, cm: number) => Math.round(snapCm(Math.min(maxOf(edge), Math.max(0, cm))) * 100) / 100;
  const handleCm = (edge: Edge) => (edge === 'top' ? marginOf('top') : pageCm - marginOf('bottom'));
  const pointerCm = (clientY: number) => (clientY - strip!.getBoundingClientRect().top) / scale / PX_PER_CM;

  function start(event: PointerEvent, edge: Edge) {
    if (!editable || event.button !== 0) return;
    event.preventDefault(); // the caret, and thus the measured page, stays put
    strip!.setPointerCapture(event.pointerId);
    // Moved by the pointer's travel, so a grab off the handle's centre does not nudge it.
    drag = { edge, cm: page.margins[edge], from: page.margins[edge], grab: pointerCm(event.clientY) };
  }

  function move(event: PointerEvent) {
    if (!drag) return;
    const travel = pointerCm(event.clientY) - drag.grab;
    drag = { ...drag, cm: clamp(drag.edge, drag.from + (drag.edge === 'top' ? travel : -travel)) };
  }

  function finish(event: PointerEvent) {
    if (!drag) return;
    const { edge, cm, from } = drag;
    drag = null;
    strip!.releasePointerCapture(event.pointerId);
    if (cm !== from) onMargin(edge, cm);
  }

  // The arrow moves the boundary the way it points, one snap step at a time.
  function key(event: KeyboardEvent, edge: Edge) {
    if (!editable || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const down = event.key === 'ArrowDown' ? 1 : -1;
    const next = clamp(edge, page.margins[edge] + (edge === 'top' ? down : -down) * SNAP_CM);
    if (next !== page.margins[edge]) onMargin(edge, next);
  }

  const label = (edge: Edge) => (edge === 'top' ? t().ruler.topMargin : t().ruler.bottomMargin);
</script>

<!-- A rail of no height at the page's top, inset to the page's own side edge (a page
     narrower than the widest is centred); the strip inside sticks to the scroller's side
     edge when the page scrolls sideways and moves with it up and down. -->
<div class="vruler-rail" class:end style="padding-{end ? 'right' : 'left'}: {page.left * scale}px">
  <div class="vruler" dir="ltr">
    <div
      class="strip"
      bind:this={strip}
      style="top: {page.top * scale}px; height: {page.height * scale}px"
      onpointermove={move}
      onpointerup={finish}
      onpointercancel={finish}
      role="presentation"
    >
      <div class="margin" style="top: 0; height: {y(span.from)}px"></div>
      <div class="margin" style="top: {y(span.to)}px; bottom: 0"></div>
      {#each [header, footer] as band}
        {#if band && !page.editing}
          <div class="zone" style="top: {y(band.top / PX_PER_CM)}px; height: {y(band.height / PX_PER_CM)}px"></div>
        {/if}
      {/each}

      {#each ticks as cm (cm)}
        {#if onPage(cm)}
          <div class="tick" style="top: {y(originCm + cm)}px">
            {#if cm > 0 && y(textCm - cm) >= LABEL_CLEAR_PX && cm % labelEvery === 0}<span>{cm}</span>{/if}
          </div>
        {/if}
      {/each}
      {#each subTicks as cm (cm)}
        {#if onPage(cm)}
          <div class="sub" class:half={Math.abs(cm % 1) === 0.5} style="top: {y(originCm + cm)}px"></div>
        {/if}
      {/each}

      {#if !page.editing}
        {#each ['top', 'bottom'] as const as edge (edge)}
          <div
            class="handle"
            class:dragging={drag?.edge === edge}
            class:locked={!editable}
            style="top: {y(handleCm(edge))}px"
            role="slider"
            tabindex={editable ? 0 : -1}
            aria-orientation="vertical"
            aria-label={label(edge)}
            aria-disabled={!editable}
            aria-valuemin={0}
            aria-valuemax={Math.round(maxOf(edge) * 100) / 100}
            aria-valuenow={Math.round(marginOf(edge) * 100) / 100}
            aria-valuetext={`${formatDecimal(Math.round(marginOf(edge) * 100) / 100)} cm`}
            title={label(edge)}
            onpointerdown={(e) => start(e, edge)}
            onkeydown={(e) => key(e, edge)}
          ></div>
        {/each}
      {/if}
    </div>
  </div>
</div>

{#if drag}
  <!-- Where the text area will begin or end, across the page. -->
  <div class="vruler-guide" style="top: {(page.top + handleCm(drag.edge) * PX_PER_CM) * scale}px; left: {page.left * scale}px; width: {page.width * scale}px"></div>
{/if}

<style>
  /* Flex, so the sticky strip keeps its negative margin: it hangs just outside the canvas,
     under the horizontal ruler's tab-type button, and needs .editor's extra side padding. */
  .vruler-rail {
    display: flex;
    box-sizing: border-box;
    height: 0;
  }

  .vruler-rail.end {
    justify-content: flex-end;
  }

  /* Sticky offsets count from inside .editor's padding; these reach its outer edge. */
  .vruler {
    position: sticky;
    left: calc(-1rem - 28px);
    z-index: 4; /* under the horizontal ruler (5) where the two meet */
    flex: none;
    width: 22px;
    margin-left: -28px;
    user-select: none;
    color: var(--color-text);
  }

  .end .vruler {
    left: auto;
    right: calc(-1rem - 28px);
    margin-left: 0;
    margin-right: -28px;
  }

  .strip {
    position: absolute;
    left: 0;
    width: 22px;
    box-sizing: border-box;
    background: var(--color-surface);
    /* Drawn inside rather than as a border, so marks count from the page's own top edge. */
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-text) 25%, transparent);
    border-radius: 2px;
    overflow: hidden;
  }

  .margin, .zone {
    position: absolute;
    left: 0;
    right: 0;
    background: currentColor;
    opacity: 0.18;
  }

  /* A header or footer: lighter than the margin around it, edged on both sides. */
  .zone {
    opacity: 0.08;
    border-block: 1px solid currentColor;
  }

  .tick {
    position: absolute;
    left: 0;
    right: 0;
    height: 0;
    transform: translateY(-0.5px);
  }

  /* The mark sits along the edge away from the page, as the horizontal one's along the top. */
  .tick::before {
    content: '';
    position: absolute;
    left: 0;
    width: 4px;
    border-top: 1px solid currentColor;
    opacity: 0.55;
  }

  .end .tick::before {
    left: auto;
    right: 0;
  }

  .sub {
    position: absolute;
    left: 50%;
    width: 3px;
    border-top: 1px solid currentColor;
    opacity: 0.45;
    transform: translate(-50%, -0.5px);
  }

  .sub.half {
    width: 7px;
  }

  /* Turned a quarter, reading bottom to top, as the vertical rulers of word processors are. */
  .tick span {
    position: absolute;
    left: 50%;
    top: 0;
    transform: translate(-50%, -50%) rotate(-90deg);
    font-size: 10px;
    line-height: 1;
    color: var(--color-text);
    opacity: 0.8;
  }

  /* The margin boundary: a bar across the strip, grabbed to move it. */
  .handle {
    position: absolute;
    left: 0;
    right: 0;
    height: 7px;
    margin-top: -3.5px;
    cursor: ns-resize;
    touch-action: none;
  }

  .handle::after {
    content: '';
    position: absolute;
    left: 2px;
    right: 2px;
    top: 2.5px;
    height: 2px;
    border-radius: 1px;
    background: var(--w-accent);
  }

  .handle.locked {
    cursor: default;
  }

  .handle.locked::after {
    background: currentColor;
    opacity: 0.4;
  }

  .handle:focus-visible {
    outline: 2px solid var(--w-accent);
    outline-offset: -1px;
  }

  .handle.dragging::after {
    opacity: 0.6;
  }

  .vruler-guide {
    position: absolute;
    z-index: 4;
    height: 0;
    border-top: 1px dashed var(--w-accent);
    pointer-events: none;
  }

  @media print {
    .vruler-rail, .vruler-guide {
      display: none;
    }
  }
</style>
