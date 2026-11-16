<script lang="ts">
  import { captionClicks } from '../menu.svelte';
  import type { Editor } from '@tiptap/core';
  import RibbonGroup from '../RibbonGroup.svelte';
  import RibbonButton from '../RibbonButton.svelte';
  import ColorPicker from '../../ColorPicker.svelte';
  import ShapePicker from '../../ShapePicker.svelte';
  import BorderWidthBox from '../../BorderWidthBox.svelte';
  import CaptionDialog from '../../CaptionDialog.svelte';
  import { wrapGap, type WrapGap, type WrapMode } from '../../../editor/extensions/image';
  import { GAP_LABEL, GAP_SIDES, ORDERS, ORDER_ICON, ORDER_LABEL, hasWrapGap, setFrameGap, setFrameWrap, wrapChoice, type WrapChoice } from '../../frameCommands';
  import type { ShapeKind, TextVAlign } from '../../../editor/extensions/textBox';
  import { t } from '../../../i18n/i18n.svelte';

  // Word's Picture Format and Shape Format: the same wrap modes, plus a shape's
  // own fill, outline and kind.
  let { editor, tick, which, wrap, wrapDist = null, inFront = false, alt = '', shapeKind, fillColor, strokeColor, strokeWidthPt, textVertical = false, textVAlign = 'top' }: {
    editor: Editor | null;
    tick: number;
    which: 'picture' | 'shape';
    wrap: WrapMode;
    wrapDist?: unknown;
    inFront?: boolean;
    alt?: string;
    shapeKind?: ShapeKind;
    fillColor?: string | null;
    strokeColor?: string | null;
    strokeWidthPt?: number;
    textVertical?: boolean | 'up';
    textVAlign?: TextVAlign;
  } = $props();

  const WRAPS: { key: WrapChoice; icon: 'wrapInline' | 'wrapLeft' | 'wrapRight' | 'wrapTopBottom' | 'wrapBehind' | 'wrapFront'; label: () => string }[] = [
    { key: 'inline', icon: 'wrapInline', label: () => t().image.wrapInline },
    { key: 'left', icon: 'wrapLeft', label: () => t().image.wrapLeft },
    { key: 'right', icon: 'wrapRight', label: () => t().image.wrapRight },
    { key: 'topBottom', icon: 'wrapTopBottom', label: () => t().image.wrapTopBottom },
    { key: 'behind', icon: 'wrapBehind', label: () => t().image.wrapBehind },
    { key: 'front', icon: 'wrapFront', label: () => t().image.wrapFront },
  ];
  const active = $derived(wrapChoice(wrap, inFront));

  const VALIGNS: { key: TextVAlign; icon: 'alignTop' | 'alignMiddle' | 'alignBottom'; label: () => string }[] = [
    { key: 'top', icon: 'alignTop', label: () => t().textBox.vAlignTop },
    { key: 'middle', icon: 'alignMiddle', label: () => t().textBox.vAlignMiddle },
    { key: 'bottom', icon: 'alignBottom', label: () => t().textBox.vAlignBottom },
  ];

  const ORDER_ITEMS = ORDERS.map((key) => ({ key, icon: ORDER_ICON[key], label: ORDER_LABEL[key] }));
  const canOrder = $derived(tick >= 0 && !!editor ? Object.fromEntries(ORDERS.map((o) => [o, editor.can().restackFrame(o)])) : {});

  const gap = $derived(wrapGap(wrapDist));
  const GAPS = GAP_SIDES.map((key) => ({ key, label: GAP_LABEL[key] }));
  const setGap = (side: keyof WrapGap, raw: string) => setFrameGap(editor, which, wrapDist, side, raw);

  let captionOpen = $state(false);

  const setWrap = (w: WrapChoice) => setFrameWrap(editor, which, w, wrap);
</script>

