<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { t } from '../i18n/i18n.svelte';
  import {
    DEFAULT_STYLE, HEADING_PARENT, isAbstractStyle, propsFromBlock, resolveStyle, styleDelta,
    styleOrder, uniqueStyleName, type Style,
  } from '../styles/styleSheet';
  import { deleteStyle, putStyle, renameStyle, resetStyle, styleSheet } from '../styles/sheet.svelte';
  import { blockStyleName } from '../editor/extensions/paragraphStyle';
  import { CANDIDATE_FONTS, detectAvailableFonts } from '../utils/fontDetect';
  import AlignIcon, { type AlignValue } from './AlignIcon.svelte';

  // LibreOffice's style manager: pick a style, edit its properties, or make a new one
  // from the cursor's formatting. Edits apply live — every block using the style follows.
  let { open = $bindable(false), editor }: { open?: boolean; editor: Editor | null } = $props();

  const ALIGNMENTS: AlignValue[] = ['left', 'center', 'right', 'justify'];

  let dialogEl: HTMLDialogElement | null = $state(null);
  let selected = $state(DEFAULT_STYLE);
  // The fonts installed on this machine, detected once the dialog is first opened
  // (same list the font picker uses).
  let fonts = $state<string[]>([]);

  let sheet = $derived(styleSheet());
  // Indented by inheritance depth, so the chain is visible.
  let rows = $derived(styleOrder(sheet, true).map((s) => ({ style: s, depth: depthOf(s) })));
  let style = $derived(sheet.paragraph[selected] ?? sheet.paragraph[DEFAULT_STYLE]);
  let resolved = $derived(resolveStyle(sheet, selected));
  // A style can't inherit from itself or from one of its own descendants.
  let parentOptions = $derived(
    Object.keys(sheet.paragraph).filter((name) => name !== style.name && !descendsFrom(name, style.name)),
  );

  function depthOf(s: Style): number {
    let depth = 0;
    let cur = s.parent;
    const seen = new Set<string>();
    while (cur && sheet.paragraph[cur] && !seen.has(cur)) { seen.add(cur); depth++; cur = sheet.paragraph[cur].parent; }
    return depth;
  }

  function descendsFrom(name: string, ancestor: string): boolean {
    let cur: string | null = name;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (cur === ancestor) return true;
      cur = sheet.paragraph[cur]?.parent ?? null;
    }
    return false;
  }

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });

  $effect(() => {
    if (open && !fonts.length) fonts = detectAvailableFonts(CANDIDATE_FONTS);
  });

  // Follow the cursor's style when the dialog opens (LibreOffice preselects it too).
  $effect(() => {
    if (open && editor) selected = blockStyleName(editor.state.selection.$from.parent as never);
  });

  // An undefined patch value clears the style's own property, so it inherits again.
  function edit(patch: { para?: Partial<Style['para']>; text?: Partial<Style['text']> }) {
    const merge = <T extends object>(base: T, over: Partial<T>): T => {
      const out = { ...base } as T;
      for (const [key, value] of Object.entries(over)) {
        if (value === undefined) delete out[key as keyof T];
        else out[key as keyof T] = value as T[keyof T];
      }
      return out;
    };
    putStyle({ ...style, para: merge(style.para, patch.para ?? {}), text: merge(style.text, patch.text ?? {}) });
  }

  // A style may name a font that isn't installed here; keep it in the list so editing
  // another property doesn't silently drop it.
  let fontOptions = $derived(
    style.text.fontFamily && !fonts.includes(style.text.fontFamily)
      ? [style.text.fontFamily, ...fonts]
      : fonts,
  );

  // A field left empty clears the style's own value, so it inherits again.
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

  // An empty field shows what the parent chain provides, marked as inherited so it can't
  // be mistaken for this style's own value.
  const inherited = (value: string | number | undefined) =>
    value === undefined || value === '' ? '' : `${value} (${t().styles.inherited})`;

  // The cursor's block, with the marks of its first text run.
  function blockFormatting() {
    if (!editor) return null;
    const node = editor.state.selection.$from.parent;
    const first = node.firstChild;
    return {
      node,
      current: blockStyleName(node as never),
      shown: propsFromBlock(node as never, (first?.marks ?? []) as never),
    };
  }

  function newFromSelection() {
    const info = blockFormatting();
    if (!info || !editor) return;
    const name = uniqueStyleName(sheet, t().styles.newName);
    const own = styleDelta(info.shown, resolveStyle(sheet, info.current));
    putStyle({ name, parent: info.current, next: info.current, para: own.para, text: own.text });
    // The formatting now lives in the style, so the block drops it (LibreOffice's behavior).
    editor.commands.setParagraphStyle(name);
    editor.commands.clearDirectFormatting();
    selected = name;
  }

  function updateFromSelection() {
    const info = blockFormatting();
    if (!info || !editor) return;
    const own = styleDelta(info.shown, resolveStyle(sheet, style.parent ?? DEFAULT_STYLE));
    putStyle({ ...style, para: { ...style.para, ...own.para }, text: { ...style.text, ...own.text } });
    editor.commands.setParagraphStyle(style.name);
    editor.commands.clearDirectFormatting();
  }

  function rename() {
    const next = prompt(t().styles.renamePrompt, style.name)?.trim();
    if (!next || next === style.name || sheet.paragraph[next]) return;
    const from = style.name;
    renameStyle(from, next);
    // Retag every block that referenced the old name.
    editor?.commands.command(({ tr, state, dispatch }) => {
      state.doc.descendants((node, pos) => {
        if (node.attrs?.styleName === from) tr.setNodeAttribute(pos, 'styleName', next);
      });
      if (dispatch && tr.docChanged) dispatch(tr);
      return true;
    });
    selected = next;
  }

  function remove() {
    const gone = style.name;
    const fallback = style.parent ?? DEFAULT_STYLE;
    deleteStyle(gone);
    editor?.commands.command(({ tr, state, dispatch }) => {
      state.doc.descendants((node, pos) => {
        if (node.attrs?.styleName === gone) tr.setNodeAttribute(pos, 'styleName', fallback);
      });
      if (dispatch && tr.docChanged) dispatch(tr);
      return true;
    });
    selected = fallback;
  }
