<script lang="ts">
  import { captionClicks } from '../menu.svelte';
  import type { Editor } from '@tiptap/core';
  import RibbonGroup from '../RibbonGroup.svelte';
  import RibbonButton from '../RibbonButton.svelte';
  import ColorPicker from '../../ColorPicker.svelte';
  import ShapePicker from '../../ShapePicker.svelte';
  import CaptionDialog from '../../CaptionDialog.svelte';
  import { droppedFrameAttrs, type WrapMode } from '../../../editor/extensions/image';
  import type { ShapeKind } from '../../../editor/extensions/textBox';
  import { t } from '../../../i18n/i18n.svelte';

  // Word's Picture Format and Shape Format: the same wrap modes, plus a shape's
  // own fill, outline and kind.
  let { editor, which, wrap, inFront = false, alt = '', shapeKind, fillColor, strokeColor, strokeWidthPt, textVertical = false }: {
    editor: Editor | null;
    which: 'picture' | 'shape';
    wrap: WrapMode;
    inFront?: boolean;
    alt?: string;
    shapeKind?: ShapeKind;
    fillColor?: string | null;
    strokeColor?: string | null;
    strokeWidthPt?: number;
    textVertical?: boolean;
  } = $props();

  // The two run-through entries are one mode, told apart by which side of the text the
  // frame lands on — as in Word's layout options, whose "tight" no browser can draw.
  type WrapChoice = WrapMode | 'behind' | 'front';
  const WRAPS: { key: WrapChoice; icon: 'wrapInline' | 'wrapLeft' | 'wrapRight' | 'wrapTopBottom' | 'wrapBehind' | 'wrapFront'; label: () => string }[] = [
    { key: 'inline', icon: 'wrapInline', label: () => t().image.wrapInline },
    { key: 'left', icon: 'wrapLeft', label: () => t().image.wrapLeft },
    { key: 'right', icon: 'wrapRight', label: () => t().image.wrapRight },
    { key: 'topBottom', icon: 'wrapTopBottom', label: () => t().image.wrapTopBottom },
    { key: 'behind', icon: 'wrapBehind', label: () => t().image.wrapBehind },
    { key: 'front', icon: 'wrapFront', label: () => t().image.wrapFront },
  ];
  const active = $derived<WrapChoice>(wrap === 'through' ? (inFront ? 'front' : 'behind') : wrap);

  let captionOpen = $state(false);

  function setWrap(w: WrapChoice) {
    const mode: WrapMode = w === 'behind' || w === 'front' ? 'through' : w;
    if (which === 'picture') editor?.chain().focus().setImageWrap(mode, w === 'front').run();
    else editor?.chain().focus().setTextBoxAttrs({ wrap: mode, ...droppedFrameAttrs(mode, w === 'front') }).run();
  }
</script>

<RibbonGroup label={t().ribbon.groups.arrange}>
  {#each WRAPS as w}
    <RibbonButton variant="big" icon={w.icon} label={w.label()} title={w.label()} active={active === w.key} onclick={() => setWrap(w.key)} />
  {/each}
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
    <label class="field alt">
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
    <div class="rb-captioned" use:captionClicks>
      <ShapePicker
        value={shapeKind ?? 'textbox'}
        onPick={(k) => editor?.chain().focus().setTextBoxAttrs({ shapeKind: k }).run()}
      />
      <span class="rb-caption">{t().textBox.shape}</span>
    </div>
    <div class="rb-captioned" use:captionClicks>
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
    <div class="rb-captioned" use:captionClicks>
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
    <label class="field">
      <span>{t().textBox.borderWidth}</span>
      <input
        type="text"
        inputmode="decimal"
        value={strokeWidthPt ?? 1}
        onchange={(e) => {
          const v = parseFloat((e.currentTarget as HTMLInputElement).value.replace(',', '.'));
          if (!isNaN(v)) editor?.chain().focus().setTextBoxAttrs({ strokeWidthPt: Math.max(0, v) }).run();
        }}
      />
    </label>
  </RibbonGroup>

  <div class="ribbon-sep"></div>

  <RibbonGroup label={t().ribbon.groups.text}>
    <RibbonButton
      variant="big"
      icon="textDirection"
      label={t().textBox.verticalText}
      title={t().textBox.verticalText}
      active={textVertical}
      onclick={() => editor?.chain().focus().setTextBoxAttrs({ textVertical: !textVertical }).run()}
    />
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
</style>
