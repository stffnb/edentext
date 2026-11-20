<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import IslandMenu from './IslandMenu.svelte';
  import CaptionDialog from '../CaptionDialog.svelte';
  import Icon from '../ribbon/Icon.svelte';
  import { closeMenu } from '../ribbon/menu.svelte';
  import { GAP_LABEL, GAP_SIDES, ORDERS, ORDER_ICON, ORDER_LABEL, hasWrapGap, setFrameGap, type FrameKind } from '../frameCommands';
  import { wrapGap, type WrapMode } from '../../editor/extensions/image';
  import { t } from '../../i18n/i18n.svelte';
  import { formatDecimal } from '../../i18n/number';

  // What the ribbon's picture and shape tabs add to the floating frame toolbars: the
  // stacking order, the gap to the text, the alt text and a caption.
  let { editor, tick, kind, wrap, wrapDist = null, alt = '' }: {
    editor: Editor | null;
    tick: number;
    kind: FrameKind;
    wrap: WrapMode;
    wrapDist?: unknown;
    alt?: string;
  } = $props();

  const canOrder = $derived(tick >= 0 && !!editor ? Object.fromEntries(ORDERS.map((o) => [o, editor.can().restackFrame(o)])) : {});
  const gap = $derived(wrapGap(wrapDist));
  let captionOpen = $state(false);
</script>

<IslandMenu id={`${kind}-order`} icon="orderFront" cmd="orderMenu" title={t().ribbon.groups.arrange}>
  {#each ORDERS as o}
    <button data-cmd={`order-${o}`} disabled={!canOrder[o]} onclick={() => { closeMenu(); editor?.chain().focus().restackFrame(o).run(); }}>
      <Icon name={ORDER_ICON[o]} size={16} />{ORDER_LABEL[o]()}
    </button>
  {/each}
</IslandMenu>

<IslandMenu id={`${kind}-gap`} icon="margins" title={hasWrapGap(wrap) ? t().image.wrapGap : t().image.wrapGapNeedsWrap} disabled={!hasWrapGap(wrap)} minWidth={200}>
  <div class="im-label">{t().image.wrapGap} (cm)</div>
  <div class="im-grid">
    {#each GAP_SIDES as side}
      <label class="im-field" data-cmd={`wrapGap-${side}`}>
        <span>{GAP_LABEL[side]()}</span>
        <input type="text" inputmode="decimal" value={formatDecimal(gap[side])} onchange={(e) => setFrameGap(editor, kind, wrapDist, side, e.currentTarget.value)} />
      </label>
    {/each}
  </div>
</IslandMenu>

{#if kind === 'picture'}
  <!-- Filled in from the file name on insert; here it can be written. -->
  <IslandMenu id="picture-alt" content={altIcon} cmd="altTextMenu" title={t().ribbon.altText} minWidth={240}>
    <label class="im-field alt" data-cmd="altText">
      <span>{t().ribbon.altText}</span>
      <input type="text" value={alt} placeholder={t().ribbon.altTextHint}
        onchange={(e) => editor?.chain().focus().updateAttributes('image', { alt: e.currentTarget.value }).run()} />
    </label>
  </IslandMenu>
{/if}

<button class="frame-btn" title={t().caption.title} aria-label={t().ribbon.insertCaption} disabled={!editor} onclick={() => (captionOpen = true)}>
  <Icon name="caption" size={18} />
</button>

<CaptionDialog bind:open={captionOpen} {editor} />

{#snippet altIcon()}<span class="alt-glyph">Alt</span>{/snippet}

<style>
  .alt { padding: 4px 6px; }

  .alt-glyph {
    font-family: var(--font-sans);
    font-size: 0.68rem;
    font-weight: 600;
  }

  .frame-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.7rem;
    height: 1.7rem;
    padding: 0;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }

  .frame-btn:hover:not(:disabled) { background: var(--color-btn-hover); }
  .frame-btn:disabled { opacity: 0.5; cursor: default; }
</style>
