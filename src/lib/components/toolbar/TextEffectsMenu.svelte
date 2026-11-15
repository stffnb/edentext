<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import {
    effectCss, presetAttrs, TEXT_EFFECT_PRESETS,
    type TextEffectAttrs, type TextGlow, type TextOutline, type TextShadow,
  } from '../../editor/extensions/textEffects';
  import { t } from '../../i18n/i18n.svelte';
  import CustomColorPanel from '../CustomColorPanel.svelte';

  // The text effects panel of both chromes: a gallery of combinations, then one page each
  // for outline, shadow, glow and relief, opened in place (→ or a click) and left with ←.
  let { editor, tick, onDone }: { editor: Editor | null; tick: number; onDone: () => void } = $props();

  type Page = 'main' | 'outline' | 'shadow' | 'glow' | 'relief' | 'color';
  let page = $state<Page>('main');
  // "More colors" opens the custom colour panel as one more page, inline, so it scrolls
  // and closes with the menu; it remembers the page it came from and what to apply.
  let mix = $state<{ from: Page; color: string; pick: (color: string) => void } | null>(null);
  let root: HTMLDivElement | undefined = $state();
  let fx = $derived<TextEffectAttrs>(tick >= 0 ? editor?.getAttributes('textStyle') ?? {} : {});

  const SWATCHES = ['#000000', '#FFFFFF', '#7F7F7F', '#C00000', '#FF0000', '#FFC000', '#FFFF00', '#70AD47', '#00B0F0', '#4472C4', '#1F3864', '#7030A0'];
  const WEIGHTS = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3];
  // Outer shadows in eight directions around a centred halo, as Word's grid has them.
  const DIRECTIONS: [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  const BLURS = [0, 2, 4, 8];
  const GLOW_SIZES = [5, 8, 11, 18];
  const GLOW_COLORS = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47'];
  const DIST = 3;
  const SHADOW: TextShadow = { color: '#000000', alpha: 0.4, dxPt: 2.12, dyPt: 2.12, blurPt: 4 };

  let L = $derived(t().ribbon.textEffects);
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const shadowAt = ([x, y]: [number, number]): TextShadow => {
    const base = fx.textShadow ?? SHADOW;
    const d = x && y ? DIST / Math.SQRT2 : DIST;
    return { ...base, dxPt: Math.round(x * d * 100) / 100, dyPt: Math.round(y * d * 100) / 100, blurPt: x || y ? base.blurPt : Math.max(base.blurPt, 4) };
  };

  function act(run: (e: Editor) => void) {
    if (!editor) return;
    onDone();
    run(editor);
  }
  const outline = (o: TextOutline | null) => act((e) => e.chain().focus().setTextOutline(o).run());
  const shadow = (s: TextShadow | null) => act((e) => e.chain().focus().setTextShadow(s).run());
  const glow = (g: TextGlow | null) => act((e) => e.chain().focus().setTextGlow(g).run());
  const plain = (name: 'outline' | 'shadow' | 'relief', value: boolean | 'embossed' | 'engraved') =>
    act((e) => e.chain().focus().setTextEffect(name, value).run());

  function open(to: Page) {
    page = to;
    queueMicrotask(() => root?.querySelector<HTMLButtonElement>('button:not(.fx-back), input')?.focus());
  }
  function back() {
    const from = page;
    if (from === 'color' && mix) {
      page = mix.from;
      queueMicrotask(() => root?.querySelector<HTMLButtonElement>('.fx-more')?.focus());
      return;
    }
    page = 'main';
    queueMicrotask(() => root?.querySelector<HTMLButtonElement>(`[data-page="${from}"]`)?.focus());
  }
  function moreColors(pick: (color: string) => void, current: string | null | undefined) {
    mix = { from: page, color: current ?? '#000000', pick };
    open('color');
  }

  // Arrow keys move through the page's controls, → opens a page and ← leaves it.
  function onKeydown(e: KeyboardEvent) {
    const focused = document.activeElement as HTMLElement | null;
    if (e.key === 'ArrowRight' && focused?.dataset.page) { e.preventDefault(); open(focused.dataset.page as Page); return; }
    if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && page !== 'main' && focused?.tagName !== 'INPUT' && focused?.tagName !== 'SELECT') { e.preventDefault(); back(); return; }
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || focused?.tagName === 'SELECT') return;
    e.preventDefault();
    const items = Array.from(root?.querySelectorAll<HTMLElement>('button, input') ?? []);
    const i = items.indexOf(focused as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  }
