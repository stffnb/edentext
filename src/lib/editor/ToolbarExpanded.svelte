<script lang="ts">
  import type { Editor } from '@tiptap/core';

  let { editor, tick, showFormattingMarks = $bindable() }: { editor: Editor | null; tick: number; showFormattingMarks: boolean } = $props();

  type AlignValue = 'left' | 'center' | 'right' | 'justify';

  const ALIGNMENTS: { value: AlignValue; label: string }[] = [
    { value: 'left',    label: 'Left'    },
    { value: 'center',  label: 'Center'  },
    { value: 'right',   label: 'Right'   },
    { value: 'justify', label: 'Justify' },
  ];

  // Empty string when the selection spans paragraphs/headings with different alignments.
  let currentAlign = $derived.by<AlignValue | ''>(() => {
    if (tick < 0 || !editor) return 'left';
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      return (editor.state.selection.$head.parent.attrs.textAlign ?? 'left') as AlignValue;
    }
    let a: AlignValue | undefined;
    let mixed = false;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (mixed) return;
      if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
      const v = (node.attrs.textAlign ?? 'left') as AlignValue;
      if (a === undefined) a = v;
      else if (a !== v) mixed = true;
    });
    return mixed ? '' : (a ?? 'left');
  });

  // Must match the first font in --font-serif in editor.css
  const DEFAULT_EDITOR_FONT = 'Georgia';

  const FONTS = [
    { value: 'Arial',            label: 'Arial'            },
    { value: 'Verdana',          label: 'Verdana'          },
    { value: 'Trebuchet MS',     label: 'Trebuchet MS'     },
    { value: 'Georgia',          label: 'Georgia'          },
    { value: 'Times New Roman',  label: 'Times New Roman'  },
    { value: 'Courier New',      label: 'Courier New'      },
  ] as const;

  // Returns the uniform font of the selection, or '' when fonts are mixed.
  // Plain Text without an explicit mark falls back to DEFAULT_EDITOR_FONT.
  let currentFont = $derived.by(() => {
    if (tick < 0 || !editor) return '';
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      const marks = editor.state.storedMarks ?? editor.state.selection.$head.marks();
      return marks.find(m => m.type.name === 'textStyle')?.attrs.fontFamily ?? DEFAULT_EDITOR_FONT;
    }
    let font: string | undefined;
    let mixed = false;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (mixed || !node.isText) return;
      const f: string = node.marks.find(m => m.type.name === 'textStyle')?.attrs.fontFamily ?? DEFAULT_EDITOR_FONT;
      if (font === undefined) font = f;
      else if (font !== f) mixed = true;
    });
    return mixed ? '' : (font ?? DEFAULT_EDITOR_FONT);
  });

  // Must match the common document default and editor.css heading sizes (in pt)
  const DEFAULT_FONT_SIZE = '12pt';
  const HEADING_SIZES: Record<number, string> = { 1: '20pt', 2: '16pt', 3: '14pt' };
  const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

  function effectiveSize(node: { isText: boolean; marks: readonly { type: { name: string }; attrs: Record<string, string> }[] }, parent: { type: { name: string }; attrs: Record<string, number> } | null): string {
    const explicit = node.marks.find(m => m.type.name === 'textStyle')?.attrs.fontSize;
    if (explicit) return explicit;
    if (parent?.type.name === 'heading') return HEADING_SIZES[parent.attrs.level] ?? DEFAULT_FONT_SIZE;
    return DEFAULT_FONT_SIZE;
  }

  let currentFontSize = $derived.by(() => {
    if (tick < 0 || !editor) return '';
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      const head = editor.state.selection.$head;
      const marks = editor.state.storedMarks ?? head.marks();
      const explicit = marks.find(m => m.type.name === 'textStyle')?.attrs.fontSize;
      if (explicit) return explicit;
      const parent = head.parent;
      if (parent.type.name === 'heading') return HEADING_SIZES[parent.attrs.level] ?? DEFAULT_FONT_SIZE;
      return DEFAULT_FONT_SIZE;
    }
    let size: string | undefined;
    let mixed = false;
    editor.state.doc.nodesBetween(from, to, (node, _pos, parent) => {
      if (mixed || !node.isText) return;
      const s = effectiveSize(node as Parameters<typeof effectiveSize>[0], parent as Parameters<typeof effectiveSize>[1]);
      if (size === undefined) size = s;
      else if (size !== s) mixed = true;
    });
    return mixed ? '' : (size ?? DEFAULT_FONT_SIZE);
  });

  // Must match line-height in editor.css (.paper .tiptap)
  const DEFAULT_LINE_HEIGHT = '1.5';
  const LINE_HEIGHTS = [
    { value: '1',    label: 'Single'      },
    { value: '1.15', label: '1.15'        },
    { value: '1.5',  label: '1.5'         },
    { value: '2',    label: 'Double'      },
  ] as const;

  let currentLineHeight = $derived.by(() => {
    if (tick < 0 || !editor) return DEFAULT_LINE_HEIGHT;
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      return editor.state.selection.$head.parent.attrs.lineHeight ?? DEFAULT_LINE_HEIGHT;
    }
    let lh: string | undefined;
    let mixed = false;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (mixed || !('lineHeight' in node.attrs)) return;
      const h: string = node.attrs.lineHeight ?? DEFAULT_LINE_HEIGHT;
      if (lh === undefined) lh = h;
      else if (lh !== h) mixed = true;
    });
    return mixed ? '' : (lh ?? DEFAULT_LINE_HEIGHT);
  });

  // Row 1 = greyscale, row 2 = standard hues. Rows 3–7 are generated per column
  // as a light→dark gradient over the same hue, so each column reads as a shade ramp.
  const COLUMN_HUES: { h: number; sBase: number }[] = [
    { h: 0,   sBase: 0.85 }, // red (crimson side)
    { h: 8,   sBase: 1.00 }, // red
    { h: 35,  sBase: 1.00 }, // orange
    { h: 55,  sBase: 1.00 }, // yellow
    { h: 88,  sBase: 0.55 }, // yellow-green
    { h: 146, sBase: 1.00 }, // green
    { h: 195, sBase: 1.00 }, // cyan
    { h: 210, sBase: 1.00 }, // blue
    { h: 225, sBase: 1.00 }, // deep blue
    { h: 275, sBase: 0.65 }, // purple
  ];
  const SHADE_STOPS: { sScale: number; v: number }[] = [
    { sScale: 0.25, v: 1.00 },
    { sScale: 0.50, v: 0.95 },
    { sScale: 0.75, v: 0.82 },
    { sScale: 1.00, v: 0.55 },
    { sScale: 1.00, v: 0.30 },
  ];
  const COLOR_PALETTE: string[][] = [
    ['#000000', '#1A1A1A', '#333333', '#4D4D4D', '#666666', '#808080', '#999999', '#B3B3B3', '#CCCCCC', '#FFFFFF'],
    ['#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0'],
    ...SHADE_STOPS.map(stop =>
      COLUMN_HUES.map(({ h, sBase }) => hsvToHex(h, sBase * stop.sScale, stop.v)),
    ),
  ];

  // Uniform color of the selection. null = no color anywhere; '' = mixed.
  let currentColor = $derived.by<string | null>(() => {
    if (tick < 0 || !editor) return null;
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      const marks = editor.state.storedMarks ?? editor.state.selection.$head.marks();
      return marks.find(m => m.type.name === 'textStyle')?.attrs.color ?? null;
    }
    let color: string | null | undefined;
    let mixed = false;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (mixed || !node.isText) return;
      const c = node.marks.find(m => m.type.name === 'textStyle')?.attrs.color ?? null;
      if (color === undefined) color = c;
      else if (color !== c) mixed = true;
    });
    return mixed ? '' : (color ?? null);
  });

  let fontOpen = $state(false);
  let sizeOpen = $state(false);
  let lineHeightOpen = $state(false);
  let alignOpen = $state(false);
  let colorOpen = $state(false);
  let lastColor = $state<string>('#C00000');
  let moreColorsOpen = $state(false);
  let pickerH = $state<number>(0);
  let pickerS = $state<number>(1);
  let pickerV = $state<number>(0.75);
  let stagedColor = $derived(hsvToHex(pickerH, pickerS, pickerV));

  function clamp01(n: number): number {
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  function hsvToHex(h: number, s: number, v: number): string {
    const c = v * s;
    const hh = ((h % 360) + 360) % 360 / 60;
    const x = c * (1 - Math.abs((hh % 2) - 1));
    let r = 0, g = 0, b = 0;
    if (hh < 1)      { r = c; g = x; b = 0; }
    else if (hh < 2) { r = x; g = c; b = 0; }
    else if (hh < 3) { r = 0; g = c; b = x; }
    else if (hh < 4) { r = 0; g = x; b = c; }
    else if (hh < 5) { r = x; g = 0; b = c; }
    else             { r = c; g = 0; b = x; }
    const m = v - c;
    const hex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
  }

  function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
    const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const r = parseInt(m[1].slice(0, 2), 16) / 255;
    const g = parseInt(m[1].slice(2, 4), 16) / 255;
    const b = parseInt(m[1].slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r)      h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else                h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    return { h, s, v: max };
  }
  let sizeInputFocused = $state(false);
  let sizeInputValue = $state('');
  let savedFrom: number | null = null;
  let savedTo: number | null = null;

  $effect(() => {
    if (!sizeInputFocused) {
      sizeInputValue = currentFontSize ? currentFontSize.replace('pt', '') : '';
    }
  });

  function openFontPicker() {
    if (!editor) return;
    sizeOpen = false;
    sizeInputFocused = false;
    lineHeightOpen = false;
    alignOpen = false;
    colorOpen = false;
    // Save selection before the picker button steals focus.
    savedFrom = editor.state.selection.from;
    savedTo = editor.state.selection.to;
    fontOpen = !fontOpen;
  }

  function pickFont(value: string) {
    if (!editor) return;
    fontOpen = false;
    const from = savedFrom ?? editor.state.selection.from;
    const to   = savedTo   ?? editor.state.selection.to;
    savedFrom = null;
    savedTo   = null;
    editor.chain().focus().setTextSelection({ from, to }).setFontFamily(value).run();
  }

  function fontPickerClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) fontOpen = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }

  function applyFontSize(size: number) {
    if (!editor) return;
    const from = savedFrom ?? editor.state.selection.from;
    const to   = savedTo   ?? editor.state.selection.to;
    savedFrom = null;
    savedTo   = null;
    editor.chain().focus().setTextSelection({ from, to }).setFontSize(`${size}pt`).run();
  }

  function onSizeInputFocus(e: FocusEvent) {
    if (!editor) return;
    sizeInputFocused = true;
    fontOpen = false;
    lineHeightOpen = false;
    alignOpen = false;
    colorOpen = false;
    savedFrom = editor.state.selection.from;
    savedTo = editor.state.selection.to;
    (e.target as HTMLInputElement).select();
  }

  function onSizeInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const num = parseInt(sizeInputValue, 10);
      if (!isNaN(num) && num >= 1 && num <= 400) applyFontSize(num);
      sizeInputFocused = false;
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      sizeInputFocused = false;
      (e.target as HTMLInputElement).blur();
    }
  }

  function onSizeInputBlur() {
    sizeInputFocused = false;
  }

  function openSizePicker() {
    if (!editor) return;
    fontOpen = false;
    lineHeightOpen = false;
    alignOpen = false;
    colorOpen = false;
    if (!sizeInputFocused) {
      savedFrom = editor.state.selection.from;
      savedTo = editor.state.selection.to;
    }
    sizeOpen = !sizeOpen;
  }

  function pickSize(size: number) {
    if (!editor) return;
    sizeOpen = false;
    sizeInputFocused = false;
    applyFontSize(size);
  }

  function sizePickerClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) {
        sizeOpen = false;
      }
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }

  function openLineHeightPicker() {
    if (!editor) return;
    fontOpen = false;
    sizeOpen = false;
    sizeInputFocused = false;
    alignOpen = false;
    colorOpen = false;
    lineHeightOpen = !lineHeightOpen;
  }

  function pickLineHeight(value: string) {
    if (!editor) return;
    lineHeightOpen = false;
    editor.chain().focus().setLineHeight(value).run();
  }

  function lineHeightPickerClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) lineHeightOpen = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }

  function openAlignPicker() {
    if (!editor) return;
    fontOpen = false;
    sizeOpen = false;
    sizeInputFocused = false;
    lineHeightOpen = false;
    colorOpen = false;
    alignOpen = !alignOpen;
  }

  function pickAlign(value: AlignValue) {
    if (!editor) return;
    alignOpen = false;
    editor.chain().focus().setTextAlign(value).run();
  }

  function alignPickerClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) alignOpen = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }

  function openColorPicker() {
    if (!editor) return;
    fontOpen = false;
    sizeOpen = false;
    sizeInputFocused = false;
    lineHeightOpen = false;
    alignOpen = false;
    moreColorsOpen = false;
    savedFrom = editor.state.selection.from;
    savedTo = editor.state.selection.to;
    colorOpen = !colorOpen;
  }

  function applyColor(color: string) {
    if (!editor) return;
    colorOpen = false;
    moreColorsOpen = false;
    lastColor = color;
    const from = savedFrom ?? editor.state.selection.from;
    const to   = savedTo   ?? editor.state.selection.to;
    savedFrom = null;
    savedTo   = null;
    editor.chain().focus().setTextSelection({ from, to }).setColor(color).run();
  }

  function quickApplyColor() {
    if (!editor) return;
    // Save selection here too because the main button doesn't go through openColorPicker.
    if (savedFrom === null) {
      savedFrom = editor.state.selection.from;
      savedTo = editor.state.selection.to;
    }
    applyColor(lastColor);
  }

  function clearColor() {
    if (!editor) return;
    colorOpen = false;
    moreColorsOpen = false;
    const from = savedFrom ?? editor.state.selection.from;
    const to   = savedTo   ?? editor.state.selection.to;
    savedFrom = null;
    savedTo   = null;
    editor.chain().focus().setTextSelection({ from, to }).unsetColor().run();
  }

  function openMoreColors() {
    const seed = (currentColor && currentColor !== '') ? currentColor : lastColor;
    const hsv = hexToHsv(seed) ?? { h: 0, s: 1, v: 0.75 };
    pickerH = hsv.h;
    pickerS = hsv.s;
    pickerV = hsv.v;
    colorOpen = false;
    moreColorsOpen = true;
  }

  function confirmMoreColors() {
    applyColor(stagedColor);
  }

  function cancelMoreColors() {
    moreColorsOpen = false;
  }

  function onSvPointerDown(e: PointerEvent) {
    // Keep the editor's text selection visible by stopping the browser from
    // shifting focus / collapsing the selection on this click.
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const update = (ev: PointerEvent) => {
      pickerS = clamp01((ev.clientX - rect.left) / rect.width);
      pickerV = clamp01(1 - (ev.clientY - rect.top) / rect.height);
    };
    el.setPointerCapture(e.pointerId);
    update(e);
    const move = (ev: PointerEvent) => update(ev);
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function onHuePointerDown(e: PointerEvent) {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const update = (ev: PointerEvent) => {
      pickerH = clamp01((ev.clientY - rect.top) / rect.height) * 360;
    };
    el.setPointerCapture(e.pointerId);
    update(e);
    const move = (ev: PointerEvent) => update(ev);
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function onHexInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    const hsv = hexToHsv(value);
    if (!hsv) return;
    pickerH = hsv.h;
    pickerS = hsv.s;
    pickerV = hsv.v;
  }

  function colorPickerClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) {
        colorOpen = false;
        moreColorsOpen = false;
      }
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }
</script>

