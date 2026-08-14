<script lang="ts">
  import { captionClicks } from '../menu.svelte';
  import type { Editor } from '@tiptap/core';
  import RibbonGroup from '../RibbonGroup.svelte';
  import RibbonButton from '../RibbonButton.svelte';
  import ColorPicker from '../../ColorPicker.svelte';
  import ShapePicker from '../../ShapePicker.svelte';
  import type { WrapMode } from '../../../editor/extensions/image';
  import type { ShapeKind } from '../../../editor/extensions/textBox';
  import { t } from '../../../i18n/i18n.svelte';

  // Word's Picture Format and Shape Format: the same wrap modes, plus a shape's
  // own fill, outline and kind.
  let { editor, which, wrap, alt = '', shapeKind, fillColor, strokeColor, strokeWidthPt }: {
    editor: Editor | null;
    which: 'picture' | 'shape';
    wrap: WrapMode;
    alt?: string;
    shapeKind?: ShapeKind;
    fillColor?: string | null;
    strokeColor?: string | null;
    strokeWidthPt?: number;
  } = $props();

  const WRAPS: { key: WrapMode; icon: 'wrapInline' | 'wrapLeft' | 'wrapRight' | 'wrapTopBottom'; label: () => string }[] = [
    { key: 'inline', icon: 'wrapInline', label: () => t().image.wrapInline },
    { key: 'left', icon: 'wrapLeft', label: () => t().image.wrapLeft },
    { key: 'right', icon: 'wrapRight', label: () => t().image.wrapRight },
    { key: 'topBottom', icon: 'wrapTopBottom', label: () => t().image.wrapTopBottom },
  ];

  function setWrap(w: WrapMode) {
    if (which === 'picture') editor?.chain().focus().setImageWrap(w).run();
    else editor?.chain().focus().setTextBoxAttrs({ wrap: w }).run();
  }
</script>

<RibbonGroup label={t().ribbon.groups.arrange}>
  {#each WRAPS as w}
    <RibbonButton variant="big" icon={w.icon} label={w.label()} title={w.label()} active={wrap === w.key} onclick={() => setWrap(w.key)} />
  {/each}
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
{/if}

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
