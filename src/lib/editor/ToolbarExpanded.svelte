<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { onMount } from 'svelte';
  import ColorPicker from './ColorPicker.svelte';
  import {
    CANDIDATE_FONTS,
    detectAvailableFonts,
    queryLocalFontsIfAllowed,
    supportsLocalFontAccess,
  } from './fontDetect';
  import { DEFAULT_MARGINS, type PageMargins } from '../storage/pageMargins';
  import type { Orientation } from '../storage/pageOrientation';

  let { editor, tick, showFormattingMarks = $bindable(), pageMargins = $bindable(DEFAULT_MARGINS), pageOrientation = $bindable<Orientation>('portrait') }:
    { editor: Editor | null; tick: number; showFormattingMarks: boolean; pageMargins?: PageMargins; pageOrientation?: Orientation } = $props();

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

  // Must match the first font in --font-serif in global.css. Bundled as a
  // webfont so it is always available and matches the exported .odt's font.
  const DEFAULT_EDITOR_FONT = 'Liberation Serif';

  // Always-shown fonts — render in the picker even when detection fails or is blocked.
  const WEB_SAFE_FONTS: readonly string[] = [
    'Liberation Serif', 'Arial', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New',
  ];
  const WEB_SAFE_SET = new Set<string>(WEB_SAFE_FONTS);

  const RECENT_FONTS_KEY = 'odf-editor-recent-fonts';
  const MAX_RECENT_FONTS = 5;

  let recentFonts = $state<string[]>([]);
  let detectedFonts = $state<string[]>([]);
  let allInstalledFonts = $state<string[] | null>(null);
  let detectionRan = false;
  const localFontAccessSupported =
    typeof window !== 'undefined' && supportsLocalFontAccess();

  function loadRecents(): string[] {
    try {
      const raw = localStorage.getItem(RECENT_FONTS_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT_FONTS);
    } catch { return []; }
  }

  function saveRecents(fonts: string[]) {
    try { localStorage.setItem(RECENT_FONTS_KEY, JSON.stringify(fonts)); } catch { /* quota or disabled */ }
  }

  function ensureDetectionRan() {
    if (detectionRan) return;
    detectionRan = true;
    detectedFonts = detectAvailableFonts(CANDIDATE_FONTS);
  }

  onMount(() => {
    recentFonts = loadRecents();
    // Run detection during browser idle time after first paint so the picker
    // is primed before the user ever clicks it, without delaying initial render.
    const schedule = typeof requestIdleCallback === 'function'
      ? (cb: () => void) => requestIdleCallback(cb, { timeout: 1000 })
      : (cb: () => void) => setTimeout(cb, 0);
    schedule(() => ensureDetectionRan());
  });

  let extraFontsList = $derived.by(() => {
    const source = allInstalledFonts ?? detectedFonts;
    const out: string[] = [];
    const recentSet = new Set(recentFonts);
    for (const f of source) {
      if (!WEB_SAFE_SET.has(f) && !recentSet.has(f)) out.push(f);
    }
    return out.sort((a, b) => a.localeCompare(b));
  });

  async function showAllInstalledFonts() {
    const list = await queryLocalFontsIfAllowed();
    if (list && list.length > 0) allInstalledFonts = list;
  }

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
  const DEFAULT_LINE_HEIGHT = '1';
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

  // Paragraph spacing (space above / below), in points. null = "Default" (the
  // style/CSS default — see paragraphSpacing.ts). Shares the line-spacing dropdown.
  const SPACING_PRESETS: (number | null)[] = [null, 0, 6, 12, 18, 24];

  function spacingLabel(v: number | null): string {
    return v === null ? 'Default' : `${v} pt`;
  }

  function currentSpacing(attr: 'spaceBefore' | 'spaceAfter'): number | null | '' {
    if (tick < 0 || !editor) return null;
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      return (editor.state.selection.$head.parent.attrs[attr] ?? null) as number | null;
    }
    let v: number | null | undefined;
    let mixed = false;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (mixed || !(attr in node.attrs)) return;
      const s = (node.attrs[attr] ?? null) as number | null;
      if (v === undefined) v = s;
      else if (v !== s) mixed = true;
    });
    return mixed ? '' : (v ?? null);
  }

  let currentSpaceBefore = $derived(currentSpacing('spaceBefore'));
  let currentSpaceAfter = $derived(currentSpacing('spaceAfter'));

  // Each spacing axis is a font-size–style combo: a free-text input plus a
  // preset dropdown. Empty input = "Default" (null). State per axis.
  let spaceBeforeOpen = $state(false);
  let spaceAfterOpen = $state(false);
  let spaceBeforeFocused = $state(false);
  let spaceAfterFocused = $state(false);
  let spaceBeforeInput = $state('');
  let spaceAfterInput = $state('');

  // Keep the inputs in sync with the selection while not being edited.
  $effect(() => {
    if (!spaceBeforeFocused) {
      spaceBeforeInput = typeof currentSpaceBefore === 'number' ? String(currentSpaceBefore) : '';
    }
  });
  $effect(() => {
    if (!spaceAfterFocused) {
      spaceAfterInput = typeof currentSpaceAfter === 'number' ? String(currentSpaceAfter) : '';
    }
  });

  // Close the per-axis preset lists whenever the parent dropdown closes so they
  // don't reappear open on the next open.
  $effect(() => {
    if (!lineHeightOpen) {
      spaceBeforeOpen = false;
      spaceAfterOpen = false;
    }
  });

  // Uniform color of the selection for a given mark. null = no color anywhere; '' = mixed.
  function uniformMarkColor(markName: string): string | null {
    if (tick < 0 || !editor) return null;
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      const marks = editor.state.storedMarks ?? editor.state.selection.$head.marks();
      return marks.find(m => m.type.name === markName)?.attrs.color ?? null;
    }
    let color: string | null | undefined;
    let mixed = false;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (mixed || !node.isText) return;
      const c = node.marks.find(m => m.type.name === markName)?.attrs.color ?? null;
      if (color === undefined) color = c;
      else if (color !== c) mixed = true;
    });
    return mixed ? '' : (color ?? null);
  }
  // Font color lives on the textStyle mark (fontColor.ts); highlight on the
  // dedicated `highlight` mark (multicolor → exports to fo:background-color).
  let currentFontColor = $derived(uniformMarkColor('textStyle'));
  let currentHighlightColor = $derived(uniformMarkColor('highlight'));

  let fontOpen = $state(false);
  let sizeOpen = $state(false);
  let lineHeightOpen = $state(false);
  let alignOpen = $state(false);
  let fontColorOpen = $state(false);
  let highlightColorOpen = $state(false);
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
    fontColorOpen = false;
    highlightColorOpen = false;
    // Save selection before the picker button steals focus.
    savedFrom = editor.state.selection.from;
    savedTo = editor.state.selection.to;
    // Detection normally runs on mount; this is the safety net if the user
    // somehow clicks the picker before the idle callback has fired.
    if (!fontOpen) ensureDetectionRan();
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

    const next = [value, ...recentFonts.filter((f) => f !== value)].slice(0, MAX_RECENT_FONTS);
    recentFonts = next;
    saveRecents(next);
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
    fontColorOpen = false;
    highlightColorOpen = false;
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
    fontColorOpen = false;
    highlightColorOpen = false;
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
    fontColorOpen = false;
    highlightColorOpen = false;
    lineHeightOpen = !lineHeightOpen;
  }

  function pickLineHeight(value: string) {
    if (!editor) return;
    lineHeightOpen = false;
    editor.chain().focus().setLineHeight(value).run();
  }

  // Apply a resolved spacing value (pt number, or null for "Default") to the axis.
  // Restores the saved selection so applying from the input doesn't lose it.
  function applySpaceValue(axis: 'before' | 'after', value: number | null) {
    if (!editor) return;
    const from = savedFrom ?? editor.state.selection.from;
    const to   = savedTo   ?? editor.state.selection.to;
    savedFrom = null;
    savedTo   = null;
    const chain = editor.chain().focus().setTextSelection({ from, to });
    (axis === 'before' ? chain.setSpaceBefore(value) : chain.setSpaceAfter(value)).run();
  }

  // Parse a free-text input. Empty → Default (null); otherwise a non-negative pt
  // number (capped). Invalid input is ignored.
  function applySpaceInput(axis: 'before' | 'after', raw: string) {
    const t = raw.trim();
    if (t === '') return applySpaceValue(axis, null);
    const n = parseFloat(t);
    if (isNaN(n) || n < 0 || n > 200) return;
    applySpaceValue(axis, n);
  }

  function onSpaceFocus(axis: 'before' | 'after', e: FocusEvent) {
    if (!editor) return;
    fontOpen = false;
    sizeOpen = false;
    sizeInputFocused = false;
    alignOpen = false;
    fontColorOpen = false;
    highlightColorOpen = false;
    spaceBeforeOpen = false;
    spaceAfterOpen = false;
    if (axis === 'before') spaceBeforeFocused = true; else spaceAfterFocused = true;
    savedFrom = editor.state.selection.from;
    savedTo = editor.state.selection.to;
    (e.target as HTMLInputElement).select();
  }

  function onSpaceKeydown(axis: 'before' | 'after', e: KeyboardEvent) {
    const input = e.target as HTMLInputElement;
    if (e.key === 'Enter') {
      e.preventDefault();
      applySpaceInput(axis, input.value);
      if (axis === 'before') spaceBeforeFocused = false; else spaceAfterFocused = false;
      input.blur();
    } else if (e.key === 'Escape') {
      if (axis === 'before') spaceBeforeFocused = false; else spaceAfterFocused = false;
      input.blur();
    }
  }

  function onSpaceBlur(axis: 'before' | 'after') {
    if (axis === 'before') spaceBeforeFocused = false; else spaceAfterFocused = false;
  }

  function openSpacePreset(axis: 'before' | 'after') {
    if (!editor) return;
    if (axis === 'before') {
      spaceAfterOpen = false;
      spaceBeforeOpen = !spaceBeforeOpen;
    } else {
      spaceBeforeOpen = false;
      spaceAfterOpen = !spaceAfterOpen;
    }
  }

  function pickSpacePreset(axis: 'before' | 'after', value: number | null) {
    if (axis === 'before') spaceBeforeOpen = false; else spaceAfterOpen = false;
    applySpaceValue(axis, value);
  }

  function spacePresetClickOutside(node: HTMLElement, axis: 'before' | 'after') {
    function handler(e: MouseEvent) {
      if (node.contains(e.target as Node)) return;
      if (axis === 'before') spaceBeforeOpen = false; else spaceAfterOpen = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
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
    fontColorOpen = false;
    highlightColorOpen = false;
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

  // --- Page layout / margins (cm) ---
  type MarginAxis = 'top' | 'bottom' | 'left' | 'right';
  const MARGIN_FIELDS: { axis: MarginAxis; label: string }[] = [
    { axis: 'top',    label: 'Top'    },
    { axis: 'bottom', label: 'Bottom' },
    { axis: 'left',   label: 'Left'   },
    { axis: 'right',  label: 'Right'  },
  ];
  const MARGIN_STEP = 0.1;
  const MARGIN_MIN = 0;
  const MARGIN_MAX = 10;

  let layoutOpen = $state(false);
  let marginInputs = $state<Record<MarginAxis, string>>({ top: '', bottom: '', left: '', right: '' });

  function fmtCm(n: number): string {
    return String(Math.round(n * 100) / 100);
  }

  // Refresh the editable display strings from the current margins. Called on open
  // and after each change — no $effect, so there's no chance of a reactive loop
  // and typing is never clobbered mid-edit.
  function syncMarginInputs() {
    marginInputs = {
      top:    fmtCm(pageMargins.top),
      bottom: fmtCm(pageMargins.bottom),
      left:   fmtCm(pageMargins.left),
      right:  fmtCm(pageMargins.right),
    };
  }

  function setMargin(axis: MarginAxis, value: number) {
    const clamped = Math.min(MARGIN_MAX, Math.max(MARGIN_MIN, Math.round(value * 100) / 100));
    pageMargins = { ...pageMargins, [axis]: clamped };
    marginInputs[axis] = fmtCm(clamped);
  }

  function stepMargin(axis: MarginAxis, delta: number) {
    setMargin(axis, pageMargins[axis] + delta);
  }

  function commitMarginInput(axis: MarginAxis) {
    const n = parseFloat(marginInputs[axis]);
    if (Number.isNaN(n)) {
      marginInputs[axis] = fmtCm(pageMargins[axis]); // revert invalid input
      return;
    }
    setMargin(axis, n);
  }

  function onMarginKeydown(axis: MarginAxis, e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitMarginInput(axis);
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      marginInputs[axis] = fmtCm(pageMargins[axis]);
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      stepMargin(axis, MARGIN_STEP);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      stepMargin(axis, -MARGIN_STEP);
    }
  }

  function openLayout() {
    fontOpen = false;
    sizeOpen = false;
    sizeInputFocused = false;
    lineHeightOpen = false;
    fontColorOpen = false;
    highlightColorOpen = false;
    alignOpen = false;
    layoutOpen = !layoutOpen;
    if (layoutOpen) syncMarginInputs();
  }

  function layoutClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) layoutOpen = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }

  // The color pickers (font + highlight) live in ColorPicker.svelte. When one
  // opens it asks the parent (via the ColorPicker `onOpen` prop) to close the
  // sibling toolbar dropdowns and the other color picker.
  function onColorPickerOpen(which: 'font' | 'highlight') {
    fontOpen = false;
    sizeOpen = false;
    sizeInputFocused = false;
    lineHeightOpen = false;
    alignOpen = false;
    if (which === 'font') highlightColorOpen = false;
    else fontColorOpen = false;
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
          {#if recentFonts.length > 0}
            <div class="font-section-label">Recent</div>
            {#each recentFonts as font}
              <button
                class="font-option"
                class:active={currentFont === font}
                style="font-family: {font}"
                onclick={() => pickFont(font)}
              >{font}</button>
            {/each}
          {/if}

          <div class="font-section-label">Web-safe</div>
          {#each WEB_SAFE_FONTS as font}
            <button
              class="font-option"
              class:active={currentFont === font}
              style="font-family: {font}"
              onclick={() => pickFont(font)}
            >{font}</button>
          {/each}

          {#if extraFontsList.length > 0}
            <div class="font-section-label">All fonts</div>
            {#each extraFontsList as font}
              <button
                class="font-option"
                class:active={currentFont === font}
                style="font-family: {font}"
                onclick={() => pickFont(font)}
              >{font}</button>
            {/each}
          {/if}

          {#if localFontAccessSupported && !allInstalledFonts}
            <button class="font-show-all" onclick={showAllInstalledFonts}>
              Load all installed fonts
            </button>
          {/if}
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
      <ColorPicker
        {editor}
        currentColor={currentFontColor}
        defaultColor="#C00000"
        title="Font color"
        chevronTitle="Choose font color"
        bind:open={fontColorOpen}
        onOpen={() => onColorPickerOpen('font')}
        onApply={(c, r) => editor?.chain().focus().setTextSelection(r).setColor(c).run()}
        onClear={(r) => editor?.chain().focus().setTextSelection(r).unsetColor().run()}
      >
        {#snippet icon()}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <text x="3" y="11" font-size="10" font-weight="bold" font-family="sans-serif" fill="currentColor">A</text>
          </svg>
        {/snippet}
      </ColorPicker>
      <ColorPicker
        {editor}
        currentColor={currentHighlightColor}
        defaultColor="#FFFF00"
        title="Highlight color"
        chevronTitle="Choose highlight color"
        bind:open={highlightColorOpen}
        onOpen={() => onColorPickerOpen('highlight')}
        onApply={(c, r) => editor?.chain().focus().setTextSelection(r).setHighlight({ color: c }).run()}
        onClear={(r) => editor?.chain().focus().setTextSelection(r).unsetHighlight().run()}
      >
        {#snippet icon()}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
            <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" opacity="0.3"/>
          </svg>
        {/snippet}
      </ColorPicker>
    </div>

    <div class="toolbar-separator"></div>

    <div class="lh-picker" use:lineHeightPickerClickOutside>
      <button class="lh-trigger" onclick={openLineHeightPicker} title="Line &amp; paragraph spacing">
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
          <div class="lh-section-label">Line spacing</div>
          {#each LINE_HEIGHTS as lh}
            <button
              class="lh-option"
              class:active={currentLineHeight === lh.value}
              onclick={() => pickLineHeight(lh.value)}
            >{lh.label}</button>
          {/each}

          <div class="lh-section-label">Space before paragraph (pt)</div>
          <div class="sp-field" use:spacePresetClickOutside={'before'}>
            <div class="sp-input-wrap">
              <input
                type="text"
                class="sp-input"
                bind:value={spaceBeforeInput}
                onfocus={(e) => onSpaceFocus('before', e)}
                onkeydown={(e) => onSpaceKeydown('before', e)}
                onblur={() => onSpaceBlur('before')}
                placeholder="Default"
                inputmode="decimal"
                title="Space before paragraph (pt)"
              />
              <button class="sp-chevron" onclick={() => openSpacePreset('before')} tabindex="-1" title="Space before presets">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                  <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
            {#if spaceBeforeOpen}
              <div class="sp-dropdown">
                {#each SPACING_PRESETS as v}
                  <button
                    class="sp-option"
                    class:active={currentSpaceBefore === v}
                    onclick={() => pickSpacePreset('before', v)}
                  >{spacingLabel(v)}</button>
                {/each}
              </div>
            {/if}
          </div>

          <div class="lh-section-label">Space after paragraph (pt)</div>
          <div class="sp-field" use:spacePresetClickOutside={'after'}>
            <div class="sp-input-wrap">
              <input
                type="text"
                class="sp-input"
                bind:value={spaceAfterInput}
                onfocus={(e) => onSpaceFocus('after', e)}
                onkeydown={(e) => onSpaceKeydown('after', e)}
                onblur={() => onSpaceBlur('after')}
                placeholder="Default"
                inputmode="decimal"
                title="Space after paragraph (pt)"
              />
              <button class="sp-chevron" onclick={() => openSpacePreset('after')} tabindex="-1" title="Space after presets">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                  <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
            {#if spaceAfterOpen}
              <div class="sp-dropdown">
                {#each SPACING_PRESETS as v}
                  <button
                    class="sp-option"
                    class:active={currentSpaceAfter === v}
                    onclick={() => pickSpacePreset('after', v)}
                  >{spacingLabel(v)}</button>
                {/each}
              </div>
            {/if}
          </div>
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

    <div class="layout-picker" use:layoutClickOutside>
      <button class="layout-trigger" onclick={openLayout} title="Page layout &amp; margins" aria-pressed={layoutOpen}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2.5" y="1.5" width="11" height="13" rx="1" stroke="currentColor" stroke-width="1.3"/>
          <rect x="4.5" y="3.5" width="7" height="9" rx="0.5" stroke="currentColor" stroke-width="1" stroke-dasharray="2 1.5"/>
        </svg>
        <span class="layout-trigger-label">Layout</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
          <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      {#if layoutOpen}
        <div class="layout-dropdown">
          <div class="lh-section-label">Orientation</div>
          <div class="orientation-row">
            <button
              class="orientation-btn"
              class:active={pageOrientation === 'portrait'}
              aria-pressed={pageOrientation === 'portrait'}
              onclick={() => (pageOrientation = 'portrait')}
              title="Portrait"
            >
              <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden="true">
                <rect x="2.5" y="1.5" width="9" height="13" rx="1" stroke="currentColor" stroke-width="1.3"/>
              </svg>
              <span>Portrait</span>
            </button>
            <button
              class="orientation-btn"
              class:active={pageOrientation === 'landscape'}
              aria-pressed={pageOrientation === 'landscape'}
              onclick={() => (pageOrientation = 'landscape')}
              title="Landscape"
            >
              <svg width="16" height="14" viewBox="0 0 16 14" fill="none" aria-hidden="true">
                <rect x="1.5" y="2.5" width="13" height="9" rx="1" stroke="currentColor" stroke-width="1.3"/>
              </svg>
              <span>Landscape</span>
            </button>
          </div>
          <div class="lh-section-label">Page margins (cm)</div>
          <div class="margin-grid">
            {#each MARGIN_FIELDS as f}
              <div class="margin-field">
                <span class="margin-label">{f.label}</span>
                <div class="margin-input-wrap">
                  <input
                    type="text"
                    class="margin-input"
                    bind:value={marginInputs[f.axis]}
                    onkeydown={(e) => onMarginKeydown(f.axis, e)}
                    onblur={() => commitMarginInput(f.axis)}
                    inputmode="decimal"
                    title="{f.label} margin (cm)"
                  />
                  <div class="margin-steppers">
                    <button class="margin-step" tabindex="-1" onclick={() => stepMargin(f.axis, MARGIN_STEP)} title="Increase {f.label.toLowerCase()} margin" aria-label="Increase {f.label.toLowerCase()} margin">
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                        <path d="M1 5.5l3-3 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </button>
                    <button class="margin-step" tabindex="-1" onclick={() => stepMargin(f.axis, -MARGIN_STEP)} title="Decrease {f.label.toLowerCase()} margin" aria-label="Decrease {f.label.toLowerCase()} margin">
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                        <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            {/each}
          </div>
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
    max-height: 360px;
    overflow-y: auto;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 2px;
    display: flex;
    flex-direction: column;
  }

  .font-section-label {
    padding: 0.4rem 0.6rem 0.2rem;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
    font-family: var(--font-sans);
    user-select: none;
  }

  .font-section-label:not(:first-child) {
    margin-top: 4px;
    border-top: 1px solid var(--color-border);
  }

  .font-show-all {
    display: block;
    width: 100%;
    padding: 0.4rem 0.6rem;
    margin-top: 2px;
    border: none;
    border-top: 1px solid var(--color-border);
    border-radius: 0;
    background: var(--color-surface);
    color: var(--color-primary);
    font-size: 0.8rem;
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
    position: sticky;
    bottom: -2px;
  }

  .font-show-all:hover {
    background: var(--color-btn-hover);
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
    min-width: 200px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 2px;
    display: flex;
    flex-direction: column;
  }

  .layout-picker {
    position: relative;
  }

  .layout-trigger {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 2rem;
    padding: 0 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    min-width: unset;
    transition: border-color 0.15s;
  }

  .layout-trigger:hover {
    border-color: var(--color-primary);
  }

  .layout-trigger-label {
    font-size: 0.8rem;
    font-family: var(--font-sans);
  }

  .layout-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    width: 232px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 2px 2px 6px;
  }

  .orientation-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 4px 6px 2px;
  }

  .orientation-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 8px 4px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 0.72rem;
    cursor: pointer;
  }

  .orientation-btn:hover {
    background: var(--color-btn-hover);
  }

  .orientation-btn.active {
    border-color: var(--color-primary);
    background: var(--color-primary);
    color: white;
  }

  .margin-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 4px 6px 2px;
  }

  .margin-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    /* Allow the grid track to shrink below the input's intrinsic width so the
       fields stay inside the panel instead of overflowing to the right. */
    min-width: 0;
  }

  .margin-label {
    font-size: 0.72rem;
    color: var(--color-text);
    font-family: var(--font-sans);
  }

  .margin-input-wrap {
    display: flex;
    align-items: stretch;
    height: 1.9rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    overflow: hidden;
    transition: border-color 0.15s;
  }

  .margin-input-wrap:hover,
  .margin-input-wrap:focus-within {
    border-color: var(--color-primary);
  }

  .margin-input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 0.4rem;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-size: 0.8rem;
    font-family: var(--font-sans);
    outline: none;
  }

  .margin-steppers {
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--color-border);
  }

  .margin-step {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    min-width: unset;
    height: 50%;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }

  .margin-step:first-child {
    border-bottom: 1px solid var(--color-border);
  }

  .margin-step:hover {
    background: var(--color-btn-hover);
  }

  .lh-section-label {
    padding: 0.4rem 0.6rem 0.2rem;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text);
    font-family: var(--font-sans);
    user-select: none;
  }

  .lh-section-label:not(:first-child) {
    margin-top: 4px;
    border-top: 1px solid var(--color-border);
  }

  .sp-field {
    position: relative;
    padding: 0 2px 2px;
  }

  .sp-input-wrap {
    display: flex;
    align-items: center;
    height: 1.9rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    overflow: hidden;
    transition: border-color 0.15s;
  }

  .sp-input-wrap:hover,
  .sp-input-wrap:focus-within {
    border-color: var(--color-primary);
  }

  .sp-input {
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

  .sp-chevron {
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

  .sp-chevron:hover {
    background: var(--color-btn-hover);
  }

  .sp-dropdown {
    position: absolute;
    top: calc(100% + 1px);
    left: 2px;
    right: 2px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 210;
    padding: 2px;
    display: flex;
    flex-direction: column;
    max-height: 220px;
    overflow-y: auto;
  }

  .sp-option {
    display: block;
    width: 100%;
    padding: 0.3rem 0.6rem;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    font-size: 0.8rem;
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s;
    min-width: unset;
    height: auto;
    justify-content: flex-start;
  }

  .sp-option:hover {
    background: var(--color-btn-hover);
  }

  .sp-option.active {
    background: var(--color-primary);
    color: white;
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

</style>
