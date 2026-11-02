<script lang="ts">
  // A docked pane's inner edge: drag it, or arrow-key it, to make the pane wider or
  // narrower; a double-click goes back to the default. The pane clamps and keeps the width.
  let { width, min, left = false, label, onWidth, onReset }: {
    width: number;
    min: number;
    /** The pane is docked left, so its handle is on its right edge. */
    left?: boolean;
    label: string;
    onWidth: (w: number) => void;
    onReset: () => void;
  } = $props();

  function startResize(e: PointerEvent) {
    const handle = e.currentTarget as HTMLElement;
    const x0 = e.clientX;
    const w0 = width;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onWidth(w0 + (left ? ev.clientX - x0 : x0 - ev.clientX));
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    e.preventDefault();
  }

  function resizeKey(e: KeyboardEvent) {
    const step = e.shiftKey ? 64 : 16;
    const grow = left ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === grow) onWidth(width + step);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') onWidth(width - step);
    else return;
    e.preventDefault();
  }
</script>

<!-- A focusable separator is a widget (ARIA), which Svelte does not know. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div class="pane-resize" class:left role="separator" aria-orientation="vertical" aria-label={label}
  aria-valuenow={width} aria-valuemin={min} tabindex="0" title={label}
  onpointerdown={startResize} onkeydown={resizeKey} ondblclick={onReset}></div>

<style>
  /* The grab strip straddles the border, wider than it looks. The pane is positioned. */
  .pane-resize {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -3px;
    width: 6px;
    cursor: col-resize;
    z-index: 1;
    touch-action: none;
  }
  .pane-resize.left { left: auto; right: -3px; }
  .pane-resize:hover, .pane-resize:focus-visible { background: var(--color-primary); opacity: 0.6; outline: none; }
</style>
