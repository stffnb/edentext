<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { onMount } from 'svelte';
  import ColorPicker from './ColorPicker.svelte';
  import ParagraphBorderPicker from './ParagraphBorderPicker.svelte';
  import TablePicker from './TablePicker.svelte';
  import SpecialCharPicker from './SpecialCharPicker.svelte';
  import DateTimePicker from './DateTimePicker.svelte';
  import LinkDialog from './LinkDialog.svelte';
  import { OPEN_LINK_DIALOG_EVENT } from '../editor/extensions/link';
  import {
    detectInstalledFonts,
    queryLocalFontsIfAllowed,
    supportsLocalFontAccess,
  } from '../utils/fontDetect';
  import { DEFAULT_MARGINS, cmToPx, type PageMargins } from '../storage/pageMargins';
  import type { Orientation } from '../storage/pageOrientation';
  import { pageDimsCm, PAGE_FORMAT_CM, type PageFormat } from '../storage/pageFormat';
  import { DEFAULT_HF_DISTANCES, clampHfDistance, type HfDistances } from '../storage/headerFooter';
  import { blockFontSize, coversWholeBlock, DEFAULT_FONT_SIZE, FONT_SIZES, type SizedBlock } from '../utils/fontSize';
  import { listContext } from '../editor/extensions/indent';
  import { stepFontSize } from '../editor/extensions/shortcuts';
  import { findColumns, DEFAULT_COLUMN_GAP_CM } from '../editor/extensions/columns';
  import { t } from '../i18n/i18n.svelte';
  import { shortcutHint, type ShortcutId } from '../editor/shortcuts';

  let { editor, tick, showFormattingMarks = $bindable(), pageMargins = $bindable(DEFAULT_MARGINS), pageOrientation = $bindable<Orientation>('portrait'), pageFormat = $bindable<PageFormat>('A4'), hfDistances = $bindable(DEFAULT_HF_DISTANCES), differentFirstPage = $bindable(false), differentOddEven = $bindable(false), hfActive = null, onEditZone, onDebugDump, onManageTableStyles }:
    { editor: Editor | null; tick: number; showFormattingMarks: boolean; pageMargins?: PageMargins; pageOrientation?: Orientation; pageFormat?: PageFormat; hfDistances?: HfDistances; differentFirstPage?: boolean; differentOddEven?: boolean; hfActive?: 'header' | 'footer' | null; onEditZone?: (zone: 'header' | 'footer') => void; onDebugDump?: () => void; onManageTableStyles?: () => void } = $props();

  const PAGE_FORMATS = Object.keys(PAGE_FORMAT_CM) as PageFormat[];

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

  async function ensureDetectionRan() {
    detectedFonts = await detectInstalledFonts();
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

  // A node that carries text formatting in the selection: a text node, or an inline
  // atom (e.g. a date/time field) bearing the mark in question. Selecting such an atom
  // makes a NodeSelection, so without this its font/size/color would read as default.
  const bearsMark = (node: { isText: boolean; isInline: boolean; isAtom: boolean; marks: readonly { type: { name: string } }[] }, markName: string): boolean =>
    node.isText || (node.isInline && node.isAtom && node.marks.some(m => m.type.name === markName));

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
      if (mixed || !bearsMark(node, 'textStyle')) return;
      const f: string = node.marks.find(m => m.type.name === 'textStyle')?.attrs.fontFamily ?? DEFAULT_EDITOR_FONT;
      if (font === undefined) font = f;
      else if (font !== f) mixed = true;
    });
    return mixed ? '' : (font ?? DEFAULT_EDITOR_FONT);
  });

  function effectiveSize(node: { isText: boolean; marks: readonly { type: { name: string }; attrs: Record<string, string> }[] }, parent: SizedBlock): string {
    const explicit = node.marks.find(m => m.type.name === 'textStyle')?.attrs.fontSize;
    return explicit || blockFontSize(parent);
  }

  let currentFontSize = $derived.by(() => {
    if (tick < 0 || !editor) return '';
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      const head = editor.state.selection.$head;
      const marks = editor.state.storedMarks ?? head.marks();
      const explicit = marks.find(m => m.type.name === 'textStyle')?.attrs.fontSize;
      if (explicit) return explicit;
      return blockFontSize(head.parent as SizedBlock);
    }
    let size: string | undefined;
    let mixed = false;
    editor.state.doc.nodesBetween(from, to, (node, _pos, parent) => {
      if (mixed || !bearsMark(node, 'textStyle')) return;
      const s = effectiveSize(node as Parameters<typeof effectiveSize>[0], parent as Parameters<typeof effectiveSize>[1]);
      if (size === undefined) size = s;
      else if (size !== s) mixed = true;
    });
    return mixed ? '' : (size ?? DEFAULT_FONT_SIZE);
  });

  // Must match line-height in editor.css (.paper .tiptap)
  const DEFAULT_LINE_HEIGHT = '1';
  const LINE_HEIGHTS = ['1', '1.15', '1.5', '2'];

  // Word binds only these three; 1.15 has no key.
  const LH_SHORTCUTS: Record<string, ShortcutId | undefined> = {
    '1': 'lineHeight1', '1.5': 'lineHeight15', '2': 'lineHeight2',
  };

  // Numeric values show verbatim; the single/double presets are localized.
  function lineHeightLabel(value: string): string {
    if (value === '1') return t().toolbarExpanded.lineSingle;
    if (value === '2') return t().toolbarExpanded.lineDouble;
    return value;
  }

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
    return v === null ? t().toolbarExpanded.spacingDefault : t().toolbarExpanded.pt(v);
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
      if (mixed || !bearsMark(node, markName)) return;
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

  // Uniform paragraph background across the selection (paragraphBox.ts). null = none
  // anywhere; '' = mixed. Feeds the paragraph-shading ColorPicker.
  let currentParaBackground = $derived.by(() => {
    if (tick < 0 || !editor) return null;
    const { from, to, empty } = editor.state.selection;
    if (empty) return (editor.state.selection.$head.parent.attrs.backgroundColor ?? null) as string | null;
    let c: string | null | undefined;
    let mixed = false;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (mixed || !('backgroundColor' in node.attrs)) return;
      const b = (node.attrs.backgroundColor ?? null) as string | null;
      if (c === undefined) c = b;
      else if (c !== b) mixed = true;
    });
    return mixed ? '' : (c ?? null);
  });

  // Sub/superscript are mutually exclusive (Word-style): toggling one clears the
  // other. odf-kit maps these marks to text:position (round-trips with LibreOffice
  // and Word). See export/odt.ts applyRuns for the custom-attr-paragraph path.
  let isSuperscript = $derived(tick >= 0 && !!editor?.isActive('superscript'));
  let isSubscript = $derived(tick >= 0 && !!editor?.isActive('subscript'));

  function toggleSuperscript() {
    editor?.chain().focus().unsetSubscript().toggleSuperscript().run();
  }
  function toggleSubscript() {
    editor?.chain().focus().unsetSuperscript().toggleSubscript().run();
  }

  let fontOpen = $state(false);
  let fontInputFocused = $state(false);
  let fontInputValue = $state('');
  let sizeOpen = $state(false);
  let lineHeightOpen = $state(false);
  let fontColorOpen = $state(false);
  let highlightColorOpen = $state(false);
  let paraShadeOpen = $state(false);
  let sizeInputFocused = $state(false);
  let sizeInputValue = $state('');
  let savedFrom: number | null = null;
  let savedTo: number | null = null;

  $effect(() => {
    if (!sizeInputFocused) {
      sizeInputValue = currentFontSize ? currentFontSize.replace('pt', '') : '';
    }
  });

  // The typed text survives the input's blur while the dropdown is open: clicking an
  // option blurs first, and re-expanding the list there would move the click target away.
  $effect(() => {
    if (!fontInputFocused && !fontOpen) fontInputValue = currentFont;
  });

  // While the user types, the dropdown narrows to the matching fonts.
  let fontFilter = $derived(
    fontOpen && fontInputValue !== currentFont ? fontInputValue.trim().toLowerCase() : ''
  );
  const matchesFilter = (f: string) => !fontFilter || f.toLowerCase().includes(fontFilter);
  let recentShown = $derived(recentFonts.filter(matchesFilter));
  let webSafeShown = $derived(WEB_SAFE_FONTS.filter(matchesFilter));
  let extraShown = $derived(extraFontsList.filter(matchesFilter));

  function openFontPicker() {
    if (!editor) return;
    sizeOpen = false;
    sizeInputFocused = false;
    lineHeightOpen = false;
    fontColorOpen = false;
    highlightColorOpen = false;
    paraShadeOpen = false;
    // Save selection before the picker button steals focus.
    savedFrom = editor.state.selection.from;
    savedTo = editor.state.selection.to;
    // Detection normally runs on mount; this is the safety net if the user
    // somehow clicks the picker before the idle callback has fired.
    if (!fontOpen) ensureDetectionRan();
    fontOpen = !fontOpen;
  }

  function onFontInputFocus(e: FocusEvent) {
    fontInputFocused = true;
    if (!fontOpen) openFontPicker();
    (e.target as HTMLInputElement).select();
  }

  function onFontInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const typed = fontInputValue.trim();
      const known = [...recentFonts, ...WEB_SAFE_FONTS, ...extraFontsList];
      // Exact name wins; otherwise the first prefix match, like LibreOffice's
      // autocomplete. An unknown name is applied as typed (the font may exist).
      const hit = known.find(f => f.toLowerCase() === typed.toLowerCase())
        ?? known.find(f => f.toLowerCase().startsWith(typed.toLowerCase()));
      if (typed) pickFont(hit ?? typed);
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      fontOpen = false;
      fontInputFocused = false;
      (e.target as HTMLInputElement).blur();
      editor?.commands.focus();
    }
  }

  function pickFont(value: string) {
    if (!editor) return;
    fontOpen = false;
    fontInputFocused = false;
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
    const chain = editor.chain().focus().setTextSelection({ from, to }).setFontSize(`${size}pt`);
    if (coversWholeBlock(editor.state.doc, from, to)) chain.setBlockFontSize(`${size}pt`);
    chain.run();
  }

  function onSizeInputFocus(e: FocusEvent) {
    if (!editor) return;
    sizeInputFocused = true;
    fontOpen = false;
    lineHeightOpen = false;
    fontColorOpen = false;
    highlightColorOpen = false;
    paraShadeOpen = false;
    savedFrom = editor.state.selection.from;
    savedTo = editor.state.selection.to;
    (e.target as HTMLInputElement).select();
  }

  function onSizeInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Imported documents carry fractional sizes (producer rounding, relative style
      // sizes), so keep one decimal instead of snapping the shown value to a whole point.
      const num = Math.round(parseFloat(sizeInputValue.replace(',', '.')) * 10) / 10;
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
    fontColorOpen = false;
    highlightColorOpen = false;
    paraShadeOpen = false;
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
    fontColorOpen = false;
    highlightColorOpen = false;
    paraShadeOpen = false;
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
    const trimmed = raw.trim();
    if (trimmed === '') return applySpaceValue(axis, null);
    const n = parseFloat(trimmed);
    if (isNaN(n) || n < 0 || n > 200) return;
    applySpaceValue(axis, n);
  }

  function onSpaceFocus(axis: 'before' | 'after', e: FocusEvent) {
    if (!editor) return;
    fontOpen = false;
    sizeOpen = false;
    sizeInputFocused = false;
    fontColorOpen = false;
    highlightColorOpen = false;
    paraShadeOpen = false;
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

  // --- Page layout / margins (cm) ---
  type MarginAxis = 'top' | 'bottom' | 'left' | 'right';
  const MARGIN_FIELDS: MarginAxis[] = ['top', 'bottom', 'left', 'right'];
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

  // --- Header/footer edge distances (cm) ---
  type HfAxis = 'header' | 'footer';
  const HF_DIST_FIELDS: HfAxis[] = ['header', 'footer'];
  let hfDistInputs = $state<Record<HfAxis, string>>({ header: '', footer: '' });

  function syncHfDistInputs() {
    hfDistInputs = { header: fmtCm(hfDistances.header), footer: fmtCm(hfDistances.footer) };
  }

  function setHfDist(axis: HfAxis, value: number) {
    const clamped = clampHfDistance(value);
    hfDistances = { ...hfDistances, [axis]: clamped };
    hfDistInputs[axis] = fmtCm(clamped);
  }

  function stepHfDist(axis: HfAxis, delta: number) {
    setHfDist(axis, hfDistances[axis] + delta);
  }

  function commitHfDistInput(axis: HfAxis) {
    const n = parseFloat(hfDistInputs[axis]);
    if (Number.isNaN(n)) {
      hfDistInputs[axis] = fmtCm(hfDistances[axis]); // revert invalid input
      return;
    }
    setHfDist(axis, n);
  }

  function onHfDistKeydown(axis: HfAxis, e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitHfDistInput(axis);
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      hfDistInputs[axis] = fmtCm(hfDistances[axis]);
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      stepHfDist(axis, MARGIN_STEP);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      stepHfDist(axis, -MARGIN_STEP);
    }
  }

  function openLayout() {
    fontOpen = false;
    sizeOpen = false;
    sizeInputFocused = false;
    lineHeightOpen = false;
    fontColorOpen = false;
    highlightColorOpen = false;
    paraShadeOpen = false;
    columnsOpen = false;
    layoutOpen = !layoutOpen;
    if (layoutOpen) {
      syncMarginInputs();
      syncHfDistInputs();
    }
  }

  function layoutClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) layoutOpen = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }

  // The color pickers (font + highlight + paragraph shading) live in ColorPicker.svelte.
  // When one opens it asks the parent (via the `onOpen` prop) to close the sibling
  // toolbar dropdowns and the other color pickers.
  function onColorPickerOpen(which: 'font' | 'highlight' | 'paraShade') {
    fontOpen = false;
    sizeOpen = false;
    sizeInputFocused = false;
    lineHeightOpen = false;
    columnsOpen = false;
    if (which !== 'font') fontColorOpen = false;
    if (which !== 'highlight') highlightColorOpen = false;
    if (which !== 'paraShade') paraShadeOpen = false;
  }

  // --- Table insertion (TablePicker.svelte) ---
  let tableOpen = $state(false);

  // Close the sibling dropdowns when the table picker opens (mirrors openLayout).
  function onTablePickerOpen() {
    fontOpen = false;
    sizeOpen = false;
    sizeInputFocused = false;
    lineHeightOpen = false;
    fontColorOpen = false;
    highlightColorOpen = false;
    paraShadeOpen = false;
    layoutOpen = false;
    specialCharOpen = false;
    columnsOpen = false;
  }

  function insertTable(rows: number, cols: number, range: { from: number; to: number }) {
    if (!editor) return;
    editor.chain().focus().setTextSelection(range).insertTable({ rows, cols, withHeaderRow: false }).run();
  }

  // --- Table of contents insertion (tableOfContents.ts) ---
  function insertToc() {
    if (!editor || hfActive) return; // body-only; the HF schema has no TOC node
    editor.chain().focus().setTableOfContents().run();
  }

  // --- Multi-column section (columns.ts) ---
  let columnsOpen = $state(false);
  let columnGapInput = $state('');

  // Count/gap of the columns section around the cursor; count 1 = not in one.
  let colState = $derived.by(() => {
    if (tick < 0 || !editor) return { count: 1, gapCm: DEFAULT_COLUMN_GAP_CM, inColumns: false };
    const found = findColumns(editor.state);
    return found
      ? { count: found.node.attrs.count as number, gapCm: found.node.attrs.gapCm as number, inColumns: true }
      : { count: 1, gapCm: DEFAULT_COLUMN_GAP_CM, inColumns: false };
  });

  function openColumnsPicker() {
    fontOpen = false;
    sizeOpen = false;
    sizeInputFocused = false;
    lineHeightOpen = false;
    fontColorOpen = false;
    highlightColorOpen = false;
    paraShadeOpen = false;
    layoutOpen = false;
    tableOpen = false;
    specialCharOpen = false;
    columnsOpen = !columnsOpen;
    if (columnsOpen) columnGapInput = fmtCm(colState.gapCm);
  }

  function columnsClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) columnsOpen = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }

  // The current gap straight from the document (colState may not have recomputed yet
  // within the same handler after a command ran).
  function liveColumnGap(): number {
    const found = editor ? findColumns(editor.state) : null;
    return (found?.node.attrs.gapCm as number | undefined) ?? DEFAULT_COLUMN_GAP_CM;
  }

  function applyColumnCount(n: number) {
    if (!editor || hfActive) return;
    editor.chain().focus().setColumns(n).run();
    columnGapInput = fmtCm(liveColumnGap());
  }

  function setColumnGap(value: number) {
    if (!editor) return;
    editor.chain().focus().setColumnGap(value).run();
    columnGapInput = fmtCm(liveColumnGap());
  }

  function commitColumnGapInput() {
    const n = parseFloat(columnGapInput);
    if (Number.isNaN(n)) {
      columnGapInput = fmtCm(liveColumnGap()); // revert invalid input
      return;
    }
    setColumnGap(n);
  }

  function onColumnGapKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitColumnGapInput();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      columnGapInput = fmtCm(liveColumnGap());
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setColumnGap(liveColumnGap() + MARGIN_STEP);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setColumnGap(liveColumnGap() - MARGIN_STEP);
    }
  }

  // --- Special character insertion (SpecialCharPicker.svelte) ---
  let specialCharOpen = $state(false);

  // Close the sibling dropdowns when the special-character picker opens.
  function onSpecialCharPickerOpen() {
    fontOpen = false;
    sizeOpen = false;
    sizeInputFocused = false;
    lineHeightOpen = false;
    fontColorOpen = false;
    highlightColorOpen = false;
    paraShadeOpen = false;
    layoutOpen = false;
    tableOpen = false;
    columnsOpen = false;
    dateTimeOpen = false;
  }

  function insertSpecialChar(char: string, range: { from: number; to: number }) {
    if (!editor) return;
    editor.chain().focus().setTextSelection(range).insertContent(char).run();
  }

  // --- Date/time field insertion (DateTimePicker.svelte) ---
  let dateTimeOpen = $state(false);

  // Close the sibling dropdowns (incl. the special-char picker) without touching
  // dateTimeOpen, so the trigger's own open/close toggle keeps working.
  function onDateTimePickerOpen() {
    fontOpen = false;
    sizeOpen = false;
    sizeInputFocused = false;
    lineHeightOpen = false;
    fontColorOpen = false;
    highlightColorOpen = false;
    paraShadeOpen = false;
    layoutOpen = false;
    tableOpen = false;
    columnsOpen = false;
    specialCharOpen = false;
  }

  function insertDateTime(
    opts: { kind: 'date' | 'time'; format: string; fixed: boolean },
    range: { from: number; to: number },
  ) {
    if (!editor) return;
    editor.chain().focus().setTextSelection(range).insertDateTimeField(opts).run();
  }

  // --- Image insertion (image.ts) ---
  let imageInput = $state<HTMLInputElement | null>(null);

  // The page text box in px, so an inserted image never starts wider/taller than
  // one page (mirrors export's content-width math; dims follow format + orientation).
  function contentBoxPx(): { maxW: number; maxH: number } {
    const { w, h } = pageDimsCm(pageFormat, pageOrientation);
    const wCm = w - pageMargins.left - pageMargins.right;
    const hCm = h - pageMargins.top - pageMargins.bottom;
    return { maxW: Math.round(cmToPx(wCm)), maxH: Math.round(cmToPx(hCm)) };
  }

  function onImageFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    if (!file || !editor) return; // editor = activeEditor (body or the active HF zone)
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const probe = document.createElement('img');
      probe.onload = () => {
        let w = probe.naturalWidth || 1;
        let h = probe.naturalHeight || 1;
        const { maxW, maxH } = contentBoxPx();
        if (w > maxW) { h = (h * maxW) / w; w = maxW; }
        if (h > maxH) { w = (w * maxH) / h; h = maxH; }
        editor!.chain().focus().setImage({ src, alt: file.name, width: Math.round(w), height: Math.round(h) }).run();
      };
      probe.src = src;
    };
    reader.readAsDataURL(file);
  }

  // --- Link insertion (link.ts) ---
  let isLink = $derived(tick >= 0 && !!editor?.isActive('link'));
  let linkDialogOpen = $state(false);
  let linkInitialUrl = $state('');

  function openLinkDialog() {
    if (!editor || hfActive) return; // body-only; HF has no link mark
    linkInitialUrl = (editor.getAttributes('link').href as string) ?? '';
    linkDialogOpen = true;
  }

  // Add a scheme/mailto when the user types a bare host or e-mail (like Word/LO).
  function normalizeUrl(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (/^(https?:|mailto:|tel:|ftp:|#|\/)/i.test(trimmed)) return trimmed;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return `mailto:${trimmed}`;
    return `https://${trimmed}`;
  }

  function applyLink(rawUrl: string) {
    linkDialogOpen = false;
    if (!editor) return;
    const href = normalizeUrl(rawUrl);
    if (!href) return;
    const chain = editor.chain().focus().extendMarkRange('link');
    if (editor.state.selection.empty && !editor.isActive('link')) {
      // No selection and not inside a link: insert the URL as the link text.
      chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
    } else {
      chain.setLink({ href }).run();
    }
  }

  function removeLink() {
    linkDialogOpen = false;
    editor?.chain().focus().extendMarkRange('link').unsetLink().run();
  }

  function linkClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) linkDialogOpen = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }

  // Ctrl/Cmd+K (from the Link extension) opens the dialog.
  $effect(() => {
    const open = () => openLinkDialog();
    window.addEventListener(OPEN_LINK_DIALOG_EVENT, open);
    return () => window.removeEventListener(OPEN_LINK_DIALOG_EVENT, open);
  });

  // --- Indent (Einzug) ---
  // In a list, step the list point one level (indentListForward/Backward — the Tab
  // keymap's commands, see indent.ts); outside a list, step the paragraph's left indent.
  function changeIndent(dir: 1 | -1) {
    if (!editor) return;
    const c = editor.chain().focus();
    if (listContext(editor.state).inList) {
      (dir === 1 ? c.indentListForward() : c.indentListBackward()).run();
    } else {
      (dir === 1 ? c.indentMore() : c.indentLess()).run();
    }
  }
