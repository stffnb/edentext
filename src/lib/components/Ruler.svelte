<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { PX_PER_CM, type PageMargins } from '../storage/pageMargins';
  import { activeTabStops, type TabAlign, type TabStop } from '../editor/extensions/tabStops';
  import { t } from '../i18n/i18n.svelte';

  // Horizontal ruler: the tab stops and indents of the block the cursor is in.
  // Positions are cm from the left text margin, the attr's own origin.
  let { editor, tick, zoom, width, margins }: {
    editor: Editor | null;
    tick: number;
    zoom: number;
    width: number; // the page's SCALED width in px (.paper-scaler's)
    margins: PageMargins;
  } = $props();

  const TYPES: TabAlign[] = ['left', 'center', 'right', 'decimal'];
  const SNAP_CM = 0.05;
  const DRAG_OFF_PX = 18; // pulled this far off the ruler = drop the stop

  let type = $state<TabAlign>('left');
  let strip: HTMLDivElement;

  const scale = $derived(zoom / 100);
  const pageCm = $derived(scale > 0 ? width / scale / PX_PER_CM : 0);
  // The block under the cursor; `tick` re-evaluates it on every transaction.
  const info = $derived(tick >= 0 && editor ? activeTabStops(editor.state) : null);

  // cm from the left text margin → px within the strip, and back.
  const px = (cm: number) => (margins.left + cm) * PX_PER_CM * scale;
  const cmAt = (clientX: number) =>
    Math.round(((clientX - strip.getBoundingClientRect().left) / scale / PX_PER_CM - margins.left) / SNAP_CM) * SNAP_CM;

  const textCm = $derived(Math.max(0, pageCm - margins.left - margins.right));
  const ticks = $derived(Array.from({ length: Math.ceil(pageCm) + 1 }, (_, i) => i - Math.floor(margins.left)));

  // Marker glyphs in a shared 10×10 box: L / ⊥ / ⅃, plus ⊥ with a dot for decimal. The
  // stem is the stop's own position, so it stays centred in the box and the foot's
  // direction carries the type.
  const MARK: Record<TabAlign, string> = {
    left: 'M5,1 V9 M4.2,9 H9.5',
    center: 'M5,1 V9 M0.5,9 H9.5',
    right: 'M5,1 V9 M0.5,9 H5.8',
    decimal: 'M5,1 V9 M0.5,9 H9.5',
  };

  type Drag =
    | { kind: 'stop'; index: number }
    | { kind: 'indent' }
    | { kind: 'indentRight' }
    | { kind: 'first' };
  let drag = $state<{ target: Drag; cm: number; off: boolean } | null>(null);

  function apply(stops: TabStop[]) {
    editor?.chain().focus().setTabStops(stops).run();
  }

  function start(event: PointerEvent, target: Drag) {
    if (!editor || !info || event.button !== 0) return;
    event.preventDefault(); // keep the caret (and thus the target block) where it is
    event.stopPropagation();
    strip.setPointerCapture(event.pointerId);
    drag = { target, cm: cmAt(event.clientX), off: false };
  }

  function move(event: PointerEvent) {
    if (!drag) return;
    const rect = strip.getBoundingClientRect();
    const off = event.clientY < rect.top - DRAG_OFF_PX || event.clientY > rect.bottom + DRAG_OFF_PX;
    drag = { ...drag, cm: cmAt(event.clientX), off: drag.target.kind === 'stop' && off };
  }

  function end(event: PointerEvent) {
    if (!drag || !info) return;
    const { target, cm, off } = drag;
    drag = null;
    strip.releasePointerCapture(event.pointerId);
    if (target.kind === 'stop') {
      const rest = info.stops.filter((_, i) => i !== target.index);
      apply(off ? rest : [...rest, { pos: cm, align: info.stops[target.index].align }]);
    } else if (target.kind === 'indent') {
      // Moves the whole block: the first line keeps its offset from the indent.
      editor?.chain().focus().setIndent(Math.max(0, cm)).run();
    } else if (target.kind === 'indentRight') {
      // Measured from the right text edge inwards, mirroring the left indent. Snapped
      // again: the pointer's own snap doesn't survive the subtraction from textCm.
      const snapped = Math.round(Math.max(0, textCm - cm) / SNAP_CM) * SNAP_CM;
      editor?.chain().focus().setIndentRight(snapped).run();
    } else {
      editor?.chain().focus().setIndentFirst(cm - info.indent).run();
    }
  }

  // A click on empty ruler adds a stop of the selected type.
  function addStop(event: PointerEvent) {
    if (!editor || !info || event.button !== 0) return;
    const cm = cmAt(event.clientX);
    if (cm <= 0 || cm >= textCm) return;
    event.preventDefault();
    apply([...info.stops, { pos: cm, align: type }]);
  }

  const preview = $derived(drag && !drag.off ? drag.cm : null);

  // Is this the marker being dragged, and where does it draw? While dragging it
  // follows the pointer, otherwise it sits at its stored position.
  const dragging = (t: Drag) => !!drag && drag.target.kind === t.kind
    && (t.kind !== 'stop' || (drag.target as { index: number }).index === t.index);
  const at = (t: Drag, stored: number) => (dragging(t) && preview != null ? preview : stored);
</script>

