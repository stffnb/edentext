<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { t } from '../i18n/i18n.svelte';
  import { dragWindow } from '../utils/dragWindow';
  import { styleSheet } from '../styles/sheet.svelte';
  import { noteSettings } from '../storage/notes.svelte';
  import {
    REF_TARGET_KINDS, refFormats, refRange, refTargets,
    type CrossRefFormat, type RefTarget, type RefTargetKind,
  } from '../editor/extensions/crossReference';

  // The cross-reference window, modelled on Word's: reference type × what to insert,
  // over the list of targets. Modeless so the document stays readable and scrollable
  // while a target is picked, and draggable by its bar.
  let { open, editor, tick = 0, onClose }: {
    open: boolean;
    editor: Editor | null;
    tick?: number;
    onClose: () => void;
  } = $props();

  let kind = $state<RefTargetKind>('heading');
  let format = $state<CrossRefFormat>('text');
  let withDirection = $state(false);
  let useSep = $state(false);
  let sep = $state('-');
  let picked = $state(0);
  let win = $state<HTMLElement | null>(null);
  let pos = $state<{ left: number; top: number } | null>(null);

  const doc = $derived(tick >= 0 ? editor?.state.doc ?? null : null);
  // One collection per tick, not one per type per render: each is a document walk.
  const all = $derived.by<Record<RefTargetKind, RefTarget[]> | null>(() => {
    if (!open || !doc) return null;
    const sheet = styleSheet();
    const notes = noteSettings();
    const out = {} as Record<RefTargetKind, RefTarget[]>;
    for (const k of REF_TARGET_KINDS) out[k] = refTargets(doc, k, sheet, notes);
    return out;
  });
  const kinds = $derived(all ? REF_TARGET_KINDS.filter((k) => all[k].length) : []);
  const targets = $derived<RefTarget[]>(all?.[kind] ?? []);
  const formats = $derived(refFormats(kind));
  const target = $derived(targets[Math.min(picked, targets.length - 1)] ?? null);
  const fullContext = $derived(format === 'number-all-superior');

  // The type keeps its pick where it can; a type with no targets left falls back to one
  // that has some, so the window never shows an empty list while another type has rows.
  $effect(() => {
    if (open && kinds.length && !kinds.includes(kind)) kind = kinds[0];
  });
  $effect(() => {
    if (!formats.includes(format)) format = formats[0];
  });
  $effect(() => {
    if (picked >= targets.length) picked = 0;
  });
  // A top-layer popover, not a <dialog>: `position: fixed` resolves against a transformed
  // ancestor, and the island chrome's toolbar stack is one, so a plain window landed
  // beside the viewport there. "manual": a click in the document must not dismiss it.
  $effect(() => {
    if (!win) return;
    if (open && !win.matches(':popover-open')) win.showPopover();
    else if (!open && win.matches(':popover-open')) win.hidePopover();
  });

  // What "insert reference to" calls each format depends on the type, exactly as Word
  // words it: a heading has a heading number, a caption has a label and a number.
  function formatLabel(format: CrossRefFormat): string {
    const f = t().crossRef.formats;
    if (format === 'page') return f.page;
    if (format === 'direction') return f.direction;
    if (kind === 'figure' || kind === 'table') {
      return format === 'category-and-value' ? f.labelAndNumber
        : format === 'caption' ? f.captionText : f.wholeCaption;
    }
    if (kind === 'footnote') return f.footnoteNumber;
    if (kind === 'endnote') return f.endnoteNumber;
    if (kind === 'bookmark' && format === 'text') return f.bookmarkText;
    const heading = kind === 'heading';
    if (format === 'text') return heading ? f.headingText : f.paragraphText;
    if (format === 'number-no-superior') return heading ? f.headingNumberNoContext : f.paragraphNumberNoContext;
    if (format === 'number-all-superior') return heading ? f.headingNumberFullContext : f.paragraphNumberFullContext;
    return heading ? f.headingNumber : f.paragraphNumber;
  }

  function insert() {
    if (!editor || !target || !doc) return;
    const range = refRange(doc, target, format);
    // No scrolling on focus: the window is modeless so the view can be parked on the
    // target, and restoring focus must not pull it back to the caret on every insert.
    editor.chain().focus(null, { scrollIntoView: false }).insertCrossRef({
      name: target.name,
      from: range.from,
      to: range.to,
      format,
      kind: target.kind,
      sep: useSep && fullContext ? sep : null,
      withDirection,
    }).run();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'Enter' && target) { e.preventDefault(); insert(); }
  }