</script>

<div class="toolbar-expanded">
  {#if editor}
    <div class="font-picker" use:fontPickerClickOutside>
      <div class="font-trigger-wrap">
        <input
          type="text"
          class="font-input"
          style={currentFont ? `font-family: ${currentFont}` : ''}
          bind:value={fontInputValue}
          onfocus={onFontInputFocus}
          onkeydown={onFontInputKeydown}
          onblur={() => (fontInputFocused = false)}
          spellcheck="false"
          autocomplete="off"
          title={t().toolbarExpanded.fontName}
        />
        <button class="font-chevron" onclick={openFontPicker} tabindex="-1" title={t().toolbarExpanded.fontName}>
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
            <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      {#if fontOpen}
        <div class="font-dropdown">
          <div class="menu-scroll">
            {#if recentShown.length > 0}
              <div class="font-section-label">{t().toolbarExpanded.recent}</div>
              {#each recentShown as font}
                <button
                  class="font-option"
                  class:active={currentFont === font}
                  style="font-family: {font}"
                  onclick={() => pickFont(font)}
                >{font}</button>
              {/each}
            {/if}

            {#if webSafeShown.length > 0}
              <div class="font-section-label">{t().toolbarExpanded.webSafe}</div>
            {/if}
            {#each webSafeShown as font}
              <button
                class="font-option"
                class:active={currentFont === font}
                style="font-family: {font}"
                onclick={() => pickFont(font)}
              >{font}</button>
            {/each}

            {#if extraShown.length > 0}
              <div class="font-section-label">{t().toolbarExpanded.allFonts}</div>
              {#each extraShown as font}
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
                {t().toolbarExpanded.loadAllFonts}
              </button>
            {/if}
          </div>
        </div>
      {/if}
    </div>

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
          title={t().toolbarExpanded.fontSize}
        />
        <button class="size-chevron" onclick={openSizePicker} tabindex="-1" title={t().toolbarExpanded.fontSizeList}>
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
            <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      {#if sizeOpen}
        <div class="size-dropdown">
          <div class="menu-scroll">
            <div class="lh-section-label">{t().toolbarExpanded.fontSize}</div>
            {#each FONT_SIZES as size}
              <button
                class="size-option"
                class:active={currentFontSize === `${size}pt`}
                onclick={() => pickSize(size)}
              >{size}</button>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <div class="toolbar-group">
      <button
        onclick={() => editor && stepFontSize(editor, 1)}
        title={`${t().toolbarExpanded.growFont} (${shortcutHint('fontGrow')})`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <text x="5" y="14" text-anchor="middle" font-size="15" font-family="sans-serif" fill="currentColor">A</text>
          <path d="M12.5 12V5m0 0L10.5 7m2-2l2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button
        onclick={() => editor && stepFontSize(editor, -1)}
        title={`${t().toolbarExpanded.shrinkFont} (${shortcutHint('fontShrink')})`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <text x="5" y="14" text-anchor="middle" font-size="11" font-family="sans-serif" fill="currentColor">A</text>
          <path d="M12.5 5v7m0 0l-2-2m2 2l2-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <ColorPicker
        {editor}
        currentColor={currentFontColor}
        defaultColor="#C00000"
        title={t().toolbarExpanded.fontColor}
        chevronTitle={t().toolbarExpanded.chooseFontColor}
        bind:open={fontColorOpen}
        onOpen={() => onColorPickerOpen('font')}
        onApply={(c, r) => editor?.chain().focus().setTextSelection(r).setColor(c).run()}
        onClear={(r) => editor?.chain().focus().setTextSelection(r).unsetColor().run()}
      >
        {#snippet icon()}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <text x="8" y="14" text-anchor="middle" font-size="15" font-family="sans-serif" fill="currentColor">A</text>
          </svg>
        {/snippet}
      </ColorPicker>
      <ColorPicker
        {editor}
        currentColor={currentHighlightColor}
        defaultColor="#FFFF00"
        title={t().toolbarExpanded.highlightColor}
        chevronTitle={t().toolbarExpanded.chooseHighlightColor}
        clearLabel={t().toolbarExpanded.noColor}
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
      <ColorPicker
        {editor}
        currentColor={currentParaBackground}
        defaultColor="#FFFF00"
        title={t().toolbarExpanded.paragraphShading}
        chevronTitle={t().toolbarExpanded.chooseParagraphShading}
        clearLabel={t().toolbarExpanded.noColor}
        bind:open={paraShadeOpen}
        onOpen={() => onColorPickerOpen('paraShade')}
        onApply={(c, r) => editor?.chain().focus().setTextSelection(r).setParagraphBackground(c).run()}
        onClear={(r) => editor?.chain().focus().setTextSelection(r).setParagraphBackground(null).run()}
      >
        {#snippet icon()}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 13h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <rect x="3" y="3" width="10" height="7" rx="1" fill="currentColor" opacity="0.3" stroke="currentColor" stroke-width="1.2"/>
          </svg>
        {/snippet}
      </ColorPicker>
      <ParagraphBorderPicker {editor} {tick} />
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <button
        class:active={isSuperscript}
        onclick={toggleSuperscript}
        title={`${t().toolbarExpanded.superscript} (${shortcutHint('superscript')})`}
        aria-pressed={isSuperscript}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2.5 11.5L7 5M7 11.5L2.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M10.5 4.7c0-.8.7-1.4 1.5-1.4s1.5.6 1.5 1.4c0 1.2-1.6 1.5-3 3.1h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button
        class:active={isSubscript}
        onclick={toggleSubscript}
        title={`${t().toolbarExpanded.subscript} (${shortcutHint('subscript')})`}
        aria-pressed={isSubscript}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2.5 11.5L7 5M7 11.5L2.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M10.5 12.2c0-.8.7-1.4 1.5-1.4s1.5.6 1.5 1.4c0 1.2-1.6 1.5-3 3.1h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <button onclick={() => changeIndent(-1)} title={t().toolbarExpanded.decreaseIndent}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <line x1="5" y1="3"  x2="14" y2="3"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="9" y1="8"  x2="14" y2="8"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="5" y1="13" x2="14" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M5.5 8H1.5M3.5 5.5L1.5 8L3.5 10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button onclick={() => changeIndent(1)} title={t().toolbarExpanded.increaseIndent}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <line x1="5" y1="3"  x2="14" y2="3"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="9" y1="8"  x2="14" y2="8"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="5" y1="13" x2="14" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M1.5 8H5.5M3.5 5.5L5.5 8L3.5 10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <div class="lh-picker" use:lineHeightPickerClickOutside>
      <button class="lh-trigger" onclick={openLineHeightPicker} title={t().toolbarExpanded.lineParagraphSpacing}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <line x1="8" y1="3"  x2="16" y2="3"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="8" y1="8"  x2="16" y2="8"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="8" y1="13" x2="16" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M2.8 6.5V1.6M2.8 1.6L0.7 4.1M2.8 1.6L4.9 4.1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2.8 9.5V14.4M2.8 14.4L0.7 11.9M2.8 14.4L4.9 11.9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
          <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      {#if lineHeightOpen}
        <div class="lh-dropdown">
          <div class="lh-section-label">{t().toolbarExpanded.lineSpacing}</div>
          {#each LINE_HEIGHTS as lh}
            <button
              class="lh-option"
              class:active={currentLineHeight === lh}
              onclick={() => pickLineHeight(lh)}
              title={LH_SHORTCUTS[lh] ? shortcutHint(LH_SHORTCUTS[lh]) : undefined}
            >{lineHeightLabel(lh)}</button>
          {/each}

          <div class="lh-section-label">{t().toolbarExpanded.spaceBefore}</div>
          <div class="sp-field" use:spacePresetClickOutside={'before'}>
            <div class="sp-input-wrap">
              <input
                type="text"
                class="sp-input"
                bind:value={spaceBeforeInput}
                onfocus={(e) => onSpaceFocus('before', e)}
                onkeydown={(e) => onSpaceKeydown('before', e)}
                onblur={() => onSpaceBlur('before')}
                placeholder={t().toolbarExpanded.spacingDefault}
                inputmode="decimal"
                title={t().toolbarExpanded.spaceBefore}
              />
              <button class="sp-chevron" onclick={() => openSpacePreset('before')} tabindex="-1" title={t().toolbarExpanded.spaceBeforePresets}>
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                  <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
            {#if spaceBeforeOpen}
              <div class="sp-dropdown">
                <div class="menu-scroll">
                  {#each SPACING_PRESETS as v}
                    <button
                      class="sp-option"
                      class:active={currentSpaceBefore === v}
                      onclick={() => pickSpacePreset('before', v)}
                    >{spacingLabel(v)}</button>
                  {/each}
                </div>
              </div>
            {/if}
          </div>

          <div class="lh-section-label">{t().toolbarExpanded.spaceAfter}</div>
          <div class="sp-field" use:spacePresetClickOutside={'after'}>
            <div class="sp-input-wrap">
              <input
                type="text"
                class="sp-input"
                bind:value={spaceAfterInput}
                onfocus={(e) => onSpaceFocus('after', e)}
                onkeydown={(e) => onSpaceKeydown('after', e)}
                onblur={() => onSpaceBlur('after')}
                placeholder={t().toolbarExpanded.spacingDefault}
                inputmode="decimal"
                title={t().toolbarExpanded.spaceAfter}
              />
              <button class="sp-chevron" onclick={() => openSpacePreset('after')} tabindex="-1" title={t().toolbarExpanded.spaceAfterPresets}>
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                  <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
            {#if spaceAfterOpen}
              <div class="sp-dropdown">
                <div class="menu-scroll">
                  {#each SPACING_PRESETS as v}
                    <button
                      class="sp-option"
                      class:active={currentSpaceAfter === v}
                      onclick={() => pickSpacePreset('after', v)}
                    >{spacingLabel(v)}</button>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <div class="layout-picker right-group" use:layoutClickOutside>
      <button class="layout-trigger" onclick={openLayout} title={t().toolbarExpanded.pageLayoutMargins} aria-pressed={layoutOpen}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2.5" y="1.5" width="11" height="13" rx="1" stroke="currentColor" stroke-width="1.3"/>
          <rect x="4.5" y="3.5" width="7" height="9" rx="0.5" stroke="currentColor" stroke-width="1" stroke-dasharray="2 1.5"/>
        </svg>
        <span class="layout-trigger-label">{t().toolbarExpanded.layout}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
          <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      {#if layoutOpen}
        <div class="layout-dropdown">
          <div class="lh-section-label">{t().toolbarExpanded.pageFormat}</div>
          <select class="format-select" bind:value={pageFormat} title={t().toolbarExpanded.pageFormat}>
            {#each PAGE_FORMATS as fmt}
              <option value={fmt}>{t().toolbarExpanded.pageFormats[fmt]} — {fmtCm(PAGE_FORMAT_CM[fmt].w)} × {fmtCm(PAGE_FORMAT_CM[fmt].h)} cm</option>
            {/each}
          </select>
          <div class="lh-section-label">{t().toolbarExpanded.orientation}</div>
          <div class="orientation-row">
            <button
              class="orientation-btn"
              class:active={pageOrientation === 'portrait'}
              aria-pressed={pageOrientation === 'portrait'}
              onclick={() => (pageOrientation = 'portrait')}
              title={t().toolbarExpanded.portrait}
            >
              <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden="true">
                <rect x="2.5" y="1.5" width="9" height="13" rx="1" stroke="currentColor" stroke-width="1.3"/>
              </svg>
              <span>{t().toolbarExpanded.portrait}</span>
            </button>
            <button
              class="orientation-btn"
              class:active={pageOrientation === 'landscape'}
              aria-pressed={pageOrientation === 'landscape'}
              onclick={() => (pageOrientation = 'landscape')}
              title={t().toolbarExpanded.landscape}
            >
              <svg width="16" height="14" viewBox="0 0 16 14" fill="none" aria-hidden="true">
                <rect x="1.5" y="2.5" width="13" height="9" rx="1" stroke="currentColor" stroke-width="1.3"/>
              </svg>
              <span>{t().toolbarExpanded.landscape}</span>
            </button>
          </div>
          <div class="lh-section-label">{t().toolbarExpanded.pageMargins}</div>
          <div class="margin-grid">
            {#each MARGIN_FIELDS as axis}
              <div class="margin-field">
                <span class="margin-label">{t().toolbarExpanded.margins[axis]}</span>
                <div class="margin-input-wrap">
                  <input
                    type="text"
                    class="margin-input"
                    bind:value={marginInputs[axis]}
                    onkeydown={(e) => onMarginKeydown(axis, e)}
                    onblur={() => commitMarginInput(axis)}
                    inputmode="decimal"
                    title={t().toolbarExpanded.marginField(t().toolbarExpanded.margins[axis])}
                  />
                  <div class="margin-steppers">
                    <button class="margin-step" tabindex="-1" onclick={() => stepMargin(axis, MARGIN_STEP)} title={t().toolbarExpanded.increaseMargin(t().toolbarExpanded.margins[axis])} aria-label={t().toolbarExpanded.increaseMargin(t().toolbarExpanded.margins[axis])}>
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                        <path d="M1 5.5l3-3 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </button>
                    <button class="margin-step" tabindex="-1" onclick={() => stepMargin(axis, -MARGIN_STEP)} title={t().toolbarExpanded.decreaseMargin(t().toolbarExpanded.margins[axis])} aria-label={t().toolbarExpanded.decreaseMargin(t().toolbarExpanded.margins[axis])}>
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                        <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            {/each}
          </div>

          <div class="lh-section-label">{t().toolbarExpanded.headerFooter}</div>
          <div class="hf-edit-row">
            <button
              class="hf-edit-btn"
              class:active={hfActive === 'header'}
              onclick={() => onEditZone?.('header')}
            >{t().toolbarExpanded.editHeader}</button>
            <button
              class="hf-edit-btn"
              class:active={hfActive === 'footer'}
              onclick={() => onEditZone?.('footer')}
            >{t().toolbarExpanded.editFooter}</button>
          </div>
          <label class="hf-firstpage-row" title={t().toolbarExpanded.differentFirstPageHint}>
            <input type="checkbox" bind:checked={differentFirstPage} />
            <span>{t().toolbarExpanded.differentFirstPage}</span>
          </label>
          <label class="hf-firstpage-row" title={t().toolbarExpanded.differentOddEvenHint}>
            <input type="checkbox" bind:checked={differentOddEven} />
            <span>{t().toolbarExpanded.differentOddEven}</span>
          </label>

          <div class="lh-section-label">{t().toolbarExpanded.position}</div>
          <div class="margin-grid">
            {#each HF_DIST_FIELDS as axis}
              <div class="margin-field">
                <span class="margin-label">{t().toolbarExpanded.hfDist[axis]}</span>
                <div class="margin-input-wrap">
                  <input
                    type="text"
                    class="margin-input"
                    bind:value={hfDistInputs[axis]}
                    onkeydown={(e) => onHfDistKeydown(axis, e)}
                    onblur={() => commitHfDistInput(axis)}
                    inputmode="decimal"
                    title={t().toolbarExpanded.hfField(t().toolbarExpanded.hfDist[axis])}
                  />
                  <div class="margin-steppers">
                    <button class="margin-step" tabindex="-1" onclick={() => stepHfDist(axis, MARGIN_STEP)} title={t().toolbarExpanded.increaseShort} aria-label={t().toolbarExpanded.increase(t().toolbarExpanded.hfDist[axis])}>
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                        <path d="M1 5.5l3-3 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </button>
                    <button class="margin-step" tabindex="-1" onclick={() => stepHfDist(axis, -MARGIN_STEP)} title={t().toolbarExpanded.decreaseShort} aria-label={t().toolbarExpanded.decrease(t().toolbarExpanded.hfDist[axis])}>
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
        title={`${t().toolbarExpanded.formattingMarks} (${shortcutHint('formattingMarks')})`}
        aria-pressed={showFormattingMarks}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M11 2.25v11.5M7.5 2.25v11.5M11 2.25H6.75a2.75 2.75 0 0 0 0 5.5H7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <TablePicker
        {editor}
        bind:open={tableOpen}
        onOpen={onTablePickerOpen}
        onInsert={insertTable}
        onManageStyles={onManageTableStyles}
      />
      <SpecialCharPicker
        {editor}
        bind:open={specialCharOpen}
        onOpen={onSpecialCharPickerOpen}
        onInsert={insertSpecialChar}
      />
      <DateTimePicker
        {editor}
        bind:open={dateTimeOpen}
        onOpen={onDateTimePickerOpen}
        onInsert={insertDateTime}
      />
      <button
        onclick={() => imageInput?.click()}
        title={t().toolbarExpanded.insertImage}
        aria-label={t().toolbarExpanded.insertImage}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" />
          <circle cx="5.3" cy="6" r="1.2" fill="currentColor" />
          <path d="M2 12l3.7-3.6 2.4 2.4 2.8-2.8L14 11.5" stroke="currentColor" stroke-linejoin="round" />
        </svg>
      </button>
      <input
        bind:this={imageInput}
        type="file"
        accept="image/*"
        style="display:none"
        onchange={onImageFile}
      />
      <button
        onclick={() => editor?.chain().focus().insertTextBox().run()}
        disabled={!!hfActive}
        title={hfActive ? t().toolbarExpanded.textBoxNotInHf : t().toolbarExpanded.insertTextBox}
        aria-label={t().toolbarExpanded.insertTextBox}
      >
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1.5" y="3.5" width="13" height="9" rx="1" stroke="currentColor" />
          <path d="M5.5 6.5h5M8 6.5v4" stroke="currentColor" stroke-linecap="round" />
        </svg>
      </button>
      <div class="columns-wrap" use:columnsClickOutside>
        <button
          class:active={colState.inColumns}
          onclick={openColumnsPicker}
          disabled={!!hfActive}
          title={hfActive ? t().toolbarExpanded.columnsNotInHf : t().toolbarExpanded.columns}
          aria-label={t().toolbarExpanded.columns}
          aria-haspopup="true"
          aria-expanded={columnsOpen}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 3.5h5M2 6h5M2 8.5h5M2 11h5M2 13.5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
            <path d="M9 3.5h5M9 6h5M9 8.5h5M9 11h5M9 13.5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
        </button>
        {#if columnsOpen}
          <div class="columns-dropdown">
            <div class="lh-section-label">{t().toolbarExpanded.columns}</div>
            <div class="columns-row">
              <button
                class="orientation-btn"
                class:active={colState.count === 1}
                aria-pressed={colState.count === 1}
                onclick={() => applyColumnCount(1)}
                title={t().toolbarExpanded.columnsOne}
              >
                <svg width="22" height="18" viewBox="0 0 22 18" fill="none" aria-hidden="true">
                  <path d="M3 3h16M3 6h16M3 9h16M3 12h16M3 15h10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                </svg>
                <span>1</span>
              </button>
              <button
                class="orientation-btn"
                class:active={colState.count === 2}
                aria-pressed={colState.count === 2}
                onclick={() => applyColumnCount(2)}
                title={t().toolbarExpanded.columnsTwo}
              >
                <svg width="22" height="18" viewBox="0 0 22 18" fill="none" aria-hidden="true">
                  <path d="M3 3h7M3 6h7M3 9h7M3 12h7M3 15h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                  <path d="M12 3h7M12 6h7M12 9h7M12 12h7M12 15h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                </svg>
                <span>2</span>
              </button>
              <button
                class="orientation-btn"
                class:active={colState.count === 3}
                aria-pressed={colState.count === 3}
                onclick={() => applyColumnCount(3)}
                title={t().toolbarExpanded.columnsThree}
              >
                <svg width="22" height="18" viewBox="0 0 22 18" fill="none" aria-hidden="true">
                  <path d="M3 3h4M3 6h4M3 9h4M3 12h4M3 15h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                  <path d="M9 3h4M9 6h4M9 9h4M9 12h4M9 15h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                  <path d="M15 3h4M15 6h4M15 9h4M15 12h4M15 15h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                </svg>
                <span>3</span>
              </button>
            </div>
            <div class="lh-section-label">{t().toolbarExpanded.columnGap}</div>
            <div class="columns-gap-row">
              <div class="margin-input-wrap">
                <input
                  type="text"
                  class="margin-input"
                  bind:value={columnGapInput}
                  disabled={!colState.inColumns}
                  onkeydown={onColumnGapKeydown}
                  onblur={commitColumnGapInput}
                  inputmode="decimal"
                  title={t().toolbarExpanded.columnGap}
                />
                <div class="margin-steppers">
                  <button class="margin-step" tabindex="-1" disabled={!colState.inColumns} onclick={() => setColumnGap(liveColumnGap() + MARGIN_STEP)} title={t().toolbarExpanded.increaseShort} aria-label={t().toolbarExpanded.increase(t().toolbarExpanded.columnGap)}>
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                      <path d="M1 5.5l3-3 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                  <button class="margin-step" tabindex="-1" disabled={!colState.inColumns} onclick={() => setColumnGap(liveColumnGap() - MARGIN_STEP)} title={t().toolbarExpanded.decreaseShort} aria-label={t().toolbarExpanded.decrease(t().toolbarExpanded.columnGap)}>
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                      <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        {/if}
      </div>
      <button
        onclick={insertToc}
        disabled={!!hfActive}
        title={hfActive ? t().toolbarExpanded.tocNotInHf : t().toolbarExpanded.insertToc}
        aria-label={t().toolbarExpanded.insertToc}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 3.5h6M2 6.5h8M2 9.5h5M2 12.5h7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
          <path d="M12.5 3.5h1.5M13.5 6.5H14M12 9.5h2M12.5 12.5H14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
        </svg>
      </button>
      <div class="link-wrap" use:linkClickOutside>
        <button
          class:active={isLink}
          onclick={openLinkDialog}
          disabled={!!hfActive}
          title={hfActive ? t().toolbarExpanded.linkNotInHf : `${t().toolbarExpanded.insertLink} (${shortcutHint('link')})`}
          aria-label={t().toolbarExpanded.insertLink}
          aria-haspopup="dialog"
          aria-expanded={linkDialogOpen}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6.5 9.5l3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            <path d="M8.5 5l.9-.9a2.5 2.5 0 0 1 3.5 3.5l-.9.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M7.5 11l-.9.9a2.5 2.5 0 0 1-3.5-3.5l.9-.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <LinkDialog
          open={linkDialogOpen}
          initialUrl={linkInitialUrl}
          canRemove={isLink}
          onApply={applyLink}
          onRemove={removeLink}
          onClose={() => (linkDialogOpen = false)}
        />
      </div>
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <button
        onclick={() => editor?.commands.clearDirectFormatting()}
        title={`${t().toolbarExpanded.clearFormatting} (${shortcutHint('clearFormatting')})`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <!-- bold + italic A -->
          <text x="0" y="12" font-size="12" font-family="var(--font-serif, serif)"
                font-weight="700" font-style="italic" fill="currentColor">A</text>
          <!-- underline beneath the A -->
          <line x1="0.5" y1="14.2" x2="7.5" y2="14.2"
                stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          <!-- big eraser sweeping across the A's upper-right -->
          <g transform="rotate(35 10 6)">
            <rect x="6.5" y="3.4" width="9" height="4.4" rx="1.3"
                  fill="currentColor" fill-opacity="0.12"
                  stroke="currentColor" stroke-width="1.4"/>
            <line x1="9.7" y1="3.4" x2="9.7" y2="7.8" stroke="currentColor" stroke-width="1.2"/>
          </g>
        </svg>
      </button>
    </div>

    {#if import.meta.env.DEV && onDebugDump}
      <div class="toolbar-separator"></div>

      <div class="toolbar-group">
        <button class="debug-btn" onclick={onDebugDump} title="Download page-break debug snapshot">
          Debug
        </button>
      </div>
    {/if}
  {/if}
</div>

<style>
  /* Inner content of the second toolbar row; the surrounding .toolbar-secondary
     (App.svelte) owns the background, divider and elevation. */
  .toolbar-expanded {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    flex: 1;
    min-width: 0;
    padding: 0;
  }

  /* Layout sits at the far right (logical separation from the rest). order:1
     renders it after the left cluster; margin-left:auto opens the gap. Its
     dropdown anchors right so it stays inside the viewport. */
  .right-group { order: 1; }
  .layout-picker.right-group { margin-left: auto; }
  .layout-picker.right-group .layout-dropdown { left: auto; right: 0; }

  .toolbar-group {
    display: flex;
    gap: 1px;
  }

  .toolbar-separator {
    width: 1px;
    height: 1.2rem;
    background: var(--color-border);
    margin: 0 0.3rem;
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--toolbar-btn-size);
    height: var(--toolbar-btn-size);
    padding: 0 0.3rem;
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

  /* Plain toolbar buttons gain a primary outline on hover (combobox triggers and
     split buttons handle their own; menu items keep border:none → no-op). */
  .toolbar-group > button,
  .link-wrap > button {
    border: 1px solid transparent;
    transition: background 0.15s, border-color 0.15s;
  }

  .toolbar-group > button:hover:not(:disabled),
  .link-wrap > button:hover:not(:disabled) {
    border-color: var(--color-primary);
  }

  /* Anchor for the link popover (LinkDialog), like .font-picker. */
  .link-wrap {
    position: relative;
    display: inline-flex;
  }

  .font-picker {
    position: relative;
  }

  .font-input {
    text-overflow: ellipsis;
  }

  .font-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    min-width: 100%;
    max-height: 360px;
    overflow: hidden;
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
    min-height: fit-content;
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

  .size-trigger-wrap,
  .font-trigger-wrap {
    display: inline-flex;
    align-items: center;
    height: var(--toolbar-btn-size);
    width: 62px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    transition: border-color 0.15s;
    overflow: hidden;
  }

  /* Same combo-box as the size field, only wider. */
  .font-trigger-wrap {
    width: 145px;
  }

  .size-trigger-wrap:hover,
  .size-trigger-wrap:focus-within,
  .font-trigger-wrap:hover,
  .font-trigger-wrap:focus-within {
    border-color: var(--color-primary);
  }

  .size-input,
  .font-input {
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

  .size-chevron,
  .font-chevron {
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

  .size-chevron:hover,
  .font-chevron:hover {
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
    overflow: hidden;
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
    height: var(--toolbar-btn-size);
    padding: 0 0.4rem;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    min-width: unset;
    transition: background 0.15s, border-color 0.15s;
  }

  .lh-trigger:hover {
    background: var(--color-btn-hover);
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
    height: var(--toolbar-btn-size);
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

  .format-select {
    margin: 4px 6px 2px;
    width: calc(100% - 12px);
    padding: 6px 8px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 0.78rem;
    cursor: pointer;
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

  .columns-wrap {
    position: relative;
  }

  .columns-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    width: 200px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 2px 2px 6px;
  }

  .columns-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 6px;
    padding: 4px 6px 2px;
  }

  .columns-gap-row {
    padding: 4px 6px 2px;
  }

  .margin-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 4px 6px 2px;
  }

  .hf-edit-row {
    display: flex;
    gap: 6px;
    padding: 2px 6px 4px;
  }

  .hf-edit-btn {
    flex: 1;
    padding: 5px 8px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 0.78rem;
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }

  .hf-edit-btn:hover {
    background: var(--color-btn-hover);
  }

  .hf-edit-btn.active {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: #fff;
  }

  .hf-firstpage-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px 4px;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 0.78rem;
    cursor: pointer;
    user-select: none;
  }
  .hf-firstpage-row input {
    cursor: pointer;
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
    /* Pin the input to the bottom of its grid cell so a wrapped two-line label
       (e.g. "Footer from bottom") doesn't push its box below the sibling's. */
    margin-top: auto;
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
    overflow: hidden;
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

  .debug-btn {
    padding: 0.35rem 0.7rem;
    background: transparent;
    color: var(--color-text-muted);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius);
    font-size: 0.75rem;
    font-family: var(--font-sans);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s;
  }

  .debug-btn:hover:not(:disabled) {
    background: var(--color-btn-hover);
    color: var(--color-text);
  }
</style>