<div class="ruler" style="width: {width}px">
  <button
    class="tab-type"
    onpointerdown={(e) => e.preventDefault()}
    onclick={() => (type = TYPES[(TYPES.indexOf(type) + 1) % TYPES.length])}
    title={t().ruler.tabType[type]}
  >
    <svg viewBox="0 0 10 10"><path d={MARK[type]} /><circle cx="7.8" cy="6.6" r="1.1" class:hide={type !== 'decimal'} /></svg>
  </button>

  <div
    class="strip"
    bind:this={strip}
    onpointerdown={addStop}
    onpointermove={move}
    onpointerup={end}
    onpointercancel={end}
    role="presentation"
  >
    <div class="margin" style="left: 0; width: {px(0)}px"></div>
    <div class="margin" style="left: {px(textCm)}px"></div>

    {#each ticks as cm (cm)}
      {#if px(cm) >= 0 && px(cm) <= width}
        <div class="tick" style="left: {px(cm)}px">
          {#if cm > 0 && cm < textCm}<span>{cm}</span>{/if}
        </div>
      {/if}
    {/each}

    {#if info}
      {#each info.stops as stop, i (i)}
        <div
          class="stop"
          class:dragging={dragging({ kind: 'stop', index: i })}
          style="left: {px(at({ kind: 'stop', index: i }, stop.pos))}px"
          onpointerdown={(e) => start(e, { kind: 'stop', index: i })}
          role="presentation"
          title={t().ruler.tabType[stop.align]}
        >
          <svg viewBox="0 0 10 10"><path d={MARK[stop.align]} /><circle cx="7.8" cy="6.6" r="1.1" class:hide={stop.align !== 'decimal'} /></svg>
        </div>
      {/each}

      <div
        class="indent top"
        style="left: {px(at({ kind: 'first' }, info.indent + info.indentFirst))}px"
        onpointerdown={(e) => start(e, { kind: 'first' })}
        role="presentation"
        title={t().ruler.firstLineIndent}
      ></div>
      <div
        class="indent bottom"
        style="left: {px(at({ kind: 'indent' }, info.indent))}px"
        onpointerdown={(e) => start(e, { kind: 'indent' })}
        role="presentation"
        title={t().ruler.leftIndent}
      ></div>
      <div
        class="indent bottom"
        style="left: {px(at({ kind: 'indentRight' }, textCm - info.indentRight))}px"
        onpointerdown={(e) => start(e, { kind: 'indentRight' })}
        role="presentation"
        title={t().ruler.rightIndent}
      ></div>
    {/if}
  </div>
</div>

<style>
  .ruler {
    /* Sticky against .editor's content box, which already clears the toolbar island.
       The negative margin eats most of that padding (it was spacing the page, not a
       ruler); `top` matches it, or the bar would jump down that far once it scrolls. */
    position: sticky;
    top: -1.125rem;
    z-index: 5;
    margin: -1.125rem auto 0.5rem;
    height: 22px;
    display: flex;
    align-items: stretch;
    user-select: none;
    color: var(--color-text);
  }

  .tab-type {
    position: absolute;
    left: -28px;
    width: 22px;
    height: 22px;
    padding: 2px;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
  }

  /* The bar is chrome, not page: --color-surface separates it from the editor
     background in every theme (which --color-bg, being that background, did not). */
  .strip {
    position: relative;
    flex: 1;
    background: var(--color-surface);
    /* --color-border is a hairline meant for white-on-white panels; against the
       editor background the bar needs its own outline to read as one object. */
    border: 1px solid color-mix(in srgb, var(--color-text) 25%, transparent);
    border-radius: 2px;
    overflow: hidden;
    cursor: default;
  }

  /* The margins are shaded, the printable column left plain. A currentColor tint
     darkens a light bar and lightens a dark one, so one rule fits every theme. */
  .margin {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    background: currentColor;
    opacity: 0.18;
  }

  .tick {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    transform: translateX(-0.5px);
  }

  /* The mark itself sits along the top edge, clear of the tab markers below. */
  .tick::before {
    content: '';
    position: absolute;
    top: 0;
    height: 4px;
    border-left: 1px solid currentColor;
    opacity: 0.55;
  }

  .tick span {
    position: absolute;
    left: 50%;
    top:50%;
    transform: translate(-50%, -50%);
    font-size: 10px;
    line-height: 1;
    color: var(--color-text);
    opacity: 0.8;
  }

  .stop {
    position: absolute;
    bottom: 0;
    width: 11px;
    height: 11px;
    margin-left: -5.5px;
    cursor: ew-resize;
    color: var(--color-text);
  }

  .stop.dragging {
    opacity: 0.6;
  }

  /* Block, or the svg sits on the text baseline: it hung 3px below its box and the
     strip's overflow clipped the glyph's foot, leaving every type a bare stem. */
  svg {
    display: block;
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
  }

  circle {
    fill: currentColor;
    stroke: none;
  }

  .hide {
    display: none;
  }

  /* Indent handles: first line points down from the top edge, the block's left
     indent points up from the bottom edge. */
  .indent {
    position: absolute;
    width: 0;
    height: 0;
    margin-left: -5px;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    cursor: ew-resize;
  }

  .indent.top {
    top: 0;
    border-top: 6px solid var(--color-primary);
  }

  .indent.bottom {
    bottom: 0;
    border-bottom: 6px solid var(--color-primary);
  }
</style>