<RibbonGroup label={t().ribbon.groups.arrange}>
  {#each WRAPS as w}
    <RibbonButton variant="big" icon={w.icon} cmd={`wrap-${w.key}`} label={w.label()} title={w.label()} active={active === w.key} onclick={() => setWrap(w.key)} />
  {/each}
  {#each [ORDER_ITEMS.slice(0, 2), ORDER_ITEMS.slice(2)] as col}
    <div class="rb-col">
      {#each col as o}
        <RibbonButton variant="small" icon={o.icon} cmd={`order-${o.key}`} label={o.label()} title={o.label()} disabled={!canOrder[o.key]} onclick={() => editor?.chain().focus().restackFrame(o.key).run()} />
      {/each}
    </div>
  {/each}
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().image.wrapGap}>
  <div class="gap-grid">
    {#each [0, 2, 1, 3] as i}
      {@const side = GAPS[i]}
      <label class="field" data-cmd={`wrapGap-${side.key}`} title={hasWrapGap(wrap) ? undefined : t().image.wrapGapNeedsWrap}>
        <span>{t().toolbarExpanded.hfField(side.label())}</span>
        <input
          type="number"
          min="0"
          max="10"
          step="0.1"
          value={gap[side.key]}
          disabled={!hasWrapGap(wrap)}
          onchange={(e) => setGap(side.key, (e.currentTarget as HTMLInputElement).value)}
        />
      </label>
    {/each}
  </div>
</RibbonGroup>

<div class="ribbon-sep"></div>

<!-- Also in the References tab, where both products keep it — but that is a tab away
     from the object it captions, and this one only shows while that object is selected. -->
<RibbonGroup label={t().ribbon.groups.captions}>
  <RibbonButton
    variant="big"
    icon="caption"
    label={t().ribbon.insertCaption}
    title={t().caption.title}
    disabled={!editor}
    onclick={() => (captionOpen = true)}
  />
</RibbonGroup>

{#if which === 'picture'}
  <div class="ribbon-sep"></div>

  <!-- The alt text has always ridden along in both formats, filled in from the
       file name and never editable. -->
  <RibbonGroup label={t().ribbon.groups.accessibility}>
    <label class="field alt" data-cmd="altText">
      <span>{t().ribbon.altText}</span>
      <input
        type="text"
        value={alt}
        placeholder={t().ribbon.altTextHint}
        onchange={(e) => editor?.chain().focus().updateAttributes('image', { alt: (e.currentTarget as HTMLInputElement).value }).run()}
      />
    </label>
  </RibbonGroup>
{/if}

{#if which === 'shape'}
  <div class="ribbon-sep"></div>

  <RibbonGroup label={t().ribbon.groups.shapeStyles}>
    <div class="rb-captioned" data-cmd="shape" use:captionClicks>
      <ShapePicker
        value={shapeKind ?? 'textbox'}
        onPick={(k) => editor?.chain().focus().setTextBoxAttrs({ shapeKind: k }).run()}
      />
      <span class="rb-caption">{t().textBox.shape}</span>
    </div>
    <div class="rb-captioned" data-cmd="fillColor" use:captionClicks>
      <ColorPicker
        {editor}
        currentColor={fillColor ?? null}
        defaultColor="#4472C4"
        title={t().textBox.fillColor}
        chevronTitle={t().textBox.fillColor}
        clearLabel={t().textBox.noFill}
        onApply={(c) => editor?.chain().focus().setTextBoxAttrs({ fillColor: c }).run()}
        onClear={() => editor?.chain().focus().setTextBoxAttrs({ fillColor: null }).run()}
        icon={fillIcon}
      />
      <span class="rb-caption">{t().textBox.fillColor}</span>
    </div>
    <div class="rb-captioned" data-cmd="borderColor" use:captionClicks>
      <ColorPicker
        {editor}
        currentColor={strokeColor ?? null}
        defaultColor="#2F5496"
        title={t().textBox.borderColor}
        chevronTitle={t().textBox.borderColor}
        clearLabel={t().textBox.noBorder}
        onApply={(c) => editor?.chain().focus().setTextBoxAttrs({ strokeColor: c }).run()}
        onClear={() => editor?.chain().focus().setTextBoxAttrs({ strokeColor: null }).run()}
        icon={strokeIcon}
      />
      <span class="rb-caption">{t().textBox.borderColor}</span>
    </div>
    <!-- Not a label: a click on the list's caret would also focus the field. -->
    <div class="field" data-cmd="borderWidth">
      <span>{t().textBox.borderWidth}</span>
      <BorderWidthBox value={String(strokeWidthPt ?? 1)} presets={[0.5, 1, 2.25]} none={false} style="flex: none; width: 72px; height: 24px"
        onChange={(w) => editor?.chain().focus().setTextBoxAttrs({ strokeWidthPt: Number(w) }).run()} />
    </div>
  </RibbonGroup>

  <div class="ribbon-sep"></div>

  <RibbonGroup label={t().ribbon.groups.text}>
    <RibbonButton
      variant="big"
      icon="textDirection"
      cmd="verticalText"
      label={t().textBox.verticalText}
      title={t().textBox.verticalText}
      active={textVertical === true}
      onclick={() => editor?.chain().focus().setTextBoxAttrs({ textVertical: textVertical !== true }).run()}
    />
    <RibbonButton
      variant="big"
      icon="textDirectionUp"
      cmd="verticalTextUp"
      label={t().textBox.verticalTextUp}
      title={t().textBox.verticalTextUp}
      active={textVertical === 'up'}
      onclick={() => editor?.chain().focus().setTextBoxAttrs({ textVertical: textVertical === 'up' ? false : 'up' }).run()}
    />
    {#each VALIGNS as v}
      <RibbonButton
        cmd={`textAlign-${v.icon.slice(5)}`}
        icon={v.icon}
        title={v.label()}
        active={textVAlign === v.key}
        onclick={() => editor?.chain().focus().setTextBoxAttrs({ textVAlign: v.key }).run()}
      />
    {/each}
  </RibbonGroup>
{/if}

<CaptionDialog bind:open={captionOpen} {editor} />

{#snippet fillIcon()}<span class="swatch" style="background: {fillColor ?? 'transparent'}"></span>{/snippet}
{#snippet strokeIcon()}<span class="swatch outline" style="border-color: {strokeColor ?? 'currentColor'}"></span>{/snippet}

<style>
  .swatch {
    width: 24px;
    height: 24px;
    border: 1px solid var(--w-border-strong);
    border-radius: 2px;
  }

  .swatch.outline { background: transparent; border-width: 2px; }

  .field {
    font-family: var(--w-font);
    font-size: 12px;
    color: var(--w-text);
    white-space: nowrap;
  }

  .field {
    display: flex;
    align-items: center;
    align-self: center;
    gap: 6px;
    color: var(--w-text-dim);
  }

  .field input {
    width: 52px;
    height: 24px;
    border: 1px solid var(--w-border-strong);
    border-radius: 3px;
    background: var(--w-surface);
    padding: 0 5px;
    color: var(--w-text);
    font: inherit;
    text-align: right;
  }

  .field input:focus { outline: none; border-color: var(--w-accent); }

  .alt input { width: 200px; text-align: left; }
  /* One grid, so both columns' boxes share their rows and line up on each column's right edge. */
  .gap-grid { display: grid; grid-template-columns: auto auto; align-content: center; gap: 3px 12px; }
  .gap-grid .field > span { flex: 1; }
  .gap-grid .field input { width: 54px; height: 22px; padding: 0 1px 0 4px; }
  .gap-grid .field input::-webkit-inner-spin-button { opacity: 1; margin-left: 4px; height: 18px; }
  .field input:disabled { opacity: 0.5; }
</style>