</script>

<div
  bind:this={win}
  class="xr"
  popover="manual"
  role="dialog"
  aria-label={t().crossRef.title}
  tabindex="-1"
  onkeydown={onKeydown}
  style={pos ? `left:${pos.left}px; top:${pos.top}px; right:auto;` : undefined}
>
  <div class="xr-bar" use:dragWindow={(p) => (pos = p)}>
    <span>{t().crossRef.title}</span>
    <button class="xr-x" onclick={onClose} aria-label={t().common.close}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
    </button>
  </div>

  <div class="xr-body">
    {#if !kinds.length}
      <p class="xr-none">{t().crossRef.none}</p>
    {:else}
      <div class="xr-rows">
        <label>
          {t().crossRef.type}
          <select bind:value={kind}>
            {#each kinds as k (k)}<option value={k}>{t().crossRef.kinds[k]}</option>{/each}
          </select>
        </label>
        <label>
          {t().crossRef.referTo}
          <select bind:value={format}>
            {#each formats as f (f)}<option value={f}>{formatLabel(f)}</option>{/each}
          </select>
        </label>
      </div>

      <label class="xr-check"><input type="checkbox" bind:checked={withDirection} />{t().crossRef.includeDirection}</label>
      <label class="xr-check" class:xr-off={!fullContext}>
        <input type="checkbox" bind:checked={useSep} disabled={!fullContext} />
        {t().crossRef.separateWith}
        <input class="xr-sep" type="text" maxlength="3" bind:value={sep} disabled={!fullContext || !useSep} />
      </label>

      <span class="xr-label">{t().crossRef.target}</span>
      <select class="xr-list" size={8} bind:value={picked}>
        {#each targets as target, i (i)}
          <option value={i}>{target.label}</option>
        {/each}
      </select>
    {/if}
  </div>

  <div class="xr-actions">
    <button onclick={onClose}>{t().common.close}</button>
    <button class="xr-apply" onclick={insert} disabled={!target}>{t().common.insert}</button>
  </div>
</div>

<style>
  .xr {
    position: fixed;
    /* The popover's own inset: 0 would stretch it between top and bottom. */
    inset: 9rem 2rem auto auto;
    margin: 0;
    z-index: 300;
    width: 20rem;
    max-height: calc(100vh - 11rem);
    padding: 0;
  }

  .xr-bar {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.4rem 0.35rem 0.7rem;
    border-bottom: 1px solid var(--color-border);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: move;
    touch-action: none;
  }

  .xr-bar span { flex: 1; }

  .xr-x {
    display: flex;
    padding: 0.25rem;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .xr-x:hover { background: var(--color-hover, rgba(0, 0, 0, 0.06)); }

  .xr-body {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.7rem;
  }

  .xr-rows { display: flex; flex-direction: column; gap: 0.45rem; }

  .xr-body label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.8rem; }

  .xr-check { flex-direction: row !important; align-items: center; gap: 0.4rem !important; }
  .xr-off { opacity: 0.5; }

  .xr-label { font-size: 0.8rem; }

  select, .xr-sep {
    width: 100%;
    box-sizing: border-box;
    padding: 0.25rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.8rem;
  }

  .xr-sep { width: 3rem; }
  .xr-check:not(.xr-off) .xr-sep:disabled { opacity: 0.5; }
  .xr-list { min-height: 9rem; }
  .xr-none { margin: 0; font-size: 0.8rem; opacity: 0.7; }

  .xr-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
    padding: 0 0.7rem 0.7rem;
  }

  .xr-actions button {
    height: 1.8rem;
    padding: 0 0.7rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-size: 0.8rem;
    cursor: pointer;
  }

  .xr-actions button:hover:not(:disabled) { background: var(--color-hover, rgba(0, 0, 0, 0.06)); }
  .xr-apply { border-color: var(--color-accent, #1a56db) !important; color: var(--color-accent, #1a56db); }
  .xr-actions button:disabled { opacity: 0.5; cursor: default; }
</style>