<div class="toolbar-expanded">
  {#if editor}
    <div class="font-picker" use:fontPickerClickOutside>
      <button class="font-trigger" onclick={openFontPicker} title="Font Name">
        <span class="font-trigger-label" style={currentFont ? `font-family: ${currentFont}` : ''}>{currentFont}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
          <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      {#if fontOpen}
        <div class="font-dropdown">
          {#each FONTS as font}
            <button
              class="font-option"
              class:active={currentFont === font.value}
              style="font-family: {font.value}"
              onclick={() => pickFont(font.value)}
            >{font.label}</button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="toolbar-separator"></div>

    <div class="size-picker" use:sizePickerClickOutside>
      <div class="size-trigger-wrap">
        <input
          type="text"
          class="size-input"
          bind:value={sizeInputValue}
          onfocus={onSizeInputFocus}
          onkeydown={onSizeInputKeydown}
          onblur={onSizeInputBlur}
          inputmode="numeric"
          title="Font size"
        />
        <button class="size-chevron" onclick={openSizePicker} tabindex="-1" title="Font size list">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
            <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      {#if sizeOpen}
        <div class="size-dropdown">
          {#each FONT_SIZES as size}
            <button
              class="size-option"
              class:active={currentFontSize === `${size}pt`}
              onclick={() => pickSize(size)}
            >{size}</button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <div class="color-picker" use:colorPickerClickOutside>
        <div class="color-split">
          <button class="color-main" onclick={quickApplyColor} title="Font color">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <text x="3" y="11" font-size="10" font-weight="bold" font-family="sans-serif" fill="currentColor">A</text>
            </svg>
            <span class="color-bar" style="background: {lastColor}"></span>
          </button>
          <button class="color-chevron" onclick={openColorPicker} tabindex="-1" title="Choose font color">
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
              <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        {#if colorOpen}
          <div class="color-dropdown">
            <button
              class="color-automatic"
              class:active={currentColor === null}
              onclick={clearColor}
            >Automatic</button>
            <div class="color-grid">
              {#each COLOR_PALETTE as row}
                <div class="color-row">
                  {#each row as c}
                    <button
                      class="color-cell"
                      class:active={currentColor === c}
                      style="background: {c}"
                      title={c}
                      onclick={() => applyColor(c)}
                      aria-label={c}
                    ></button>
                  {/each}
                </div>
              {/each}
            </div>
            <button class="color-more-trigger" onclick={openMoreColors}>More colors…</button>
          </div>
        {/if}
        {#if moreColorsOpen}
          <div class="color-window" role="dialog" aria-label="Choose color">
            <div class="color-window-body">
              <div
                class="sv-square"
                style="--hue: {pickerH}"
                onpointerdown={onSvPointerDown}
                role="presentation"
              >
                <div class="sv-thumb" style="left: {pickerS * 100}%; top: {(1 - pickerV) * 100}%"></div>
              </div>
              <div
                class="hue-slider"
                onpointerdown={onHuePointerDown}
                role="presentation"
              >
                <div class="hue-thumb" style="top: {(pickerH / 360) * 100}%"></div>
              </div>
            </div>
            <div class="color-window-readout">
              <span class="color-window-swatch" style="background: {stagedColor}"></span>
              <input class="color-window-hex" type="text" value={stagedColor} oninput={onHexInput} maxlength="7" />
            </div>
            <div class="color-more-actions">
              <button class="color-cancel" onclick={cancelMoreColors}>Abbrechen</button>
              <button class="color-confirm" onclick={confirmMoreColors}>OK</button>
            </div>
          </div>
        {/if}
      </div>
      <button disabled title="Highlight color (coming soon)">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
          <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" opacity="0.3"/>
        </svg>
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <div class="lh-picker" use:lineHeightPickerClickOutside>
      <button class="lh-trigger" onclick={openLineHeightPicker} title="Line spacing">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <line x1="5" y1="3"  x2="14" y2="3"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="5" y1="8"  x2="14" y2="8"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="5" y1="13" x2="14" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M2 5.5V1.5M2 1.5L1 2.8M2 1.5L3 2.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 10.5V14.5M2 14.5L1 13.2M2 14.5L3 13.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
          <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      {#if lineHeightOpen}
        <div class="lh-dropdown">
          {#each LINE_HEIGHTS as lh}
            <button
              class="lh-option"
              class:active={currentLineHeight === lh.value}
              onclick={() => pickLineHeight(lh.value)}
            >{lh.label}</button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="toolbar-separator"></div>

    <div class="align-picker" use:alignPickerClickOutside>
      <button class="align-trigger" onclick={openAlignPicker} title="Text alignment">
        {#if currentAlign === 'center'}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="4" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="3" y1="11" x2="13" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        {:else if currentAlign === 'right'}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="6" y1="7" x2="14" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="4" y1="11" x2="14" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        {:else if currentAlign === 'justify'}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="2" y1="7" x2="14" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="2" y1="11" x2="14" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="2" y1="7" x2="10" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="2" y1="11" x2="12" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        {/if}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
          <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      {#if alignOpen}
        <div class="align-dropdown">
          {#each ALIGNMENTS as a}
            <button
              class="align-option"
              class:active={currentAlign === a.value}
              onclick={() => pickAlign(a.value)}
              title="Align {a.label.toLowerCase()}"
            >
              {#if a.value === 'left'}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <line x1="2" y1="7" x2="10" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <line x1="2" y1="11" x2="12" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              {:else if a.value === 'center'}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <line x1="4" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <line x1="3" y1="11" x2="13" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              {:else if a.value === 'right'}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <line x1="6" y1="7" x2="14" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <line x1="4" y1="11" x2="14" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              {:else}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <line x1="2" y1="7" x2="14" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <line x1="2" y1="11" x2="14" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              {/if}
              <span>{a.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <button
        class:active={showFormattingMarks}
        onclick={() => (showFormattingMarks = !showFormattingMarks)}
        title="Formatting marks"
        aria-pressed={showFormattingMarks}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M11 2.25v11.5M7.5 2.25v11.5M11 2.25H6.75a2.75 2.75 0 0 0 0 5.5H7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <button disabled title="Insert table (coming soon)">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1.5" y="1.5" width="13" height="13" rx="1" stroke="currentColor" stroke-width="1.5"/>
          <line x1="1.5" y1="5.5" x2="14.5" y2="5.5" stroke="currentColor" stroke-width="1"/>
          <line x1="1.5" y1="9.5" x2="14.5" y2="9.5" stroke="currentColor" stroke-width="1"/>
          <line x1="5.5" y1="5.5" x2="5.5" y2="14.5" stroke="currentColor" stroke-width="1"/>
          <line x1="10.5" y1="5.5" x2="10.5" y2="14.5" stroke="currentColor" stroke-width="1"/>
        </svg>
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <button disabled title="Clear formatting (coming soon)">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  {/if}
</div>

<style>
  .toolbar-expanded {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.4rem 1rem;
    background: var(--color-toolbar-bg);
    border-bottom: 1px solid var(--color-border);
  }

  .toolbar-group {
    display: flex;
    gap: 2px;
  }

  .toolbar-separator {
    width: 1px;
    height: 1.5rem;
    background: var(--color-border);
    margin: 0 0.5rem;
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2rem;
    height: 2rem;
    padding: 0 0.5rem;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-size: 0.85rem;
    font-family: var(--font-sans);
    cursor: pointer;
    transition: background 0.15s;
  }

  button:hover:not(:disabled) {
    background: var(--color-btn-hover);
  }

  button.active {
    background: var(--color-primary);
    color: white;
  }

  button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .font-picker {
    position: relative;
  }

  .font-trigger {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 2rem;
    padding: 0 0.4rem 0 0.6rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.8rem;
    font-family: var(--font-sans);
    cursor: pointer;
    width: 145px;
    transition: border-color 0.15s;
  }

  .font-trigger:hover {
    border-color: var(--color-primary);
  }

  .font-trigger-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    font-size: 0.8rem;
  }

  .font-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    min-width: 100%;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 2px;
    display: flex;
    flex-direction: column;
  }

  .font-option {
    display: block;
    width: 100%;
    padding: 0.35rem 0.6rem;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    font-size: 0.85rem;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s;
    min-width: unset;
    height: auto;
    justify-content: flex-start;
  }

  .font-option:hover {
    background: var(--color-btn-hover);
  }

  .font-option.active {
    background: var(--color-primary);
    color: white;
  }

  .size-picker {
    position: relative;
  }

  .size-trigger-wrap {
    display: inline-flex;
    align-items: center;
    height: 2rem;
    width: 62px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    transition: border-color 0.15s;
    overflow: hidden;
  }

  .size-trigger-wrap:hover,
  .size-trigger-wrap:focus-within {
    border-color: var(--color-primary);
  }

  .size-input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 0 0 0.5rem;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-size: 0.8rem;
    font-family: var(--font-sans);
    outline: none;
  }

  .size-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    min-width: unset;
    height: 100%;
    padding: 0;
    border: none;
    border-left: 1px solid var(--color-border);
    border-radius: 0;
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }

  .size-chevron:hover {
    background: var(--color-btn-hover);
  }

  .size-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    min-width: 100%;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 2px;
    display: flex;
    flex-direction: column;
    max-height: 260px;
    overflow-y: auto;
  }

  .size-option {
    display: block;
    width: 100%;
    padding: 0.3rem 0.6rem;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    font-size: 0.85rem;
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s;
    min-width: unset;
    height: auto;
    justify-content: flex-start;
  }

  .size-option:hover {
    background: var(--color-btn-hover);
  }

  .size-option.active {
    background: var(--color-primary);
    color: white;
  }

  .lh-picker {
    position: relative;
  }

  .lh-trigger {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 2rem;
    padding: 0 0.4rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    min-width: unset;
    transition: border-color 0.15s;
  }

  .lh-trigger:hover {
    border-color: var(--color-primary);
  }

  .lh-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    min-width: 110px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 2px;
    display: flex;
    flex-direction: column;
  }

  .lh-option {
    display: block;
    width: 100%;
    padding: 0.35rem 0.6rem;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    font-size: 0.85rem;
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s;
    min-width: unset;
    height: auto;
    justify-content: flex-start;
  }

  .lh-option:hover {
    background: var(--color-btn-hover);
  }

  .lh-option.active {
    background: var(--color-primary);
    color: white;
  }

  .align-picker {
    position: relative;
  }

  .align-trigger {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 2rem;
    padding: 0 0.4rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    min-width: unset;
    transition: border-color 0.15s;
  }

  .align-trigger:hover {
    border-color: var(--color-primary);
  }

  .align-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    min-width: 130px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 2px;
    display: flex;
    flex-direction: column;
  }

  .align-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.35rem 0.6rem;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    font-size: 0.85rem;
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s;
    min-width: unset;
    height: auto;
    justify-content: flex-start;
  }

  .align-option:hover {
    background: var(--color-btn-hover);
  }

  .align-option.active {
    background: var(--color-primary);
    color: white;
  }

  .color-picker {
    position: relative;
  }

  .color-split {
    display: inline-flex;
    align-items: stretch;
    height: 2rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    overflow: hidden;
    transition: border-color 0.15s;
  }

  .color-split:hover {
    border-color: var(--color-primary);
  }

  .color-main {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    min-width: 1.7rem;
    height: 100%;
    padding: 0 0.35rem;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }

  .color-main:hover {
    background: var(--color-btn-hover);
  }

  .color-bar {
    display: block;
    width: 14px;
    height: 3px;
    border-radius: 1px;
  }

  .color-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    min-width: unset;
    height: 100%;
    padding: 0;
    border: none;
    border-left: 1px solid var(--color-border);
    border-radius: 0;
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }

  .color-chevron:hover {
    background: var(--color-btn-hover);
  }

  .color-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .color-automatic {
    display: block;
    width: 100%;
    padding: 0.35rem 0.6rem;
    border: 1px solid var(--color-border);
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    font-size: 0.8rem;
    font-family: var(--font-sans);
    text-align: center;
    cursor: pointer;
    min-width: unset;
    height: auto;
    transition: background 0.1s;
  }

  .color-automatic:hover {
    background: var(--color-btn-hover);
  }

  .color-automatic.active {
    background: var(--color-primary);
    color: white;
    border-color: var(--color-primary);
  }

  .color-grid {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .color-row {
    display: flex;
    gap: 2px;
  }

  .color-cell {
    width: 18px;
    height: 18px;
    min-width: unset;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: 2px;
    cursor: pointer;
    transition: transform 0.05s;
  }

  .color-cell:hover {
    transform: scale(1.15);
  }

  .color-cell.active {
    outline: 2px solid var(--color-primary);
    outline-offset: 1px;
  }

  .color-more-trigger {
    display: block;
    width: 100%;
    padding: 0.35rem 0.6rem;
    border: 1px solid var(--color-border);
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    font-size: 0.8rem;
    font-family: var(--font-sans);
    text-align: center;
    cursor: pointer;
    min-width: unset;
    height: auto;
    transition: background 0.1s;
  }

  .color-more-trigger:hover {
    background: var(--color-btn-hover);
  }

  .color-window {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    width: 210px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
  }

  .color-window-body {
    display: flex;
    gap: 8px;
  }

  .sv-square {
    position: relative;
    width: 160px;
    height: 160px;
    cursor: crosshair;
    border: 1px solid var(--color-border);
    background:
      linear-gradient(to top, #000, transparent),
      linear-gradient(to right, #fff, hsl(var(--hue, 0), 100%, 50%));
    touch-action: none;
  }

  .sv-thumb {
    position: absolute;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid white;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .hue-slider {
    position: relative;
    width: 18px;
    height: 160px;
    cursor: pointer;
    border: 1px solid var(--color-border);
    background: linear-gradient(
      to bottom,
      #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%
    );
    touch-action: none;
  }

  .hue-thumb {
    position: absolute;
    left: -3px;
    width: 22px;
    height: 6px;
    border: 1px solid white;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
    transform: translateY(-50%);
    pointer-events: none;
  }

  .color-window-readout {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .color-window-swatch {
    display: block;
    width: 28px;
    height: 24px;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    flex-shrink: 0;
  }

  .color-window-hex {
    flex: 1;
    min-width: 0;
    height: 24px;
    padding: 0 0.4rem;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.8rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    outline: none;
  }

  .color-window-hex:focus {
    border-color: var(--color-primary);
  }

  .color-more-actions {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }

  .color-confirm,
  .color-cancel {
    padding: 0.25rem 0.6rem;
    border-radius: calc(var(--radius) - 2px);
    font-size: 0.75rem;
    font-family: var(--font-sans);
    cursor: pointer;
    min-width: unset;
    height: auto;
    transition: background 0.1s, border-color 0.15s;
  }

  .color-cancel {
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text);
  }

  .color-cancel:hover {
    background: var(--color-btn-hover);
  }

  .color-confirm {
    border: 1px solid var(--color-primary);
    background: var(--color-primary);
    color: white;
  }

  .color-confirm:hover {
    filter: brightness(1.1);
  }
</style>