</script>

<dialog
  class="styles"
  bind:this={dialogEl}
  onclose={() => (open = false)}
  onclick={(e) => { if (e.target === dialogEl) open = false; }}
  aria-label={t().styles.title}
>
  <div class="card">
    <header>
      <h2>{t().styles.title}</h2>
      <button class="close" onclick={() => (open = false)} aria-label={t().common.close}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>
    </header>

    <div class="body">
      <ul class="list">
        {#each rows as { style: s, depth } (s.name)}
          <li>
            <button
              class="entry"
              class:active={selected === s.name}
              style="padding-left: {0.6 + depth * 0.8}rem"
              onclick={() => (selected = s.name)}
            >
              {s.name}
              {#if isAbstractStyle(s.name)}<span class="badge">{t().styles.abstract}</span>
              {:else if !s.builtin}<span class="badge">{t().styles.custom}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>

      <div class="fields">
        <!-- Fallbacks are the page's own defaults, not `inherit`: an inline `inherit`
             would beat the .preview rule and pull in the dialog's UI text color. -->
        <div class="preview" style="
          font-family: {resolved.text.fontFamily ?? 'var(--font-serif)'};
          font-size: {Math.min(24, resolved.text.fontSizePt ?? 12)}pt;
          font-weight: {resolved.text.bold ? 700 : 400};
          font-style: {resolved.text.italic ? 'italic' : 'normal'};
          color: {resolved.text.color ?? 'var(--color-page-text)'};
          text-decoration: {[resolved.text.underline && 'underline', resolved.text.strike && 'line-through'].filter(Boolean).join(' ') || 'none'};
          text-align: {resolved.para.textAlign ?? 'left'};
        ">{style.name}</div>

        <label>{t().styles.parent}
          <select value={style.parent ?? ''} onchange={(e) => putStyle({ ...style, parent: e.currentTarget.value || null })}>
            <option value="">—</option>
            {#each parentOptions as name}<option value={name}>{name}</option>{/each}
          </select>
        </label>

        <label>{t().styles.font}
          <select
            value={style.text.fontFamily ?? ''}
            onchange={(e) => edit({ text: { fontFamily: e.currentTarget.value || undefined } })}
          >
            <option value="">{inherited(resolved.text.fontFamily) || '—'}</option>
            {#each fontOptions as font}
              <option value={font} style="font-family: '{font}'">{font}</option>
            {/each}
          </select>
        </label>

        <div class="row">
          <label>{t().styles.size}
            <input type="number" min="1" max="400" step="0.5"
              value={style.text.fontSizePt ?? ''}
              placeholder={inherited(resolved.text.fontSizePt)}
              onchange={(e) => edit({ text: { fontSizePt: num(e.currentTarget.value) } })} />
          </label>
          <label>{t().styles.color}
            <input type="color" value={style.text.color ?? resolved.text.color ?? '#000000'}
              onchange={(e) => edit({ text: { color: e.currentTarget.value.toUpperCase() } })} />
          </label>
        </div>

        <div class="row toggles">
          <label class="check"><input type="checkbox" checked={!!resolved.text.bold}
            onchange={(e) => edit({ text: { bold: e.currentTarget.checked } })} />{t().styles.bold}</label>
          <label class="check"><input type="checkbox" checked={!!resolved.text.italic}
            onchange={(e) => edit({ text: { italic: e.currentTarget.checked } })} />{t().styles.italic}</label>
          <label class="check"><input type="checkbox" checked={!!resolved.text.underline}
            onchange={(e) => edit({ text: { underline: e.currentTarget.checked } })} />{t().styles.underline}</label>
          <label class="check"><input type="checkbox" checked={!!resolved.text.strike}
            onchange={(e) => edit({ text: { strike: e.currentTarget.checked } })} />{t().styles.strike}</label>
        </div>

        <div class="field">
          <span class="field-label">{t().styles.alignment}</span>
          <div class="align-row">
            {#each ALIGNMENTS as a}
              <button
                class="align-btn"
                class:active={style.para.textAlign === a}
                class:inherit={!style.para.textAlign && (resolved.para.textAlign ?? 'left') === a}
                title={t().align.alignTo(t().align[a])}
                aria-pressed={style.para.textAlign === a}
                onclick={() => edit({ para: { textAlign: style.para.textAlign === a ? undefined : a } })}
              >
                <AlignIcon value={a} />
              </button>
            {/each}
          </div>
        </div>

        <div class="row">
          <label>{t().styles.spaceBefore}
            <input type="number" min="0" max="200" step="1" value={style.para.spaceBefore ?? ''}
              placeholder={inherited(resolved.para.spaceBefore ?? 0)}
              onchange={(e) => edit({ para: { spaceBefore: num(e.currentTarget.value) } })} />
          </label>
          <label>{t().styles.spaceAfter}
            <input type="number" min="0" max="200" step="1" value={style.para.spaceAfter ?? ''}
              placeholder={inherited(resolved.para.spaceAfter ?? 0)}
              onchange={(e) => edit({ para: { spaceAfter: num(e.currentTarget.value) } })} />
          </label>
          <label>{t().styles.indent}
            <input type="number" min="0" max="20" step="0.25" value={style.para.indent ?? ''}
              placeholder={inherited(resolved.para.indent ?? 0)}
              onchange={(e) => edit({ para: { indent: num(e.currentTarget.value) } })} />
          </label>
        </div>
      </div>
    </div>

    <footer>
      <button onclick={newFromSelection}>{t().styles.newFromSelection}</button>
      <button onclick={updateFromSelection}>{t().styles.updateFromSelection}</button>
      <span class="spacer"></span>
      {#if style.builtin}
        <button onclick={() => resetStyle(style.name)}>{t().styles.reset}</button>
      {:else}
        <button onclick={rename}>{t().styles.rename}</button>
        <button class="danger" onclick={remove} disabled={style.name === HEADING_PARENT}>{t().common.remove}</button>
      {/if}
    </footer>
  </div>
</dialog>

<style>
  .styles {
    margin: auto;
    padding: 0;
    border: none;
    background: transparent;
    max-width: none;
  }
  .styles::backdrop {
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(2px);
  }

  .card {
    width: min(46rem, 92vw);
    background: var(--color-surface);
    color: var(--color-text);
    border-radius: var(--island-radius);
    /* The card's own outline: in dark mode a shadow can't separate it from the
       backdrop, so the edge has to be a real line. */
    border: 1px solid var(--color-border);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    font-family: var(--font-sans);
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--color-border);
  }
  header h2 { margin: 0; font-size: 0.95rem; }
  .close {
    border: none;
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    padding: 0.25rem;
    border-radius: var(--radius);
  }
  .close:hover { background: var(--color-btn-hover); }

  .body { display: flex; gap: 0; max-height: min(30rem, 70vh); }

  .list {
    width: 14rem;
    margin: 0;
    padding: 0.4rem 0;
    list-style: none;
    overflow-y: auto;
    border-right: 1px solid var(--color-border);
  }
  .entry {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.35rem 0.6rem;
    border: none;
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: 0.85rem;
    text-align: left;
    cursor: pointer;
  }
  .entry:hover { background: var(--color-btn-hover); }
  .entry.active { background: var(--color-primary); color: white; }
  .badge {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.6;
  }

  .fields {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.8rem 1rem;
    overflow-y: auto;
  }
  .preview {
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-page-bg, #fff);
    color: var(--color-page-text);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }
  .row { display: flex; gap: 0.6rem; }
  .field { display: flex; flex-direction: column; gap: 0.2rem; }
  .field-label { font-size: 0.75rem; color: var(--color-text-muted); }
  .align-row { display: flex; gap: 2px; }
  .align-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--toolbar-btn-size);
    height: var(--toolbar-btn-size);
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }
  .align-btn:hover { background: var(--color-btn-hover); }
  .align-btn.active { background: var(--color-primary); color: white; }
  /* What the parent chain provides while this style sets none of its own. */
  .align-btn.inherit { border-color: var(--color-border); color: var(--color-text-muted); }
  .row > label { flex: 1; }
  .toggles { align-items: center; gap: 1rem; }
  .check {
    flex-direction: row;
    align-items: center;
    gap: 0.35rem;
    color: var(--color-text);
    font-size: 0.8rem;
  }
  input, select {
    font: inherit;
    font-size: 0.85rem;
    padding: 0.25rem 0.35rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
  }
  input[type='color'] { padding: 0.1rem; height: 1.9rem; }

  footer {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.6rem 1rem;
    border-top: 1px solid var(--color-border);
  }
  .spacer { flex: 1; }
  footer button {
    font: inherit;
    font-size: 0.8rem;
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
  }
  footer button:hover:not(:disabled) { border-color: var(--color-primary); }
  footer button:disabled { opacity: 0.4; cursor: not-allowed; }
  .danger:hover:not(:disabled) { border-color: #c0392b; color: #c0392b; }
</style>