</script>

{#snippet swatches(pick: (color: string) => void, current: string | null | undefined)}
  <div class="fx-swatches">
    {#each SWATCHES as c}
      <button class="fx-swatch" class:selected={current === c} style:background={c} title={c} aria-label={c} onclick={() => pick(c)}></button>
    {/each}
  </div>
  <button class="fx-row fx-more" onclick={() => moreColors(pick, current)}>
    <span class="fx-rainbow" aria-hidden="true"></span>{t().color.moreColors}
  </button>
{/snippet}

{#snippet sample(attrs: TextEffectAttrs & { color?: string })}
  <span class="fx-sample" style="color: {attrs.color ?? 'var(--color-page-text, #000)'}; {effectCss(attrs)}">A</span>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fx-menu" bind:this={root} onkeydown={onKeydown}>
  {#if page === 'main'}
    <div class="fx-grid gallery" role="group" aria-label={L.gallery}>
      {#each TEXT_EFFECT_PRESETS as p, i}
        {@const attrs = presetAttrs(p)}
        <button class="fx-tile" class:selected={same(fx.textOutline, attrs.textOutline) && same(fx.textShadow, attrs.textShadow) && same(fx.textGlow, attrs.textGlow) && fx.color === p.color}
          title={L.preset(i + 1)} aria-label={L.preset(i + 1)}
          onclick={() => act((e) => e.chain().focus().applyTextEffectPreset(p).run())}>{@render sample(attrs)}</button>
      {/each}
    </div>
    {#each [['outline', L.outline, !!(fx.textOutline || fx.outline)], ['shadow', L.shadow, !!(fx.textShadow || fx.shadow)], ['glow', L.glow, !!fx.textGlow], ['relief', L.relief, fx.relief === 'embossed' || fx.relief === 'engraved']] as const as [key, label, on]}
      <button class="fx-row" class:selected={on} data-page={key} data-cmd={`textEffects-${key}`} aria-haspopup="menu" onclick={() => open(key)}>
        {label}<span class="menu-sub"><svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M2.5 1l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg></span>
      </button>
    {/each}
    <button class="fx-row" data-cmd="textEffects-clear" onclick={() => act((e) => e.chain().focus().unsetTextEffects().run())}>{L.clear}</button>
  {:else}
    <button class="fx-row fx-back" onclick={back}>
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M5.5 1l-3 3 3 3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>
      {page === 'outline' ? L.outline : page === 'shadow' ? L.shadow : page === 'glow' ? L.glow : page === 'color' ? t().color.moreColors : L.relief}
    </button>
    {#if page === 'color' && mix}
      <div class="fx-custom">
        <CustomColorPanel color={mix.color} onConfirm={mix.pick} onCancel={back} />
      </div>
    {:else if page === 'outline'}
      <button class="fx-row" class:selected={!fx.textOutline && !fx.outline} onclick={() => outline(null)}>{L.noOutline}</button>
      <div class="fx-label">{L.color}</div>
      {@render swatches((c) => outline({ color: c, widthPt: fx.textOutline?.widthPt ?? 0.75 }), fx.textOutline?.color)}
      <div class="fx-label">{L.weight}</div>
      {#each WEIGHTS as w}
        <button class="fx-row" class:selected={fx.textOutline?.widthPt === w} onclick={() => outline({ color: fx.textOutline?.color ?? '#000000', widthPt: w })}>
          <span class="fx-line" style:border-top-width="{w}pt"></span>{w.toLocaleString()} pt
        </button>
      {/each}
      <button class="fx-row" class:selected={fx.outline === true} onclick={() => plain('outline', true)}>
        <span class="fx-mini" style={effectCss({ outline: true })}>A</span>{L.hollow}<span class="menu-sub">{L.alsoOdt}</span>
      </button>
    {:else if page === 'shadow'}
      <button class="fx-row" class:selected={!fx.textShadow && !fx.shadow} onclick={() => shadow(null)}>{L.noShadow}</button>
      <div class="fx-label">{L.direction}</div>
      <div class="fx-grid three">
        {#each DIRECTIONS as d}
          {@const s = shadowAt(d)}
          <button class="fx-tile" class:selected={same(fx.textShadow, s)} title={L.direction} onclick={() => shadow(s)}>{@render sample({ textShadow: s })}</button>
        {/each}
      </div>
      <div class="fx-label">{L.blur}</div>
      <div class="fx-grid four">
        {#each BLURS as b}
          {@const s = { ...(fx.textShadow ?? SHADOW), blurPt: b }}
          <button class="fx-tile" class:selected={fx.textShadow?.blurPt === b} title="{b} pt" onclick={() => shadow(s)}>{@render sample({ textShadow: s })}</button>
        {/each}
      </div>
      <div class="fx-label">{L.color}</div>
      {@render swatches((c) => shadow({ ...(fx.textShadow ?? SHADOW), color: c }), fx.textShadow?.color)}
      <button class="fx-row" class:selected={fx.shadow === true} onclick={() => plain('shadow', true)}>
        <span class="fx-mini" style={effectCss({ shadow: true })}>A</span>{L.plainShadow}<span class="menu-sub">{L.alsoOdt}</span>
      </button>
    {:else if page === 'glow'}
      <button class="fx-row" class:selected={!fx.textGlow} onclick={() => glow(null)}>{L.noGlow}</button>
      <div class="fx-grid six">
        {#each GLOW_SIZES as r}
          <span class="fx-size">{r} pt</span>
          {#each GLOW_COLORS as c}
            {@const g = { color: c, alpha: 0.6, radiusPt: r }}
            <button class="fx-tile" class:selected={same(fx.textGlow, g)} title="{r} pt" onclick={() => glow(g)}>{@render sample({ textGlow: g })}</button>
          {/each}
        {/each}
      </div>
      <div class="fx-label">{L.color}</div>
      {@render swatches((c) => glow({ alpha: 0.6, radiusPt: 8, ...fx.textGlow, color: c }), fx.textGlow?.color)}
    {:else}
      {#each [['embossed', L.embossed], ['engraved', L.engraved]] as const as [value, label]}
        <button class="fx-row" class:selected={fx.relief === value} onclick={() => plain('relief', fx.relief === value ? false : value)}>
          <span class="fx-mini" style={effectCss({ relief: value })}>A</span>{label}<span class="menu-sub">{L.alsoOdt}</span>
        </button>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .fx-menu {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 232px;
  }

  /* Tiles and swatches sit in one grid per section, so every column lines up. */
  .fx-grid {
    display: grid;
    gap: 4px;
    padding: 4px;
  }
  .fx-grid.gallery, .fx-grid.four { grid-template-columns: repeat(4, 1fr); }
  .fx-grid.three { grid-template-columns: repeat(3, 1fr); }
  .fx-grid.six { grid-template-columns: auto repeat(6, 1fr); align-items: center; }
  .fx-size { font-size: 11px; color: var(--w-text-dim, var(--color-text-secondary)); white-space: nowrap; }

  .fx-menu .fx-tile {
    display: grid;
    place-items: center;
    width: auto;
    height: 44px;
    padding: 0;
    border: 1px solid var(--w-border, var(--color-border));
    border-radius: 4px;
    background: var(--color-page-bg, #fff);
  }
  .fx-menu .fx-tile.selected { outline: 2px solid var(--w-accent, var(--color-primary)); outline-offset: -1px; }

  .fx-sample {
    font: 700 26px/1 'Liberation Sans', Arial, sans-serif;
  }
  .fx-grid.six .fx-sample { font-size: 18px; }

  .fx-mini {
    display: inline-block;
    width: 18px;
    font: 700 15px/1 'Liberation Sans', Arial, sans-serif;
    color: var(--w-text);
  }

  .fx-label {
    padding: 6px 8px 2px;
    font-size: 11px;
    color: var(--w-text-dim, var(--color-text-secondary));
  }

  .fx-swatches {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 4px;
    padding: 4px 8px;
  }
  .fx-menu .fx-swatch {
    width: 100%;
    height: 20px;
    padding: 0;
    border: 1px solid var(--w-border-strong, var(--color-border));
    border-radius: 3px;
  }
  .fx-menu .fx-swatch.selected { outline: 2px solid var(--w-accent, var(--color-primary)); outline-offset: 1px; }

  .fx-rainbow {
    display: inline-block;
    width: 14px;
    height: 14px;
    margin-right: 8px;
    border-radius: 50%;
    background: conic-gradient(#e0483e, #e0b43e, #4caf50, #3ea6e0, #6a5ae0, #e03ea6, #e0483e);
  }
  .fx-custom { padding: 4px 8px 8px; }

  .fx-line {
    display: inline-block;
    width: 48px;
    border-top: solid currentColor;
  }

  .fx-back { font-weight: 600; }
</style>
